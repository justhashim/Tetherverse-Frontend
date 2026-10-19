'use client';

import { useEffect, useRef } from "react";

/**
 * The four verses, drawn.
 *
 * This used to be four gradients. A gradient is a colour; a verse is a place,
 * and the difference is everything the player can recognise at a glance - the
 * silhouette of a hull plate against vacuum, the caps of something that grew
 * over the wreckage, gantries over a molten floor, and the Null failing in
 * horizontal bands. Those are what the run actually carries you through, so
 * they are what the menu shows.
 *
 * One canvas for all four, not four. A single element composites once, takes
 * one transform, and keeps the whole backdrop off the DOM's critical path -
 * which matters more than usual here, because everything above this is type and
 * a control that must stay at sixty frames on a phone.
 *
 * Boundaries are drawn rather than laid out: each verse fades out over the
 * outer third of its own width, so two of them bleed into each other the way
 * parallel skies should. The hairlines that mark the quarters live in the DOM,
 * on the same marks the verse names below are aligned to.
 */

type RGB = [number, number, number];

const VERGE: RGB = [168, 85, 247];
const BLOOM: RGB = [16, 185, 129];
const KILN: RGB = [249, 115, 22];
const NULLC: RGB = [217, 70, 239];

const rgba = (c: RGB, a: number) => `rgba(${c[0]},${c[1]},${c[2]},${a})`;

/**
 * Deterministic noise, so the same sky loads every time.
 *
 * `Math.random()` would reshuffle the silhouettes on every render and every
 * revalidation, and a backdrop that is different each visit reads as broken
 * rather than as alive. This is the same mulberry32 idea the level generator
 * uses, folded down to a handful of numbers: no dependency bought for eight
 * lines.
 */
