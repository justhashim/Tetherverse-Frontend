import { headers } from 'next/headers';

import {
    ApiUnavailableError,
    readBearerHeader,
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
import { RUN_ID_PATTERN } from '@/src/lib/server-run';

/**
 * Score read and write, forwarded to the Tetherverse API.
 *
 * The Excel Play token is passed through untouched and verified by the API
 * against the accounts backend, so this route has no identity logic and no
 * database code of its own. A rejected token can never fall through to an
 * anonymous write, because this route never decides what a token means.
 *
 * ── The run lifecycle, and why a token is no longer enough ──────────────────
 *
 * A write is only meaningful against a run the API opened for this player.
 * `POST /runs` issues the run id and the seed, starting a run replaces any
 * previous open run, and `POST /score` finalises exactly one run: it checks
 * that the id belongs to the caller, that it has not been submitted before,
 * that it has not expired, and that the claimed peak and coins are plausible
 * for the run's age. The old `{ score, coins }` body is rejected outright -
 * without a run id there is nothing to finalise, so holding a valid token no
 * longer lets a client write an arbitrary score.
 *
 * ── What this route can and cannot guarantee ────────────────────────────────
 *
 * The altitude still arrives from the client, which measured it by dividing the
 * player's pixel height by ten. Nothing here can check that, because this
 * process has no view of the simulation: it can refuse a malformed payload, an
 * unknown or cross-site request, but it cannot tell a climb from a hand-typed
 * number. Score integrity therefore lives in the API service, and the run id is
 * what gives it something to check the number against. This layer's job is to
 * refuse the malformed, the oversized and the cross-site before they reach it.
 *
 * That matters because the leaderboard is the game's one piece of shared state,
 * and a client that can name its own score owns it.
 */

/**
 * Score writes are once per run.
 *
 * Generous by a wide margin - a run lasts minutes, and a lost connection might
 * retry a few times - because the cost of being too tight is a player losing a
 * real score they earned, and the cost of being loose here is only that an
 * already-detected cheater gets more attempts per minute than they need.
 */
const SCORE_LIMIT = { limit: 30, windowMs: 60_000 };

export async function POST(request: Request) {
    try {
        // Cross-site writes are refused before anything else is spent on them.
        if (!isSameSiteOrigin(request)) {
            return refused(403, 'Cross-origin requests are not accepted');
        }

        const limited = consume(
            rateLimitKey('score:post', clientIdentity(request)),
            SCORE_LIMIT,
        );
        if (!limited.ok) {
            return refused(429, 'Too many score submissions', limited.retryAfter);
        }

        const body = await readJsonBody<{
            runId?: unknown;
            score?: unknown;
            coins?: unknown;
        }>(request);
        if (isRejected(body)) return body.response;
        const { runId, score, coins } = body;

        // The run id is the whole contract: it is what ties this number to a
        // run the API opened for this player. Refuse anything that could not
        // have come from `POST /runs` before it costs an upstream round trip.
        if (typeof runId !== 'string' || !RUN_ID_PATTERN.test(runId)) {
            return Response.json({ error: 'Invalid run id' }, { status: 400 });
        }

        // Reject a malformed score here rather than forwarding it, so a bad
        // payload costs one round trip less and the error names the actual
        // problem. A whole number of metres is required: a float is not a
        // rounding difference, it is a client that is not reporting an
        // altitude the game can actually produce.
        if (typeof score !== 'number' || !Number.isInteger(score) || score < 0) {
            return Response.json({ error: 'Invalid score value' }, { status: 400 });
        }

        // Coins are optional: a client from before the coin system posts none,
        // and treating that as an error would throw away a real score over a
        // new field. They are integers by construction, so `Math.floor` rather
        // than a tolerance: a fractional coin is a malformed request, not a
        // rounding difference.
        if (
            coins !== undefined &&
            (typeof coins !== 'number' || !Number.isInteger(coins) || coins < 0)
        ) {
            return Response.json({ error: 'Invalid coin value' }, { status: 400 });
        }

        const requestHeaders = await headers();

        return toResponse(
            await tetherverseApi.postScore(
                readBearerHeader(requestHeaders.get('authorization')),
                runId,
                score,
                typeof coins === 'number' ? coins : 0,
            ),
        );
    } catch (error) {
        if (error instanceof ApiUnavailableError) {
            return Response.json(
                { error: 'Failed to process score' },
                { status: 502 },
            );
        }
        console.error('Score Save Error:', error);
        return Response.json({ error: 'Failed to process score' }, { status: 500 });
    }
}

/**
 * Reads the caller's own best.
 *
 * Reads are not rate-limited: the game calls this once on boot and once on the
 * menu, a public score is not a secret worth defending, and the API has its own
 * view of the caller. Throttling it would mean a player on a flaky connection
 * finds their personal best missing.
 */
export async function GET() {
    try {
        const requestHeaders = await headers();

        return toResponse(
            await tetherverseApi.getScore(
                readBearerHeader(requestHeaders.get('authorization')),
            ),
        );
    } catch (error) {
        if (error instanceof ApiUnavailableError) {
            return Response.json({ error: 'Failed to fetch score' }, { status: 502 });
        }
        console.error('Score Fetch Error:', error);
        return Response.json({ error: 'Failed to fetch score' }, { status: 500 });
    }
}
