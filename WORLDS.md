# The four worlds

What each verse in Tetherverse stands for, and the concept behind it.

> The source of truth for every number and colour below is
> [`src/game/worlds/definitions.ts`](src/game/worlds/definitions.ts). If this
> document and that file ever disagree, the file is right.

---

## What a verse is

A verse is **not a level and not a difficulty band**. It is a *skin* plus a set
of *multipliers*, and the distinction is the whole design.

The difficulty bands are the spine of the game and every other system reads
them rather than deciding for itself. So a verse never owns a number — it owns
a **ratio**. `gravity: 1.16` means "16% heavier than whatever the difficulty
dial currently says", not "gravity is 1.16". Move a boundary, rescale a band, or
let the difficulty ramp get rewritten, and every verse rides the change with no
edit here.

A verse that could set its own base values would be a separate game per world.
A verse that only ever multiplies is **travel**.

### The one hard invariant

**Cyan (`signal`) is the player and nothing else** — the tether, the altitude
readout, the controls. No verse touches it, which is why every colour in a
verse's palette is defined by what it is *not*.

This is the difference between a palette swap and somewhere you went. A world
that could recolour your tether would be a filter laid over one game; a world
that cannot is a place you travelled to.

---

## I — VERGE

**THE ORIGIN VERSE** · accent `#a855f7` (violet)

**What it stands for:** the edge of everything — the starting line, the place
before anything has happened to you. "Verge" is the boundary itself: hull plating
and wreckage drifting in vacuum, the remains of whatever built this, still and
unlit and waiting.

**Concept:** nothing is trying to kill you here, and nothing is helping either.
VERGE is deliberately *neutral* — all five multipliers are exactly `1`, which
makes it the **control group** for the whole system. It is the game as it was
before verses existed. If VERGE ever stops feeling like the original build, a
multiplier has leaked somewhere.

| | |
|---|---|
| Multipliers | gravity `1` · bounce `1` · grip `1` · hazards `1` · crumble `1` |
| Ambient | none — vacuum has no drift |
| Overlay | none |
| Silhouettes | hull plating, antennae with nav lights, wreckage entering frame |

---

## II — BLOOM

**THE OVERGROWN VERSE** · accent `#63ffb3` (bio-green)

**What it stands for:** life arriving somewhere it was never meant to be. The
wreckage of VERGE did not stay dead — something grew over it, caps and stalks
and spores, soft-lit from underneath.

**Concept:** *you are slowed, not killed.* BLOOM's material is the kindest in
the game and its idea is the hardest, because it introduces a verse that can
**touch your tether** instead of your health. Gravity is untouched — BLOOM's
difference is in the *landing*, not the arc:

- **`3x` bounce** turns every ledge into a pad. You will not fall off things
  here; you will be thrown off them.
- **`0.4x` crumble** is what pays for that. Sixty per cent of the fragile ground
  the generator marked is gone, and the hazard budget that buys back is spent by
  the verse itself on **sticky pods**, which drag the tether and cost you time.

| | |
|---|---|
| Multipliers | gravity `1` · bounce `3` · grip `1.1` · hazards `0.7` · crumble `0.4` |
| Ambient | **SPORES** |
| Overlay | vignette `0.28` |
| Silhouettes | mushroom caps with gills, leaning stalks, glow pools on the floor |

---

## III — KILN

**THE MOLTEN VERSE** · accent `#ff8a3a` (ember orange)

**What it stands for:** industry that never stopped. Gantries and stacks over a
molten floor, heat rising through soot — a place built to fire things, still
running with nobody left to operate it.

**Concept:** *heavy, brittle, hot.* KILN is where the game stops forgiving a
sloppy swing:

- **`1.16x` gravity** is the smallest change that makes a swing feel *pulled
  down* rather than merely missing.
- **`0.2x` bounce** is the important half of that pairing: in KILN **a landing
  is a landing**. There is no second chance built into the surface.
- **`1.8x` crumble** is where "falling debris" comes from — the mountain itself
  is the debris field — and it is why BLOOM's pods have no equivalent here.

| | |
|---|---|
| Multipliers | gravity `1.16` · bounce `0.2` · grip `0.78` · hazards `0.9` · crumble `1.8` |
| Ambient | **EMBERS** |
| Overlay | heat shimmer `0.4` · vignette `0.34` |
| Silhouettes | tapered stacks with cooling bands, lattice trusses, a molten floor line |

