/**
 * Builds the Cloudflare Worker.
 *
 * This is what `pnpm build` runs, because the deploy step (`wrangler deploy`)
 * looks for OpenNext output: a plain `next build` compiles the app but leaves
 * nothing at `.open-next/worker.js` to upload. The OpenNext build runs
 * `pnpm build:next` underneath - `open-next.config.ts` names that command so
 * this file is not called a second time.
 *
 * The production configuration lives in `env.prod`, which is committed. Its
 * NEXT_PUBLIC_* values are inlined into the client bundle and
 * TETHERVERSE_API_URL into the server bundle, all at build time. This script
 * reads that file and puts its values in the environment before the build
 * starts.
 *
 * Environment variables take precedence over every `.env` file Next.js reads,
 * which is what makes this deterministic. Loading the same values through a
 * `.env` file instead would leave the result at the mercy of the order Next.js
 * reads them in, and a developer with a `.env.local` full of development
 * origins would get those origins baked into a deployed Worker.
 */

import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';

const SOURCE = 'env.prod';

/** Build-time values the bundle is meaningless without. */
const REQUIRED = [
    'TETHERVERSE_API_URL',
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

if (process.env.TETHERVERSE_API_URL) {
    // Printed because the build log is the only place the deployed backend is
    // visible: the value is inlined, not read from a dashboard variable.
    console.log(`[build-worker] Backend: ${process.env.TETHERVERSE_API_URL}`);
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
