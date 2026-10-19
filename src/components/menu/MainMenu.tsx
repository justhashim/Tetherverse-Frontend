'use client';

import { useEffect, useRef } from "react";
import Image from "next/image";
import ProfileCard from "./ProfileCard";
import { stratumForAltitude } from "@/src/game/config/strata";

interface MainMenuProps {
    onPlay: () => void;
    onOpenLeaderboard: () => void;
    onLogout: () => void;
    user: { name: string; image?: string | null };
    bestAltitude?: number;
    /**
     * True when the menu is the screen the player is looking at.
     *
     * The menu stays mounted behind the leaderboard panel and behind the intro
     * video, and the call to action must not take the keyboard focus while
     * either of those is on top of it.
     */
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
        <svg
            width="14"
            height="14"
            viewBox="0 0 14 14"
            fill="currentColor"
            aria-hidden="true"
            focusable="false"
            className="shrink-0"
        >
            {/* Ascending bars, left to right, so the glyph reads as a ranking
                rather than as a generic chart. */}
            <rect x="0" y="8" width="3" height="6" rx="0.5" />
            <rect x="5.5" y="4" width="3" height="10" rx="0.5" />
            <rect x="11" y="0" width="3" height="14" rx="0.5" />
        </svg>
    );
}

export default function MainMenu({
    onPlay,
    onOpenLeaderboard,
    onLogout,
    user,
    bestAltitude = 0,
    active = false,
}: MainMenuProps) {
    const playRef = useRef<HTMLButtonElement>(null);

    /**
     * Enter starts the climb.
     *
     * A focused control keeps its own Enter key: if the player has tabbed to
     * the leaderboard and presses Enter, they meant the leaderboard. Anywhere
     * else, Enter means climb, because climbing is what the player came for.
     */
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key !== 'Enter') return;

            const target = e.target as HTMLElement | null;
            if (
                target &&
                (target.tagName === 'BUTTON' ||
                    target.tagName === 'A' ||
                    target.isContentEditable)
            ) {
                return;
            }

            e.preventDefault();
            onPlay();
        };

        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [onPlay]);

    /**
     * The call to action takes the focus when the menu becomes the screen in
     * front of the player, so the climb is one keypress away without the
     * player having to find the button first.
     */
    useEffect(() => {
        if (!active) return;

        const frame = requestAnimationFrame(() => playRef.current?.focus());
        return () => cancelAnimationFrame(frame);
    }, [active]);

    const getStratum = (alt: number) => stratumForAltitude(alt);

    return (
        <div className="relative w-screen min-h-[100dvh] h-[100dvh] overflow-hidden flex flex-col z-20 select-none">
            {/*
              A scrim that darkens only the region the text occupies: across the
              bottom on every screen size, and down the left column where there
              is room for one. The rest of the world is left alone, which is the
              whole point of the arrangement.
            */}
            <div className="pointer-events-none absolute inset-x-0 bottom-0 h-[58%] bg-linear-to-t from-slate-950 via-slate-950/70 to-transparent" />
            <div className="pointer-events-none absolute inset-y-0 left-0 w-[62%] hidden md:block bg-linear-to-r from-slate-950/85 via-slate-950/35 to-transparent" />

            {/* Top bar: who is playing, and nothing else. */}
            <header className="relative w-full flex items-start justify-between gap-3 p-4 sm:p-6 md:p-8">
                <ProfileCard user={user} onLogout={onLogout} />
            </header>

            {/*
              The interface sits in the lower left of the world, not in the
              middle of the screen. Centred, a stack of panels reads as a
              control panel floating in front of a picture; anchored to a corner
              over a local scrim, it reads as something standing inside the
              place.
            */}
            <div className="relative flex-1 flex items-end">
                <div className="w-full p-4 sm:p-6 md:p-8">
                    <div className="w-full max-w-sm md:max-w-md flex flex-col items-center md:items-start gap-3 md:gap-4">
                        {/* The mark and the name. Small, still, no halo, no ring. */}
                        <div className="flex items-center gap-3">
                            <Image
                                src="/logo.png"
                                alt=""
                                width={40}
                                height={40}
                                className="w-10 h-10 rounded-full shrink-0"
                                preload
                            />
                            <h1 className="text-3xl md:text-4xl lg:text-5xl font-black text-white tracking-tight">
                                Tetherverse
                            </h1>
                        </div>

                        {/*
                          The one fact about the player worth saying out loud.
                          It used to be shown twice, once as a chip on the
                          profile card and once in a bordered panel, both of them
                          showing the same number.
                        */}
                        <p className="font-mono text-sm text-zinc-400 tracking-wide">
                            {bestAltitude > 0 ? (
                                <>
                                    Best{" "}
                                    <span className="text-zinc-100 font-semibold tabular">
                                        {bestAltitude.toLocaleString()}m
                                    </span>{" "}
                                    · {getStratum(bestAltitude)}
                                </>
                            ) : (
                                "No record yet"
                            )}
                        </p>

                        {/*
                          The climb.

                          A disc, not a labelled slab. There is exactly one thing a
                          player can do on this screen, and a wide rectangle with
                          words in it says "form" where a play symbol says "go" — and
                          the play symbol is the one glyph every player already
                          knows without being told.

                          It is also the only cyan on the screen, and it is big:
                          144px against a 48px wordmark, so the eye lands on the
                          way to start rather than on the name of the game.

                          The triangle is nudged right. A right-pointing triangle has
                          all of its mass on the left, so one that is geometrically
                          centred reads as sitting slightly left of the middle of
                          the disc, and the disc looks off-centre.
                        */}
                        <button
                            ref={playRef}
                            onClick={onPlay}
                            type="button"
                            aria-label="Begin ascent"
                            className="group relative mt-2 grid place-items-center w-32 h-32 md:w-36 md:h-36
                                       rounded-full bg-cyan-400 text-slate-950
                                       shadow-[0_0_80px_-16px_rgba(34,211,238,0.6)]
                                       transition-[background-color,box-shadow,transform] duration-200 ease-out
                                       hover:bg-cyan-300 hover:shadow-[0_0_100px_-14px_rgba(34,211,238,0.8)]
                                       active:scale-[0.97]
                                       focus-visible:rounded-full!
                                       cursor-pointer select-none"
                        >
                            <svg
                                viewBox="0 0 24 24"
                                className="w-10 h-10 md:w-12 md:h-12 translate-x-[7%]"
                                fill="currentColor"
                                aria-hidden="true"
                                focusable="false"
                            >
                                <path d="M8 5.14v13.72c0 .81.88 1.3 1.55.84l10.78-6.86a1 1 0 0 0 0-1.68L9.55 4.3A1 1 0 0 0 8 5.14z" />
                            </svg>
                        </button>

                        {/* Everything else is secondary, and looks it. */}
                        <button
                            onClick={onOpenLeaderboard}
                            className="mt-3 md:mt-4 font-mono text-[11px] uppercase tracking-widest text-zinc-500 hover:text-zinc-200 transition-colors duration-150 cursor-pointer select-none"
                        >
                            <span className="inline-flex items-center gap-2">
                                <LeaderboardIcon />
                                Leaderboard
                            </span>
                        </button>

                        {/*
                          One line of instruction, not a panel. The HUD repeats
                          it during a run and the world teaches it in its own
                          words at the starting platform, so a bordered table
                          here was saying a third time what two other places
                          already said.
                        */}
                        <p className="font-mono text-[11px] text-zinc-600 tracking-wide">
                            Hold to grapple · release to launch
                        </p>
                    </div>
                </div>
            </div>
        </div>
    );
}
