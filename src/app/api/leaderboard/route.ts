import {
    ApiUnavailableError,
    toResponse,
    tetherverseApi,
} from '@/src/lib/tetherverse-api';
import { clientIdentity, consume, rateLimitKey, refused } from '@/src/lib/edge-guard';

// Next.js caches aggressively. This must stay fresh, because the leaderboard is
// the page players land on to compare personal bests.
export const dynamic = 'force-dynamic';

/**
 * The public leaderboard, forwarded to the Tetherverse API.
 *
 * No token is needed: the API reads only `player_points`, which carries a display
 * name and avatar but no email, so the leaderboard exposes no player identity and
 * never touches the profile table.
 *
 * ── Why an unauthenticated read is still budgeted ───────────────────────────
 *
 * Being public makes it the cheapest way to make this deployment expensive, and
 * the API it forwards to pays for every request whether the answer is cached or
 * not. The limit is deliberately loose - a leaderboard panel that re-renders on
 * every hover should not be counting - but it is not infinite, which is what
 * matters: a scraper now has a rate to work around instead of an open pipe.
 *
 * There is no origin check here, because a GET that changes nothing is not a
 * CSRF target. Refusing cross-site reads would also break a bookmarked link or
 * an embed of the panel, for no security gain.
 */

/** Generous for a human, useless for a scraper. */
const LEADERBOARD_LIMIT = { limit: 60, windowMs: 60_000 };

export async function GET(request: Request) {
    try {
        const limited = consume(
            rateLimitKey('leaderboard:get', clientIdentity(request)),
            LEADERBOARD_LIMIT,
        );
        if (!limited.ok) {
            return refused(429, 'Too many requests', limited.retryAfter);
        }

        return toResponse(await tetherverseApi.getLeaderboard());
    } catch (error) {
        if (error instanceof ApiUnavailableError) {
            return Response.json({ error: 'Failed to fetch leaderboard' }, { status: 502 });
        }
        console.error('Leaderboard fetch error:', error);
        return Response.json({ error: 'Failed to fetch leaderboard' }, { status: 500 });
    }
}
