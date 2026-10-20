// src/components/leaderboard/LeaderboardPanel.tsx
'use client';

import { useEffect, useRef, useState } from "react";
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

/**
 * The display name of the signed-in player, resolved once per page session.
 *
 * The board identifies a climber by name: the API's `_id` for a row is the
 * display name, not the account id the app is signed in with, so matching on
 * the id alone never finds a row and the player's own row — the one row on
 * the board that has to be unmistakable — never lights up.
 *
 * The name comes from the same verified identity endpoint the app already
 * trusts, and the request is shared and memoised, so opening the board twice
 * costs one verification rather than two. If it fails, the board still works;
 * it just does not know which row is the player's.
 */
let playerNamePromise: Promise<string | null> | null = null;

function resolvePlayerName(): Promise<string | null> {
    if (typeof window === 'undefined') return Promise.resolve(null);

    if (!playerNamePromise) {
        playerNamePromise = (async () => {
            try {
                const token =
                    window.__tetherverseAuthToken ??
                    sessionStorage.getItem('tetherverse:excel-access-token') ??
                    sessionStorage.getItem('tetherverse:bridge-token');
                if (!token) return null;

                const response = await fetch('/api/bridge/verify', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ token }),
                });
                if (!response.ok) return null;

                const data = (await response.json()) as { user?: { name?: string } };
                return data?.user?.name ?? null;
            } catch {
                return null;
            }
        })();
    }

    return playerNamePromise;
}

