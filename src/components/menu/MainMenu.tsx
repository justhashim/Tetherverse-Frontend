'use client';

import { useEffect, useRef, useState } from "react";
import Image from "next/image";
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
    /** Opens the manual: the rules a climb is decided by, and how a run is scored. */
    onOpenRules: () => void;
    onLogout: () => void;
    user: { name: string; image?: string | null };
    bestAltitude?: number;
    /** True when the menu is the screen in front of the player. */
    active?: boolean;
    /** True while the server is opening a run for this climb. */
    starting?: boolean;
    /** Why the last attempt to open a run failed, if it did. */
    error?: string | null;
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
 * The way to the board.
 *
 * One control, rendered in two places: the centre of the top bar on a wide
 * screen, and under the record on a phone. It used to be `hidden sm:flex`,
 * which meant the board had no entry point at all on the platform this game is
 * built for - the one screen in the product with a ranking on it was reachable
 * only from a desktop.
 *
 * The hit area is a full 44px tall even though the label is 10px, because the
 * right-hand column it sits in is in the top corner where a thumb can still
 * reach on a large handset, and a text link is not a target.
 */
function LeaderboardLink({ onClick, className = "" }: { onClick: () => void; className?: string }) {
    return (
        <button
            onClick={onClick}
            type="button"
            className={`group inline-flex min-h-[44px] items-center gap-2.5 font-mono text-[10px] sm:text-[11px] uppercase tracking-[0.22em] text-zinc-400 hover:text-zinc-100 transition-[color] duration-150 cursor-pointer select-none touch-manipulation ${className}`}
        >
            <span className="text-zinc-500 transition-colors duration-150 group-hover:text-zinc-300">
                <LeaderboardIcon />
            </span>
            Leaderboard
        </button>
    );
}

/**
 * A page with lines of writing on it: the manual glyph.
 *
 * Outlined rather than filled, unlike the leaderboard's bars, because the two
 * marks are different kinds of thing: a ranking is a reading of the board, a
 * manual is a document you open. Drawn on `currentColor` so it tints with its
 * label, and inline because one mark is not worth a library.
 */
function RulesIcon() {
    return (
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none"
            aria-hidden="true" focusable="false" className="shrink-0">
            <rect x="2.75" y="1" width="8.5" height="12" rx="1.4"
                stroke="currentColor" strokeWidth="1.3" />
            <path d="M5.25 4.6h3.5M5.25 6.9h3.5M5.25 9.2h2.1"
                stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
        </svg>
    );
}

/**
 * The way to the rules.
 *
 * Placed by the same rule as the board, but not in the same place. On a wide
 * screen it joins the leaderboard in the middle of the top bar, where there is
 * room and a pointer; on a phone it sits under the route, in the bottom band,
 * because the top right corner of a 390px screen is the one place a thumb
 * cannot go. The two placements are the same control, hidden and shown at the
 * `sm` breakpoint that separates the two compositions.
 */
function RulesLink({ onClick, className = "" }: { onClick: () => void; className?: string }) {
    return (
        <button
            onClick={onClick}
            type="button"
            className={`group inline-flex min-h-[44px] items-center gap-2.5 font-mono text-[10px] sm:text-[11px] uppercase tracking-[0.22em] text-zinc-400 hover:text-zinc-100 transition-[color] duration-150 cursor-pointer select-none touch-manipulation ${className}`}
        >
            <span className="text-zinc-500 transition-colors duration-150 group-hover:text-zinc-300">
                <RulesIcon />
            </span>
            Rules
        </button>
    );
}

/**
 * The exit back to the Excel Play launcher.
 *
 * This is a real link rather than a client-side redirect: the launcher is a
 * separate application, so the browser should own the navigation and users
 * should be able to open it in a new tab from the context menu. On the narrowest
 * phones the label collapses to the arrow, but the 44px target and accessible
 * name remain.
 */
