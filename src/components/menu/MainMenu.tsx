'use client';

import { useEffect, useRef, useState } from "react";
import {
    animate,
    motion,
    useMotionValue,
    useReducedMotion,
    useSpring,
    useTransform,
} from "framer-motion";
import ProfileCard from "./ProfileCard";
import VerseScenes from "./VerseScenes";
import { stratumForAltitude } from "@/src/game/config/strata";

interface MainMenuProps {
    onPlay: () => void;
    onOpenLeaderboard: () => void;
    onLogout: () => void;
    user: { name: string; image?: string | null };
    bestAltitude?: number;
    /** True when the menu is the screen in front of the player. */
    active?: boolean;
}

/**
 * A bar-chart glyph for the leaderboard action.
 *
 * Inline rather than pulled from a set: the icon needs to inherit `currentColor`
 * so it tints with the button label, and it is three rectangles. An icon library
 * would ship forty kilobytes of tree-shaken paths for one mark.
 */
function LeaderboardIcon() {
    return (
        <svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor"
            aria-hidden="true" focusable="false" className="shrink-0">
            {/* Ascending bars, left to right, so the glyph reads as a ranking
                rather than as a generic chart. */}
            <rect x="0" y="8" width="3" height="6" rx="0.5" />
            <rect x="5.5" y="4" width="3" height="10" rx="0.5" />
            <rect x="11" y="0" width="3" height="14" rx="0.5" />
        </svg>
    );
}

/**
 * One corner of the instrument frame.
 *
 * A short pair of hairlines, inset from the viewport. Four of them turn the
 * screen edge into a viewfinder, which is the device that makes an overlay read
 * as instrumentation rather than as a page sitting on a picture.
 */
function CornerTick({ className }: { className: string }) {
    return (
        <div aria-hidden="true"
            className={`pointer-events-none absolute w-4 h-4 border-white/25 ${className}`} />
    );
}

/** A verse's name and numeral. What it looks like is drawn, not styled. */
type Verse = {
    numeral: string;
    name: string;
};

/**
 * The four verses, in the order the player reaches them.
 *
 * These are the same four worlds the portal system carries a run through. The
 * menu states the premise without a sentence of copy: the sky behind this
 * screen is four of them at once, side by side, each with its own light,
 * its own floor and its own weather.
 *
 * None of them is cyan. Cyan is the player's own presence and nothing else, so
 * the moment a background takes it the control stops being findable.
 */
const VERSES: Verse[] = [
    { numeral: "I", name: "Verge" },
    { numeral: "II", name: "Bloom" },
    { numeral: "III", name: "Kiln" },
    { numeral: "IV", name: "Null" },
];

/**
 * Each verse's accent, in the same order as VERSES.
 *
 * Mirrors `src/game/worlds/definitions.ts`, which cannot be imported here: it
 * pulls in Phaser, and this is a client component rendering a menu. Four hex
 * values is the whole cost of the duplication.
 *
 * None is cyan. Cyan is the player, and the player is not on this screen.
 */
const ACCENT = ["#a855f7", "#63ffb3", "#ff8a3a", "#ff2fd0"] as const;

/** The entry curve. Heavy out: fast start, long settle, no overshoot. */
const ENTER_EASE = [0.16, 1, 0.3, 1] as const;

