'use client';

import { useState, useEffect, useMemo, useRef, useCallback } from "react";
import { MotionConfig } from "framer-motion";
import NextImage from "next/image";
import GameCanvas from "@/src/components/GameCanvas";
import GameHUD from "@/src/components/hud/GameHUD";
import MainMenu from "@/src/components/menu/MainMenu";
import GameOverOverlay from "@/src/components/game/GameOverOverlay";
import type { GameOverData } from "@/src/components/game/GameOverOverlay";
import LeaderboardPanel from "@/src/components/leaderboard/LeaderboardPanel";
import MultiverseBackground from "@/src/components/menu/MultiverseBackground";
import { useExcelSession } from "@/src/lib/excel-auth-client";
import { useBridgeAuth } from "@/src/lib/bridge-auth";
import { installChunkRecovery } from "@/src/lib/chunk-recovery";
import { startServerRun, type ServerRun } from "@/src/lib/server-run";

type AppState = 'menu' | 'playing' | 'leaderboard';

// --- Main Application Root ---
/**
 * `reducedMotion="user"` is declared once here rather than per component. It
 * disables transform and layout animations across the whole tree while leaving
 * opacity alone, so menu entrances still fade in instead of appearing instantly
 * at full visibility. The CSS block in globals.css covers the `animate-*`
 * utilities, which know nothing about this setting.
 */