function BackToPlayLink() {
    return (
        <a
            href="https://play.excelmec.org"
            aria-label="Back to Excel Play"
            className="group inline-flex min-h-[44px] shrink-0 items-center gap-2 rounded-[var(--radius-control)]
                       font-mono text-[10px] uppercase tracking-[0.18em] text-zinc-400
                       transition-[color,transform] duration-150 hover:text-zinc-100 active:scale-[0.97]
                       focus-visible:outline-2! focus-visible:outline-white! focus-visible:outline-offset-2!
                       touch-manipulation"
        >
            <span className="text-zinc-500 transition-colors duration-150 group-hover:text-zinc-300" aria-hidden="true">
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none" focusable="false">
                    <path d="M8.75 3.25 5.5 7l3.25 3.75M6 7h5.25" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
            </span>
            <span className="hidden min-[420px]:inline">Back to Play</span>
        </a>
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
    onOpenRules,
    onLogout,
    user,
    bestAltitude = 0,
    active = false,
    starting = false,
    error = null,
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
     *
     * Only while the menu is the screen in front. It stays mounted behind the
     * board and the manual (that sky is these panels' backdrop), so a listener
     * that fired from there would start a run out of a reference sheet - the
     * one press this screen owns, spent by a key the player pressed to read.
     */
    useEffect(() => {
        if (!active) return;

        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key !== 'Enter') return;
            const target = e.target as HTMLElement | null;
            if (target && (target.tagName === 'BUTTON' || target.tagName === 'A' || target.isContentEditable)) return;
            e.preventDefault();
            onPlay();
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [onPlay, active]);

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
        "block font-black leading-[0.84] tracking-[-0.045em] text-[clamp(2.4rem,11vw,5rem)] short:text-[2.5rem]";

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
                The phone composition is three bands with the sky between them:
                identity at the top, the name directly beneath it, the control
                sunk into the thumb's arc, the route along the bottom.

                The name used to be glued to the control and the pair sunk
                together, which left a single 400px gap above the name - half a
                phone screen of nothing, and nothing on the other side of it to
                make it read as space. A void is a composition only when it is
                bounded above; here the world gets the middle of the screen and
                the two anchors sit at the two ends.

                The control still lands in the same place. It is `mt-auto`
                inside the middle band rather than `mt-auto` on it, so the band
                stretches and the disc keeps the bottom of its travel.

                The split is `lg`, not `md`. A tablet in portrait is still a
                touch screen held in two hands, and centring the band put the
                only control at 53% of the screen - a reach, not a press. The
                phone composition carries through the tablet widths; desktop
                centring starts where the pointer does. */}
            <div className="relative h-full flex flex-col
                            pl-[calc(1.75rem+env(safe-area-inset-left))] pr-[calc(1.75rem+env(safe-area-inset-right))]
                            pt-[calc(1.75rem+env(safe-area-inset-top))] pb-[calc(1.25rem+env(safe-area-inset-bottom))]
                            md:pl-[calc(3rem+env(safe-area-inset-left))] md:pr-[calc(3rem+env(safe-area-inset-right))]
                            md:pt-[calc(2.75rem+env(safe-area-inset-top))] md:pb-[calc(2.75rem+env(safe-area-inset-bottom))]
                            short:pt-[calc(1.25rem+env(safe-area-inset-top))] short:pb-[calc(1.25rem+env(safe-area-inset-bottom))]
                            md:justify-between">

                {/* Top band: who is playing, the way to the board, what they've done. */}
                <motion.header {...stagger(0)}
                    className="flex items-start justify-between gap-4">
                    <ProfileCard user={user} onLogout={onLogout} />

                    <div className="hidden sm:flex items-center gap-7">
                        <RulesLink onClick={onOpenRules} />
                        <LeaderboardLink onClick={onOpenLeaderboard} />
                    </div>

                    <div className="flex flex-col items-end text-right">
                        <span className="font-mono text-[10px] md:text-[11px] uppercase tracking-[0.28em] text-zinc-400">Best</span>
                        <span className="flex items-baseline gap-1 text-readout">
                            <span ref={recordRef}
                                className="font-mono font-semibold tabular text-2xl md:text-3xl text-zinc-50 leading-tight">0</span>
                            <span className="font-mono text-sm text-zinc-400">m</span>
                        </span>
                        <span className="font-mono text-[10px] md:text-[11px] uppercase tracking-[0.24em] text-zinc-400">
                            {bestAltitude > 0 ? stratum : "No record"}
                        </span>
                        {/* The phone's way to the board. On a wide screen the
                            same control lives in the middle of the bar above,
                            where there is room for it; here it closes the
                            record column instead of taking a row of its own
                            from the sky. */}
                        <LeaderboardLink onClick={onOpenLeaderboard} className="sm:hidden" />
                    </div>
                </motion.header>

                {/* Middle band: the name at one end, the control at the other. */}
                <div className="mt-7 flex flex-1 flex-col items-center gap-y-6 short:mt-3 lg:mt-0 lg:justify-center">

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
                        className="mt-auto flex flex-col items-center lg:mt-0"
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
                            aria-busy={starting}
                            disabled={starting}
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
                                       cursor-pointer select-none touch-manipulation
                                       disabled:cursor-wait disabled:opacity-70
                                       disabled:hover:bg-white/[0.09] disabled:hover:ring-white/25
                                       disabled:active:scale-100"
                        >
                            <span aria-hidden="true"
                                className="pointer-events-none absolute inset-0 rounded-full animate-[breathe_4.5s_cubic-bezier(0.16,1,0.3,1)_infinite]" />

                            <span
                                className="grid place-items-center w-32 h-32 short:w-28 short:h-28 md:w-44 md:h-44 rounded-full
                                           bg-cyan-400 text-slate-950
                                           shadow-[0_0_72px_-16px_rgba(34,211,238,0.6),inset_0_1px_1px_rgba(255,255,255,0.45)]
                                           transition-[background-color,box-shadow] duration-[350ms]
                                           ease-[cubic-bezier(0.16,1,0.3,1)]
                                           group-hover:bg-cyan-300 group-hover:shadow-[0_0_104px_-10px_rgba(34,211,238,0.85),inset_0_1px_1px_rgba(255,255,255,0.55)]"
                            >
                                <svg viewBox="0 0 24 24"
                                    className="w-10 h-10 short:w-8 short:h-8 md:w-14 md:h-14 translate-x-[7%] transition-transform duration-[420ms] ease-[cubic-bezier(0.16,1,0.3,1)] group-hover:translate-x-[15%]"
                                    fill="currentColor" aria-hidden="true" focusable="false">
                                    <path d="M8 5.14v13.72c0 .81.88 1.3 1.55.84l10.78-6.86a1 1 0 0 0 0-1.68L9.55 4.3A1 1 0 0 0 8 5.14z" />
                                </svg>
                            </span>
                        </motion.button>

                        <motion.p {...stagger(4)}
                            className="mt-4 font-mono text-[10px] md:text-[11px] uppercase tracking-[0.24em] text-zinc-300 [text-shadow:0_1px_10px_rgba(2,4,8,0.95)] text-center text-readout short:hidden">
                            {starting ? "Opening the run" : "Hold to grapple · release to launch"}
                        </motion.p>

                        {/*
                          The failure to open a run is stated here, beside the
                          control that caused it, rather than as a toast: the
                          player has to know the climb did not start and that
                          nothing they do on the mountain would have counted.
                        */}
                        {error && (
                            <motion.p
                                role="alert"
                                initial={{ opacity: 0, y: 6 }}
                                animate={{ opacity: 1, y: 0 }}
                                transition={{ duration: 0.3, ease: ENTER_EASE }}
                                className="mt-3 max-w-[280px] text-center font-mono text-[11px] leading-relaxed tracking-[0.04em] text-rose-300 [text-shadow:0_1px_10px_rgba(2,4,8,0.95)]"
                            >
                                {error}
                            </motion.p>
                        )}
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
                    className="mt-2 lg:mt-0 grid grid-cols-4 gap-2 pt-1 short:mt-4 short:pt-1 border-t border-white/[0.07]"
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
                                        lit ? "text-zinc-100 text-readout" : "text-zinc-400 group-hover:text-zinc-200"
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

                {/*
                  The foot of the screen: the credit, and the manual.

                  These share a row because the bottom band is the most
                  expensive 44 pixels on the screen. The disc is `mt-auto` at
                  the bottom of the middle band, so every pixel added under it
                  moves the one control in the game up out of a thumb's reach,
                  and a 44px line of its own under the route is 44 pixels of
                  reach spent on a document. So the manual shares the credit's
                  row, on the right where a thumb already rests, and the route,
                  the credit and the hint above give back the height they can
                  spare. Measured afterwards at 390x844: the disc's centre sits
                  at 616px, 73% down the screen, inside the bottom third.

                  On a wide screen the rules are in the top bar and only the
                  credit is here, so the row goes back to being centred.
                */}
                <motion.div {...stagger(6)}
                    className="relative mt-1 short:mt-2 flex items-center justify-center gap-3">
                    <span className="absolute left-0">
                        <BackToPlayLink />
                    </span>

                    <span className="flex items-center gap-3">
                        <span className="font-mono text-[9px] uppercase tracking-[0.28em] text-zinc-400
                                         [text-shadow:0_1px_10px_rgba(2,4,8,0.95)] md:text-[10px]">
                            Sponsored by
                        </span>
                        <Image
                            src="/images/studyin-logo.webp"
                            alt="StudyIn"
                            width={480}
                            height={106}
                            className="h-4 w-auto short:h-3.5 md:h-5"
                        />
                    </span>

                    <RulesLink onClick={onOpenRules} className="absolute right-0 sm:hidden" />
                </motion.div>
            </div>
        </div>
    );
}
