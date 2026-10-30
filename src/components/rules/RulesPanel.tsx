// src/components/rules/RulesPanel.tsx
'use client';

import { useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import CoinIcon from '@/src/components/shared/CoinIcon';

interface RulesPanelProps {
    onClose: () => void;
}

/**
 * One rule: a term in the game's own vocabulary, and what it means.
 *
 * The term is the thing the player will hear the game say ("banked", "the
 * void", "the risk line"), so it is set in the same monospace caps the HUD
 * uses for a label. Two columns on a wide screen, stacked on a phone: an
 * uppercase label and a sentence beside it is a table, and a table on a
 * 390px screen is two ragged columns of four words each.
 */
interface Rule {
    term: string;
    detail: string;
    /** The coin rule leads with the coin itself, because it is the only amber thing here. */
    coin?: boolean;
}

interface Section {
    numeral: string;
    title: string;
    /** One line under the title, so a section can be skimmed without reading it. */
    lead: string;
    rules: Rule[];
}

/**
 * The manual, in the order a climb asks the questions.
 *
 * Every number below is read out of the game rather than remembered:
 * `GAME_CONSTANTS` for the rope, the fray and the 20m fall; `LevelGenerator`
 * and `WorldManager` for the risk line and the portals; `WORLDS.md` for the
 * schedule. A rule sheet that drifts from the simulation is worse than none,
 * because it teaches a player something the mountain will contradict.
 *
 * The last section is not a formality. A climb cannot start without a run the
 * server opened, so "be online" is a rule of the game the same way the rope
 * length is - it is just the only one the player cannot see in the sim.
 */
const SECTIONS: Section[] = [
    {
        numeral: '01',
        title: 'The climb',
        lead: 'Altitude is the score. There is no summit, no boss, and no floor.',
        rules: [
            {
                term: 'Ten pixels, one metre',
                detail:
                    'Altitude is measured upward from the launch platform, so the number in the HUD is the height you are at and not the distance left to travel.',
            },
            {
                term: 'Your peak is the score',
                detail:
                    'A run is scored on the highest point it reached, never on where it ended. Climbing back down costs you time in the air, not the altitude the run already won.',
            },
            {
                term: 'The mountain never ends',
                detail:
                    'Ledges keep generating above the last one for as long as you keep reaching them. The shape tightens with altitude; it does not run out.',
            },
            {
                term: 'Difficulty reads your peak',
                detail:
                    'The next stretch of mountain is built from the highest point of the run, so falling back down never makes what is above you kinder.',
            },
        ],
    },
    {
        numeral: '02',
        title: 'One control',
        lead: 'Press and hold. Everything else in this game is timing.',
        rules: [
            {
                term: 'Hold to tether',
                detail:
                    'Press anywhere and keep holding. The rope takes the anchor you point at, or the nearest one within 38 metres if your finger is in open sky.',
            },
            {
                term: 'Hold to swing',
                detail:
                    'A held rope pumps the arc in the direction you are already travelling. That pump is the only energy the mountain gives away; every rotation after the first is earned.',
            },
            {
                term: 'Release to launch',
                detail:
                    'There is no boost on release. The arc you leave with is exactly the arc the swing had, which is why the release is the whole game.',
            },
        ],
    },
    {
        numeral: '03',
        title: 'The rope pays',
        lead: 'A mistake costs the tether, not the run.',
        rules: [
            {
                term: 'An impact frays it',
                detail:
                    'A hazard throws you off the anchor and wears the rope. Rose segments and a rose player are the same fact: the tether is hurt.',
            },
            {
                term: 'A frayed rope is longer',
                detail:
                    'Damage makes it pay out, up to 35% longer. The swing hangs lower and the release comes from further down, so a bad hit is a worse next swing rather than a shorter climb.',
            },
            {
                term: 'Three hits is the worst',
                detail:
                    'Each impact costs a third of the rope and the damage stops there. It re-braids on its own at 5% a second, so a clean run of swings heals it.',
            },
            {
                term: 'Unstable anchors let go',
                detail:
                    'An anchor that flares holds for about a second and then shatters. Take the hook and spend it; hanging on is how it kills you.',
            },
        ],
    },
    {
        numeral: '04',
        title: 'Coins',
        lead: 'The second thing worth climbing for, and the only one you can lose.',
        rules: [
            {
                term: 'Touch to take',
                detail: 'Coins lie on ledges and hang in the air. Crossing one collects it.',
                coin: true,
            },
            {
                term: 'Landing banks them',
                detail:
                    'A collected coin is only pending. Settling onto solid, ordinary ground is what commits the haul: the coins are yours once you have proved you can still climb.',
            },
            {
                term: 'The risk line never banks',
                detail:
                    'Narrow, crumbling ledges carry the richest coins and commit nothing. Whatever they hold is still out on the mountain until you land somewhere safe.',
            },
            {
                term: 'Banked coins are permanent',
                detail:
                    'They survive the run and are never spent. Anything still pending when the run ends falls with it, and the game-over screen says how much that was.',
            },
        ],
    },
    {
        numeral: '05',
        title: 'What ends a run',
        lead: 'Three ways. Every other cost can be climbed out of.',
        rules: [
            {
                term: 'The void under your peak',
                detail:
                    'Fall more than a screen below the highest point of the run and it is over. The void follows you up, so the higher you climb the closer it sits.',
            },
            {
                term: 'A fall to the base',
                detail:
                    'Past 20 metres of climb, sliding all the way back down to the launch platform ends the run as surely as the void does.',
            },
            {
                term: 'Aborting',
                detail:
                    'The way out of a run is Escape, and it abandons the climb: nothing banked, nothing scored. It is an exit, not a save.',
            },
            {
                term: 'Nothing else',
                detail:
                    'A hazard, a crumbling ledge, a dissolving floor and a snapped anchor all cost position and rope. None of them ends the run for you.',
            },
        ],
    },
    {
        numeral: '06',
        title: 'The verses',
        lead: 'Four worlds, one difficulty dial, no separate rulebooks.',
        rules: [
            {
                term: 'Four verses',
                detail:
                    'VERGE, BLOOM, KILN and NULL. Each is a skin and a set of multipliers on the same dial, so what a verse changes is how heavy, how slick or how brittle the mountain is.',
            },
            {
                term: 'Portals at 250 m, then every 400 m',
                detail:
                    'A gate carries the run into the next verse mid-flight. The order is BLOOM, KILN, NULL, and then VERGE again, so the loop closes where it started.',
            },
            {
                term: 'THE BLEED',
                detail:
                    'Past 50,000 metres the four stop taking turns. The skin rotates, the multipliers escalate, and the endgame arrives without a fifth world being invented for it.',
            },
            {
                term: 'Cyan is you',
                detail:
                    'The tether, the trail, the launch control: if it is cyan it is the player. No verse may take that colour, which is what keeps you findable on a busy sky.',
            },
        ],
    },
    {
        numeral: '07',
        title: 'Always online',
        lead: 'A climb is a run the server opened, not a number this tab invented.',
        rules: [
            {
                term: 'The run comes from the server',
                detail:
                    'The run is opened before the mountain exists. With no connection the ascent does not start, because there would be nothing to score it against.',
            },
            {
                term: 'The seed is the mountain',
                detail:
                    'The server also issues the seed the world is generated from, so the same attempt is the same mountain on every device. That is what makes a record mean anything.',
            },
            {
                term: 'One run, one score',
                detail:
                    'A run can be submitted once, and only what it banked and reached. The number that stands is the one the server accepted, not the one the tab displayed.',
            },
            {
                term: 'Your best lives on the API',
                detail:
                    'Altitude, coins and rank are read back from the server. The copy in this browser is only there to fill the number in before the real one answers.',
            },
        ],
    },
];

/** The entry curve. Heavy out: fast start, long settle, no overshoot. */
const ENTER_EASE = [0.16, 1, 0.3, 1] as const;

/**
 * The rules, as a sheet rather than a page.
 *
 * The menu teaches the loop in one line and the starting platform teaches it
 * again in world space, so this is not where the player learns to tether -
 * it is where they find out what the rope costs and what the coins are
 * waiting for. That makes it a reference, which is the one thing a player
 * reads mid-session and expects to be able to leave instantly.
 *
 * Which is why the close control is at the bottom, in the thumb zone, and
 * nothing else here is a control. The leaderboard puts its close in the top
 * corner; that is reachable with a mouse and a stretch with a thumb, and this
 * panel is the one the player is more likely to open one-handed.
 *
 * There is no cyan on this screen at all. Cyan is the player, and a column of
 * reference text is not the player - a panel that borrowed it would make the
 * menu's play disc one of two cyan objects, which is the outcome the colour
 * law exists to prevent.
 */
export default function RulesPanel({ onClose }: RulesPanelProps) {
    const dialogRef = useRef<HTMLDivElement>(null);

    /**
     * A sheet that takes the keyboard has to take focus with it, or Escape and
     * the arrow keys keep going to the menu behind it.
     *
     * It lands on the sheet itself rather than on Close. Focusing Close drew a
     * white focus ring around the way out the instant the panel opened, which
     * made the door look like the point of the room - and on a phone, where
     * nothing was tabbed to, the ring was a border that appeared for no reason
     * the player could see. From here the first Tab reaches the rules body,
     * the second reaches Close, and Escape works throughout.
     */
    useEffect(() => {
        const frame = requestAnimationFrame(() => dialogRef.current?.focus());
        return () => cancelAnimationFrame(frame);
    }, []);

    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape') {
                e.preventDefault();
                onClose();
            }
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [onClose]);

    return (
        <AnimatePresence>
            {/* No backdrop-blur: the panel already sits over the painted menu
                sky, and a blur over a live canvas is the one cost this
                codebase has measured twice and paid neither time. */}
            <div
                className="fixed inset-0 z-50 flex w-full items-end justify-center bg-slate-950/70 select-none sm:items-center sm:p-4"
                onClick={onClose}
            >
                <motion.div
                    ref={dialogRef}
                    tabIndex={-1}
                    /*
                      The focus sink is the sheet itself, and it must not draw a
                      ring: `:focus-visible` is unlayered in design-tokens.css,
                      so it outranks any utility, and its colour is `--signal`.
                      A cyan box around the manual would be a second cyan object
                      on a screen that has one, so the ring is suppressed here
                      by the only thing that outranks that rule - an inline
                      style. Nothing else on this sheet is a focus sink.
                    */
                    style={{ outline: 'none' }}
                    initial={{ opacity: 0, y: 28 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: 24 }}
                    transition={{ duration: 0.35, ease: ENTER_EASE }}
                    onClick={(e) => e.stopPropagation()}
                    role="dialog"
                    aria-modal="true"
                    aria-labelledby="rules-title"
                    className="relative flex max-h-[92dvh] w-full max-w-xl flex-col overflow-hidden
                               rounded-t-[var(--radius-panel)] border border-white/[0.08] bg-[#04060b]/[0.98]
                               shadow-2xl outline-none sm:max-h-[84vh] sm:rounded-[var(--radius-panel)]"
                >
                    {/* ------------------------------------------------------ header
                        The lead line is the first thing to go on a landscape
                        phone: at 390px of height the sheet can afford one line
                        of title and 250px of rules, and a subtitle would spend
                        a fifth of that on saying what the title says. */}
                    <div className="shrink-0 border-b border-white/[0.07] px-5 pt-5 pb-4 md:px-6 md:pt-6 short:px-4 short:pt-3 short:pb-2">
                        <p className="font-mono text-[10px] uppercase tracking-[0.34em] text-zinc-500 short:hidden">
                            The manual
                        </p>
                        <h2
                            id="rules-title"
                            className="mt-1 text-xl font-black uppercase tracking-tight text-white md:text-2xl short:mt-0 short:text-lg"
                        >
                            Rules &amp; guidelines
                        </h2>
                        <p className="mt-2 text-sm leading-relaxed text-zinc-400 short:hidden">
                            One rope, four verses, and a mountain that never asks
                            how you got there.
                        </p>
                    </div>

                    {/* -------------------------------------------------------- body
                        Scrollable, and focusable, so a keyboard player can read
                        past the fold without a pointer. `overscroll-contain`
                        stops the sheet handing a flick back to the page.

                        The fade at the foot is the only ornament: a line of
                        copy cut off mid-sentence by a control bar reads as a
                        layout bug, and a sheet that says "there is more" without
                        a scrollbar a phone will not show is worth 24 pixels. */}
                    <div className="relative flex min-h-0 flex-1 flex-col">
                        <div
                            tabIndex={0}
                            role="region"
                            aria-label="Rules"
                            className="custom-scrollbar min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 py-1 md:px-6"
                        >
                            <ol className="divide-y divide-white/[0.06]">
                                {SECTIONS.map((section) => (
                                    <li key={section.numeral} className="py-5 short:py-3">
                                        <div className="flex items-baseline gap-3">
                                            <span className="font-mono text-[10px] tracking-[0.3em] text-zinc-600">
                                                {section.numeral}
                                            </span>
                                            <h3 className="text-[13px] font-black uppercase tracking-[0.16em] text-white">
                                                {section.title}
                                            </h3>
                                            <span className="h-px flex-1 bg-white/[0.07]" aria-hidden="true" />
                                        </div>

                                        <p className="mt-2 text-sm leading-relaxed text-zinc-300">
                                            {section.lead}
                                        </p>

                                        <dl className="mt-5 flex flex-col gap-4 sm:grid sm:grid-cols-[10.5rem_1fr] sm:gap-x-6 sm:gap-y-4">
                                            {section.rules.map((rule) => (
                                                <div key={rule.term} className="flex flex-col gap-1 sm:contents">
                                                    <dt className="flex items-center gap-1.5 font-mono text-[11px] font-bold uppercase leading-relaxed tracking-[0.14em] text-zinc-100">
                                                        {rule.coin && <CoinIcon size={12} />}
                                                        {rule.term}
                                                    </dt>
                                                    <dd className="text-sm leading-relaxed text-zinc-400">
                                                        {rule.detail}
                                                    </dd>
                                                </div>
                                            ))}
                                        </dl>
                                    </li>
                                ))}
                            </ol>
                        </div>

                        <div
                            aria-hidden="true"
                            className="pointer-events-none absolute inset-x-0 bottom-0 h-10 bg-linear-to-t from-[#04060b] to-transparent"
                        />
                    </div>

                    {/* ------------------------------------------------------ footer
                        The way out, in the arc a thumb already sits in. Ghost
                        rather than lit: the only lit control in the menu is the
                        disc behind this sheet, and a second one would split the
                        one press the screen is for. */}
                    <div className="shrink-0 border-t border-white/[0.07] px-5 pt-4 pb-[calc(1rem+env(safe-area-inset-bottom))] md:px-6 short:px-4 short:pt-2 short:pb-[calc(0.5rem+env(safe-area-inset-bottom))]">
                        <button
                            type="button"
                            onClick={onClose}
                            className="flex min-h-[56px] w-full cursor-pointer touch-manipulation items-center justify-center gap-3
                                       rounded-[var(--radius-control)] border border-white/15 bg-white/[0.04] px-6
                                       font-mono text-sm font-bold uppercase tracking-[0.24em] text-zinc-200
                                       transition-[background-color,border-color,color] duration-200
                                       hover:border-white/30 hover:bg-white/[0.07]
                                       focus-visible:outline-2! focus-visible:outline-white! focus-visible:outline-offset-4!
                                       short:min-h-[44px]"
                        >
                            Close
                            <span className="hidden rounded-[3px] border border-white/10 px-1 py-px text-[9px] tracking-[0.15em] text-zinc-500 sm:inline">
                                ESC
                            </span>
                        </button>
                    </div>
                </motion.div>
            </div>
        </AnimatePresence>
    );
}
