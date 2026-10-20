/**
 * Request hardening shared by every API route.
 *
 * The frontend holds no database and no identity logic of its own - it forwards
 * to the Tetherverse API - so everything it CAN do to protect itself has to
 * happen at this boundary: who is asking, how often, how much they sent, and
 * whether the request could have come from another site.
 *
 * ── What this does NOT do ────────────────────────────────────────────────────
 *
 * The counters live in a module-level Map, so they are per isolate and they reset
 * on deploy. Cloudflare Workers runs many isolates, so this is a speed bump
 * rather than a wall: it stops one client flooding the process in front of you,
 * and it stops retry storms, and it does NOT stop an attacker with a large IP
 * pool. Real quota belongs at the edge (`cf.rate_limit` in wrangler.toml) or in
 * the API service, which can see every request from every isolate. This layer
 * exists because the boundary should not be trusting by default while that is
 * arranged - not because it is sufficient on its own.
 */

/**
 * Sliding-window limiter.
 *
 * A fixed window lets a caller spend a full quota, wait one tick, and spend it
 * again - two full quotas inside a second and a half. A sliding window charges
 * the part of the previous window still in force, so the rate stays flat across
 * the boundary.
 */
interface Bucket {
    /** Requests charged in the current window. */
    count: number;
    /** When the current window ends. */
    resetAt: number;
    /** When this bucket was last touched, so idle ones can be swept. */
    touchedAt: number;
}

/**
 * Cap on tracked buckets.
 *
 * A limiter keyed by client IP is a map an attacker can grow without limit by
 * sending requests from many addresses, which turns a protection into a memory
 * leak. The sweep reclaims idle entries; this is the backstop if that is not
 * enough. Reaching it drops the coldest entries rather than growing.
 */
const MAX_BUCKETS = 20_000;

/** How long an untouched bucket is kept before being swept. */
const BUCKET_TTL_MS = 10 * 60_000;

/** How often a sweep runs, so it cannot cost more than the requests it saves. */
const SWEEP_INTERVAL_MS = 60_000;

const buckets = new Map<string, Bucket>();
let lastSweepAt = 0;

function sweep(now: number): void {
    if (now - lastSweepAt < SWEEP_INTERVAL_MS) return;
    lastSweepAt = now;

    const cutoff = now - BUCKET_TTL_MS;
    for (const [key, bucket] of buckets) {
        if (bucket.touchedAt < cutoff) buckets.delete(key);
    }

    // Still over the cap, which means traffic is spread across more live clients
    // than the cap allows for. Drop the least recently touched rather than grow:
    // losing some accurate accounting is cheaper than the memory it would take
    // to keep it all.
    if (buckets.size > MAX_BUCKETS) {
        const coldest = [...buckets.entries()].sort(
            (a, b) => a[1].touchedAt - b[1].touchedAt,
        );
        for (const [key] of coldest.slice(0, buckets.size - MAX_BUCKETS)) {
            buckets.delete(key);
        }
    }
}

export interface RateLimit {
    /** Requests allowed per window. */
    limit: number;
    /** Window length in milliseconds. */
    windowMs: number;
}

export interface RateResult {
    ok: boolean;
    /** Seconds the caller should wait, for a Retry-After header. */
    retryAfter: number;
    /** Requests left in the current window. */
    remaining: number;
}

/**
 * Charges one request against `key` and reports whether it was allowed.
 *
 * `key` must already be namespaced by route - see {@link rateLimitKey} - so a
 * caller who spends their whole quota on the leaderboard cannot also spend it on
 * score submission. Endpoints have different abuse profiles, and a shared bucket
 * would let the cheapest one take the others down with it.
 */
export function consume(key: string, { limit, windowMs }: RateLimit): RateResult {
    const now = Date.now();
    sweep(now);

    const existing = buckets.get(key);

    // No bucket, or the window has fully elapsed: start a fresh one.
    if (!existing || existing.resetAt <= now) {
        buckets.set(key, { count: 1, resetAt: now + windowMs, touchedAt: now });
        return { ok: true, retryAfter: 0, remaining: limit - 1 };
    }

    existing.count += 1;
    existing.touchedAt = now;

    if (existing.count > limit) {
        return {
            ok: false,
            retryAfter: Math.max(1, Math.ceil((existing.resetAt - now) / 1000)),
            remaining: 0,
        };
    }

    return {
        ok: true,
        retryAfter: 0,
        remaining: Math.max(0, limit - existing.count),
    };
}

/**
 * Namespaces a bucket by route.
 *
 * Route names are compile-time constants here, so a caller cannot forge a
 * namespace and reach into another endpoint's quota.
 */
export function rateLimitKey(route: string, identity: string): string {
    return `${route}\u0000${identity}`;
}

/**
 * Best available client address.
 *
 * Cloudflare sets `CF-Connecting-IP` at the edge and it cannot be forged from
 * the open internet, so it is preferred whenever present. `X-Real-IP` is next,
 * being set by most proxies rather than merely passed through.
 *
 * `X-Forwarded-For` is a last resort, and its FIRST entry is deliberately not
 * used: that is the client-controlled part of the chain, so trusting it would
 * let a caller evade the limiter by rotating a fabricated address, and would let
 * them exhaust every other caller's bucket by exhausting their own. The LAST
 * entry is the one appended by the proxy closest to us - set rather than
 * forwarded.
 *
 * With none of these there is no address to key on, and the caller is bucketed
 * with everyone else. That fails the right way: an unidentified flood gets
 * throttled rather than let through.
 */
