'use client';

import { useEffect } from "react";
import Image from "next/image";
import { motion } from "framer-motion";
import ProfileCard from "./ProfileCard";
import MultiverseBackground from "./MultiverseBackground";
import AnimatedButton from "../shared/AnimatedButton";

interface MainMenuProps {
    onPlay: () => void;
    onOpenLeaderboard: () => void;
    onLogout: () => void;
    user: { name: string; image?: string | null };
    bestAltitude?: number;
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

/**
 * The control scheme, declared once.
 *
 * Kept as data rather than markup because the menu and the in-game HUD both
 * describe it, and two hand-written lists drift apart within a week. `touchOnly`
 * marks the entries that mean nothing on a keyboard, so they can be hidden where
 * there is no pointer.
 */
const CONTROLS = [
    { keys: 'HOLD SPACE', action: 'GRAPPLE', touchOnly: false },
    { keys: 'RELEASE', action: 'LAUNCH', touchOnly: false },
    { keys: 'A / D', action: 'STEER', touchOnly: false },
] as const;

export default function MainMenu({
    onPlay,
    onOpenLeaderboard,
    onLogout,
    user,
    bestAltitude = 0
}: MainMenuProps) {

    // Keyboard navigation: Enter launches game
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                onPlay();
            }
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [onPlay]);

    const getStratum = (alt: number) => {
        if (alt >= 1500) return "EXOSPHERE";
        if (alt >= 700) return "MESOSPHERE";
        if (alt >= 350) return "STRATOSPHERE";
        if (alt >= 120) return "TROPOSPHERE";
        return "SURFACE";
    };

    return (
        <div className="relative w-screen min-h-[100dvh] h-[100dvh] overflow-hidden flex flex-col justify-between p-4 sm:p-6 md:p-8 z-10 select-none bg-[#02040a]">
            {/* Layered Cosmic Multiverse Background */}
            <MultiverseBackground />

            {/* TOP BAR: Profile & Sector Status */}
            <header className="w-full flex justify-between items-center z-20 gap-3 pt-1">
                <ProfileCard user={user} bestAltitude={bestAltitude} onLogout={onLogout} />

                <div className="flex items-center gap-2 font-mono text-[10px] md:text-xs bg-slate-950/70 border border-cyan-500/30 px-3 md:px-4 py-2 rounded-[var(--radius-control)] backdrop-blur-md shadow-[0_0_15px_rgba(6,182,212,0.15)]">
                    <span className="w-2 h-2 rounded-full bg-cyan-400 animate-ping shrink-0" />
                    <span className="text-slate-300 font-bold hidden sm:inline">SECTOR //</span>
                    <span className="text-cyan-300 font-black">07-GRAVITY</span>
                </div>
            </header>

            {/* HERO CENTERPIECE: Multiverse Emblem, Title, & Mobile Expedition Pill */}
            <main className="w-full flex flex-col items-center justify-center my-auto z-20 text-center px-2 py-2">
                {/* Official High-Resolution Multiverse Grappling Vortex Emblem */}
                <motion.div
                    initial={{ scale: 0.8, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
                    className="relative mb-3 md:mb-5"
                >
                    {/* Energy halo. One slow pulse, no hover response: this is a
                        mark, not a control. */}
                    <div className="absolute inset-[-15%] rounded-full bg-linear-to-tr from-cyan-500 via-violet-600 to-fuchsia-500 blur-2xl md:blur-3xl opacity-35 animate-pulse" />

                    {/* A single counter-rotating ring pair, at very different rates so
                        the motion never visibly repeats. Two rings was three pieces of
                        motion on one element, competing with the float below and the
                        halo above. */}
                    <div className="absolute inset-[-12px] md:inset-[-16px] border border-cyan-400/30 rounded-full animate-[spin_45s_linear_infinite]" />

                    {/* Emblem Wrapper */}
                    <motion.div
                        className="relative w-36 h-36 sm:w-44 sm:h-44 md:w-52 md:h-52 rounded-full overflow-hidden p-1.5 bg-slate-950/80 border border-cyan-400/50 shadow-[0_0_40px_rgba(6,182,212,0.3)] backdrop-blur-md"
                        animate={{
                            y: [0, -6, 0],
                        }}
                        transition={{
                            duration: 4,
                            repeat: Infinity,
                            ease: "easeInOut",
                        }}
                    >
                        <Image
                            src="/logo.png"
                            alt="Tetherverse Logo"
                            width={220}
                            height={220}
                            priority
                            className="w-full h-full object-contain rounded-full"
                        />
                    </motion.div>
                </motion.div>

                {/* Game Title */}
                <motion.h1
                    initial={{ y: 15, opacity: 0 }}
                    animate={{ y: 0, opacity: 1 }}
                    transition={{ delay: 0.15, duration: 0.6 }}
                    className="text-4xl sm:text-6xl md:text-7xl lg:text-8xl font-black text-white tracking-normal uppercase font-sans mb-1 select-none"
                >
                    Tether<span className="text-transparent bg-clip-text bg-linear-to-r from-cyan-400 via-violet-400 to-fuchsia-400">verse</span>
                </motion.h1>

                {/* Subtitle */}
                <motion.p
                    initial={{ y: 12, opacity: 0 }}
                    animate={{ y: 0, opacity: 1 }}
                    transition={{ delay: 0.25, duration: 0.6 }}
                    className="font-mono text-[10px] sm:text-xs md:text-sm text-cyan-300/80 tracking-[0.25em] md:tracking-[0.35em] uppercase mb-4 md:mb-6 select-none"
                >
                    {"// QUANTUM ASCENT LOOP / MULTIVERSE EXPEDITION"}
                </motion.p>

                {/* Mobile Expedition Credentials Badge */}
                <motion.div
                    initial={{ opacity: 0, scale: 0.95 }}
                    animate={{ opacity: 1, scale: 1 }}
                    transition={{ delay: 0.35, duration: 0.6 }}
                    className="flex items-center gap-3 sm:gap-6 bg-slate-950/70 border border-violet-500/30 backdrop-blur-xl px-4 py-2 rounded-[var(--radius-panel)] shadow-[0_0_25px_rgba(139,92,246,0.15)] mb-6 md:mb-8 text-left"
                >
                    <div className="flex flex-col">
                        <span className="font-mono text-[9px] text-slate-400 uppercase tracking-widest">
                            SECTOR RECORD
                        </span>
                        <span className="font-mono font-black text-base sm:text-lg text-cyan-300">
                            {bestAltitude.toLocaleString()}
                            <span className="text-cyan-400 text-xs font-normal ml-0.5">m</span>
                        </span>
                    </div>

                    <div className="w-px h-8 bg-slate-800" />

                    <div className="flex flex-col">
                        <span className="font-mono text-[9px] text-slate-400 uppercase tracking-widest">
                            STRATUM
                        </span>
                        <span className="font-mono font-bold text-xs sm:text-sm text-violet-300">
                            {getStratum(bestAltitude)}
                        </span>
                    </div>
                </motion.div>

                {/* MOBILE THUMB ACTION ZONE: Primary Launch & Telemetry Buttons */}
                <motion.div
                    initial={{ y: 20, opacity: 0 }}
                    animate={{ y: 0, opacity: 1 }}
                    transition={{ delay: 0.45, duration: 0.6 }}
                    className="flex flex-col sm:flex-row items-center gap-3 sm:gap-4 w-full max-w-xs sm:max-w-md"
                >
                    <AnimatedButton onClick={onPlay} variant="primary" className="w-full">
                        <span>INITIALIZE ASCENT</span>
                        <span className="text-[10px] bg-zinc-200/80 border border-zinc-300 text-zinc-800 px-1.5 py-0.5 rounded font-mono font-semibold hidden sm:inline">
                            ENTER
                        </span>
                    </AnimatedButton>
                    <AnimatedButton onClick={onOpenLeaderboard} variant="secondary" className="w-full">
                        <LeaderboardIcon />
                        <span>LEADERBOARD</span>
                    </AnimatedButton>
                </motion.div>

                {/* Control guide. Separated by hairlines rather than middle dots:
                    three dots in one line is a separator family used for nothing
                    else, and a rule reads as structure at a glance. */}
                <motion.dl
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    transition={{ delay: 0.55, duration: 0.6 }}
                    className="mt-5 md:mt-7 flex flex-wrap items-center justify-center gap-x-4 gap-y-2 font-mono text-[10px] md:text-[11px] bg-slate-950/60 border border-slate-800/80 backdrop-blur-md px-5 py-2.5 rounded-[var(--radius-chip)]"
                >
                    {CONTROLS.map(({ keys, action, touchOnly }) => (
                        <div key={action} className="flex items-center gap-2">
                            <dt className="text-slate-200 font-bold">{keys}</dt>
                            <dd className="text-slate-400">{action}</dd>
                            {touchOnly && (
                                <span className="text-slate-500 md:hidden">touch</span>
                            )}
                        </div>
                    ))}
                </motion.dl>
            </main>

            {/* Footer. No version string, no status dot. The dot next to the
                former "STATION // LINKED" asserted a connection state the client
                never observes, so it was decoration that lied, and the version was
                a CLI fixture on what is effectively a menu page. */}
            <footer className="w-full flex justify-end items-center z-20 font-mono text-[9px] md:text-[11px] text-slate-400 tracking-wider pb-1">
                <span>Tetherverse // Multiverse Division</span>
            </footer>
        </div>
    );
}