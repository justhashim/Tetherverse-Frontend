'use client';

import { memo, useState } from "react";
import Image from "next/image";
import { motion } from "framer-motion";
import { LeaderboardPlayer } from "@/src/types/game";

interface LeaderboardEntryProps {
    player: LeaderboardPlayer;
    rank: number;
    isCurrentUser: boolean;
    /**
     * The best altitude on the board, so that the bar in the altitude column
     * can be drawn to scale. It is passed in rather than looked up because a
     * row knows nothing about the rows above it.
     */
    topAltitude?: number;
}

/**
 * A row of the board.
 *
 * The old row was a rounded box with a border, and the top three came with a
 * gold, a silver and a bronze chip plus an amber border on the first and the
 * third. All of that decoration was louder than the one number the
 * leaderboard exists to show, and the amber borders landed on the two rows
 * that were *not* the player's, which read as "selected" for the wrong people.
 *
 * So the row is now a line of type. The rank is a quiet numeral, the podium
 * is carried by weight rather than by metal, the altitude column carries a bar
 * drawn to scale so the eye goes to the data, and the player's own row is the
 * one thing on the board that is coloured.
 */
function LeaderboardEntry({ player, rank, isCurrentUser, topAltitude = 0 }: LeaderboardEntryProps) {
    const [imageError, setImageError] = useState(false);

    // How much of the board's best this row reached. The bar is right-aligned
    // and grows leftwards from the same edge for every row, so the lengths can
    // be compared by eye.
    const share = topAltitude > 0 ? Math.min(100, (player.maxAltitude / topAltitude) * 100) : 0;

    return (
        <motion.li
            initial={{ opacity: 0, x: -10 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.25 }}
            className="relative flex items-center gap-3.5 pl-3 py-3"
        >
            {/*
              The player's own row, marked once and unmistakably: a signal
              coloured edge down the side of the row. Cyan is the player's
              presence in the token vocabulary, so the one row that is about
              the player is the one row that wears it.
            */}
            {isCurrentUser && (
                <span
                    aria-hidden="true"
                    className="absolute left-0 top-1/2 -translate-y-1/2 h-9 w-[2px] rounded-full bg-cyan-400"
                />
            )}

            {/* The rank. Numerals, not medal glyphs: a trophy renders as a
                full-colour image on Windows and Android, which is the only
                saturated thing on a screen built out of one accent and a
                neutral ramp. The podium is carried by weight instead, and the
                digit is tabular so it does not shift as the board changes. */}
            <span
                className={`w-5 shrink-0 text-right font-mono text-[13px] tabular ${
                    rank <= 3 ? "text-zinc-300" : "text-zinc-600"
                }`}
            >
                {rank}
            </span>

            {/*
              The avatar. One mark, two ways of filling it: a photograph and the
              monogram that stands in for a missing one are the same object —
              same size, same tight radius, same hairline ring, same flat
              backdrop. The picture is also pulled to monochrome, because these
              are Google's own avatars and they arrive in whatever colour the
              account happened to be given: a green tile, a purple tile and a
              face, side by side, in a product with one accent and a neutral
              ramp. Monochrome, they are a set of marks instead of three
              unrelated pictures, and nothing on the row shouts louder than the
              altitude.
            */}
            <div className="relative w-9 h-9 rounded-[var(--radius-control)] overflow-hidden bg-zinc-800/70 ring-1 ring-inset ring-white/10 shrink-0 flex items-center justify-center">
                {player.image && !imageError ? (
                    <Image
                        src={player.image}
                        alt={player.name}
                        width={36}
                        height={36}
                        className="w-full h-full object-cover grayscale opacity-90"
                        onError={() => setImageError(true)}
                        unoptimized
                    />
                ) : (
                    <div className="w-full h-full flex items-center justify-center font-mono font-bold text-xs text-zinc-300 uppercase">
                        {player.name ? player.name.charAt(0) : '?'}
                    </div>
                )}
            </div>

            <span
                className={`text-[15px] truncate ${isCurrentUser ? "text-white font-semibold" : "text-zinc-300 font-medium"}`}
            >
                {player.name}
            </span>

            {isCurrentUser && (
                <span className="font-mono text-[10px] bg-cyan-400/10 text-cyan-300 border border-cyan-400/25 px-1.5 py-px rounded-full uppercase tracking-wider shrink-0 font-semibold">
                    You
                </span>
            )}

            {/* The data column. The number is the loudest thing on the row, and
                the bar under it is drawn to scale, so the board reads as a
                chart of how far each climber got. */}
            <div className="ml-auto flex flex-col items-end gap-1.5 w-28 sm:w-32 shrink-0">
                <span className="font-mono text-xl font-bold text-white tabular leading-none">
                    {player.maxAltitude.toLocaleString()}
                    <span className="text-zinc-500 text-[13px] font-normal ml-0.5">m</span>
                </span>
                <span aria-hidden="true" className="block h-[3px] w-full rounded-full bg-white/[0.05]">
                    <span
                        className="block h-full ml-auto rounded-full bg-white/30"
                        style={{ width: `${share}%` }}
                    />
                </span>
            </div>
        </motion.li>
    );
}

export default memo(LeaderboardEntry);
