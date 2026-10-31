/**
 * Client-side helper for the server-managed run lifecycle.
 *
 * A climb is only scorable against a run the API opened for this player: the
 * server chooses the run id and the level seed, and `POST /score` accepts
 * nothing else. This module is the browser's side of that handshake, kept out
 * of the Phaser scene and the React page so both can share one definition of
 * what a valid run looks like.
 */

/** The exact shape of a run id issued by `POST /runs`. */
export const RUN_ID_PATTERN = /^[A-Za-z0-9_-]{43}$/;

/** What `POST /runs` returns, and what the game needs to start a climb. */
export interface ServerRun {
    runId: string;
    seed: number;
    expiresAt: string;
}

/**
 * The access token the rest of the app is already holding.
 *
 * Both auth paths write the same global: the launcher bridge sets it from a
 * postMessage, and standalone sign-in sets it from the token exchange. The
 * sessionStorage keys are the fallback for a reload that lands before either
 * hook has run, so starting a run does not fail on the first click after a
 * refresh.
 */
export function readClientAccessToken(): string | null {
    if (typeof window === 'undefined') return null;

    const injected = (window as Window & {
        __tetherverseAuthToken?: string | null;
    }).__tetherverseAuthToken;

    return (
        injected ??
        sessionStorage.getItem('tetherverse:excel-access-token') ??
        sessionStorage.getItem('tetherverse:bridge-token')
    );
}

/** Pulls the API's own error message out of a failed response, if it sent one. */
function errorMessage(payload: unknown): string | null {
    if (typeof payload !== 'object' || payload === null) return null;
    const message = (payload as { error?: unknown }).error;
    return typeof message === 'string' && message.length > 0 ? message : null;
}

/**
 * Sends one proof-of-play sample for the run in progress.
 *
 * The API anchors the final score to the latest accepted sample, so this is not
 * optional bookkeeping. It returns false rather than throwing: a dropped
 * checkpoint is a reason to try again on the next tick, not a reason to end the
 * climb. The final save sends one more sample before the score, which is what
 * makes a last-second network blip survivable.
 */
export async function sendRunCheckpoint(
    runId: string,
    score: number,
    coins: number,
): Promise<boolean> {
    const token = readClientAccessToken();
    if (!token) return false;

    try {
        const response = await fetch('/api/checkpoint', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${token}`,
            },
            body: JSON.stringify({ runId, score, coins }),
        });

        return response.ok;
    } catch {
        return false;
    }
}

/**
 * Opens a new run for the signed-in player.
 *
 * Starting a run is not optional bookkeeping: without one the climb cannot be
 * scored at all. Every failure here is therefore surfaced to the caller rather
 * than swallowed, so the menu can refuse to start an unscored run instead of
 * letting the player climb for nothing.
 */
export async function startServerRun(): Promise<ServerRun> {
    const token = readClientAccessToken();
    if (!token) {
        throw new Error('Sign in again to start a scored climb.');
    }

    let response: Response;
    try {
        response = await fetch('/api/run', {
            method: 'POST',
            headers: { Authorization: `Bearer ${token}` },
        });
    } catch {
        throw new Error('Could not reach the server to start this climb.');
    }

    let payload: unknown;
    try {
        payload = await response.json();
    } catch {
        throw new Error('The server returned an unreadable run.');
    }

    if (!response.ok) {
        const retryAfter = response.headers.get('retry-after');
        const suffix = retryAfter ? ` Try again in ${retryAfter}s.` : '';
        throw new Error(
            `${errorMessage(payload) ?? 'Could not start this climb.'}${suffix}`,
        );
    }

    const data = payload as Partial<ServerRun>;

    if (typeof data.runId !== 'string' || !RUN_ID_PATTERN.test(data.runId)) {
        throw new Error('The server returned an invalid run id.');
    }

    if (
        typeof data.seed !== 'number' ||
        !Number.isInteger(data.seed) ||
        data.seed < 0 ||
        data.seed > 0xffffffff
    ) {
        throw new Error('The server returned an invalid run seed.');
    }

    if (
        typeof data.expiresAt !== 'string' ||
        Number.isNaN(Date.parse(data.expiresAt))
    ) {
        throw new Error('The server returned an invalid run expiry.');
    }

    return {
        runId: data.runId,
        seed: data.seed,
        expiresAt: data.expiresAt,
    };
}
