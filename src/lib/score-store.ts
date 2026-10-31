/**
 * Where a climb's number lives, and what to do when it cannot be delivered.
 *
 * The score of record is the API's. This module exists so that the browser is
 * only ever a *cache and an outbox* around it:
 *
 *   - `readStoredBest` is a placeholder for the menu's first paint, keyed by
 *     player so a shared browser cannot inherit someone else's best.
 *     `fetchServerBest` is the answer, and it always wins.
 *
 *   - A finished run is written to the outbox *before* the network is touched,
 *     so a tab that closes mid-request, a dead connection, or a deploy that
 *     unloads the page turns into a delayed save rather than a lost climb.
 *
 * Why the outbox matters more than it looks: `POST /runs` replaces the run a
 * player already has open. Start a new climb while a finished one is still
 * unsent and that finished run can never be scored again, because the API has
 * already moved on to the new id. So the caller drains the outbox first and
 * refuses to start until it is empty - see `drainPendingRuns`.
 *
 * Both stored shapes carry a checksum over every field, so a row that was
 * truncated or edited by hand is dropped here instead of being sent. That is a
 * corruption check, not a security boundary: a score is only ever as trustworthy
 * as the API's judgement of it (see `finalize_run()`), and nothing stored in a
 * browser can change that. The one thing the checksum does protect is the queue's
 * ability to drain at all - a poisoned row used to sit in it forever and block
 * every climb that followed.
 *
 * Every storage access is wrapped: Safari in private mode throws on
 * `localStorage` writes, and a climb the player just earned must not be lost to
 * a storage quota. When the write fails the run still goes out over the
 * network; only the retry is lost, which is the graceful half of the trade.
 */

import { readClientAccessToken } from './server-run';

const BEST_KEY_PREFIX = 'tetherverse:best:';
const PENDING_KEY = 'tetherverse:pending-runs';

/**
 * The most finished runs kept for retry.
 *
 * A bound rather than a policy: an offline session can finish several climbs,
 * and an unbounded list would grow until the quota fails. Eight is more than a
 * player can plausibly finish without a connection coming back, and the oldest
 * go first.
 */
const MAX_PENDING_RUNS = 8;

/** The facts a run is scored on, captured the moment it ends. */
export interface PendingRun {
    runId: string;
    /** This run's peak altitude in metres, already clamped by the caller. */
    score: number;
    /** This run's banked coins - not the lifetime total. */
    coins: number;
    /**
     * The account the run belongs to.
     *
     * Empty when the scene could not name one; such an entry is still drained by
     * whoever is signed in, because a save is always preferred to a stranded
     * row. Everything else is scoped, so signing in as someone else on the same
     * machine cannot post a stranger's climb to their board.
     */
    owner: string;
    /** When the run ended, for ordering and for evicting the oldest. */
    at: number;
}

/** How a save went, for the overlay to say out loud. */
export type RunSaveStatus = 'saving' | 'saved' | 'pending' | 'rejected' | 'unscored';

export interface RunSaveState {
    status: RunSaveStatus;
    /** One short line, shown only when `status` is `pending` or `rejected`. */
    message?: string;
}

export interface RunSaveResult extends RunSaveState {
    /** The player's best after the save, when the API reported one. */
    best?: number;
    /** The player's coin total after the save, when the API reported one. */
    coins?: number;
}

export interface DrainResult {
    /** How many queued runs went through. */
    saved: number;
    /** How many are still waiting, including runs belonging to other players. */
    remaining: number;
    /** The last thing that went wrong, if anything did. */
    message: string | null;
    /** The best the API reported along the way, if it reported one. */
    best: number;
}

/* --------------------------------------------------------------- the checksums */

/**
 * A per-install salt for the stored digests.
 *
 * Not a secret, and cannot be one: it lives in the same storage as the rows it
 * protects, so anyone who can edit a row can read the salt. It only makes the
 * digest specific to this browser, which is enough for a row copied in from
 * somewhere else to fail.
 */
const SALT_KEY = 'tetherverse:checksum-salt';

/** Resolved once per page, and kept even when storage turns out to be unusable. */
let installSaltCache: string | null = null;