export default function Home() {
  const excelSession = useExcelSession();
  const bridge = useBridgeAuth();

  // A tab left open across a deploy is holding chunk names that no longer exist.
  // This reloads it once instead of leaving the player on an unstyled page.
  useEffect(() => installChunkRecovery(), []);

  // Embedded play authenticates through the launcher; standalone play through the
  // Excel Play accounts. Either one is enough to reach the menu. Both are reshaped
  // into the field names the menu already expects so downstream props stay unchanged.
  const identity = useMemo(() => {
    if (excelSession.user) {
      return {
        id: excelSession.user.id,
        name: excelSession.user.name,
        email: excelSession.user.email,
        image: excelSession.user.picture,
      };
    }
    if (!bridge.user) return null;
    return {
      id: bridge.user.id,
      name: bridge.user.name,
      email: bridge.user.email,
      image: bridge.user.picture,
    };
  }, [excelSession.user, bridge.user]);
  const [currentView, setCurrentView] = useState<AppState>('menu');
  const [gameOver, setGameOver] = useState<GameOverData | null>(null);
  const [gameKey, setGameKey] = useState(0);
  // The run the server opened for this attempt. Nothing can be scored without
  // one, so play and rerun both wait for it before touching the canvas.
  const [run, setRun] = useState<ServerRun | null>(null);
  const [runError, setRunError] = useState<string | null>(null);
  const [isStartingRun, setIsStartingRun] = useState(false);
  // Refs, not state, for the guards: a second click in the same tick would see
  // an unchanged `isStartingRun` and start a second run, replacing the first
  // one on the server before the player ever reaches the mountain.
  const startingRunRef = useRef(false);
  const runRequestRef = useRef(0);
  // The menu is on screen from the first frame. The game canvas is not: it is
  // mounted a moment later, behind the menu, so the engine is warm and its
  // assets are cached by the time the player reaches for the play disc. It used
  // to wait behind the intro video.
  const [isMenuMounted, setIsMenuMounted] = useState(false);
  const [bestAltitude, setBestAltitude] = useState<number>(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('maxAltitude');
      return saved ? parseInt(saved, 10) || 0 : 0;
    }
    return 0;
  });

  const handleLogin = excelSession.login;

  const handleLogout = excelSession.logout;

  /**
   * Opens a run on the server, or reports why it could not.
   *
   * A climb with no run behind it cannot be scored, so this is a gate rather
   * than a background detail: the caller only moves the player into the game
   * once a run exists. The request id makes the result cancellable - leaving
   * for the launcher while a start is in flight must not drop a run onto the
   * menu when it lands.
   */
  const beginRun = useCallback(async (): Promise<ServerRun | null> => {
    if (startingRunRef.current) return null;

    startingRunRef.current = true;
    const requestId = ++runRequestRef.current;
    setIsStartingRun(true);
    setRunError(null);

    try {
      const nextRun = await startServerRun();
      if (requestId !== runRequestRef.current) return null;
      setRun(nextRun);
      return nextRun;
    } catch (error) {
      if (requestId !== runRequestRef.current) return null;
      setRunError(
        error instanceof Error
          ? error.message
          : 'Could not start this climb. Try again.',
      );
      return null;
    } finally {
      startingRunRef.current = false;
      setIsStartingRun(false);
    }
  }, []);

  const handlePlay = useCallback(async () => {
    const nextRun = await beginRun();
    if (!nextRun) return;
    setCurrentView('playing');
  }, [beginRun]);

  const handleRerun = useCallback(async () => {
    const nextRun = await beginRun();
    if (!nextRun) return;
    setGameOver(null);
    setGameKey((k) => k + 1);
  }, [beginRun]);

  const handleExitToLauncher = useCallback(() => {
    // Invalidate any start still in flight, and drop the run: the next climb
    // must be opened against a fresh server run, not resumed from this one.
    runRequestRef.current += 1;
    setRun(null);
    setRunError(null);
    setGameOver(null);
    setGameKey((k) => k + 1);
    setCurrentView('menu');
  }, []);

  // Sync best altitude from live altitude updates
  useEffect(() => {
    const handleAltitude = (e: Event) => {
      const detail = (e as CustomEvent<{ maxAltitude: number }>).detail;
      if (detail?.maxAltitude) {
        setBestAltitude(detail.maxAltitude);
      }
    };
    window.addEventListener('tetherverse:altitude-update', handleAltitude);
    return () => window.removeEventListener('tetherverse:altitude-update', handleAltitude);
  }, []);

  // Sync game over events
  useEffect(() => {
    const handleGameOver = (e: Event) => {
      const detail = (e as CustomEvent<GameOverData>).detail;
      setGameOver(detail);
      if (detail?.best) {
        setBestAltitude(detail.best);
      }
    };
    window.addEventListener('tetherverse:gameover', handleGameOver);
    return () => window.removeEventListener('tetherverse:gameover', handleGameOver);
  }, []);

  // Keyboard controls during Game Over overlay
  useEffect(() => {
    if (!gameOver) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === ' ' || e.key === 'Enter') {
        e.preventDefault();
        handleRerun();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        handleExitToLauncher();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [gameOver, handleRerun, handleExitToLauncher]);

  // Eagerly pre-warm heavy game engine modules and assets in the background
  useEffect(() => {
    const prewarm = async () => {
      try {
        await Promise.all([
          import("phaser"),
          import("@/src/game/config/phaser-config"),
        ]);
        const textures = [
          '/background/background.png',
          '/assets/platform.png',
          '/assets/hook_node.png',
          '/character/hero.png',
        ];
        textures.forEach((src) => {
          const img = new window.Image();
          img.src = src;
        });
      } catch {
        // Silently ignore background prewarm hiccups
      }
    };

    if (typeof window !== "undefined") {
      if ("requestIdleCallback" in window) {
        window.requestIdleCallback(() => prewarm());
      } else {
        setTimeout(prewarm, 200);
      }
    }
  }, []);

  // Pre-mount GameCanvas in the background once an identity is ready
  useEffect(() => {
    if (identity) {
      const timer = setTimeout(() => {
        setIsMenuMounted(true);
      }, 1200);
      return () => clearTimeout(timer);
    }
  }, [identity]);

  // View: Connecting to the Excel Play launcher
  if (bridge.status === 'awaiting') {
    return (
      <main className="relative w-screen min-h-[100dvh] h-[100dvh] overflow-hidden flex flex-col items-center justify-center gap-3 select-none">
        <MultiverseBackground />
        <div
            className="relative z-10 w-10 h-10 border-2 border-t-white/80 border-r-transparent border-b-transparent border-l-transparent rounded-full animate-spin"
            role="status"
            aria-label="Linking Excel Play session"
        />
        <span className="relative z-10 text-slate-400 font-mono text-xs tracking-[0.3em] uppercase">
          Linking Excel Play session...
        </span>
      </main>
    );
  }

  // View: Embedded, but the launcher token could not be verified. Falling through
  // to the sign-in gate here would be wrong: the game is framed, so there is no
  // usable sign-in inside the iframe. Say what happened and offer a retry instead.
  if (bridge.status === 'error') {
    return (
      <main className="relative w-screen min-h-[100dvh] h-[100dvh] overflow-hidden flex flex-col items-center justify-center p-6 select-none">
        <MultiverseBackground />
        {/* No backdrop-blur: measured 33 -> 39 fps in WebKit when stripped (390x844@dpr3); Chromium 60fps either way. */}
        <div className="relative z-10 w-full max-w-md bg-slate-950/80 border border-rose-500/30 rounded-[var(--radius-panel)] p-8 text-center">
          <h1 className="text-xl font-black text-white tracking-tight uppercase mb-2">
            Session link failed
          </h1>
          <p className="text-sm text-slate-400 mb-6 leading-relaxed">
            Excel Play did not hand over a valid access token, so this climb
            cannot be scored to your account.
          </p>
          <button
            onClick={() => window.location.reload()}
            className="px-5 py-2.5 rounded-[var(--radius-control)] bg-white text-zinc-950 font-mono text-xs font-bold uppercase tracking-wider hover:bg-zinc-100 active:bg-zinc-200 transition-colors cursor-pointer active:scale-[0.98]"
          >
            Retry link
          </button>
        </div>
      </main>
    );
  }

  // View: Loading Session
  if (excelSession.status === 'loading' && bridge.status === 'standalone') {
    return (
      <main className="relative w-screen min-h-[100dvh] h-[100dvh] overflow-hidden flex flex-col items-center justify-center gap-3 select-none">
        <MultiverseBackground />
        <div className="relative z-10 w-10 h-10">
          <div className="absolute inset-0 border-2 border-t-white/80 border-r-transparent border-b-transparent border-l-transparent rounded-full animate-spin" />
          <div className="absolute inset-1.5 border-2 border-b-white/40 border-r-transparent border-t-transparent border-l-transparent rounded-full animate-[spin_1s_linear_infinite_reverse]" />
        </div>
        <span className="relative z-10 text-slate-400 font-mono text-xs tracking-[0.3em] uppercase">
          Preparing the climb
        </span>
      </main>
    );
  }

  // View: Unauthenticated Dimensional Terminal Gate
  if (!identity) {
    return (
      <main className="relative w-screen min-h-[100dvh] h-[100dvh] overflow-hidden flex flex-col items-center justify-center p-6 select-none">
        <MultiverseBackground />

        {/*
          The sign-in card. The logo is shown plainly: the ring that used to
          orbit it, the dashed circle and the flare along the top edge all
          decorated a mark that does not need decorating, and the green pip
          under the button announced a gateway that was never a gateway.
        */}
        {/* No backdrop-blur: the sign-in card measured 33 -> 39 fps in WebKit when stripped (390x844@dpr3); Chromium 60fps either way. */}
        <div className="relative z-10 w-full max-w-md bg-slate-950/75 border border-zinc-800 rounded-[var(--radius-panel)] p-8 md:p-10 text-center flex flex-col items-center">
          <NextImage
            src="/logo.png"
            alt="Tetherverse Logo"
            width={64}
            height={64}
            preload
            className="w-16 h-16 rounded-full mb-5"
          />

          <h1 className="text-3xl md:text-4xl font-black text-white tracking-tight mb-1">
            Tetherverse
          </h1>
          <p className="font-mono text-xs text-slate-400 tracking-[0.2em] uppercase mb-8">
            Sign in to climb
          </p>

          <button
            onClick={handleLogin}
            className="group relative w-full flex items-center justify-center gap-3 bg-cyan-400 hover:bg-cyan-300 active:bg-cyan-500 text-slate-950 font-mono font-bold text-sm tracking-wider uppercase px-6 py-3.5 rounded-[var(--radius-control)] border border-cyan-300/70 transition-colors duration-150 shadow-[0_0_30px_rgba(34,211,238,0.25)] active:scale-[0.98] cursor-pointer select-none"
          >
            <svg className="w-5 h-5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4" />
              <polyline points="10 17 15 12 10 7" />
              <line x1="3" y1="12" x2="15" y2="12" />
            </svg>
            <span>Sign in with Excel Play</span>
          </button>
        </div>
      </main>
    );
  }

  return (
    <MotionConfig reducedMotion="user">
      <main className="relative w-screen min-h-[100dvh] h-[100dvh] overflow-hidden bg-[#02040a] text-white select-none">
        {/*
          The environment, at the page level rather than inside any one screen,
          so the world is continuous behind the menu, behind the sign-in card and
          behind the leaderboard panel instead of restarting with each of them.
        */}
        <MultiverseBackground />

        {/* Main Launcher Interface */}
        {(currentView === 'menu' || currentView === 'leaderboard' || isMenuMounted) && (
          <div
            className={`absolute inset-0 transition-opacity duration-700 ${currentView === 'menu' || currentView === 'leaderboard'
              ? "z-20 opacity-100 pointer-events-auto"
              : "z-0 opacity-0 pointer-events-none"
              }`}
          >
            <MainMenu
              onPlay={handlePlay}
              onOpenLeaderboard={() => setCurrentView('leaderboard')}
              onLogout={handleLogout}
              user={identity}
              bestAltitude={bestAltitude}
              active={currentView === 'menu'}
              starting={isStartingRun}
              error={runError}
            />
          </div>
        )}

        {/* Global Rankings Telemetry Panel */}
        {currentView === 'leaderboard' && (
          <LeaderboardPanel
            onClose={() => setCurrentView('menu')}
            currentUserId={identity.id}
          />
        )}

        {/*
          Active Game Canvas & In-Game React HUD.

          The canvas is mounted while the menu is up so the game is already
          running and its assets are already cached when the player starts. It
          used to sit at a third opacity behind the menu, which put a second
          sky underneath the environment: the scene's own tiled nebula showing
          through the menu's painted one. It is invisible until the climb
          starts, and the two skies share their art, so the handover is a
          dissolve between two versions of the same place.
        */}
        {(currentView === 'playing' || isMenuMounted) && (
          <div
            className={`w-full h-full absolute inset-0 transition-opacity duration-700 ${currentView === 'playing'
              ? "z-30 opacity-100 pointer-events-auto"
              : "z-10 opacity-0 pointer-events-none"
              }`}
          >
            <GameCanvas key={gameKey} isActive={currentView === 'playing'} run={run} />

            {/*
              The HUD goes when the run does. It was still mounted behind the
              overlay, and its scrim - however dark - could not hide it: an
              altimeter reading the altitude of a run that has ended was still
              on screen under the one that had just been measured, two numbers
              deep, with an Abort control on top of a run that has already
              stopped. Its Escape binding also fired alongside the overlay's
              own, so the exit ran twice.
            */}
            {currentView === 'playing' && !gameOver && (
              <GameHUD onAbort={handleExitToLauncher} />
            )}

            {/*
              The run, as an overlay rather than a modal. It carries its own
              scrim, its own motion and its own reasoning - see
              GameOverOverlay.tsx for why there is no panel around it.
            */}
            {gameOver && (
              <GameOverOverlay
                data={gameOver}
                onRerun={handleRerun}
                onExit={handleExitToLauncher}
              />
            )}
          </div>
        )}
      </main>
    </MotionConfig>
  );
}