export default function MainMenu({
    onPlay,
    onOpenLeaderboard,
    onLogout,
    user,
    bestAltitude = 0,
    active = false,
}: MainMenuProps) {
    const playRef = useRef<HTMLButtonElement>(null);
    const recordRef = useRef<HTMLSpanElement>(null);
    const reduce = useReducedMotion();

    /* --------------------------------------------------------------- focus
       Which verse the player is pointing at, if any.

       State rather than CSS `:has()`, because the thing being hovered (a name
       in the row at the bottom) and the thing reacting (a slice of sky at the
       top) are not nested - no selector can connect them. Four values, changed
       only on enter and leave, so this never re-renders during a gesture. */
    const [focusedVerse, setFocusedVerse] = useState<number | null>(null);

    /* ---------------------------------------------------------------- motion
       The menu is a plane in front of a world, so it behaves like one: a few
       pixels of parallax when the pointer moves, with the two halves of the
       name drifting against the control so there is depth between them.

       Motion values, not state. Pointer position changes every frame; routing
       it through useState would re-render the whole menu sixty times a second
       and collapse on a phone, which is the platform this game is built for. */
    const px = useMotionValue(0);
    const py = useMotionValue(0);
    const springX = useSpring(px, { stiffness: 55, damping: 20, mass: 0.6 });
    const springY = useSpring(py, { stiffness: 55, damping: 20, mass: 0.6 });

    const titleX = useTransform(springX, (v) => v * 8);
    const titleY = useTransform(springY, (v) => v * 6);
    // The control moves against the name above it, and by the most, because it
    // is the only element on the screen the player can touch.
    const controlX = useTransform(springX, (v) => v * -18);
    const controlY = useTransform(springY, (v) => v * -13);
    // The slices slide against each other too, so the four worlds read as four
    // planes at four depths rather than as one flat picture cut into strips.
    const sliceX = useTransform(springX, (v) => v * 22);

    function handlePointerMove(e: React.PointerEvent<HTMLDivElement>) {
        if (reduce) return;
        const r = e.currentTarget.getBoundingClientRect();
        px.set((e.clientX - r.left) / r.width - 0.5);
        py.set((e.clientY - r.top) / r.height - 0.5);
    }

    function handlePointerLeave() {
        px.set(0); py.set(0);
    }

    /* -------------------------------------------------------------- the record
       The number counts up once when the menu appears. It writes straight into
       the DOM node rather than into state, because a value that changes every
       frame for a second is exactly what should not re-render a tree. */
    useEffect(() => {
        if (bestAltitude <= 0 || !recordRef.current) return;
        recordRef.current.textContent = "0";
        const controls = animate(0, bestAltitude, {
            duration: 1.1, ease: ENTER_EASE,
            onUpdate: (v) => {
                if (recordRef.current) recordRef.current.textContent = Math.round(v).toLocaleString();
            },
        });
        return () => controls.stop();
    }, [bestAltitude]);

    /**
     * Enter starts the climb.
     *
     * A focused control keeps its own Enter key: if the player has tabbed to
     * the leaderboard and presses Enter, they meant the leaderboard. Anywhere
     * else, Enter means climb.
     */
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key !== 'Enter') return;
            const target = e.target as HTMLElement | null;
            if (target && (target.tagName === 'BUTTON' || target.tagName === 'A' || target.isContentEditable)) return;
            e.preventDefault();
            onPlay();
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [onPlay]);

    /** The control takes focus the moment the menu is the screen in front. */
    useEffect(() => {
        if (!active) return;
        const frame = requestAnimationFrame(() => playRef.current?.focus());
        return () => cancelAnimationFrame(frame);
    }, [active]);

    const stratum = stratumForAltitude(bestAltitude);

    const stagger = (i: number) => ({
        initial: { opacity: 0, y: 18 },
        animate: { opacity: 1, y: 0 },
        transition: { duration: 0.75, ease: ENTER_EASE, delay: 0.12 + i * 0.11 },
    });

    const wordmarkText =
        "block font-black leading-[0.84] tracking-[-0.045em] text-[clamp(2rem,6.5vw,5rem)]";

    return (
        <div
            onPointerMove={handlePointerMove}
            onPointerLeave={handlePointerLeave}
            className="relative w-screen min-h-[100dvh] h-[100dvh] overflow-hidden z-20 select-none"
        >
            {/* ------------------------------------------------------- the slices
                Four parallel pieces of sky, side by side, with the control
                sitting on the seam between the middle two.

                Each verse is opaque where it counts and transparent only at its
                edges. The earlier version was a translucent wash over one shared
                sky, and it read as four colour blocks: a wash carries no
                silhouette, and a silhouette is the only thing that makes a sky a
                *place* rather than a colour. So each verse now brings its own
                painted backdrop and its own cut-out shapes - hull plating over
                the Verge, bioluminescent caps over the Bloom, gantries over the
                Kiln, fragments over the Null - blended to nothing across its
                outer 15%, so that where two meet they mix.

                The seams are hairlines rather than gaps. Four hard panels would
                be a layout; four atmospheres meeting at a line is a view. */}
            <motion.div
                style={{ x: sliceX }}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ duration: 1.2, ease: ENTER_EASE, delay: 0.1 }}
                className="pointer-events-none absolute -inset-x-4 inset-y-0 overflow-hidden"
                aria-hidden="true"
            >
                <VerseScenes className="absolute inset-0 h-full w-full" focused={focusedVerse} />

                {/* The seams, on the same quarter marks the verse names below
                    are laid out on, so the row of names and the sky above it
                    are one grid rather than two. The slices blend their own
                    edges; these lines are what say the blends are four and not
                    one. */}
                {[25, 50, 75].map((pct) => (
                    <div key={pct}
                        className="absolute inset-y-0 w-px bg-white/[0.06]"
                        style={{ left: `${pct}%` }} />
                ))}
            </motion.div>

            {/*
              Legibility. A vignette keeps the middle of the frame clear while
              the edges fall away, and a shallow bottom band carries the verse
              names. Neither is the old corner slab: the content is spread, so
              the wash is spread.
            */}
            <div aria-hidden="true"
                className="pointer-events-none absolute inset-0 bg-[radial-gradient(125%_95%_at_50%_45%,transparent_32%,rgba(2,4,8,0.60)_100%)]" />
            <div aria-hidden="true"
                className="pointer-events-none absolute inset-x-0 bottom-0 h-[12%] bg-linear-to-t from-slate-950/55 to-transparent" />

            {/* ---------------------------------------------------------- frame */}
            <motion.div
                aria-hidden="true"
                initial={{ opacity: 0, scale: 1.015 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ duration: 0.9, ease: ENTER_EASE }}
                className="pointer-events-none absolute inset-4 md:inset-6 rounded-[var(--radius-panel)] ring-1 ring-inset ring-white/[0.07]"
            >
                <CornerTick className="-top-px -left-px border-l border-t rounded-tl-[calc(var(--radius-panel)-1px)]" />
                <CornerTick className="-top-px -right-px border-r border-t rounded-tr-[calc(var(--radius-panel)-1px)]" />
                <CornerTick className="-bottom-px -left-px border-l border-b rounded-bl-[calc(var(--radius-panel)-1px)]" />
                <CornerTick className="-bottom-px -right-px border-r border-b rounded-br-[calc(var(--radius-panel)-1px)]" />
            </motion.div>

            {/* -------------------------------------------------------- content
                On a phone the middle band is sunk with `mt-auto` rather than
                centred. Vertical centring puts the control at half the screen
                height, which on a tall handset is the top of the thumb's arc.
                Sunk, it lands where a thumb already is - which is the whole point
                of a one-button game. The desktop spreads the three bands. */}
            <div className="relative h-full flex flex-col px-7 pt-7 pb-[calc(1.75rem+env(safe-area-inset-bottom))] md:px-12 md:py-11 md:justify-between">

                {/* Top band: who is playing, the way to the board, what they've done. */}
                <motion.header {...stagger(0)}
                    className="flex items-start justify-between gap-4">
                    <ProfileCard user={user} onLogout={onLogout} />

                    <div className="hidden sm:flex items-center">
                        <button
                            onClick={onOpenLeaderboard}
                            className="group inline-flex items-center gap-2.5 font-mono text-[11px] uppercase tracking-[0.22em] text-zinc-500 hover:text-zinc-100 transition-[color] duration-150 cursor-pointer select-none touch-manipulation"
                        >
                            <span className="text-zinc-600 transition-colors duration-150 group-hover:text-zinc-300">
                                <LeaderboardIcon />
                            </span>
                            Leaderboard
                        </button>
                    </div>

                    <div className="flex flex-col items-end text-right">
                        <span className="font-mono text-[10px] md:text-[11px] uppercase tracking-[0.28em] text-zinc-500">Best</span>
                        <span className="flex items-baseline gap-1 text-readout">
                            <span ref={recordRef}
                                className="font-mono font-semibold tabular text-2xl md:text-3xl text-zinc-50 leading-tight">0</span>
                            <span className="font-mono text-sm text-zinc-400">m</span>
                        </span>
                        <span className="font-mono text-[10px] md:text-[11px] uppercase tracking-[0.24em] text-zinc-500">
                            {bestAltitude > 0 ? stratum : "No record"}
                        </span>
                    </div>
                </motion.header>

                {/* Middle band: the name, then the control beneath it. */}
                <div className="mt-auto flex flex-col items-center justify-center gap-y-6 md:mt-0">

                    {/*
                      The name, in one piece.

                      It used to be split across the control - TETHER on the
                      left, VERSE on the right, the button in the seam. That
                      read well at a glance and badly at a glance: a title you
                      have to assemble around an object is a title nobody reads
                      twice. Set whole, on one line, it names the product; the
                      two halves still take different weights so the
                      construction stays visible without leaving the word
                      broken in half.
                    */}
                    <span className="block overflow-hidden">
                        <motion.h1
                            initial={{ y: "108%" }} animate={{ y: "0%" }}
                            transition={{ duration: 0.95, ease: ENTER_EASE, delay: 0.44 }}
                            style={{ x: titleX, y: titleY }}
                            className={`${wordmarkText} text-center [filter:drop-shadow(0_2px_20px_rgba(2,4,8,0.9))]`}
                        >
                            <span className="text-white">TETHER</span>
                            <span className="bg-linear-to-b from-zinc-100 via-zinc-300 to-zinc-500 bg-clip-text text-transparent">
                                VERSE
                            </span>
                        </motion.h1>
                    </span>

                    {/* ------------------------------------------------ the disc */}
                    <motion.div
                        style={{ x: controlX, y: controlY }}
                        className="flex flex-col items-center"
                    >
                        {/*
                          The climb.

                          The largest thing on the screen and in the centre of
                          it, because there is exactly one thing a player can do
                          here. On a phone it is sunk into the thumb's arc; on a
                          desktop it sits on the seam between the middle two
                          verses, which is the seam a run actually crosses.

                          Double-bezelled: a machined outer shell holding a lit
                          core, the way a physical button sits in a housing. The
                          shell makes it read as an object in the world rather
                          than as a coloured div, and gives the hover somewhere
                          to go.

                          It is the only cyan on the screen. Cyan means the
                          player, and this is the player.

                          The triangle is nudged right. A right-pointing triangle
                          has all of its mass on the left, so one that is
                          geometrically centred reads as sitting left of the
                          middle of the disc.
                        */}
                        <motion.button
                            ref={playRef}
                            onClick={onPlay}
                            type="button"
                            aria-label="Begin ascent"
                            initial={{ opacity: 0, scale: 0.88 }}
                            animate={{ opacity: 1, scale: 1 }}
                            transition={{ duration: 0.8, ease: ENTER_EASE, delay: 0.52 }}
                            className="group relative grid place-items-center rounded-full p-2 md:p-2.5
                                       bg-white/[0.09] ring-1 ring-white/25
                                       shadow-[inset_0_1px_1px_rgba(255,255,255,0.14)]
                                       transition-[background-color,ring-color,transform] duration-[350ms]
                                       ease-[cubic-bezier(0.16,1,0.3,1)]
                                       hover:bg-white/[0.14] hover:ring-white/45
                                       active:scale-[0.97]
                                       focus-visible:outline-2! focus-visible:outline-white! focus-visible:outline-offset-4! focus-visible:rounded-full!
                                       cursor-pointer select-none touch-manipulation"
                        >
                            <span aria-hidden="true"
                                className="pointer-events-none absolute inset-0 rounded-full animate-[breathe_4.5s_cubic-bezier(0.16,1,0.3,1)_infinite]" />

                            <span
                                className="grid place-items-center w-32 h-32 md:w-44 md:h-44 rounded-full
                                           bg-cyan-400 text-slate-950
                                           shadow-[0_0_72px_-16px_rgba(34,211,238,0.6),inset_0_1px_1px_rgba(255,255,255,0.45)]
                                           transition-[background-color,box-shadow] duration-[350ms]
                                           ease-[cubic-bezier(0.16,1,0.3,1)]
                                           group-hover:bg-cyan-300 group-hover:shadow-[0_0_104px_-10px_rgba(34,211,238,0.85),inset_0_1px_1px_rgba(255,255,255,0.55)]"
                            >
                                <svg viewBox="0 0 24 24"
                                    className="w-10 h-10 md:w-14 md:h-14 translate-x-[7%] transition-transform duration-[420ms] ease-[cubic-bezier(0.16,1,0.3,1)] group-hover:translate-x-[15%]"
                                    fill="currentColor" aria-hidden="true" focusable="false">
                                    <path d="M8 5.14v13.72c0 .81.88 1.3 1.55.84l10.78-6.86a1 1 0 0 0 0-1.68L9.55 4.3A1 1 0 0 0 8 5.14z" />
                                </svg>
                            </span>
                        </motion.button>

                        <motion.p {...stagger(4)}
                            className="mt-6 font-mono text-[10px] md:text-[11px] uppercase tracking-[0.24em] text-zinc-500 text-center text-readout">
                            Hold to grapple · release to launch
                        </motion.p>
                    </motion.div>
                </div>

                {/*
                  Bottom band: the four verses, named under their own slice.

                  The first is lit and the rest are not, because every run begins
                  in the Verge - the row is a route, not a legend. It is the one
                  piece of instruction on this screen that is not repeated
                  anywhere else, and it turns four decorative strips into a
                  promise.

                  These are buttons, not labels. Pointing at a name lifts that
                  verse's slice out of the other three - the row is the only
                  control that can reach the sky, and it is at the bottom of the
                  screen precisely because that is where a thumb already is.
                */}
                <motion.nav {...stagger(5)}
                    className="mt-8 md:mt-0 grid grid-cols-4 gap-2 pt-4 border-t border-white/[0.07]"
                    aria-label="Verses">
                    {VERSES.map((v, i) => {
                        const active = focusedVerse === i;
                        const lit = active || (focusedVerse === null && i === 0);
                        return (
                            <button
                                key={v.name}
                                type="button"
                                onPointerEnter={() => setFocusedVerse(i)}
                                onPointerLeave={() => setFocusedVerse(null)}
                                onFocus={() => setFocusedVerse(i)}
                                onBlur={() => setFocusedVerse(null)}
                                className="group relative flex min-h-[44px] flex-col items-center justify-center gap-1
                                           rounded-[var(--radius-control)] pt-1 text-center cursor-pointer
                                           transition-transform duration-[420ms] ease-[cubic-bezier(0.16,1,0.3,1)]
                                           hover:-translate-y-0.5 focus-visible:outline-2! focus-visible:outline-white!
                                           focus-visible:outline-offset-2! touch-manipulation"
                            >
                                <span
                                    className={`font-mono text-[9px] md:text-[10px] tracking-[0.3em] transition-colors duration-500 ${
                                        lit ? "text-zinc-300" : "text-zinc-600"
                                    }`}
                                >
                                    {v.numeral}
                                </span>
                                <span
                                    className={`font-mono text-[10px] md:text-[11px] uppercase tracking-[0.22em] transition-colors duration-500 ${
                                        lit ? "text-zinc-100 text-readout" : "text-zinc-500 group-hover:text-zinc-300"
                                    }`}
                                >
                                    {v.name}
                                </span>

                                {/* The verse's own accent, under the name only while
                                    it is the one being looked at. Never cyan. */}
                                <span
                                    aria-hidden="true"
                                    className="absolute -bottom-px left-1/2 h-px w-0 -translate-x-1/2
                                               transition-[width,opacity] duration-[420ms] ease-[cubic-bezier(0.16,1,0.3,1)]"
                                    style={{
                                        background: ACCENT[i],
                                        opacity: active ? 0.9 : 0,
                                        width: active ? "62%" : "0%",
                                    }}
                                />
                            </button>
                        );
                    })}
                </motion.nav>
            </div>
        </div>
    );
}
