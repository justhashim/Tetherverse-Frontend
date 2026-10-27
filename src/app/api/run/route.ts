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
    isSameSiteOrigin,
    rateLimitKey,
    refused,
} from '@/src/lib/edge-guard';

/**
 * Run creation, forwarded to the Tetherverse API.
 *
 * A run has to be opened before play and again before every rerun: the API
 * chooses the run id and the level seed, and `POST /score` rejects any score
 * that is not attached to the player's current open run. This route is
 * therefore the only door into a scorable climb, and it takes no body - the
 * player comes from the forwarded bearer, never from anything the browser
 * claims.
 *
 * The token is passed through untouched and verified by the API against the
 * accounts backend, so this route has no identity logic of its own. Starting a
 * run also replaces the player's previous open run, which is what makes an
 * abandoned attempt unusable instead of letting a client stockpile run ids.
 */

/**
 * Runs are started by a human pressing play, not by the frame loop.
 *
 * Twenty a minute is far more than a player needs - a run lasts minutes, and
 * even a run of quick deaths will not approach it - while a client trying to
 * farm run ids hits a wall early. The cost of being too tight is a player
 * seeing a refusal on a legitimate rerun, so the allowance stays generous.
 */
const RUN_LIMIT = { limit: 20, windowMs: 60_000 };

export async function POST(request: Request) {
    try {
        // Cross-site writes are refused before anything else is spent on them.
        if (!isSameSiteOrigin(request)) {
            return refused(403, 'Cross-origin requests are not accepted');
        }

        const limited = consume(
            rateLimitKey('run:post', clientIdentity(request)),
            RUN_LIMIT,
        );
        if (!limited.ok) {
            return refused(429, 'Too many runs started', limited.retryAfter);
        }

        const requestHeaders = await headers();

        return toResponse(
            await tetherverseApi.startRun(
                readBearerHeader(requestHeaders.get('authorization')),
            ),
        );
    } catch (error) {
        if (error instanceof ApiUnavailableError) {
            return Response.json(
                { error: 'Failed to start run' },
                { status: 502 },
            );
        }
        console.error('Run Start Error:', error);
        return Response.json({ error: 'Failed to start run' }, { status: 500 });
    }
}