export function clientIdentity(request: Request): string {
    const connecting = request.headers.get('cf-connecting-ip');
    if (connecting) return connecting.trim();

    const real = request.headers.get('x-real-ip');
    if (real) return real.trim();

    const forwarded = request.headers.get('x-forwarded-for');
    if (forwarded) {
        const hops = forwarded.split(',').map((hop) => hop.trim()).filter(Boolean);
        const last = hops[hops.length - 1];
        if (last) return last;
    }

    return 'unknown';
}

/** Largest request body any of these routes will read, in bytes. */
export const MAX_BODY_BYTES = 4 * 1024;

/** Returned by the body readers to mean "refuse this request". */
export interface Rejected {
    rejected: true;
    response: Response;
}

function isRejected(value: unknown): value is Rejected {
    return typeof value === 'object' && value !== null && 'rejected' in value;
}

/**
 * Rejects a request that announces a body larger than we will read.
 *
 * Checked from the declared `content-length` before parsing rather than by
 * counting bytes afterwards: the point is to avoid allocating for a payload we
 * were never going to accept. Lying about the header is not a way around it -
 * {@link readJsonBody} caps the text again before parsing.
 */
export function assertBodySize(request: Request): Rejected | null {
    const declared = Number(request.headers.get('content-length'));
    if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) {
        return {
            rejected: true,
            response: Response.json(
                { error: 'Request body too large' },
                { status: 413 },
            ),
        };
    }
    return null;
}

/**
 * Reads a small JSON body, or refuses the request.
 *
 * The declared length is a hint rather than a guarantee, so the raw text is
 * capped again before it is parsed - a chunked request with no `content-length`
 * would otherwise sail past {@link assertBodySize} and parse whatever it liked.
 */
export async function readJsonBody<T>(request: Request): Promise<T | Rejected> {
    const size = assertBodySize(request);
    if (size) return size;

    const text = await request.text().catch(() => '');
    if (text.length > MAX_BODY_BYTES) {
        return {
            rejected: true,
            response: Response.json(
                { error: 'Request body too large' },
                { status: 413 },
            ),
        };
    }

    try {
        return JSON.parse(text || '{}') as T;
    } catch {
        return {
            rejected: true,
            response: Response.json({ error: 'Malformed JSON body' }, { status: 400 }),
        };
    }
}

/** Narrows a body-read result in a route's `catch`-free flow. */
export { isRejected };

/**
 * Origins allowed to make state-changing calls to these routes.
 *
 * Configured rather than derived, because the deployed origin is not knowable
 * from inside the request without trusting a header an attacker can forge.
 */
export function allowedOrigins(): string[] {
    const configured = [process.env.NEXT_PUBLIC_SITE_URL, process.env.NEXT_PUBLIC_LAUNCHER_ORIGIN];

    return [
        ...new Set(
            configured
                .filter((value): value is string => typeof value === 'string' && value.length > 0)
                .flatMap((value) => value.split(','))
                .map((origin) => origin.trim().replace(/\/+$/, ''))
                .filter(Boolean),
        ),
    ];
}

/**
 * Whether a state-changing request came from a place we recognise.
 *
 * CSRF is usually dismissed on bearer-token endpoints, on the grounds that the
 * browser only attaches cookies automatically and these routes use none. That
 * reasoning is incomplete: `/api/score` and `/api/bridge/verify` accept a request
 * with no Authorization header at all, and a hostile page can fire those from an
 * iframe or a form. The check costs one comparison, and being wrong costs a 403
 * on a request that was going to be rejected anyway.
 *
 * Requests with no `Origin` header are allowed through deliberately. A request
 * without one is a curl, a server-to-server call, or a navigation - none of which
 * is cross-site, and none of which can carry a cookie, so none of them is the
 * attack this guards against. An unknown `Origin` is by definition some page
 * somewhere, which is exactly the caller to refuse. The literal `null` is the
 * origin of a sandboxed frame or a `data:` URL - a context with no origin to
 * vouch for it - so that one is refused even though it is present.
 */
export function isSameSiteOrigin(request: Request): boolean {
    const origin = request.headers.get('origin');
    if (!origin) return true;

    const normalised = origin.trim().replace(/\/+$/, '');
    if (normalised === 'null') return false;

    // The app's own address is taken from the URL the request was received for,
    // not from a header, because a header is caller-controlled and this is the
    // one comparison the whole check rests on.
    //
    // This clause is not optional. Browsers send `Origin` on every same-site
    // POST, so an allowlist holding only the configured site and launcher would
    // 403 the game's own score saves whenever NEXT_PUBLIC_SITE_URL is unset -
    // which is the default, and which is how the four verses stop being
    // playable for a reason nobody would connect to a header.
    try {
        if (normalised === new URL(request.url).origin) return true;
    } catch {
        // An unparseable request URL is not something to grant access on.
    }

    return allowedOrigins().includes(normalised);
}

/** Standard JSON refusal for a request turned away at this boundary. */
export function refused(status: number, error: string, retryAfter?: number): Response {
    const headers = new Headers({ 'content-type': 'application/json' });
    if (retryAfter) headers.set('retry-after', String(retryAfter));
    return new Response(JSON.stringify({ error }), { status, headers });
}
