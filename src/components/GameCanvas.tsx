"use client";

import Game from "@/src/game/Game";
import type { ServerRun } from "@/src/lib/server-run";

interface GameCanvasProps {
    isActive?: boolean;
    /** The server-issued run the scene should build, or null before play. */
    run?: ServerRun | null;
    /** The account the run belongs to, so a finished climb is filed correctly. */
    playerKey?: string | null;
}

export default function GameCanvas({ isActive = true, run = null, playerKey = null }: GameCanvasProps) {
    return <Game isActive={isActive} run={run} playerKey={playerKey} />;
}