export default function LeaderboardPanel({ onClose, currentUserId }: LeaderboardPanelProps) {
    const [leaders, setLeaders] = useState<LeaderboardPlayer[]>([]);
    const [loading, setLoading] = useState<boolean>(true);
    const [error, setError] = useState<LoadError>(null);
    const [playerName, setPlayerName] = useState<string | null>(null);
    const closeRef = useRef<HTMLButtonElement>(null);

    /**
     * A modal that takes the keyboard has to give it back.
     *
     * The menu's call to action is focused underneath this panel, and without
     * this the player who opens the leaderboard is still holding a focused
     * button they cannot see. Focus lands on the close control instead, which
     * is where Escape would take them anyway.
     */
    useEffect(() => {
        const frame = requestAnimationFrame(() => closeRef.current?.focus());
        return () => cancelAnimationFrame(frame);
    }, []);

    useEffect(() => {
        // Guards against setting state after the panel closes mid-flight, which
        // React 19 warns about and which would otherwise warn on every quick
        // open-th-Escape.
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

        // The name of the signed-in player, for marking the player's own row.
        // It is not worth holding the board hostage for: if the name arrives
        // late, the row is marked late.
        void resolvePlayerName().then((name) => {
            if (!cancelled && name) setPlayerName(name);
        });

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

    // The board arrives sorted, so the first row is the best climb on it. The
    // rows need that number to draw their bars to scale.
    const topAltitude = leaders[0]?.maxAltitude ?? 0;

    /**
     * Whether a row is the signed-in player's.
     *
     * The id is tried first, because that is the honest identity. The name is
     * the fallback, because the board's own ids are names, and a board that
     * cannot point at the player is a board that cannot say "you are third".
     */
    const isCurrentUser = (player: LeaderboardPlayer): boolean =>
        player._id === currentUserId ||
        (playerName !== null &&
            player.name.trim().toLowerCase() === playerName.trim().toLowerCase());

    return (
        <AnimatePresence>
            {/*
              No backdrop-blur on the scrim: a backdrop-filter over the live
              menu canvas measured 10 fps -> 18 fps when removed in WebKit
              (390x844@dpr3, frame p50 86ms -> 53ms; Chromium holds 60fps
              either way). The scrim is already 70% opaque slate, so the blur
              bought little and cost frames.
            */}
            <div
                className="fixed inset-0 w-full h-full bg-slate-950/70 z-50 flex items-center justify-center p-4 select-none"
                onClick={onClose}
            >
                <motion.div
                    initial={{ opacity: 0, y: 20, scale: 0.95 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0, y: 20, scale: 0.95 }}
                    transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
                    onClick={(e) => e.stopPropagation()}
                    role="dialog"
                    aria-modal="true"
                    aria-label="Leaderboard"
                    className="relative w-full max-w-xl max-h-[82vh] bg-slate-950/80 border border-white/[0.08] rounded-[var(--radius-panel)] flex flex-col shadow-2xl overflow-hidden"
                >
                    {/*
                      Header. The panel is a panel, because a modal is a
                      surface: it has to be one object the player can see the
                      edges of. Everything inside it is not.
                    */}
                    <div className="px-5 md:px-6 pt-5 md:pt-6 pb-4 border-b border-white/[0.07] flex justify-between items-start gap-4">
                        <div>
                            <h2 className="text-xl md:text-2xl font-black tracking-tight text-white uppercase">
                                Leaderboard
                            </h2>
                            <p className="text-xs font-mono text-zinc-500 tracking-wider mt-1 tabular">
                                {loading
                                    ? 'Reading records'
                                    : `${leaders.length} climber${leaders.length === 1 ? '' : 's'} tracked`}
                            </p>
                        </div>
                        {/*
                          The way out. A ghost control with the key beside it:
                          the panel already says what Escape does by showing the
                          key, so it does not need a button-shaped box to say it
                          twice.
                        */}
                        <button
                            ref={closeRef}
                            onClick={onClose}
                            className="flex items-center gap-1.5 font-mono text-[11px] uppercase tracking-[0.2em] text-zinc-500 hover:text-zinc-100 transition-[color] duration-150 cursor-pointer select-none"
                        >
                            <span className="text-[9px] text-zinc-600 border border-white/10 rounded-[3px] px-1 py-px">ESC</span>
                            <span>Close</span>
                        </button>
                    </div>

                    {/* Entry Scroll Space */}
                    <div className="flex-1 min-h-0 overflow-y-auto px-5 md:px-6 py-1 custom-scrollbar">
                        {loading ? (
                            // Skeletons in the shape of the rows that are coming,
                            // rather than a spinner in an empty box. The panel
                            // does not reflow when the data lands because the
                            // placeholder already occupies the same height.
                            <ul className="divide-y divide-white/[0.06]" aria-hidden="true">
                                {Array.from({ length: 5 }).map((_, i) => (
                                    <li key={i} className="flex items-center gap-3.5 pl-3 py-3">
                                        <div className="w-5 h-3 rounded bg-white/[0.06] shrink-0" />
                                        <div className="w-9 h-9 rounded-[var(--radius-control)] bg-zinc-800/70 shrink-0" />
                                        <div className="h-3 rounded bg-white/[0.08] flex-1 max-w-[40%]" />
                                        <div className="ml-auto flex flex-col items-end gap-1.5 w-28 sm:w-32 shrink-0">
                                            <div className="h-4 rounded bg-white/[0.08] w-16" />
                                            <div className="h-[3px] w-full rounded-full bg-white/[0.05]" />
                                        </div>
                                    </li>
                                ))}
                            </ul>
                        ) : error ? (
                            // Distinct from the empty state: this one says the board
                            // could not be reached, and says so plainly rather than
                            // implying nobody has climbed yet.
                            <div className="w-full h-full flex flex-col items-center justify-center gap-2 text-center px-6 py-10">
                                <p className="font-mono text-sm text-rose-300">
                                    {error === 'network'
                                        ? 'Lost connection to telemetry'
                                        : 'Telemetry service unavailable'}
                                </p>
                                <p className="font-mono text-xs text-zinc-500">
                                    {error === 'network'
                                        ? 'Check your network and reopen this panel.'
                                        : 'The leaderboard could not be read. Try again shortly.'}
                                </p>
                            </div>
                        ) : leaders.length === 0 ? (
                            <div className="w-full h-full flex flex-col items-center justify-center gap-2 text-center px-6 py-10">
                                <p className="text-zinc-300 font-mono text-sm">
                                    No ascent records yet
                                </p>
                                <p className="text-zinc-500 font-mono text-xs">
                                    The first climb sets the mark everyone chases.
                                </p>
                            </div>
                        ) : (
                            /*
                              The rows themselves. They are lines of type with a
                              hairline between them, not a stack of cards: the
                              board is a table, and a table is not made of boxes.
                            */
                            <ul className="divide-y divide-white/[0.06]">
                                {leaders.map((player, index) => (
                                    <LeaderboardEntry
                                        key={player._id}
                                        player={player}
                                        rank={index + 1}
                                        isCurrentUser={isCurrentUser(player)}
                                        topAltitude={topAltitude}
                                    />
                                ))}
                            </ul>
                        )}
                    </div>
                </motion.div>
            </div>
        </AnimatePresence>
    );
}
