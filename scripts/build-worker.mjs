/**
 * Builds the Cloudflare Worker.
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
 * `TETHERVERSE_API_URL` is deliberately absent from `env.prod`. It is not
 * NEXT_PUBLIC_, so it is read at runtime from a Worker binding, and that is
 * only true while it is absent from the build environment. Setting it here
 * would bake the backend's address into the deployed bundle and make it
 * unchangeable without a rebuild.
 */

import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';

const SOURCE = 'env.prod';

let contents;
try {
    contents = readFileSync(SOURCE, 'utf8');
} catch (cause) {
    console.error(`[build-worker] Could not read ${SOURCE}: ${cause.message}`);
    process.exit(1);
}

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
