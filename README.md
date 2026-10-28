<p align="center">
  <img src="https://capsule-render.vercel.app/api?type=waving&height=220&color=0:0F172A,100:2563EB&text=Tetherverse&fontColor=FFFFFF&fontSize=60&animation=fadeIn" />
</p>

<p align="center">
  A physics-driven platformer where momentum is the mechanic.
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Phaser-3-blue?style=for-the-badge">
  <img src="https://img.shields.io/badge/Matter.js-Physics-black?style=for-the-badge">
  <img src="https://img.shields.io/badge/TypeScript-3178C6?style=for-the-badge">
  <img src="https://img.shields.io/badge/Next.js-000000?style=for-the-badge">
</p>

---

## About

**Tetherverse** is a 2D platforming game built around momentum, precision, and player mastery.

Using a custom pivot mechanic powered by Matter.js physics, players swing, launch, and traverse challenging terrain through skillful movement rather than scripted actions. Every jump, release, and launch carries consequences, rewarding precision and experimentation.

---

## Gameplay

- Physics-based movement
- Pivot and grappling mechanics
- Momentum-driven traversal
- Precision platforming
- Dynamic launch system
- Skill-focused progression

---

## Philosophy

> Movement should feel earned.

Tetherverse is designed around player control and mechanical expression. The environment is not simply navigated; it is mastered through timing, trajectory management, and an understanding of momentum.

Every successful traversal is the result of player skill interacting with a simulated physical world.

---

## Scoring and server-managed runs

A climb is only scorable against a run the API opened for the signed-in player.
The browser no longer invents a score and posts it on its own; it asks the
server for a run first, and the server decides the run's identity and the seed
the level generator must use.

1. **Start the run.** `POST /api/run` forwards to `POST /runs` on the API with
   the caller's Excel Play bearer. The response is
   `{ runId, seed, expiresAt }`. Starting a run replaces any previous open run
   for that player.
2. **Play it.** `GameScene` builds the mountain from the server's `seed`, so the
   same attempt is the same world on every client.
3. **Finalise it.** On failure the scene posts
   `{ runId, score, coins }` to `/api/score`, which forwards to `POST /score`.
   `score` is the peak altitude of **this run** in whole metres, and `coins` is
   the haul banked **during this run** - not the player's personal best and not
   their lifetime coin total. The API replies with the authoritative persistent
   `coins`, which the scene adopts.

The API rejects the old `{ score, coins }` body outright. It also refuses a run
that belongs to another player (403), an unknown or replaced run (404), a
duplicate submission (409), an expired run (410), an implausible score (422),
and a caller over its rate limit (429, with `Retry-After`).

### Deploying

The frontend and the backend must ship together, after `db/schema.sql` has been
applied. A frontend that still posts `{ score, coins }` gets a validation error
from the new API, and an older API does not have `POST /runs` at all, so a new
frontend cannot start a climb. Neither order has a compatible overlap window:
API-first breaks saves from the old frontend, and frontend-first breaks play on
the old API.

**Configuration lives in Cloudflare, not in this repository.** No production
environment file is committed, and none needs to be:

| Variable | Where it goes | When it is read |
|---|---|---|
| `NEXT_PUBLIC_EXCEL_AUTH_FRONTEND_URL` | Worker > Settings > Build (variable) | build, inlined into the client |
| `NEXT_PUBLIC_LAUNCHER_ORIGIN` | Worker > Settings > Build (variable) | build, inlined into the client |
| `TETHERVERSE_API_URL` | `wrangler.toml` `[vars]`, or `wrangler secret put` | runtime, every request |

The two `NEXT_PUBLIC_*` values have to exist when the build runs, because they
are compiled into the bundle — the launcher origin is what the CSP allows to
frame the game, so a build without it produces a Worker the launcher cannot
embed. `TETHERVERSE_API_URL` is deliberately not part of the build: it is read
per request, so the API can move without rebuilding the app. With it unset the
API routes answer 502 and log the reason.

It currently points at the Render deployment, which is the only one that exists.
When the API lands on Cloud Run, the change is that one line in `wrangler.toml` —
or the same variable in the dashboard, which applies without a deploy at all.

For a local build, `.env.local` or an ignored `env.prod` supplies the same
values; `env.example` documents each one.

### Remaining limitation

The simulation still runs in the browser. The run id and the seed give the API
something to bind a score to - ownership, single use, expiry, and a plausibility
check against the run's age - but a determined client can still compute a
mechanically plausible score without playing. Deterministic replay, with the
server re-running the simulation from the seed and the input log, is the real
fix.

---

## Built With

- Phaser 3
- Matter.js
- TypeScript
- React
- Next.js

---

<p align="center">
  <img src="https://capsule-render.vercel.app/api?type=waving&section=footer&height=120&color=0:0F172A,100:2563EB" />
</p>
