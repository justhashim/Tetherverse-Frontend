// src/components/leaderboard/LeaderboardPanel.tsx
'use client';

import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { LeaderboardPlayer } from "@/src/types/game";
import LeaderboardEntry from "./LeaderBoardEntry";

interface LeaderboardPanelProps {
    onClose: () => void;
    currentUserId: string;
}

/**
 * Why the fetch failed, or null while it is in flight or succeeded.
 *
 * The panel previously logged the failure and fell through to the empty state,
 * which rendered "NO DATAPOINTS RECORDED IN THIS SECTOR". A network error and a
 * genuinely empty leaderboard are different facts, and the player was told the
 * second one when the first was true.
 */
type LoadError = 'network' | 'server' | null;

export default function LeaderboardPanel({ onClose, currentUserId }: LeaderboardPanelProps) {
    const [leaders, setLeaders] = useState<LeaderboardPlayer[]>([]);
    const [loading, setLoading] = useState<boolean>(true);
    const [error, setError] = useState<LoadError>(null);

    useEffect(() => {
        // Guards against setting state after the panel closes mid-flight, which
        // React 19 warns about and which would otherwise warn on every quick
        // open-th Escape.
        let cancelled = false;

        const fetchLeaderboardData = async () => {
            try {
                const res = await fetch('/api/leaderboard');

                // A non-2xx is a server failure, not an empty board. Check it
                // before parsing so a proxy error page does not throw a parse
                // error and get reported as a network fault.
                if (!res.ok) {
                    if (!cancelled) setError('server');
                    return;
                }

                const data = await res.json();

                if (!cancelled) {
                    if (data.success && Array.isArray(data.leaderboard)) {
                        setLeaders(data.leaderboard);
                    } else {
                        setError('server');
                    }
                }
            } catch (err) {
                console.error("Telemetry failure fetching leaderboard:", err);
                if (!cancelled) setError('network');
            } finally {
                if (!cancelled) setLoading(false);
            }
        };

        fetchLeaderboardData();

        return () => { cancelled = true; };
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
            <div
                className="fixed inset-0 w-full h-full bg-slate-950/80 z-50 backdrop-blur-md flex items-center justify-center p-4 select-none"
                onClick={onClose}
            >
                <motion.div
                    initial={{ opacity: 0, y: 20, scale: 0.95 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0, y: 20, scale: 0.95 }}
                    transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
                    onClick={(e) => e.stopPropagation()}
                    className="relative w-full max-w-xl h-[82vh] bg-slate-900/80 border border-violet-500/30 rounded-[var(--radius-panel)] flex flex-col shadow-[0_0_60px_rgba(139,92,246,0.15)] overflow-hidden"
                >
                    {/* Holographic Border Flare */}
                    <div className="absolute top-0 inset-x-0 h-0.5 bg-linear-to-r from-transparent via-cyan-400 to-transparent shadow-[0_0_15px_rgba(34,211,238,0.8)]" />

                    {/* Header */}
                    <div className="p-5 md:p-6 border-b border-slate-800/80 flex justify-between items-center bg-slate-950/50">
                        <div>
                            <div className="flex items-center gap-2">
                                <h2 className="text-xl md:text-2xl font-black tracking-tight text-white uppercase">
                                    Leaderboard
                                </h2>
                            </div>
                            <p className="text-xs font-mono text-slate-300 tracking-wider mt-0.5 tabular">
                                {loading
                                    ? 'Reading records'
                                    : `${leaders.length} climber${leaders.length === 1 ? '' : 's'} tracked`}
                            </p>
                        </div>
                        <button
                            onClick={onClose}
                            className="flex items-center gap-1.5 font-mono text-xs border border-zinc-800 hover:border-zinc-700 px-3 py-1.5 rounded-[var(--radius-control)] bg-zinc-900/90 hover:bg-zinc-800 text-zinc-400 hover:text-zinc-200 transition-colors duration-150 active:scale-[0.98] shadow-sm cursor-pointer select-none"
                        >
                            <span className="text-[10px] bg-zinc-800 border border-zinc-700 text-zinc-400 px-1 py-0.5 rounded font-mono">ESC</span>
                            <span>CLOSE</span>
                        </button>
                    </div>

                    {/* Entry Scroll Space */}
                    <div className="flex-1 overflow-y-auto p-4 md:p-6 space-y-2 custom-scrollbar bg-slate-950/30">
                        {loading ? (
                            // Skeletons in the shape of the rows that are coming,
                            // rather than a spinner in an empty box. The panel does
                            // not reflow when the data lands because the placeholder
                            // already occupies the same height.
                            <ul className="space-y-2" aria-hidden="true">
                                {Array.from({ length: 6 }).map((_, i) => (
                                    <li
                                        key={i}
                                        className="flex items-center gap-3.5 p-3.5 rounded-[var(--radius-panel)] border border-zinc-800/60 bg-zinc-900/30"
                                    >
                                        <div className="w-8 h-8 rounded-[var(--radius-control)] bg-zinc-800 shrink-0" />
                                        <div className="w-9 h-9 rounded-[var(--radius-control)] bg-zinc-800 shrink-0" />
                                        <div className="h-3 rounded bg-zinc-800 flex-1 max-w-[45%]" />
                                        <div className="h-3 rounded bg-zinc-800/60 w-14 ml-auto" />
                                    </li>
                                ))}
                            </ul>
                        ) : error ? (
                            // Distinct from the empty state: this one says the board
                            // could not be reached, and says so plainly rather than
                            // implying nobody has climbed yet.
                            <div className="w-full h-full flex flex-col items-center justify-center gap-2 text-center px-6">
                                <p className="font-mono text-sm text-rose-300">
                                    {error === 'network'
                                        ? 'Lost connection to telemetry'
                                        : 'Telemetry service unavailable'}
                                </p>
                                <p className="font-mono text-xs text-slate-400">
                                    {error === 'network'
                                        ? 'Check your network and reopen this panel.'
                                        : 'The leaderboard could not be read. Try again shortly.'}
                                </p>
                            </div>
                        ) : leaders.length === 0 ? (
                            <div className="w-full h-full flex flex-col items-center justify-center gap-2 text-center px-6">
                                <p className="text-slate-300 font-mono text-sm">
                                    No ascent records yet
                                </p>
                                <p className="text-slate-400 font-mono text-xs">
                                    The first climb sets the mark everyone chases.
                                </p>
                            </div>
                        ) : (
                            leaders.map((player, index) => (
                                <LeaderboardEntry
                                    key={player._id}
                                    player={player}
                                    rank={index + 1}
                                    isCurrentUser={player._id === currentUserId}
                                />
                            ))
                        )}
                    </div>
                </motion.div>
            </div>
        </AnimatePresence>
    );
}