'use client';

import { memo, useState } from "react";
import Image from "next/image";
import { motion } from "framer-motion";
import { LeaderboardPlayer } from "@/src/types/game";

interface LeaderboardEntryProps {
    player: LeaderboardPlayer;
    rank: number;
    isCurrentUser: boolean;
}

function LeaderboardEntry({ player, rank, isCurrentUser }: LeaderboardEntryProps) {
    const [imageError, setImageError] = useState(false);

    /**
     * Rank treatment.
     *
     * Numerals, not medal glyphs. A trophy or medal renders as a full-colour
     * image on Windows and Android, which is the only saturated thing on a screen
     * built out of one accent and a neutral ramp, and it reads as clip art rather
     * than instrumentation. `tabular` keeps the digit from shifting as ranks
     * change, and gold and silver carry the podium without needing a picture.
     */
    const getRankStyles = (r: number) => {
        switch (r) {
            case 1:
                return {
                    badge: "bg-amber-400 text-zinc-950 font-bold border border-amber-300 shadow-sm",
                    row: "bg-amber-950/20 border-amber-500/30 hover:border-amber-500/50",
                };
            case 2:
                return {
                    badge: "bg-zinc-200 text-zinc-950 font-bold border border-zinc-100 shadow-sm",
                    row: "bg-zinc-900/50 border-zinc-700/40 hover:border-zinc-700/60",
                };
            case 3:
                return {
                    badge: "bg-amber-700 text-amber-100 font-bold border border-amber-600 shadow-sm",
                    row: "bg-amber-950/10 border-amber-700/30 hover:border-amber-700/50",
                };
            default:
                return {
                    badge: "bg-zinc-900 text-zinc-400 border border-zinc-800",
                    row: "bg-zinc-900/30 border-zinc-800/60 hover:border-zinc-700/80",
                };
        }
    };

    const rankStyle = getRankStyles(rank);

    return (
        <motion.div
            initial={{ opacity: 0, x: -10 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.25 }}
            className={`flex items-center justify-between p-3.5 rounded-[var(--radius-panel)] border transition-colors duration-150 ${isCurrentUser
                ? "bg-zinc-900/90 border-zinc-400/50 shadow-sm"
                : rankStyle.row
                }`}
        >
            <div className="flex items-center gap-3.5 min-w-0">
                {/* Ranking Token Badge */}
                <div className={`w-8 h-8 rounded-[var(--radius-control)] border font-mono text-xs tabular flex items-center justify-center shrink-0 ${rankStyle.badge}`}>
                    {rank}
                </div>

                {/* Profile Vector Frame */}
                <div className="relative w-9 h-9 rounded-[var(--radius-control)] overflow-hidden border border-zinc-800 bg-zinc-900 shrink-0 flex items-center justify-center">
                    {player.image && !imageError ? (
                        <Image
                            src={player.image}
                            alt={player.name}
                            width={36}
                            height={36}
                            className="w-full h-full object-cover"
                            onError={() => setImageError(true)}
                            unoptimized
                        />
                    ) : (
                        <div className="w-full h-full bg-zinc-800 flex items-center justify-center font-bold text-xs text-zinc-400 uppercase">
                            {player.name ? player.name.charAt(0) : '?'}
                        </div>
                    )}
                </div>

                <div className="flex items-center gap-2 truncate">
                    <span className={`text-sm font-semibold truncate ${isCurrentUser ? "text-white" : "text-zinc-200"}`}>
                        {player.name}
                    </span>
                    {isCurrentUser && (
                        <span className="font-mono text-[9px] bg-zinc-800 text-zinc-200 border border-zinc-700 px-1.5 py-0.5 rounded uppercase tracking-wider shrink-0 font-medium">
                            YOU
                        </span>
                    )}
                </div>
            </div>

            {/* Score Metric */}
            <div className="text-right pl-3 shrink-0">
                <span className="font-mono text-base font-bold text-white tabular">
                    {player.maxAltitude.toLocaleString()}
                    <span className="text-zinc-400 text-xs font-normal ml-0.5">m</span>
                </span>
            </div>
        </motion.div>
    );
}

export default memo(LeaderboardEntry);