function randomSalt(): string {
    const bytes = new Uint8Array(16);
    if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
        crypto.getRandomValues(bytes);
    } else {
        for (let index = 0; index < bytes.length; index += 1) {
            bytes[index] = Math.floor(Math.random() * 256);
        }
    }
    return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function installSalt(): string {
    if (installSaltCache !== null) return installSaltCache;

    let salt = '';
    try {
        salt = window.localStorage.getItem(SALT_KEY) ?? '';
        if (!salt) {
            salt = randomSalt();
            window.localStorage.setItem(SALT_KEY, salt);
        }
    } catch {
        // Storage is unusable. Fall back to a salt that lasts as long as this
        // page, so rows written and read in this session still agree; they would
        // not survive a reload, but neither would the rows.
        salt = salt || randomSalt();
    }

    installSaltCache = salt;
    return salt;
}

/**
 * FNV-1a, run twice with different offsets, to 64 bits.
 *
 * Deliberately not SHA-256, and the reason is not laziness: `crypto.subtle` is
 * asynchronous, and the outbox write has to finish synchronously the instant a
 * run ends, or the durability this module exists for is gone. A cryptographic
 * digest would not buy anything either - the key would ship inside this bundle,
 * so anyone who can edit the stored row can read the key and recompute. What this
 * catches is a row that was truncated, corrupted, or edited by hand without
 * recomputing: those used to be sent and refused, and are now dropped before they
 * cost a request.
 */
function fnv1a(text: string, offset: number): number {
    let hash = offset >>> 0;
    for (let index = 0; index < text.length; index += 1) {
        hash ^= text.charCodeAt(index);
        hash = Math.imul(hash, 0x01000193) >>> 0;
    }
    return hash >>> 0;
}

function digest(text: string): string {
    const low = fnv1a(text, 0x811c9dc5);
    const high = fnv1a(text, 0x9e3779b9);
    return low.toString(16).padStart(8, '0') + high.toString(16).padStart(8, '0');
}

/**
 * The canonical text a run's checksum covers.
 *
 * JSON over a fixed-order tuple rather than concatenation, because "12" next to
 * "3" is the same string as "1" next to "23". Every stored field is included, so
 * changing any one of them - including the owner, which decides whose board the
 * run lands on - invalidates the digest.
 */
function runChecksum(row: PendingRun, salt: string): string {
    return digest(`${salt}\u0000${JSON.stringify([row.runId, row.score, row.coins, row.owner, row.at])}`);
}

function bestChecksum(owner: string, value: number, salt: string): string {
    return digest(`${salt}\u0000${JSON.stringify(['best', owner, value])}`);
}

/* ------------------------------------------------------------------ the best */

/**
 * The cached best for one player, or 0.
 *
 * Only ever a placeholder: the menu paints with it and then replaces it with the
 * server's number a moment later. A missing, unreadable, negative or checksum-less
 * value reads as 0 rather than throwing, because this runs during render - and
 * because a value that the digest does not cover cannot be shown as this player's.
 */
export function readStoredBest(owner: string): number {
    if (typeof window === 'undefined' || !owner) return 0;
    try {
        const raw = window.localStorage.getItem(BEST_KEY_PREFIX + owner);
        if (!raw) return 0;

        const record = JSON.parse(raw) as { v?: unknown; c?: unknown };
        if (typeof record?.v !== 'number' || !Number.isFinite(record.v)) return 0;
        if (typeof record.c !== 'string') return 0;
        if (record.c !== bestChecksum(owner, record.v, installSalt())) return 0;

        return record.v > 0 ? Math.floor(record.v) : 0;
    } catch {
        return 0;
    }
}

/** Replaces the cached best. Never called with a guess - only with the API's. */
export function writeStoredBest(owner: string, best: number): void {
    if (typeof window === 'undefined' || !owner) return;
    if (!Number.isFinite(best) || best < 0) return;

    const value = Math.floor(best);
    try {
        window.localStorage.setItem(
            BEST_KEY_PREFIX + owner,
            JSON.stringify({ v: value, c: bestChecksum(owner, value, installSalt()) }),
        );
    } catch {
        // A full or disabled store costs the fast first paint, not the score.
    }
}

/** Forgets the cached best, when the server says this player has none. */
export function clearStoredBest(owner: string): void {
    if (typeof window === 'undefined' || !owner) return;
    try {
        window.localStorage.removeItem(BEST_KEY_PREFIX + owner);
    } catch {
        // Nothing to do; the next server read will overwrite it anyway.
    }
}

/* ----------------------------------------------------------------- the outbox */

function isPendingRun(value: unknown): value is PendingRun {
    if (typeof value !== 'object' || value === null) return false;
    const run = value as Partial<PendingRun>;
    return (
        typeof run.runId === 'string' &&
        run.runId.length > 0 &&
        typeof run.score === 'number' &&
        Number.isInteger(run.score) &&
        run.score >= 0 &&
        typeof run.coins === 'number' &&
        Number.isInteger(run.coins) &&
        run.coins >= 0 &&
        typeof run.owner === 'string' &&
        typeof run.at === 'number'
    );
}

