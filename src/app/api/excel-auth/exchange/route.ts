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
 * Exchanges an Excel Play refresh token for an access token.
 *
 * The refresh token arrives in the redirect after sign-in. Exchanging it through the
 * API keeps the accounts backend URL out of this app entirely, and means the
 * browser only ever handles the short-lived access token.
 *
 * A refresh token is the long-lived half of a session - losing it means losing
 * the account, not losing one request - so this route is budgeted tighter than
 * the others. Six per minute is far more than one player needs: a session
 * refreshes on boot and then periodically, and nothing else calls it.
 */

const EXCHANGE_LIMIT = { limit: 6, windowMs: 60_000 };

/** Longest refresh token forwarded. See the same bound in bridge/verify. */
const MAX_REFRESH_TOKEN_LENGTH = 8_192;

export async function POST(request: Request) {
    try {
        // Exchanges happen on a redirect back from the accounts frontend, which
        // navigates this document directly and therefore sends no `Origin` at
        // all - so the allow-empty rule in `isSameSiteOrigin` is what lets the
        // real sign-in flow through while refusing a page on another site.
        if (!isSameSiteOrigin(request)) {
            return refused(403, 'Cross-origin requests are not accepted');
        }

        const limited = consume(
            rateLimitKey('excel:exchange', clientIdentity(request)),
            EXCHANGE_LIMIT,
        );
        if (!limited.ok) {
            return refused(429, 'Too many token exchanges', limited.retryAfter);
        }

        const body = await readJsonBody<{ refreshToken?: unknown }>(request);
        if (isRejected(body)) return body.response;

        const { refreshToken } = body;

        if (typeof refreshToken !== 'string' || !refreshToken) {
            return NextResponse.json(
                { error: 'refreshToken is required' },
                { status: 400 },
            );
        }

        if (refreshToken.length > MAX_REFRESH_TOKEN_LENGTH) {
            return NextResponse.json(
                { error: 'refreshToken is required' },
                { status: 400 },
            );
        }

        return toResponse(await tetherverseApi.exchangeRefreshToken(refreshToken));
    } catch (error) {
        if (error instanceof ApiUnavailableError) {
            return NextResponse.json(
                { error: 'Could not exchange the refresh token' },
                { status: 502 },
            );
        }
        console.error('Excel auth exchange error:', error);
        return NextResponse.json(
            { error: 'Could not exchange the refresh token' },
            { status: 500 },
        );
    }
}