---

## IV — NULL

**THE COLLAPSING VERSE** · accent `#ff2fd0` (magenta)

**What it stands for:** the world losing its grip on itself. Monochrome with a
magenta bleed — colour drained out, geometry displaced, bands of the display
failing to hold still.

**Concept:** *deception itself.* NULL's hazard is **not a force, it is a lie**,
and the numbers are deliberately close to the dial's own:

- gravity `1`, bounce `1` — almost neutral, on purpose.
- **`0.5x` hazard density**, because the verse has no interest in an asteroid
  hitting you when a floor can simply *not be there*.
- **`0.9x` grip** and **`1.2x` crumble** are the only real pressure, and they
  are small.

The work is done by **illusory platforms**: geometry that reads as ground and
isn't. By the time NULL arrives the player trusts what they are standing on,
which is exactly when taking that away is worth something.

| | |
|---|---|
| Multipliers | gravity `1` · bounce `1` · grip `0.9` · hazards `0.5` · crumble `1.2` |
| Ambient | **GLITCH** |
| Overlay | scanlines `0.22` · vignette `0.4` |
| Silhouettes | displaced fragments with ghost outlines, failing horizontal bands |

---

## The schedule

Portals are placed in metres of climb:

| Constant | Value | Why |
|---|---|---|
| `FIRST_PORTAL_ALTITUDE` | **250 m** | Far enough past the handcrafted tutorial that the first gate is a reward rather than an interruption. |
| `PORTAL_ALTITUDE_INTERVAL` | **400 m** | Roughly forty swings — enough to learn a verse's material, not enough to tire of it before the next arrives. |
| `BLEED_ALTITUDE` | **50,000 m** | Deliberately unreachable by ordinary play. It is the payoff the endless climb has been promising, not a place anyone farms. |

**Order of arrival:** `BLOOM → KILN → NULL → VERGE`

- **BLOOM first** — the kindest material carrying the hardest idea: the pods
  teach the player that a verse can touch the tether.
- **KILN second** — its hazard is legible, so it lands once BLOOM has taught
  the player to expect a verse to have one.
- **NULL third** — by now the player trusts the ground, which is what makes
  NULL worth visiting.
- **VERGE returns last** — the loop closes on the origin, and the contrast is
  available again.

**The gate itself:** radius `210` world px (measured — at the first guess of
`170` the player passed under rings they had clearly flown at, which reads as a
bug rather than a miss), hung `100` px below the scheduled altitude because a
tether swings you *under* your anchor, never over it. A player who climbs
`550` px (`~55 m`) past a gate passes it anyway: past that point, dropping back
down to swing through is not a challenge the climb supports, so the gate stops
being an obstacle and becomes a door.

The crossing itself is `600 ms`, swapping the world underneath a flash at
`180 ms`.

---

## THE BLEED

**Beyond NULL — the four verses stop taking turns and start overlapping.**

THE BLEED is **not a fifth world**. It is the four of them at once: the skin
rotates through all four, and the multipliers escalate on a timer, so nothing
new had to be invented to make the endgame — only the existing four made to
arrive together.

Its numbers below are the state at **phase zero**, the mildest blend. The
escalation factor multiplies the whole set from there.

| | |
|---|---|
| Multipliers (phase 0) | gravity `1.1` · bounce `1.5` · grip `0.95` · hazards `1` · crumble `1.6` |
| Begins at | 50,000 m |

It is also the game's pressure valve. There is no fifth verse because THE BLEED
already answers the question a fifth world would be asked to answer: *what
happens when this stops being finite?*

---

## Where you see them

- **The menu** shows all four at once as parallel slices of environment, not as
  four colour blocks — each carrying its own backdrop and its own silhouettes.
  Generated art lives in [`public/verses/`](public/verses/), one directory per
  verse, built by a raster + SVG split: the nebula is raster because SVG cannot
  hold a cloud without banding, and the silhouettes are vector because they have
  to stay sharp from a 106 px phone quarter to a 360 px desktop one.
- **In a run**, one verse is active at a time and carries you to the next
  through a portal mid-flight.
- Nothing in either place is cyan except you.
