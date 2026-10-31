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
import RulesPanel from "@/src/components/rules/RulesPanel";
import MultiverseBackground from "@/src/components/menu/MultiverseBackground";
import { useExcelSession } from "@/src/lib/excel-auth-client";
import { useBridgeAuth } from "@/src/lib/bridge-auth";
import { installChunkRecovery } from "@/src/lib/chunk-recovery";
import { startServerRun, type ServerRun } from "@/src/lib/server-run";
import {
  clearStoredBest,
  drainPendingRuns,
  fetchServerBest,
  readStoredBest,
  writeStoredBest,
  type RunSaveStatus,
} from "@/src/lib/score-store";

/*
   `rules` is a view rather than a boolean on the menu, so the panel owns the
   screen the way the board does: the menu stays mounted underneath it (the sky
   behind it is the menu's own, and its entrance animations are already spent),
   and closing the sheet drops the player back on the screen they left.
*/
type AppState = 'menu' | 'playing' | 'leaderboard' | 'rules';

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
  /**
   * The player's best, and the only number the menu's record is built from.
   *
   * It starts empty on purpose. The stored value is a *placeholder* keyed by
   * account, painted for the half second before `GET /api/score` answers, and
   * the answer always replaces it - including when it is lower. The old version
   * read `maxAltitude` from localStorage unkeyed and never corrected it, so a
   * climb the server rejected still stood as a record on that machine, and a
   * second player on the same browser inherited the first player's best.
   */
  const [bestAltitude, setBestAltitude] = useState<number>(0);
  /**
   * The last time the API said "no" to a save.
   *
   * Kept beside the run error rather than inside the menu, because the player
   * who has just finished a climb is on the menu when it lands, and the number
   * they are looking at is the one that did not move.
   */
  const [saveError, setSaveError] = useState<string | null>(null);

  const handleLogin = excelSession.login;

  const handleLogout = excelSession.logout;

  /**
   * The best, from the account that is signed in.
   *
   * Three steps, in this order, because the order is what keeps two sources of
   * truth from disagreeing:
   *
   *   1. Paint the cached placeholder for this player, so the menu has a number
   *      immediately instead of a zero that would look like a reset.
   *   2. Drain the outbox. A finished run that never reached the API is not
   *      reflected in `GET /api/score`, so fetching first would report a best
   *      that is about to be beaten by the player's own unsent climb.
   *   3. Ask the API, and let its answer win - including when it is lower than
   *      the cache, which is the only way a save that silently failed stops
   *      being displayed as if it had landed.
   */
  useEffect(() => {
    if (!identity) return;

    const owner = identity.id;
    let cancelled = false;

    const sync = async () => {
      // Painted from the cache first: the menu should not show "no record" for
      // the half second the API takes to answer a question it already answered
      // on the last visit. It is replaced below, win or lose.
      const stored = readStoredBest(owner);
      if (stored > 0) setBestAltitude(stored);

      const drained = await drainPendingRuns(owner);
      if (cancelled) return;

      const server = await fetchServerBest();
      if (cancelled) return;

      if (!server) {
        // No answer. Keep the placeholder: a flaky read must not tell a player
        // with a record that they have never climbed.
        if (drained.best > 0) setBestAltitude(drained.best);
        return;
      }

      setBestAltitude(server.best);
      if (server.best > 0) writeStoredBest(owner, server.best);
      else clearStoredBest(owner);
    };

    void sync();

    return () => {
      cancelled = true;
    };
  }, [identity]);

  /**
   * Opens a run on the server, or reports why it could not.
   *
   * A climb with no run behind it cannot be scored, so this is a gate rather
   * than a background detail: the caller only moves the player into the game
   * once a run exists. The request id makes the result cancellable - leaving
   * for the launcher while a start is in flight must not drop a run onto the
   * menu when it lands.
   */
  const beginRun = useCallback(async (): Promise<{ run: ServerRun | null; blocked: boolean }> => {
    if (startingRunRef.current) return { run: null, blocked: false };

    startingRunRef.current = true;
    const requestId = ++runRequestRef.current;
    setIsStartingRun(true);
    setRunError(null);

    try {
      /*
        The outbox goes first, and an undelivered run blocks the start.

        `POST /api/runs` replaces the run this player already has open, so the
        moment a new climb begins, any finished climb still waiting in the
        outbox can never be scored: its run id is no longer the open one. That
        makes "start a new run" and "lose an unsaved run" the same action unless
        the queue is emptied first.
      */
      const drained = await drainPendingRuns(identity?.id ?? '');
      if (requestId !== runRequestRef.current) return { run: null, blocked: false };

      if (drained.saved > 0 && drained.best > 0) {
        setBestAltitude(drained.best);
        if (identity) writeStoredBest(identity.id, drained.best);
      }

      if (drained.remaining > 0) {
        setRunError(
          drained.message === 'Sign in again to save this climb'
            ? 'Sign in again to save your last climb, then play.'
            : 'Your last climb has not been saved yet. Reconnect, then try again.',
        );
        return { run: null, blocked: true };
      }

      const nextRun = await startServerRun();
      if (requestId !== runRequestRef.current) return { run: null, blocked: false };
      setRun(nextRun);
      return { run: nextRun, blocked: false };
    } catch (error) {
      if (requestId !== runRequestRef.current) return { run: null, blocked: false };
      setRunError(
        error instanceof Error
          ? error.message
          : 'Could not start this climb. Try again.',
      );
      return { run: null, blocked: false };
    } finally {
      startingRunRef.current = false;
      setIsStartingRun(false);
    }
  }, [identity]);

  const handlePlay = useCallback(async () => {
    const { run: nextRun } = await beginRun();
    if (!nextRun) return;
    setCurrentView('playing');
  }, [beginRun]);

  const handleRerun = useCallback(async () => {
    const { run: nextRun, blocked } = await beginRun();
    if (!nextRun) {
      // A rerun can be refused because the last climb is still in the outbox.
      // That has to be said on the screen the player pressed, not only on the
      // menu behind it - the overlay is what they are looking at.
      if (blocked) {
        setGameOver((prev) =>
          prev
            ? { ...prev, save: { status: 'pending', message: 'Last climb still unsaved — reconnect to retry' } }
            : prev,
        );
      }
      return;
    }
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

  /**
   * Leaving a run mid-climb.
   *
   * The scene files the run before React unmounts it, because the outbox write
   * is the only part of this that cannot happen afterwards. The climb is not
   * discarded - it reached what it reached - so this exits to the menu instead
   * of the game-over screen, and the save's outcome arrives there.
   */
  const handleAbort = useCallback(() => {
    window.dispatchEvent(new CustomEvent('tetherverse:abort-run'));
    handleExitToLauncher();
  }, [handleExitToLauncher]);

  // Sync game over events
  useEffect(() => {
    const handleGameOver = (e: Event) => {
      const detail = (e as CustomEvent<GameOverData>).detail;
      setGameOver(detail);
      setSaveError(null);
    };
    window.addEventListener('tetherverse:gameover', handleGameOver);
    return () => window.removeEventListener('tetherverse:gameover', handleGameOver);
  }, []);

  /**
   * The API's verdict on the climb that just ended.
   *
   * Three things happen here, and all three are about not lying to the player:
   * the overlay's save line is updated in place, the menu's best is replaced by
   * the server's number rather than the scene's, and a refusal becomes a
   * message they can read instead of a console line they cannot.
   */
  useEffect(() => {
    const handleRunSaved = (e: Event) => {
      const detail = (e as CustomEvent<{
        runId: string;
        status: RunSaveStatus;
        message?: string;
        best?: number;
        coins?: number;
      }>).detail;
      if (!detail) return;

      setGameOver((prev) =>
        prev && prev.runId === detail.runId
          ? { ...prev, save: { status: detail.status, message: detail.message } }
          : prev,
      );

      if (detail.status === 'saved') {
        setSaveError(null);
        // The API's answer replaces the cache either way. A saved run always
        // reports the player's best, so a zero here means this player has no
        // record - and keeping a stale placeholder would be the exact lie this
        // change exists to stop.
        if (typeof detail.best === 'number' && identity) {
          setBestAltitude(detail.best);
          if (detail.best > 0) writeStoredBest(identity.id, detail.best);
          else clearStoredBest(identity.id);
        }
        return;
      }

      if (detail.status === 'rejected' || detail.status === 'pending') {
        setSaveError(detail.message ?? 'This climb could not be saved.');
      }
    };

    window.addEventListener('tetherverse:run-saved', handleRunSaved);
    return () => window.removeEventListener('tetherverse:run-saved', handleRunSaved);
  }, [identity]);

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
        {(currentView === 'menu' || currentView === 'leaderboard' || currentView === 'rules' || isMenuMounted) && (
          <div
            className={`absolute inset-0 transition-opacity duration-700 ${currentView === 'menu' || currentView === 'leaderboard' || currentView === 'rules'
              ? "z-20 opacity-100 pointer-events-auto"
              : "z-0 opacity-0 pointer-events-none"
              }`}
          >
            <MainMenu
              onPlay={handlePlay}
              onOpenLeaderboard={() => setCurrentView('leaderboard')}
              onOpenRules={() => setCurrentView('rules')}
              onLogout={handleLogout}
              user={identity}
              bestAltitude={bestAltitude}
              active={currentView === 'menu'}
              starting={isStartingRun}
              error={runError ?? saveError}
            />
          </div>
        )}

        {/* The manual. Over the menu, like the board, and never over a live run. */}
        {currentView === 'rules' && (
          <RulesPanel onClose={() => setCurrentView('menu')} />
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
            <GameCanvas key={gameKey} isActive={currentView === 'playing'} run={run} playerKey={identity.id} />

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
              <GameHUD onAbort={handleAbort} />
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