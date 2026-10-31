/**
 * Client for the Tetherverse API.
 *
 * The frontend holds no database code, no Postgres credentials, and no Supabase
 * keys. It forwards requests to the API service and returns what comes back.
 *
 * This is the BFF layer, and it exists for three reasons:
 *
 *  1. The `tetherverse` schema is not exposed to the Supabase Data API, so the
 *     browser could not read it even if it wanted to. Only the API service can.
 *  2. The API's address is never sent to the browser, so the service topology is
 *     not published.
 *  3. The Excel Play token is forwarded as an opaque bearer. The API verifies it
 *     against the accounts backend itself, so this layer never needs to, and never
 *     needs the accounts backend's address either.
 */

/**
 * Base URL of the Tetherverse API, server-side only.
 *
 * This must never be prefixed with NEXT_PUBLIC_: doing so would inline it into the
 * client bundle and publish the service address.
 *
 * Read from the Worker's own configuration at runtime, not baked in at build time,
 * so the address can change without rebuilding the app. That matters while the API
 * is still to be deployed. The localhost default is development only: in production
 * an unset address is a deployment mistake, and quietly calling localhost would
 * turn it into a 502 that reads like the API is down.
 */
const CONFIGURED_API_URL = (process.env.TETHERVERSE_API_URL ?? '')
    .trim()
    .replace(/\/+$/, '');

const API_URL =
    CONFIGURED_API_URL ||
    (process.env.NODE_ENV === 'production' ? '' : 'http://localhost:4000');

/** The API sits one network hop away, so it needs a real timeout. */
const TIMEOUT_MS = 10_000;

/** Identifies this caller in the API's logs. */
const CLIENT = 'tetherverse-frontend';

export interface ApiResponse {
    status: number;
    body: unknown;
}

/**
 * Forwards a request to the API.
 *
 * Only the `Authorization` header is passed through, and it is passed to the API
 * rather than consumed here. The set of forwarded headers is an explicit allowlist
 * rather than a copy of the incoming ones, so a header added to the browser request
 * later cannot leak through by accident.
 */
async function forward(
    path: string,
    init: {
        method: 'GET' | 'POST';
        authorization?: string | null;
        body?: string;
    },
): Promise<ApiResponse> {
    if (!API_URL) {
        // No address, no request. Saying so beats attempting localhost, which
        // fails as a connection error and blames the wrong service.
        console.error(
            '[tetherverse-api] TETHERVERSE_API_URL is not configured. Set it as a ' +
                'Worker variable (wrangler.toml [vars], or the dashboard).',
        );
        throw new ApiUnavailableError(path);
    }

    const headers: Record<string, string> = { 'x-tetherverse-client': CLIENT };

    if (init.authorization) {
        headers.authorization = init.authorization;
    }

    if (init.body !== undefined) {
        headers['content-type'] = 'application/json';
    }

    let response: Response;
    try {
        response = await fetch(`${API_URL}${path}`, {
            method: init.method,
            headers,
            body: init.body,
            cache: 'no-store',
            signal: AbortSignal.timeout(TIMEOUT_MS),
        });
    } catch (error) {
        // The API being unreachable is the API's problem to report, but from here it
        // looks like the game is broken. Say which side failed so a log makes sense.
        const reason = error instanceof Error ? error.message : String(error);
        console.error(`[tetherverse-api] ${init.method} ${path} failed:`, reason);
        throw new ApiUnavailableError(path);
    }

    const body = await response.json().catch(() => null);

    // A 5xx from here is usually the API's own failure passed straight through,
    // and the browser shows only the number. Log the endpoint and the status so
    // a tail is enough to tell "the API is broken" from "this route threw".
    if (response.status >= 500) {
        const detail = body === null ? '(no body)' : JSON.stringify(body).slice(0, 300);
        console.error(
            `[tetherverse-api] ${init.method} ${path} -> ${response.status} ${detail}`,
        );
    }

    return { status: response.status, body };
}

/** The API could not be reached at all, so no status of its own to report. */
export class ApiUnavailableError extends Error {
    constructor(path: string) {
        super(`Tetherverse API is unreachable (${path})`);
        this.name = 'ApiUnavailableError';
    }
}

/**
 * Passes an Authorization header through only if it is a bearer token.
 *
 * The header is forwarded whole rather than unwrapped, so the API performs exactly
 * the parse it would have performed on a direct request. Anything that is not a
 * bearer becomes null and is simply not forwarded, which leaves the API to reject
 * the request on its own terms.
 */
export function readBearerHeader(header: string | null): string | null {
    if (!header) return null;
    return /^Bearer\s+\S/i.test(header.trim()) ? header.trim() : null;
}

/**
 * Reshapes whatever the API returned into a Next.js Response.
 *
 * When the API produced no parseable body, which is what happens if something
 * upstream terminates the connection, the status alone would describe a successful
 * request as an empty success. Substituting a 502 keeps the client-facing contract
 * honest.
 */
export function toResponse(result: ApiResponse): Response {
    if (result.body === null || result.body === undefined) {
        return Response.json(
            { error: 'The Tetherverse API returned an empty response' },
            { status: result.status >= 400 ? result.status : 502 },
        );
    }

    return Response.json(result.body, { status: result.status });
}

export const tetherverseApi = {
    verifyToken: (token: string) =>
        forward('/auth/verify', {
            method: 'POST',
            body: JSON.stringify({ token }),
        }),

    exchangeRefreshToken: (refreshToken: string) =>
        forward('/auth/exchange', {
            method: 'POST',
            body: JSON.stringify({ refreshToken }),
        }),

    getScore: (authorization: string | null) =>
        forward('/score', { method: 'GET', authorization }),

    /**
     * Opens a run and returns the server's identity and seed for it.
     *
     * No body: the API derives the player from the bearer, picks the run id and
     * the seed itself, and replaces any run that player already had open.
     */
    startRun: (authorization: string | null) =>
        forward('/runs', { method: 'POST', authorization }),

    /**
     * Records one proof-of-play sample for an open run.
     *
     * The final score is only accepted when it is anchored to one of these
     * samples, so a client that opens a run and later posts a number has nothing
     * to anchor to. `score` is the run's peak so far, not the live altitude.
     */
    postCheckpoint: (
        authorization: string | null,
        runId: string,
        score: number,
        coins = 0,
    ) =>
        forward(`/runs/${encodeURIComponent(runId)}/checkpoint`, {
            method: 'POST',
            authorization,
            body: JSON.stringify({ score, coins }),
        }),

    /**
     * Finalises one run.
     *
     * `runId` is the only id the API will accept for this attempt, so a token
     * alone is no longer enough to write a score. `score` is this run's peak and
     * `coins` is this run's banked haul, not the player's persistent total.
     */
    postScore: (
        authorization: string | null,
        runId: string,
        score: number,
        coins = 0,
    ) =>
        forward('/score', {
            method: 'POST',
            authorization,
            body: JSON.stringify({ runId, score, coins }),
        }),

    getLeaderboard: () => forward('/leaderboard', { method: 'GET' }),
};