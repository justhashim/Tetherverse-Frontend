'use client';

import { useState, useEffect, useMemo } from "react";
import { MotionConfig } from "framer-motion";
import NextImage from "next/image";
import GameCanvas from "@/src/components/GameCanvas";
import GameHUD from "@/src/components/hud/GameHUD";
import CoinIcon from "@/src/components/shared/CoinIcon";
import MainMenu from "@/src/components/menu/MainMenu";
import LeaderboardPanel from "@/src/components/leaderboard/LeaderboardPanel";
import MultiverseBackground from "@/src/components/menu/MultiverseBackground";
import { useExcelSession } from "@/src/lib/excel-auth-client";
import { useBridgeAuth } from "@/src/lib/bridge-auth";

type AppState = 'menu' | 'playing' | 'leaderboard';

interface GameOverData {
  altitude: number;
  best: number;
  /** Banked coins after this run. The server total is authoritative. */
  coins: number;
  /** Coins that were on the mountain when the run ended, and are therefore lost. */
  lostCoins: number;
}

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

  const handleRerun = () => {
    setGameOver(null);
    setGameKey((k) => k + 1);
  };

  const handleExitToLauncher = () => {
    setGameOver(null);
    setGameKey((k) => k + 1);
    setCurrentView('menu');
  };

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
  }, [gameOver]);

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
        <div className="relative z-10 w-full max-w-md bg-slate-950/80 border border-rose-500/30 rounded-[var(--radius-panel)] p-8 text-center backdrop-blur-xl">
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
        <div className="relative z-10 w-full max-w-md bg-slate-950/75 border border-zinc-800 rounded-[var(--radius-panel)] p-8 md:p-10 backdrop-blur-xl text-center flex flex-col items-center">
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
              onPlay={() => setCurrentView('playing')}
              onOpenLeaderboard={() => setCurrentView('leaderboard')}
              onLogout={handleLogout}
              user={identity}
              bestAltitude={bestAltitude}
              active={currentView === 'menu'}
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
            <GameCanvas key={gameKey} isActive={currentView === 'playing'} />

            {currentView === 'playing' && (
              <GameHUD onAbort={handleExitToLauncher} />
            )}

            {/* Game Over Modal (Signal Lost) */}
            {gameOver && (
              <div className="absolute inset-0 z-50 flex items-center justify-center bg-slate-950/80 backdrop-blur-md p-4 select-none">
                <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_42%,rgba(239,68,68,0.12)_0%,rgba(139,92,246,0.12)_40%,transparent_70%)] pointer-events-none" />

                <div className="relative w-full max-w-md bg-slate-900/80 border border-zinc-800 rounded-[var(--radius-panel)] shadow-2xl overflow-hidden p-7 md:p-8 text-center backdrop-blur-xl">
                  {/*
                    The emblem and the accent line that used to sit above it are
                    gone. The failure is already stated in the heading, and the
                    heading was a three-colour gradient that mixed the failure
                    red with the coin amber, so the two states shared a colour
                    on a screen that was only about one of them.
                  */}
                  <NextImage
                    src="/logo.png"
                    alt=""
                    width={56}
                    height={56}
                    className="w-14 h-14 mx-auto rounded-full filter hue-rotate-180 brightness-95"
                  />

                  <p className="mt-5 font-mono text-[10px] tracking-[0.4em] text-rose-400 uppercase">
                    Run ended
                  </p>
                  <h2 className="mt-1 font-black text-4xl md:text-5xl tracking-tight uppercase text-rose-400">
                    Rift Collapsed
                  </h2>
                  <p className="mt-1 text-slate-400 font-mono text-xs tracking-widest uppercase">
                    Descent threshold exceeded
                  </p>

                  {/* New Record Fanfare */}
                  {gameOver.altitude >= gameOver.best && gameOver.altitude > 0 && (
                    <div className="mt-4 inline-flex items-center gap-2 rounded-full border border-cyan-400/40 bg-cyan-950/50 px-4 py-1.5 font-mono text-xs tracking-widest text-cyan-300 uppercase shadow-[0_0_15px_rgba(6,182,212,0.3)]">
                      <span className="w-2 h-2 rounded-full bg-cyan-400 animate-ping" />
                      New Dimensional Record
                    </div>
                  )}

                  {/* Stat Grid */}
                  <div className="mt-6 grid grid-cols-3 gap-3">
                    <div className="rounded-[var(--radius-panel)] border border-slate-800/80 bg-slate-950/60 p-4">
                      <p className="font-mono text-[10px] tracking-[0.25em] text-slate-400 uppercase">
                        Final Altitude
                      </p>
                      <p className="mt-1 font-mono font-black text-3xl text-cyan-400 tabular">
                        {gameOver.altitude}
                        <span className="text-sm font-normal text-cyan-500 ml-0.5">m</span>
                      </p>
                    </div>
                    <div className="rounded-[var(--radius-panel)] border border-slate-800/80 bg-slate-950/60 p-4">
                      <p className="font-mono text-[10px] tracking-[0.25em] text-slate-400 uppercase">
                        Sector Best
                      </p>
                      {/*
                        Plain white, not violet. Violet is the multiverse in the
                        token vocabulary, and a personal best is not the
                        multiverse. The final altitude keeps the signal colour
                        because that is the player's own live presence; the
                        record it is compared against is a reference value, and
                        the leaderboard shows reference values in white too.
                      */}
                      <p className="mt-1 font-mono font-black text-3xl text-white tabular">
                        {gameOver.best}
                        <span className="text-sm font-normal text-slate-400 ml-0.5">m</span>
                      </p>
                    </div>
                    {/* Coins stay hidden during the run, so the tally is only ever
                        revealed here. It appears only once there is something to say:
                        a player who never took the risk line sees no coin tile at all,
                        which keeps the system a secret rather than an empty readout. */}
                    {(gameOver.coins ?? 0) > 0 || gameOver.lostCoins > 0 ? (
                      <div className="rounded-[var(--radius-panel)] border border-amber-500/25 bg-slate-950/60 p-4">
                        <p className="font-mono text-[10px] tracking-[0.25em] text-slate-400 uppercase">
                          Coins
                        </p>
                        <p className="mt-1 flex items-center gap-1.5 font-mono font-black text-3xl text-amber-400">
                          <CoinIcon size={26} />
                          <span className="tabular">
                            {(gameOver.coins ?? 0).toLocaleString()}
                          </span>
                        </p>
                        {gameOver.lostCoins > 0 && (
                          <p className="mt-1 flex items-center gap-1 font-mono text-[10px] tracking-wider text-rose-400/80">
                            <CoinIcon size={11} muted />
                            <span>{gameOver.lostCoins} LOST</span>
                          </p>
                        )}
                      </div>
                    ) : (
                      // Keeps the three-column grid intact when the tile is absent,
                      // so the altitude pair does not stretch across the row.
                      <div className="rounded-[var(--radius-panel)] border border-slate-800/40 bg-slate-950/30 p-4 flex items-center justify-center">
                        <p className="font-mono text-[10px] tracking-[0.25em] text-slate-600 uppercase text-center leading-relaxed">
                          No coins
                          <br />
                          found
                        </p>
                      </div>
                    )}
                  </div>

                  {/* Action Controls */}
                  <div className="mt-7 flex flex-col gap-3">
                    <button
                      onClick={handleRerun}
                      className="group relative w-full bg-white hover:bg-zinc-100 active:bg-zinc-200 text-zinc-950 px-8 py-3.5 rounded-[var(--radius-control)] font-mono font-bold text-sm tracking-wider uppercase border border-zinc-200 shadow-sm transition-colors duration-150 active:scale-[0.98] flex items-center justify-center gap-2.5 cursor-pointer select-none"
                    >
                      <span>CLIMB AGAIN</span>
                      <span className="text-[10px] bg-zinc-200/80 border border-zinc-300 text-zinc-800 px-1.5 py-0.5 rounded font-mono font-semibold">
                        SPACE
                      </span>
                    </button>
                    <button
                      onClick={handleExitToLauncher}
                      className="w-full bg-zinc-900/90 hover:bg-zinc-800 active:bg-zinc-950 text-zinc-200 hover:text-white px-8 py-3 rounded-[var(--radius-control)] font-mono font-semibold text-xs tracking-wider uppercase border border-zinc-800 hover:border-zinc-700 shadow-sm transition-colors duration-150 active:scale-[0.98] flex items-center justify-center gap-2 cursor-pointer select-none"
                    >
                      <span>RETURN TO LAUNCHER</span>
                      <span className="text-[10px] bg-zinc-800 border border-zinc-700 text-zinc-400 px-1.5 py-0.5 rounded font-mono font-normal">ESC</span>
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}
      </main>
    </MotionConfig>
  );
}