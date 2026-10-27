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

The frontend and the backend must ship together. A frontend that still posts
`{ score, coins }` gets a validation error from the new API, and an older API
does not have `POST /runs` at all, so a new frontend cannot start a climb. There
is no compatible overlap window: deploy the API first, then the frontend.

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
