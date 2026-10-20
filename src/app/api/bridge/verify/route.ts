import { NextResponse } from 'next/server';

import {
    ApiUnavailableError,
    toResponse,
    tetherverseApi,
} from '@/src/lib/tetherverse-api';
import {
    clientIdentity,
    consume,
    isRejected,
    isSameSiteOrigin,
    rateLimitKey,
    readJsonBody,
    refused,
} from '@/src/lib/edge-guard';

/**
 * Verifies an Excel Play access token that arrived from the launcher frame.
 *
 * The token is only accepted once the Excel Play accounts backend confirms it, so
 * a tampered postMessage cannot invent an identity. The check itself lives in the
 * Tetherverse API, which keeps the accounts backend address out of this app
 * entirely; this route exists so the launcher bridge has an endpoint to call on its
 * own origin.
 *
 * ── Why this endpoint is the one to guard hardest ───────────────────────────
 *
 * It is the only route in this app that takes no credentials of its own and
 * spends the accounts backend's work in response to an attacker-chosen string.
 * That makes it three things at once: an oracle for guessing tokens, a way to
 * borrow this deployment's egress address to hammer an upstream that may rate
 * limit by source, and the cheapest place to make the whole app expensive. None
 * of those is fixed by the token being valid-or-not - a wrong answer is still an
 * answer, and it still cost someone a round trip.
 *
 * So the work here is bounded: a strict per-client budget, a cross-site check,
 * a body cap, and a length cap on the token itself.
 */

/**
 * Verification attempts per client per minute.
 *
 * Legitimate use is a handful per session - sign-in, an in-frame reload, the
 * leaderboard reading a display name - so thirty is several times what a real
 * player reaches. Guessing, by contrast, is unbounded by design: an attacker
 * wants millions of attempts, and this is the number that tells them they will
 * have to bring their own infrastructure to get them.
 */
const VERIFY_LIMIT = { limit: 30, windowMs: 60_000 };

/**
 * Longest token this route will forward.
 *
 * An access token is a few kilobytes at most. Without a cap, `request.json()`
 * will happily allocate and forward whatever it is given, and the upstream
 * accounts backend becomes the thing that pays for the allocation. Rejected here
 * so the cost stops at a string comparison.
 */
const MAX_TOKEN_LENGTH = 8_192;

export async function POST(request: Request) {
    try {
        // A cross-site page has no business asking this deployment to verify a
        // token: the only caller is our own launcher frame or our own document.
        if (!isSameSiteOrigin(request)) {
            return refused(403, 'Cross-origin requests are not accepted');
        }

        const limited = consume(
            rateLimitKey('bridge:verify', clientIdentity(request)),
            VERIFY_LIMIT,
        );
        if (!limited.ok) {
            return refused(429, 'Too many verification attempts', limited.retryAfter);
        }

        const body = await readJsonBody<{ token?: unknown }>(request);
        if (isRejected(body)) return body.response;

        const { token } = body;

        // The two rejections below deliberately return the same shape and the
        // same status. An attacker probing for which half of the check a
        // candidate failed learns nothing from the difference, and a genuine
        // client that has somehow produced an oversized token gets a 400 that
        // describes its request rather than its secret.
        if (typeof token !== 'string' || !token) {
            return NextResponse.json({ error: 'token is required' }, { status: 400 });
        }

        if (token.length > MAX_TOKEN_LENGTH) {
            return NextResponse.json({ error: 'token is required' }, { status: 400 });
        }

        return toResponse(await tetherverseApi.verifyToken(token));
    } catch (error) {
        if (error instanceof ApiUnavailableError) {
            return NextResponse.json(
                { error: 'Token could not be verified' },
                { status: 502 },
            );
        }
        console.error('Bridge verify error:', error);
        return NextResponse.json({ error: 'Token could not be verified' }, { status: 500 });
    }
}
