<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# Tetherverse

## This is a mobile-first game

Design for the phone first and let the desktop be the version with more room, not the version you designed. In practice that means:

- **The primary control goes in the thumb zone.** The bottom third of the screen, reachable without shifting grip. A control centred for optical balance and left in the middle of the screen is one a player cannot press while holding the phone one-handed.
- **Every tap target is at least 44px, and the primary one is far larger than that.** The play control is the biggest object on the screen because it is the only one.
- **Nothing important lives in a top corner.** That is where a hand covering the phone is not, and where system UI already is.
- **Test at 390x844 before you test at 1440x900.** If it only reads in the desktop capture, it is wrong. The probe at `/tmp/opencode/thumb.mjs` measures the control's position and reports whether it is in the thumb zone.

Headless captures freeze CSS transitions at t=0 and report their start value. Finish animations with `document.getAnimations().forEach((a) => a.finish())` before measuring, or you will chase a bug that exists only in the screenshot.

## The colour law

**Cyan is the player and nothing else.** Not a background, not a border, not a heading, not an accent. The moment another element takes cyan the player stops being findable on a busy screen, and the one control in the game stops being findable in the menu. Violet belongs to the multiverse; rose is failure.

## The multiverse

A run is four verses, VERGE, BLOOM, KILN and NULL, carried between by portals mid-flight, with THE BLEED beyond NULL as the endless stretch. The menu previews them as four environments side by side. Worlds apply multipliers to the shared difficulty dial; they never edit it.
