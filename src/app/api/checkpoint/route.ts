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
 * Proof-of-play checkpoint, forwarded to the Tetherverse API.
 *
 * The browser sends its peak altitude and banked coins every few seconds. The
 * API timestamps the sample and refuses a final score that is not anchored to
 * one, so this route is the difference between "a run happened" and "a client
 * posted a number". It forwards the bearer untouched; identity is still the
 * API's decision, never this route's.
 *
 * The body is small and the write is one row update, so the allowance is higher
 * than a score submission's. It is still bounded: a client that tries to flood
 * checkpoints hits the API's own minimum-gap check as well.
 */
const CHECKPOINT_LIMIT = { limit: 60, windowMs: 60_000 };

export async function POST(request: Request) {
    try {
        if (!isSameSiteOrigin(request)) {
            return refused(403, 'Cross-origin requests are not accepted');
        }

        const limited = consume(
            rateLimitKey('checkpoint:post', clientIdentity(request)),
            CHECKPOINT_LIMIT,
        );
        if (!limited.ok) {
            return refused(429, 'Too many checkpoints', limited.retryAfter);
        }

        const body = await readJsonBody<{
            runId?: unknown;
            score?: unknown;
            coins?: unknown;
        }>(request);
        if (isRejected(body)) return body.response;
        const { runId, score, coins } = body;

        if (typeof runId !== 'string' || !RUN_ID_PATTERN.test(runId)) {
            return Response.json({ error: 'Invalid run id' }, { status: 400 });
        }

        if (typeof score !== 'number' || !Number.isInteger(score) || score < 0) {
            return Response.json({ error: 'Invalid score value' }, { status: 400 });
        }

        if (
            coins !== undefined &&
            (typeof coins !== 'number' || !Number.isInteger(coins) || coins < 0)
        ) {
            return Response.json({ error: 'Invalid coin value' }, { status: 400 });
        }

        const requestHeaders = await headers();

        return toResponse(
            await tetherverseApi.postCheckpoint(
                readBearerHeader(requestHeaders.get('authorization')),
                runId,
                score,
                typeof coins === 'number' ? coins : 0,
            ),
        );
    } catch (error) {
        if (error instanceof ApiUnavailableError) {
            return Response.json(
                { error: 'Failed to record checkpoint' },
                { status: 502 },
            );
        }
        console.error('Checkpoint Save Error:', error);
        return Response.json(
            { error: 'Failed to record checkpoint' },
            { status: 500 },
        );
    }
}
