# Tetherverse

A one-button climbing game. Hook onto anchors, swing, release, go higher.

**Live:** [tetherverse.vercel.app](https://tetherverse.vercel.app)

## What it does

- You climb a procedurally generated mountain by tethering to anchor nodes. Press to hook, release to launch. Momentum does the rest.
- Difficulty is a continuous dial on altitude. Hazards, crumbling ledges and weather tighten as you climb, and it never gets kinder.
- Four "verses" (VERGE, BLOOM, KILN, NULL) reskin the climb and scale gravity, bounce, grip, hazards and crumbling. [WORLDS.md](WORLDS.md) has the design notes.
- Runs are scored on the server. There is a leaderboard and a coin balance.
- Built mobile-first. It runs embedded in the Excel Play launcher and signs players in through Excel's accounts.

## How it works

The game is Phaser 4 with Matter.js physics. `PivotEngine` handles the tether as a physics constraint. Levels are generated from a seed with `seedrandom`, so the same seed gives the same mountain on every client.

The frontend is Next.js, deployed to Cloudflare Workers through OpenNext. Its API routes (`/api/run`, `/api/checkpoint`, `/api/score`, `/api/leaderboard`) only forward to the Tetherverse API, with rate limiting at the edge.

Scoring works like this:

1. The client asks the server for a run and gets back `{ runId, seed, expiresAt }`.
2. The game builds the mountain from that seed and sends checkpoints while you play.
3. On failure it posts the run's altitude and coins for that `runId`. The API checks ownership, expiry, duplicates and plausibility.

Known gap: the simulation still runs in the browser, so a determined client can fake a plausible score. The real fix is server-side replay from the seed and an input log.

## Stack

- Phaser 4, Matter.js, TypeScript
- Next.js 16, React 19, Tailwind CSS 4, Zustand, Framer Motion, Howler, Zod
- Cloudflare Workers via `@opennextjs/cloudflare`

## Run it locally

```bash
pnpm install
pnpm dev
```

`next dev` expects the Tetherverse API at `http://localhost:4000`. That backend lives in a separate private repo, so runs, scores and the leaderboard need it running or `TETHERVERSE_API_URL` pointed at a deployed one (set it in `.env.local`). The build-time `NEXT_PUBLIC_*` origins are committed in `.env`. See `env.example`.

Other scripts: `pnpm build` (Worker build), `pnpm preview`, `pnpm deploy`, `pnpm type-check`, `pnpm lint`.

## Notes

Made for Excel Play. Most of it is mine, with one commit from [dijith-481](https://github.com/dijith-481).
