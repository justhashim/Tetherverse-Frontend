/**
 * Builds the Cloudflare Worker.
 *
 * This is what `pnpm build` runs, because the deploy step (`wrangler deploy`)
 * looks for OpenNext output: a plain `next build` compiles the app but leaves
 * nothing at `.open-next/worker.js` to upload. The OpenNext build runs
 * `pnpm build:next` underneath - `open-next.config.ts` names that command so
 * this file is not called a second time.
 *
 * The production configuration lives in `env.prod`, which is committed, and the
 * NEXT_PUBLIC_* values in it are inlined into the client bundle at build time.
 * This script reads that file and puts its values in the environment before the
 * build starts.
 *
 * Environment variables take precedence over every `.env` file Next.js reads,
 * which is what makes this deterministic. Loading the same values through a
 * `.env` file instead would leave the result at the mercy of the order Next.js
 * reads them in, and a developer with a `.env.local` full of development
 * origins would get those origins baked into a deployed Worker.
 *
 * `TETHERVERSE_API_URL` is deliberately absent. It is not NEXT_PUBLIC_, and it
 * is read at runtime from the Worker's configuration so the backend address can
 * change without a rebuild. Baking it here would make that impossible and hide
 * the fact that the deployed Worker has no address configured.
 */

import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';

const SOURCE = 'env.prod';

/** Build-time values the bundle is meaningless without. */
const REQUIRED = [
    'NEXT_PUBLIC_EXCEL_AUTH_FRONTEND_URL',
    'NEXT_PUBLIC_LAUNCHER_ORIGIN',
];

let contents = null;
try {
    contents = readFileSync(SOURCE, 'utf8');
} catch (cause) {
    if (cause.code !== 'ENOENT') {
        console.error(`[build-worker] Could not read ${SOURCE}: ${cause.message}`);
        process.exit(1);
    }

    // CI can supply the values as build environment variables instead of
    // committing them. Either source is fine; building with neither is not,
    // because the deployed bundle would ship development defaults.
    console.warn(`[build-worker] No ${SOURCE}; using variables from the environment.`);
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

const missing = REQUIRED.filter((name) => !process.env[name]);
if (missing.length) {
    console.error(
        `[build-worker] Missing build-time variable(s): ${missing.join(', ')}.\n` +
            `Set them in ${SOURCE} or in the build environment.`,
    );
    process.exit(1);
}

/**
 * Env files OpenNext copies into the Worker as runtime defaults.
 *
 * Worth knowing: `compileEnvFiles` reads these at build time and writes their
 * values into `.open-next/cloudflare/next-env.mjs`, so a value here is not
 * merely local. A Worker variable still wins at runtime, but a stale local
 * address would become the fallback.
 */
const ENV_FILES = ['.env', '.env.local', '.env.production', '.env.production.local'];

const bakedFiles = ENV_FILES.filter((file) => {
    try {
        return readFileSync(file, 'utf8')
            .split('\n')
            .some((line) => line.trim().startsWith('TETHERVERSE_API_URL='));
    } catch {
        return false;
    }
});

if (bakedFiles.length) {
    console.warn(
        `[build-worker] TETHERVERSE_API_URL is set in ${bakedFiles.join(', ')}. OpenNext ` +
            'copies that into the Worker as a default; remove it there so the address stays ' +
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