/**
 * A row as it sits in storage: the run, plus the digest over it.
 *
 * The digest is not part of `PendingRun`, so nothing downstream can mistake it for
 * a fact about the climb.
 */
type StoredPendingRun = PendingRun & { checksum: string };

/** Everything waiting to be sent, oldest first. Bad or altered entries are dropped. */
export function readPendingRuns(): PendingRun[] {
    if (typeof window === 'undefined') return [];

    try {
        const raw = window.localStorage.getItem(PENDING_KEY);
        if (!raw) return [];

        const parsed: unknown = JSON.parse(raw);
        if (!Array.isArray(parsed)) return [];

        const salt = installSalt();

        return parsed
            .filter((value): value is StoredPendingRun => {
                if (!isPendingRun(value)) return false;

                const stored = value as StoredPendingRun;
                if (typeof stored.checksum !== 'string') {
                    // Written before checksums existed, or with the field stripped.
                    // Either way the row is not covered, so it is not trusted.
                    console.warn('[tetherverse] dropped an outbox row with no checksum');
                    return false;
                }

                if (stored.checksum !== runChecksum(stored, salt)) {
                    // Edited by hand, or truncated by a failed write. Sending it
                    // would be refused by the API and would leave the outbox
                    // unable to drain, which is the one thing that must not
                    // happen: a stuck row blocks the next climb.
                    console.warn('[tetherverse] dropped an outbox row whose checksum did not match');
                    return false;
                }

                return true;
            })
            .map((stored) => ({
                runId: stored.runId,
                score: stored.score,
                coins: stored.coins,
                owner: stored.owner,
                at: stored.at,
            }))
            .sort((a, b) => a.at - b.at);
    } catch {
        return [];
    }
}

function writePendingRuns(runs: PendingRun[]): void {
    if (typeof window === 'undefined') return;

    try {
        if (runs.length === 0) {
            window.localStorage.removeItem(PENDING_KEY);
            return;
        }

        const salt = installSalt();
        const stored: StoredPendingRun[] = runs.map((row) => ({
            ...row,
            checksum: runChecksum(row, salt),
        }));

        window.localStorage.setItem(PENDING_KEY, JSON.stringify(stored));
    } catch {
        // The immediate POST below is still attempted; only the retry is lost.
    }
}

/**
 * Queues a finished run, replacing any earlier record of the same one.
 *
 * Called synchronously the instant a run ends, before any request, because the
 * window between "the run is over" and "the run is saved" is exactly the window
 * this whole module exists to cover.
 */
export function queuePendingRun(run: Omit<PendingRun, 'at'>): void {
    const entry: PendingRun = { ...run, at: Date.now() };
    const others = readPendingRuns().filter((pending) => pending.runId !== entry.runId);
    writePendingRuns([...others, entry].slice(-MAX_PENDING_RUNS));
}

/** Drops a run from the outbox: it was recorded, or it never can be. */
export function forgetPendingRun(runId: string): void {
    const remaining = readPendingRuns().filter((pending) => pending.runId !== runId);
    writePendingRuns(remaining);
}

/** The runs still waiting that this player is allowed to send. */
export function pendingRunsFor(owner: string): PendingRun[] {
    return readPendingRuns().filter((pending) => pending.owner === '' || pending.owner === owner);
}

/* ------------------------------------------------------------------- the API */

/**
 * Sends one queued run.
 *
 * The status codes are the contract, and they split three ways:
 *
 *   - 2xx, and 409: the run is recorded. A duplicate is the *good* race - the
 *     first attempt landed and this one arrived twice - so it clears the row
 *     rather than being reported as a failure.
 *   - 400, 403, 404, 410, 422: this run can never be scored. Malformed, someone
 *     else's, unknown, past its expiry window, or refused as mechanically
 *     implausible. Retrying would be a loop, so the row is dropped and the player
 *     is told the climb did not count.
 *   - 401, 408, 425, 429, 5xx and a dead network: not the run's fault. The row is
 *     kept, because the save is still worth making and the token can be refreshed
 *     by signing in again.
 *
 * 403 and 422 used to fall into the last group, which was the worst of both
 * worlds: both are permanent, so the row stayed queued forever, and a queue that
 * cannot drain is a player who can never start another climb. A refusal that can
 * never succeed has to be given up on out loud.
 */
