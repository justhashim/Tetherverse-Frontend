'use client';

import { useEffect, useRef } from 'react';
import { animate, motion, useReducedMotion } from 'framer-motion';
import CoinIcon from '@/src/components/shared/CoinIcon';
import { stratumForAltitude } from '@/src/game/config/strata';

export interface GameOverData {
    altitude: number;
    best: number;
    /**
     * The best as it stood before this run began.
     *
     * Separate from `best` on purpose: `best` already contains this run's own
     * peak by the time the run ends, so comparing the two answers "did you beat
     * your best?" with no almost always. Only this value can say whether the
     * climb beat anything.
     */
    bestBefore: number;
    /** Banked coins after this run. The server total is authoritative. */
    coins: number;
    /** Coins that were on the mountain when the run ended, and are therefore lost. */
    lostCoins: number;
}

interface GameOverOverlayProps {
    data: GameOverData;
    onRerun: () => void;
    onExit: () => void;
}

/** The entry curve. Heavy out: fast start, long settle, no overshoot. */
const ENTER_EASE = [0.16, 1, 0.3, 1] as const;

/**
 * The rain, which rises.
 *
 * The player died going down and the frame behind is frozen, so the only way
 * left to say "still falling" is to move everything else past them. Nine of
 * them, at four different speeds, because one speed reads as a scrolling
 * background and four read as weather.
 *
 * Colour is rose rather than white: this is the failure layer, and cyan is not
 * available - it belongs to the player, who is the thing falling through it.
 */
const RAIN = [
    { left: '8%', height: 64, duration: 13.5, delay: -2.5, alpha: 0.5 },
    { left: '19%', height: 118, duration: 10.5, delay: -7.0, alpha: 0.75 },
    { left: '29%', height: 84, duration: 15.5, delay: -12.5, alpha: 0.4 },
    { left: '40%', height: 142, duration: 9.5, delay: -4.5, alpha: 0.7 },
    { left: '51%', height: 72, duration: 14.5, delay: -9.5, alpha: 0.45 },
    { left: '62%', height: 128, duration: 11.5, delay: -1.0, alpha: 0.65 },
    { left: '72%', height: 96, duration: 16.5, delay: -6.5, alpha: 0.35 },
    { left: '83%', height: 150, duration: 10.0, delay: -14.0, alpha: 0.72 },
    { left: '93%', height: 76, duration: 12.5, delay: -3.5, alpha: 0.5 },
] as const;

function VoidRain() {
    return (
        <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden="true">
            {RAIN.map((s) => (
                <span
                    key={s.left}
                    className="absolute top-full w-px animate-[void-fall_linear_infinite]"
                    style={{
                        left: s.left,
                        height: s.height,
                        background: `linear-gradient(to bottom, transparent 0%, rgba(244,63,94,${s.alpha}) 48%, transparent 100%)`,
                        animationDuration: `${s.duration}s`,
                        animationDelay: `${s.delay}s`,
                    }}
                />
            ))}
        </div>
    );
}

/**
 * The game-over overlay.
 *
 * The screen used to be a boxed modal: a panel with a border, a backdrop blur
 * and a logo inside it, centred over the run. Three problems with that. It
 * covered the frozen frame of the world the player just lost with an opaque
 * card, so there was nothing behind it to look at. It stacked two
 * backdrop-blurs over a paused canvas, which is the one thing this codebase has
 * already measured as expensive. And an instrument is not a box - that is the
 * principle the HUD states outright when it strips the altimeter out of its
 * card, and a game-over screen which re-boxes it is contradicting the screen
 * that preceded it.
 *
 * So there is no panel. The type sits on the dark the way the HUD's does, and
 * the readout keeps the exact shape it had while the run was live - same
 * monospace, same tabular figures, same white - so the number the player was
 * watching does not change identity when it stops moving.
 *
 * Colour law, applied strictly: cyan is the player and nothing else. The
 * altitude is not the player - it is a measurement of the player, and this
 * numeral is up to 132px tall with the frozen cyan sprite still standing
 * behind it, so giving it cyan put two enormous cyan objects on one screen
 * and did the exact thing the law exists to prevent. White is what this
 * product already renders every measured value in: the leaderboard column,
 * the menu's score readout, the old sector-best tile. So the number stays
 * the brightest object here and stops claiming the player's colour to be it.
 *
 * What is left: one cyan control, the one that puts the player back in the
 * game, wearing the same cyan the menu's play disc wears. Rose is the failure
 * and everything that follows from it. Amber is the reward - banked coins, and
 * the record. Violet is the multiverse and is not mentioned. Everything else is
 * a reference value and wears zinc.
 */
