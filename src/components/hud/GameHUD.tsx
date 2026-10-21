'use client';

import { useState, useEffect } from 'react';

interface GameHUDProps {
    onAbort: () => void;
}

interface AltitudeDetail {
    altitude: number;
    maxAltitude: number;
    zone: string;
}

/**
 * The band the player is in, and the one colour that goes with it.
 *
 * The zone used to be a bordered pill in the band's own colour with a glow
 * around it, which made a piece of context louder than the altitude it was
 * supposed to be labelling. It is a fact about where the player is, so it is a
 * dot and a word now. Six pixels of colour instead of a lit chip.
 */
function getZoneDot(zone: string): string {
    switch (zone) {
        case 'TROPOSPHERE':
            // Not cyan. Cyan is the player, and a 7px dot labelling a band of
            // air is not the player - it only became the loudest cyan in the
            // HUD once the altimeter stopped wearing that colour.
            return 'bg-lime-400';
        case 'STRATOSPHERE':
            return 'bg-violet-400';
        case 'MESOSPHERE':
            return 'bg-fuchsia-400';
        case 'EXOSPHERE':
            return 'bg-amber-400';
        case 'SURFACE':
        default:
            return 'bg-emerald-400';
    }
}

export default function GameHUD({ onAbort }: GameHUDProps) {
    const [altitude, setAltitude] = useState<number>(0);
    const [maxAltitude, setMaxAltitude] = useState<number>(() => {
        if (typeof window !== 'undefined') {
            const saved = localStorage.getItem('maxAltitude');
            return saved ? parseInt(saved, 10) || 0 : 0;
        }
        return 0;
    });
    const [zone, setZone] = useState<string>('SURFACE');

    useEffect(() => {
        const handleAltitudeUpdate = (e: Event) => {
            const detail = (e as CustomEvent<AltitudeDetail>).detail;
            if (detail) {
                setAltitude(detail.altitude);
                setMaxAltitude(detail.maxAltitude);
                if (detail.zone) setZone(detail.zone);
            }
        };

        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape') {
                e.preventDefault();
                onAbort();
            }
        };

        window.addEventListener('tetherverse:altitude-update', handleAltitudeUpdate);
        window.addEventListener('keydown', handleKeyDown);

        return () => {
            window.removeEventListener('tetherverse:altitude-update', handleAltitudeUpdate);
            window.removeEventListener('keydown', handleKeyDown);
        };
    }, [onAbort]);

    const isNewRecord = altitude > maxAltitude && altitude > 0;

    return (
        <div className="absolute inset-0 pointer-events-none z-40 flex flex-col justify-between p-4 md:p-6 select-none overflow-hidden">
            <header className="w-full flex items-start justify-between gap-6">
                {/*
                  Abort. A quiet control, because the player is climbing and the
                  way out is a safety net, not the subject of the screen. It used
                  to be a dark button with a border, a shadow and a keycap, and
                  it was the only thing in the top-left corner of a sky. Now it
                  is a line of type that turns rose when the pointer finds it.
                */}
                <button
                    onClick={onAbort}
                    className="pointer-events-auto group flex items-center gap-2 font-mono text-xs uppercase tracking-[0.2em] text-zinc-500 hover:text-rose-300 transition-[color] duration-150 cursor-pointer select-none"
                    aria-label="Abort Current Ascent"
                >
                    <span className="text-sm leading-none text-zinc-600 group-hover:text-rose-400 group-hover:-translate-x-0.5 transition-all duration-150">←</span>
                    <span className="text-readout">Abort</span>
                    <span className="text-[10px] tracking-[0.15em] text-zinc-600 border border-white/10 rounded-[3px] px-1 py-px group-hover:border-rose-500/30 group-hover:text-rose-400/80">
                        ESC
                    </span>
                </button>

                {/*
                  The altimeter. This is the number the whole game is about and
                  it used to live inside a generic card with a border, a
                  backdrop and a glow, which made it look like one more widget
                  in a row of widgets. An instrument is not a box: it is a large
                  precise value, a label that stays out of its way, and enough
                  shadow to hold its own against the nebula.

                  No pointer events on this block. It sat over the canvas with
                  pointer-events-auto, so a click on the altitude readout never
                  reached the game and never threw a tether.
                */}
                <div className="flex flex-col items-end gap-1.5">
                    {/* The band. A dot and a word. */}
                    <div className="flex items-center gap-2">
                        <span className={`h-[7px] w-[7px] rounded-full shrink-0 ${getZoneDot(zone)}`} />
                        <span className="font-mono text-[11px] font-bold uppercase tracking-[0.3em] text-zinc-400 text-readout">
                            {zone}
                        </span>
                    </div>

                    {/* The value. Big, tabular, and the brightest thing on the
                        screen. White, not cyan.

                        It used to wear the signal colour on the theory that the
                        altitude is the player's own live presence. But the law
                        is not that the player's data may share the player's
                        colour - it is that cyan is the player and nothing else,
                        because the moment another element takes it the player
                        stops being findable on a busy sky. The player is a
                        small sprite and this number is sixty pixels tall
                        directly above it. Two cyan objects, one of them
                        enormous, is the exact outcome the law exists to stop,
                        reached through a loophole in its wording.

                        White is also what the game already does everywhere else
                        with a measured value: the leaderboard column, the
                        menu's own score readout, the sector best on the
                        game-over panel. The label beside it is dimmer than the
                        number by an order of magnitude.

                        Sixty pixels, not seventy-two. On a 1440-wide desktop the
                        readout used to be the size of a headline, and it was
                        fighting the world behind it for attention it does not
                        need: it is a number in the corner of a room, read at a
                        glance, not a title. */}
                    <div className="flex items-baseline gap-2">
                        <span className="font-mono text-[11px] font-bold uppercase tracking-[0.3em] text-zinc-500 text-readout">
                            Alt
                        </span>
                        <span className="font-mono font-black text-5xl md:text-6xl leading-none tracking-tight text-white tabular text-readout">
                            {altitude.toLocaleString().padStart(4, '0')}
                        </span>
                        <span className="font-mono text-sm font-bold text-zinc-500 text-readout">
                            m
                        </span>
                    </div>

                    {/* The best. A reference value, so it is white: violet is
                        the multiverse, and a personal record is not the
                        multiverse. */}
                    <div className="font-mono text-[11px] uppercase tracking-[0.25em] text-zinc-500 text-readout">
                        {isNewRecord ? (
                            <span className="inline-flex items-center gap-1.5 font-bold text-amber-300">
                                {/* A rising bar rather than a lightning glyph: same
                                    idea, drawn in the game's own accent, and it
                                    inherits colour instead of shipping an emoji
                                    font's artwork. Amber, not cyan: a personal
                                    best is a reward, and the game's reward
                                    colour is the coin. */}
                                <svg
                                    width="10"
                                    height="10"
                                    viewBox="0 0 10 10"
                                    fill="currentColor"
                                    aria-hidden="true"
                                    focusable="false"
                                    className="shrink-0"
                                >
                                    <rect x="0" y="7" width="2.5" height="3" rx="0.4" />
                                    <rect x="3.75" y="4.5" width="2.5" height="5.5" rx="0.4" />
                                    <rect x="7.5" y="0" width="2.5" height="10" rx="0.4" />
                                </svg>
                                <span>New record</span>
                            </span>
                        ) : (
                            <span>
                                Best <span className="text-zinc-200 tabular">{maxAltitude.toLocaleString()}m</span>
                            </span>
                        )}
                    </div>
                </div>
            </header>

            {/*
              The controls, as a caption rather than a bar. The game teaches
              these at the starting platform and the player only has to look at
              them once, so they do not need a surface of their own: one line of
              type at the bottom of the sky, with the keys picked out in
              weight.
            */}
            <footer className="w-full flex justify-center pb-2">
                <p className="font-mono text-[11px] md:text-xs uppercase tracking-[0.25em] text-zinc-500 text-readout">
                    <span className="text-zinc-300 font-bold">Hold</span>
                    <span className="hidden sm:inline"> click / space</span>
                    <span className="sm:hidden"> tap</span>
                    <span className="text-zinc-700 mx-2">·</span>
                    <span className="text-zinc-300 font-bold">Release</span> launch
                    <span className="hidden sm:inline">
                        <span className="text-zinc-700 mx-2">·</span>
                        <span className="text-zinc-300 font-bold">A / D</span> steer
                    </span>
                </p>
            </footer>
        </div>
    );
}