export async function submitPendingRun(run: PendingRun): Promise<RunSaveResult> {
    const token = readClientAccessToken();
    if (!token) {
        return { status: 'pending', message: 'Sign in again to save this climb' };
    }

    let response: Response;
    try {
        response = await fetch('/api/score', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${token}`,
            },
            body: JSON.stringify({
                runId: run.runId,
                score: run.score,
                coins: run.coins,
            }),
        });
    } catch {
        return { status: 'pending', message: 'No connection — will retry' };
    }

    const data = (await response.json().catch(() => null)) as
        | { maxAltitude?: unknown; coins?: unknown }
        | null;

    if (response.ok || response.status === 409) {
        forgetPendingRun(run.runId);
        const best =
            typeof data?.maxAltitude === 'number' ? Math.max(0, Math.floor(data.maxAltitude)) : undefined;
        const coins = typeof data?.coins === 'number' ? Math.max(0, Math.floor(data.coins)) : undefined;
        return { status: 'saved', best, coins };
    }

    if (response.status === 404 || response.status === 410) {
        forgetPendingRun(run.runId);
        return { status: 'rejected', message: 'This run expired before it saved' };
    }

    if (response.status === 400) {
        forgetPendingRun(run.runId);
        return { status: 'rejected', message: 'The server refused this climb' };
    }

    if (response.status === 403) {
        // The run id belongs to a different account - a shared browser, or a row
        // whose owner was rewritten. Nothing about retrying can fix that.
        forgetPendingRun(run.runId);
        return { status: 'rejected', message: 'This climb belongs to another account' };
    }

    if (response.status === 422) {
        // `finalize_run()` judged the peak impossible for the time the run had
        // been open. Permanent by definition, and the honest thing to say.
        forgetPendingRun(run.runId);
        return { status: 'rejected', message: 'The server found this climb implausible' };
    }

    if (response.status === 401) {
        return { status: 'pending', message: 'Sign in again to save this climb' };
    }

    return { status: 'pending', message: 'The server did not answer — will retry' };
}

/**
 * Sends everything waiting for this player, oldest first.
 *
 * Serial rather than parallel: the API rate-limits score writes, and these are
 * whole runs rather than fragments, so there is no time to be saved by
 * overlapping them. It stops at the first entry that is still worth retrying,
 * because a request that could not reach the server says nothing about the run
 * behind it - they will all be retried on the same next attempt.
 *
 * One drain at a time: the menu's boot fetch and the first press of the play
 * disc can both ask, and two overlapping drains would send the same run twice.
 */
let inFlightDrain: Promise<DrainResult> | null = null;

export function drainPendingRuns(owner: string): Promise<DrainResult> {
    if (inFlightDrain) return inFlightDrain;

    const run = (async (): Promise<DrainResult> => {
        let saved = 0;
        let best = 0;
        let message: string | null = null;

        for (const entry of pendingRunsFor(owner)) {
            const result = await submitPendingRun(entry);
            if (result.status === 'saved') {
                saved += 1;
                if (typeof result.best === 'number') best = Math.max(best, result.best);
                if (typeof result.best === 'number' && owner) writeStoredBest(owner, result.best);
                continue;
            }
            message = result.message ?? message;
            if (result.status === 'pending') break;
            // A rejected run is gone from the outbox; the next one may still go.
        }

        return {
            saved,
            remaining: pendingRunsFor(owner).length,
            message,
            best,
        };
    })().finally(() => {
        inFlightDrain = null;
    });

    inFlightDrain = run;
    return run;
}

/**
 * The player's best, as the API knows it.
 *
 * Null means "not answered" and is deliberately not the same as `best: 0`: the
 * menu must keep its cached placeholder on a failed read rather than announcing
 * that a player with a record has never climbed. A 200 with a best of zero *is*
 * an answer, and the caller clears the cache on it.
 */
export async function fetchServerBest(): Promise<{ best: number; coins: number } | null> {
    const token = readClientAccessToken();
    if (!token) return null;

    let response: Response;
    try {
        response = await fetch('/api/score', {
            headers: { Authorization: `Bearer ${token}` },
        });
    } catch {
        return null;
    }

    if (!response.ok) return null;

    const data = (await response.json().catch(() => null)) as
        | { success?: unknown; maxAltitude?: unknown; coins?: unknown }
        | null;

    if (!data || data.success === false) return null;
    if (typeof data.maxAltitude !== 'number' || !Number.isFinite(data.maxAltitude)) return null;

    return {
        best: Math.max(0, Math.floor(data.maxAltitude)),
        coins: typeof data.coins === 'number' ? Math.max(0, Math.floor(data.coins)) : 0,
    };
}
