/**
 * Builds the Cloudflare Worker.
 *
 * This is what `pnpm build` runs, because the deploy step (`wrangler deploy`)
 * looks for OpenNext output: a plain `next build` compiles the app but leaves
 * nothing at `.open-next/worker.js` to upload. The OpenNext build runs
 * `pnpm build:next` underneath - `open-next.config.ts` names that command so
 * this file is not called a second time.
 *
 * ── Where the configuration comes from ─────────────────────────────────────
 *
 * Production values live in Cloudflare, not in this repository:
 *
 *   NEXT_PUBLIC_EXCEL_AUTH_FRONTEND_URL   build variable, Workers Builds.
 *   NEXT_PUBLIC_LAUNCHER_ORIGIN           build variable, Workers Builds.
 *   TETHERVERSE_API_URL                   runtime variable, Worker config.
 *
 * The two NEXT_PUBLIC values are inlined into the client bundle, so they have
 * to exist when this runs. TETHERVERSE_API_URL is read at request time, so it
 * does not, and it must stay out of the build: a value here would be copied
 * into the Worker as a default and stop the address being changeable.
 *
 * Locally, `env.prod` (ignored, optional) or `.env.local` supplies the same
 * values. This script reads `env.prod` when it exists and puts it in the
 * environment before the build starts, which outranks every `.env` file Next.js
 * reads. Failing both, the values are looked for in the env files Next itself
 * would read, so a working local setup is not forced to duplicate them here.
 *
 * Building with none of the above is refused: the bundle would otherwise ship
 * with no launcher origin, and the CSP would lock the app out of the frame it
 * is meant to run in.
 */

import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';

/** Local convenience, gitignored. Never required. */
const SOURCE = 'env.prod';

/** Build-time values the bundle is meaningless without. */
const REQUIRED = [
    'NEXT_PUBLIC_EXCEL_AUTH_FRONTEND_URL',
    'NEXT_PUBLIC_LAUNCHER_ORIGIN',
];

/**
 * Env files Next.js reads, and which OpenNext copies into the Worker as
 * defaults (`.open-next/cloudflare/next-env.mjs`).
 */
const ENV_FILES = ['.env', '.env.local', '.env.production', '.env.production.local'];

/** One `NAME=value` lookup, or null. Comments and blanks simply miss. */
function readValue(file, name) {
    try {
        const line = readFileSync(file, 'utf8')
            .split('\n')
            .map((entry) => entry.trim())
            .find((entry) => entry.startsWith(`${name}=`));

        return line ? line.slice(name.length + 1).trim() : null;
    } catch {
        return null;
    }
}

/** Whether a value is available to this build, and from where. */
function resolveValue(name) {
    if (process.env[name]) return 'the environment';

    const file = ENV_FILES.find((candidate) => readValue(candidate, name) !== null);
    return file ?? null;
}

// Local override, if the developer keeps one.
let contents = null;
try {
    contents = readFileSync(SOURCE, 'utf8');
} catch (cause) {
    if (cause.code !== 'ENOENT') {
        console.error(`[build-worker] Could not read ${SOURCE}: ${cause.message}`);
        process.exit(1);
    }
}

if (contents !== null) {
    let loaded = 0;
    for (const line of contents.split('\n')) {
        const trimmed = line.trim();

        if (!trimmed || trimmed.startsWith('#')) continue;

        const separator = trimmed.indexOf('=');
        if (separator === -1) continue;

        const name = trimmed.slice(0, separator).trim();
        if (!name) continue;

        const value = trimmed.slice(separator + 1).trim();
        process.env[name] = value;
        loaded += 1;
    }

    console.log(`[build-worker] Loaded ${loaded} variable(s) from ${SOURCE}.`);
}

const missing = REQUIRED.filter((name) => resolveValue(name) === null);
if (missing.length) {
    console.error(
        `[build-worker] Missing build-time variable(s): ${missing.join(', ')}.\n` +
            'Set them as build variables on the Worker (Cloudflare dashboard, ' +
            'Settings > Build), or in .env.local for a local build.',
    );
    process.exit(1);
}

// A build-time TETHERVERSE_API_URL is not fatal, but it becomes a Worker default
// and hides a Worker that has no address configured. The address belongs in the
// Worker's own runtime configuration instead.
const bakedIn = ENV_FILES.filter((file) => readValue(file, 'TETHERVERSE_API_URL') !== null);
if (bakedIn.length) {
    console.warn(
        `[build-worker] TETHERVERSE_API_URL is set in ${bakedIn.join(', ')}. OpenNext copies ` +
            'that into the Worker as a default; remove it there so the address stays ' +
            'runtime-only.',
    );
}

const child = spawn('opennextjs-cloudflare', ['build'], {
    stdio: 'inherit',
    shell: true,
    env: process.env,
});

child.on('exit', (code, signal) => {
    if (signal) {
        console.error(`[build-worker] Build terminated by ${signal}.`);
        process.exit(1);
    }
    process.exit(code ?? 1);
});