export default function GameOverOverlay({ data, onRerun, onExit }: GameOverOverlayProps) {
    const altRef = useRef<HTMLSpanElement>(null);
    const primaryRef = useRef<HTMLButtonElement>(null);
    const reduce = useReducedMotion();

    const zone = stratumForAltitude(data.altitude);

    const isRecord = data.altitude > data.bestBefore;
    // On a record, `best` already contains this run's own peak, so printing it
    // under the hero would show the same number twice with no explanation.
    // Show what was beaten instead; the mark below names it.
    const showPrevious = isRecord && data.bestBefore > 0;
    const bestLabel = showPrevious ? 'Previous best' : 'Sector best';
    const bestValue = showPrevious ? data.bestBefore : Math.max(data.best, data.altitude);

    /* ------------------------------------------------------------- the number
       Counts up once, and writes into the DOM node rather than into state: a
       value that changes sixty times a second for a second and a half is
       exactly what must not re-render a tree. The same reason MainMenu writes
       its score this way. */
    useEffect(() => {
        const node = altRef.current;
        if (!node) return;
        const final = Math.max(0, Math.round(data.altitude));
        if (reduce) {
            node.textContent = final.toLocaleString();
            return;
        }
        const controls = animate(0, final, {
            duration: 1.1,
            delay: 0.3,
            ease: ENTER_EASE,
            onUpdate: (v) => {
                if (altRef.current) altRef.current.textContent = Math.round(v).toLocaleString();
            },
        });
        return () => controls.stop();
    }, [data.altitude, reduce]);

    /* ------------------------------------------------------------------ focus
       Taken by the one control that starts the next run, the moment the screen
       exists, so a keyboard player can go again without hunting for it.
       `preventScroll` because the container is `overflow-hidden` and a browser
       scrolling a button into view would shove the whole overlay. */
    useEffect(() => {
        const frame = requestAnimationFrame(() => primaryRef.current?.focus({ preventScroll: true }));
        return () => cancelAnimationFrame(frame);
    }, []);

    /**
     * One entrance. Explicit delays rather than an index, because the order
     * here is a reading order - what happened, what you scored, what it beat,
     * then what to do - and an index hides that behind arithmetic.
     */
    const enter = (delay: number, y = 16) => ({
        initial: { opacity: 0, y },
        animate: { opacity: 1, y: 0 },
        transition: { duration: 0.6, ease: ENTER_EASE, delay },
    });

    return (
        <div
            role="dialog"
            aria-modal="true"
            aria-label="Run over"
            className="absolute inset-0 z-50 overflow-hidden select-none"
        >
            {/*
              A scrim, not a blur. The old overlay put `backdrop-blur-md` on this
              layer and `backdrop-blur-xl` on the card inside it, over a canvas
              that is paused and therefore costs nothing to re-read - and then
              animated on top of both. Stripping a single backdrop-blur from the
              sign-in card was worth 33 -> 39 fps in WebKit, so this buys the
              frames back and lets the frozen world show through at the same
              time, which the opaque card never did.
            */}
            <div
                className="pointer-events-none absolute inset-0"
                style={{
                    background:
                        'linear-gradient(to bottom, rgba(2,4,8,0.93) 0%, rgba(2,4,8,0.76) 34%, rgba(7,3,8,0.80) 68%, rgba(2,4,8,0.95) 100%)',
                }}
            />

            {/*
              The abyss, glowing at the foot of the screen. It breathes slowly,
              and it is doing a job: it puts the brightest thing on the overlay
              directly behind the controls, so the eye arrives at the button it
              is meant to press without anything having to point at it.
            */}
            <div
                className="pointer-events-none absolute inset-x-0 bottom-0 h-[54%] origin-bottom opacity-60 animate-[void-breathe_9s_ease-in-out_infinite]"
                style={{
                    background:
                        'radial-gradient(118% 100% at 50% 100%, rgba(244,63,94,0.30) 0%, rgba(244,63,94,0.08) 46%, transparent 74%)',
                }}
                aria-hidden="true"
            />

            <VoidRain />

            <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ duration: 0.5, ease: ENTER_EASE }}
                className="relative flex h-full flex-col px-5 pt-9 pb-6 md:px-8 md:pt-10 md:pb-8"
            >
                {/* ------------------------------------------------ orientation */}
                <motion.header {...enter(0.1, 0)} className="flex shrink-0 flex-col items-center gap-3">
                    <motion.span
                        initial={{ scaleX: 0 }}
                        animate={{ scaleX: 1 }}
                        transition={{ duration: 1.1, ease: ENTER_EASE, delay: 0.16 }}
                        className="block h-px w-24 bg-gradient-to-r from-transparent via-rose-400/80 to-transparent"
                        aria-hidden="true"
                    />
                    <motion.p
                        {...enter(0.16, 10)}
                        className="font-mono text-[11px] font-bold uppercase tracking-[0.42em] text-rose-400 text-readout"
                    >
                        Ascent ended
                    </motion.p>
                </motion.header>

                {/* ------------------------------------------------------ the run */}
                <section className="flex min-h-0 flex-1 flex-col items-center justify-center gap-4 py-5">
                    <motion.div {...enter(0.24, 18)} className="flex flex-col items-center gap-2.5">
                        <p className="font-mono text-[10px] font-bold uppercase tracking-[0.3em] text-zinc-500 text-readout md:text-[11px]">
                            Final altitude
                        </p>

                        <div className="flex items-baseline gap-2">
                            {/*
                              White, and this was the single loudest thing on
                              the screen in cyan.

                              The rule in AGENTS.md is that cyan is the player
                              and nothing else, and the reason given is that the
                              moment another element takes it the player stops
                              being findable. The old readout took cyan as "the
                              player's own measure" - but the frozen player
                              sprite is still sitting behind this overlay, in
                              cyan, and a 132px cyan numeral above a cyan sprite
                              is two enormous cyan objects competing on one
                              screen. That is the outcome the law exists to
                              prevent, arrived at by reading its exception
                              generously.

                              The game already had the answer in three other
                              places: the leaderboard column, the menu's score
                              readout and the old sector-best tile all render a
                              measured value in white. White is this product's
                              voice for instrumentation, so the number keeps
                              being the brightest thing here - it just stops
                              claiming the player's colour to do it.
                            */}
                            <span
                                ref={altRef}
                                className="font-mono font-black leading-[0.86] tracking-[-0.03em] tabular text-readout text-white text-[clamp(68px,20vw,132px)]"
                            >
                                0
                            </span>
                            <span className="font-mono font-bold leading-none text-zinc-500 text-readout text-[clamp(20px,5.5vw,38px)]">
                                m
                            </span>
                        </div>
                    </motion.div>

                    {/*
                      The record, in a slot that is always there. It waits until
                      the count has landed - the mark arrives as the answer to
                      the number still moving - but it must not be inserted into
                      the flow when it does, or everything under it jumps half a
                      second after the screen has settled.
                    */}
                    <div className="flex h-6 items-center justify-center">
                        {isRecord && (
                            <motion.div
                                initial={{ opacity: 0, y: 8 }}
                                animate={{ opacity: 1, y: 0 }}
                                transition={{ duration: 0.7, ease: ENTER_EASE, delay: 1.42 }}
                                className="flex items-center gap-2"
                            >
                                <svg
                                    width="11"
                                    height="11"
                                    viewBox="0 0 10 10"
                                    fill="currentColor"
                                    aria-hidden="true"
                                    focusable="false"
                                    className="shrink-0 text-amber-300"
                                >
                                    <rect x="0" y="7" width="2.5" height="3" rx="0.4" />
                                    <rect x="3.75" y="4.5" width="2.5" height="5.5" rx="0.4" />
                                    <rect x="7.5" y="0" width="2.5" height="10" rx="0.4" />
                                </svg>
                                <span className="font-mono text-[11px] font-bold uppercase tracking-[0.3em] text-amber-300 text-readout">
                                    New record
                                </span>
                            </motion.div>
                        )}
                    </div>

                    {/*
                      Where the run reached, said the way the HUD says it: the
                      band's own name, between two rules, and nothing else. The
                      HUD already taught the player what these words mean, so
                      adding "reached the..." would be explaining a label they
                      have been reading all run.
                    */}
                    <motion.div {...enter(0.42, 12)} className="flex w-full max-w-[320px] items-center gap-4">
                        <span className="h-px flex-1 bg-white/10" />
                        <span className="font-mono text-[10px] font-bold uppercase tracking-[0.28em] text-zinc-400 text-readout">
                            {zone}
                        </span>
                        <span className="h-px flex-1 bg-white/10" />
                    </motion.div>
                </section>

                {/* ---------------------------------------------------- the detail */}
                <motion.section {...enter(0.52, 14)} className="shrink-0">
                    <div className="mx-auto flex w-full max-w-[420px] items-stretch">
                        <div className="flex flex-1 flex-col items-center gap-2">
                            <p className="font-mono text-[10px] font-bold uppercase tracking-[0.28em] text-zinc-500 text-readout">
                                {bestLabel}
                            </p>
                            <p className="font-mono text-xl font-bold text-zinc-100 tabular text-readout md:text-2xl">
                                {bestValue.toLocaleString()}
                                <span className="text-sm text-zinc-500"> m</span>
                            </p>
                        </div>

                        <span className="w-px bg-white/10" aria-hidden="true" />

                        <div className="flex flex-1 flex-col items-center gap-2">
                            <p className="font-mono text-[10px] font-bold uppercase tracking-[0.28em] text-zinc-500 text-readout">
                                Banked
                            </p>
                            <p className="flex items-center gap-2 font-mono text-xl font-bold text-amber-300 tabular text-readout md:text-2xl">
                                <CoinIcon size={18} />
                                {data.coins.toLocaleString()}
                            </p>
                        </div>
                    </div>

                    {/* Same reasoning as the record: a fixed slot, so a run with
                        nothing lost does not shove the buttons down at the last
                        moment. */}
                    <p className="mt-3 flex h-4 items-center justify-center font-mono text-[10px] uppercase tracking-[0.28em] text-rose-400/85">
                        {data.lostCoins > 0 && <span>{data.lostCoins} lost in the fall</span>}
                    </p>
                </motion.section>

                {/* ----------------------------------------------------- the way out
                    Both in the thumb zone, which is where the whole block lands
                    on a phone: the primary sits between roughly 708px and 764px
                    on a 390x844 screen, comfortably inside the bottom third and
                    out from under the hand covering the top corner.

                    The column is capped at the same 420px the stats use. Without
                    it the buttons are as wide as the viewport, and on a 1440
                    desktop that is a 1376px bar - the widest object in the
                    product, by a very long way, for a control that needs to be
                    findable rather than large.

                    The primary is a lit slot, not a painted slab. A solid
                    cyan-400 fill is what the menu disc and the sign-in button
                    use, but those sit alone on otherwise empty screens. Here it
                    would be the largest area of maximum chroma in a composition
                    that is white type, amber reward and rose failure - roughly
                    four fifths of every coloured pixel on the screen, which
                    made the number and the action fight each other. Dropping
                    the fill to a 6% wash and carrying the colour in the label,
                    the rule and the glow takes the cyan ink from 19,600px to
                    about 1,200px while leaving it the only cyan thing here, and
                    the only control with a light behind it. That is the player's
                    colour doing the player's job, at the size a light needs to
                    be. */}
                <div className="mx-auto mt-6 flex w-full max-w-[420px] shrink-0 flex-col gap-3">
                    <motion.button
                        ref={primaryRef}
                        type="button"
                        onClick={onRerun}
                        {...enter(0.66, 20)}
                        className="w-full min-h-[56px] rounded-[var(--radius-control)] bg-cyan-400/[0.06] px-6 py-4
                                   font-mono text-sm font-bold uppercase tracking-[0.24em] text-cyan-300
                                   ring-1 ring-inset ring-cyan-400/50
                                   shadow-[inset_0_1px_0_rgba(255,255,255,0.10),0_0_46px_-18px_rgba(34,211,238,0.55)]
                                   transition-[background-color,transform,box-shadow] duration-300
                                   ease-[cubic-bezier(0.16,1,0.3,1)]
                                   hover:bg-cyan-400/[0.12] active:scale-[0.98]
                                   focus-visible:outline-2! focus-visible:outline-white! focus-visible:outline-offset-4!
                                   cursor-pointer select-none touch-manipulation"
                    >
                        Ascend again
                    </motion.button>

                    <motion.button
                        type="button"
                        onClick={onExit}
                        {...enter(0.74, 16)}
                        className="w-full min-h-[44px] rounded-[var(--radius-control)] border border-white/15 bg-white/[0.04] px-6 py-3
                                   font-mono text-[11px] font-bold uppercase tracking-[0.24em] text-zinc-400
                                   transition-[border-color,color] duration-200
                                   hover:border-white/30 hover:text-zinc-200
                                   focus-visible:outline-2! focus-visible:outline-white! focus-visible:outline-offset-4!
                                   cursor-pointer select-none touch-manipulation"
                    >
                        Return to launcher
                    </motion.button>

                    {/* Keyboard only: on a phone this would be a caption about
                        keys the player does not have, and the HUD already
                        switches its own hint for touch the same way. */}
                    <p className="hidden pt-1 text-center font-mono text-[10px] uppercase tracking-[0.24em] text-zinc-600 sm:block">
                        Space climb again
                        <span className="mx-2 text-zinc-700">·</span>
                        Esc leave
                    </p>
                </div>
            </motion.div>
        </div>
    );
}