function mulberry32(seed: number) {
    return function () {
        seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
        let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

/**
 * How much of a verse shows at a given horizontal position.
 *
 * 1 in the middle of its quarter, falling to 0 at its own edges. Every drawn
 * thing in a verse multiplies its alpha by this, which is what turns four
 * stacked panels into four skies that meet.
 */
function edgeFade(x: number, x0: number, w: number) {
    const local = (x - x0) / w;
    return Math.max(0, Math.min(1, Math.min(local, 1 - local) / 0.15));
}

/** Static geometry for one verse, built once per resize. */
type Scene = {
    stars: { x: number; y: number; r: number; p: number }[];
    shapes: { x: number; y: number; w: number; h: number; r: number; p: number }[];
    motes: { x: number; y: number; r: number; vy: number; vx: number; p: number }[];
};

function buildScene(verse: number, w: number, h: number): Scene {
    const rand = mulberry32(verse * 7919 + 31);
    const n = (min: number, max: number) => min + rand() * (max - min);

    if (verse === 0) {
        // VERGE. Vacuum and wreckage: a scatter of stars, and hull plating
        // turned edge-on, drifting the way unattended metal does.
        return {
            stars: Array.from({ length: 46 }, () => ({
                x: n(0, w), y: n(0, h), r: n(0.4, 1.3), p: n(0, Math.PI * 2),
            })),
            shapes: Array.from({ length: 11 }, () => ({
                x: n(0, w), y: n(h * 0.1, h), w: n(18, 64), h: n(4, 13),
                r: n(-0.7, 0.7), p: n(0, Math.PI * 2),
            })),
            motes: [],
        };
    }

    if (verse === 1) {
        // BLOOM. Growth over the wreckage: stalks rising from the floor with
        // lit caps, and spores going up the way they will in the verse itself.
        return {
            stars: [],
            shapes: Array.from({ length: 6 }, () => ({
                x: n(0, w), y: h, w: n(26, 58), h: n(h * 0.18, h * 0.5),
                r: n(0.8, 1.5), p: n(0, Math.PI * 2),
            })),
            motes: Array.from({ length: 22 }, () => ({
                x: n(0, w), y: n(0, h), r: n(0.8, 2.4), vy: n(6, 16), vx: n(-2, 2),
                p: n(0, Math.PI * 2),
            })),
        };
    }

    if (verse === 2) {
        // KILN. Industry still running: gantries and stacks against the glow,
        // and embers coming off the floor faster than the spores do.
        return {
            stars: [],
            shapes: Array.from({ length: 7 }, () => ({
                x: n(0, w), y: h, w: n(10, 30), h: n(h * 0.22, h * 0.58),
                r: n(0.9, 1.6), p: n(0, Math.PI * 2),
            })),
            motes: Array.from({ length: 30 }, () => ({
                x: n(0, w), y: n(0, h), r: n(0.7, 2.1), vy: n(22, 46), vx: n(-8, 8),
                p: n(0, Math.PI * 2),
            })),
        };
    }

    // NULL. Nothing grows here and nothing is built here: only fragments of
    // geometry that fail to hold their position, and a floor of scanlines.
    return {
        stars: [],
        shapes: Array.from({ length: 11 }, () => ({
            x: n(0, w), y: n(h * 0.1, h * 0.9), w: n(30, 120), h: n(10, 40),
            r: n(0, 1), p: n(0, 8),
        })),
        motes: [],
    };
}

const VERSE_COLOURS: RGB[] = [VERGE, BLOOM, KILN, NULLC];

/**
 * The body of each sky.
 *
 * This is the part that actually makes four verses instead of one. The scene
 * underneath carries its own tiled nebula across the whole screen, so a wash
 * of colour over it is four tints on a single picture and the slices vanish.
 * A near-opaque body per region replaces that picture with four, and it is
 * drawn to nothing at the verse's own edges so two of them still meet.
 *
 * Each is the verse's hue pulled down to near-black rather than a neutral:
 * the difference is a few values per channel, but it is what makes the dark
 * between two light pools read as belonging to the verses rather than as
 * empty space.
 */
const VERSE_BASE: RGB[] = [
    [16, 10, 34], // VERGE — cold vacuum, violet still in it
    [5, 20, 15],  // BLOOM — deep viridian
    [24, 11, 7],  // KILN — scorched iron
    [14, 12, 18], // NULL — dead grey, already going
];

/** How high the light pool sits, as a fraction of the slice height. */
const GLOW_Y = [0.78, 0.76, 0.8, 0.74];

export default function VerseCanvas({ className }: { className?: string }) {
    const ref = useRef<HTMLCanvasElement>(null);

    useEffect(() => {
        const canvas = ref.current;
        if (!canvas) return;
        const ctx = canvas.getContext("2d", { alpha: true });
        if (!ctx) return;

        // The whole backdrop is decorative and carries no information that is
        // not also in the verse names below it, so under reduced motion it
        // draws one frame and stops rather than running a loop forever.
        const reduce =
            typeof matchMedia === "function" &&
            matchMedia("(prefers-reduced-motion: reduce)").matches;

        // Cap the backing store at 2x. A 3x phone pays four times the fill for
        // a difference nobody can see on a field of soft silhouettes.
        const dpr = Math.min(window.devicePixelRatio || 1, 2);

        let w = 0, h = 0, raf = 0, running = true;
        let scenes: Scene[] = [];
        const quarter = () => w / 4;

        const resize = () => {
            const rect = canvas.getBoundingClientRect();
            w = Math.max(1, rect.width);
            h = Math.max(1, rect.height);
            canvas.width = Math.round(w * dpr);
            canvas.height = Math.round(h * dpr);
            // Reset the transform rather than multiplying it, or every resize
            // compounds the scale and the drawing drifts off the canvas.
            ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
            scenes = VERSE_COLOURS.map((_, i) => buildScene(i, quarter(), h));
            if (reduce) draw(0);
        };

        const draw = (time: number) => {
            const t = time / 1000;
            const qw = quarter();
            ctx.clearRect(0, 0, w, h);

            for (let v = 0; v < 4; v++) {
                const x0 = v * qw;
                const colour = VERSE_COLOURS[v];
                const scene = scenes[v];
                if (!scene) continue;

                /* --- sky ------------------------------------------------
                   Body first, then light on it. The body is what replaces the
                   scene's own nebula in this quarter; the wash above it is the
                   verse's hue, and both are transparent at the verse's own
                   edges so that where two of them meet there is a blend and
                   not a cut. */
                const body = ctx.createLinearGradient(x0, 0, x0 + qw, 0);
                body.addColorStop(0, rgba(VERSE_BASE[v], 0));
                body.addColorStop(0.15, rgba(VERSE_BASE[v], 0.94));
                body.addColorStop(0.85, rgba(VERSE_BASE[v], 0.94));
                body.addColorStop(1, rgba(VERSE_BASE[v], 0));
                ctx.fillStyle = body;
                ctx.fillRect(x0, 0, qw, h);

                const sky = ctx.createLinearGradient(x0, 0, x0 + qw, 0);
                sky.addColorStop(0, rgba(colour, 0));
                sky.addColorStop(0.15, rgba(colour, 0.09));
                sky.addColorStop(0.85, rgba(colour, 0.09));
                sky.addColorStop(1, rgba(colour, 0));
                ctx.fillStyle = sky;
                ctx.fillRect(x0, 0, qw, h);

                const gy = h * GLOW_Y[v];
                const pool = ctx.createRadialGradient(
                    x0 + qw / 2, gy, 0, x0 + qw / 2, gy, qw * 0.95
                );
                pool.addColorStop(0, rgba(colour, v === 3 ? 0.4 : 0.52));
                pool.addColorStop(0.5, rgba(colour, 0.13));
                pool.addColorStop(1, rgba(colour, 0));
                ctx.fillStyle = pool;
                ctx.fillRect(x0, 0, qw, h);

                /* --- shapes -------------------------------------------
                   Silhouettes, never detail. At this size and behind this
                   much scrim, outline is the only thing the eye resolves,
                   and outline is the only thing that says "wreckage",
                   "growth", "gantry" or "fragment" at a glance. */
                for (const s of scene.shapes) {
                    const a = edgeFade(x0 + s.x, x0, qw);
                    if (a <= 0) continue;
                    const sway = Math.sin(t * 0.25 + s.p) * 3;

                    ctx.save();
                    ctx.translate(x0 + s.x + sway, s.y);
                    ctx.rotate(s.r * 0.1);

                    if (v === 0) {
                        // Hull plating: darker than the sky it sits in, with
                        // one lit edge, which is all the eye resolves of a
                        // plate turned edge-on against a star field.
                        ctx.fillStyle = rgba([5, 3, 12], 0.94 * a);
                        ctx.fillRect(-s.w / 2, -s.h / 2, s.w, s.h);
                        ctx.fillStyle = rgba(colour, 0.8 * a);
                        ctx.fillRect(-s.w / 2, -s.h / 2, s.w, 1);
                    } else if (v === 1) {
                        // Stalk, then cap. The cap is the lit part, lit from
                        // underneath, because that is what bioluminescence
                        // looks like from below.
                        ctx.fillStyle = rgba([2, 8, 6], 0.96 * a);
                        ctx.fillRect(-2.5, -s.h, 5, s.h);
                        ctx.beginPath();
                        ctx.ellipse(0, -s.h, s.w / 2, s.h * 0.16, 0, Math.PI, 0);
                        ctx.fill();
                        const g = ctx.createRadialGradient(0, -s.h, 0, 0, -s.h, s.w);
                        g.addColorStop(0, rgba(colour, 0.7 * a));
                        g.addColorStop(1, rgba(colour, 0));
                        ctx.fillStyle = g;
                        ctx.fillRect(-s.w, -s.h - s.w, s.w * 2, s.w * 2);
                    } else if (v === 2) {
                        ctx.fillStyle = rgba([9, 4, 3], 0.96 * a);
                        ctx.fillRect(-s.w / 2, -s.h, s.w, s.h);
                        // Cooling fins, and the hot edge along the top.
                        for (let f = 1; f < 4; f++) {
                            ctx.fillStyle = rgba([18, 8, 5], 0.9 * a);
                            ctx.fillRect(-s.w / 2, -s.h * (f / 4), s.w, 2);
                        }
                        ctx.fillStyle = rgba(colour, 0.9 * a);
                        ctx.fillRect(-s.w / 2, -s.h, s.w, 2);
                    } else {
                        // Fragments that cannot hold still. The step on the
                        // time term is deliberate: the Null should stutter,
                        // not ease.
                        const step = Math.floor(t * 6 + s.p) % 7;
                        const dx = step === 0 ? 9 : step === 3 ? -6 : 0;
                        const visible = step % 3 !== 1;
                        if (visible) {
                            ctx.strokeStyle = rgba(colour, 0.55 * a);
                            ctx.lineWidth = 1;
                            ctx.strokeRect(dx - s.w / 2, -s.h / 2, s.w, s.h);
                            ctx.fillStyle = rgba([5, 4, 8], 0.7 * a);
                            ctx.fillRect(dx - s.w / 2, -s.h / 2, s.w, s.h);
                        }
                    }
                    ctx.restore();
                }

                /* --- motes -------------------------------------------- */
                for (const m of scene.motes) {
                    const a = edgeFade(x0 + m.x, x0, qw);
                    if (a <= 0) continue;
                    let y = m.y - (t * m.vy) % (h + 40);
                    if (y < -20) y += h + 40;
                    const x = x0 + m.x + Math.sin(t * 0.6 + m.p) * m.vx;

                    if (v === 3) continue; // the Null has no motes; it has bands
                    const twinkle = v === 0 ? 0.35 + 0.65 * (0.5 + 0.5 * Math.sin(t * 1.4 + m.p)) : 0.85;
                    ctx.fillStyle = rgba(colour, 0.8 * a * twinkle);
                    ctx.beginPath();
                    ctx.arc(x, y, m.r, 0, Math.PI * 2);
                    ctx.fill();
                }

                /* --- verse-specific floor ----------------------------- */
                if (v === 2) {
                    // The molten line. KILN is the only verse with a hard
                    // bright edge at its floor, and it is what makes the
                    // others read as cold.
                    const floor = ctx.createLinearGradient(0, h * 0.8, 0, h);
                    floor.addColorStop(0, rgba(KILN, 0));
                    floor.addColorStop(1, rgba(KILN, 0.62));
                    ctx.fillStyle = floor;
                    ctx.fillRect(x0, h * 0.8, qw, h * 0.2);
                }

                if (v === 3) {
                    // Scanlines, then a magenta bleed at the floor.
                    ctx.fillStyle = "rgba(232,232,238,0.035)";
                    for (let y = (Math.floor(t * 20) % 4); y < h; y += 4) {
                        ctx.fillRect(x0, y, qw, 1);
                    }
                    const bleed = ctx.createLinearGradient(0, h * 0.58, 0, h);
                    bleed.addColorStop(0, rgba(NULLC, 0));
                    bleed.addColorStop(1, rgba(NULLC, 0.46));
                    ctx.fillStyle = bleed;
                    ctx.fillRect(x0, h * 0.58, qw, h * 0.42);
                }

                if (v === 1) {
                    // BLOOM's floor: the canopy glow the caps are lit by.
                    const floor = ctx.createLinearGradient(0, h * 0.74, 0, h);
                    floor.addColorStop(0, rgba(BLOOM, 0));
                    floor.addColorStop(1, rgba(BLOOM, 0.5));
                    ctx.fillStyle = floor;
                    ctx.fillRect(x0, h * 0.74, qw, h * 0.26);
                }
            }
        };

        /* Frame cap at thirty.
           This is atmosphere behind type, not gameplay, and thirty frames is
           where a drifting field stops looking choppy and starts looking
           calm. It halves the compositor work on a phone for a difference
           nobody will find. */
        let last = 0;
        const FRAME = 1000 / 30;
        const loop = (now: number) => {
            if (!running) return;
            raf = requestAnimationFrame(loop);
            if (now - last < FRAME) return;
            last = now - (now - last) % FRAME;
            draw(now);
        };

        resize();
        if (!reduce) raf = requestAnimationFrame(loop);

        const ro = new ResizeObserver(resize);
        ro.observe(canvas);

        // A canvas running off-screen is pure cost. The menu is not always the
        // screen in front of the player, and neither is the tab.
        const onVisibility = () => {
            if (document.hidden) {
                cancelAnimationFrame(raf);
                running = false;
            } else if (!reduce) {
                running = true;
                last = 0;
                raf = requestAnimationFrame(loop);
            }
        };
        document.addEventListener("visibilitychange", onVisibility);

        return () => {
            running = false;
            cancelAnimationFrame(raf);
            ro.disconnect();
            document.removeEventListener("visibilitychange", onVisibility);
        };
    }, []);

    return <canvas ref={ref} className={className} aria-hidden="true" />;
}
