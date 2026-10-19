'use client';

import { useState, useEffect, useRef, useCallback, useMemo } from "react";
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

type AppState = 'intro' | 'menu' | 'playing' | 'leaderboard';

interface GameOverData {
  altitude: number;
  best: number;
  /** Banked coins after this run. The server total is authoritative. */
  coins: number;
  /** Coins that were on the mountain when the run ended, and are therefore lost. */
  lostCoins: number;
}

// --- Cinematic Intro Video Component with Sound Activation & Fade ---
function IntroVideo({ onComplete }: { onComplete: () => void }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [hasInteracted, setHasInteracted] = useState(false);
  const [isFadingOut, setIsFadingOut] = useState(false);
  const fadeTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  const startPlayback = async () => {
    const video = videoRef.current;
    if (!video) return;

    try {
      video.muted = false;
      await video.play();
    } catch (err: unknown) {
      if (err instanceof DOMException && err.name === "AbortError") {
        return;
      }
      if (err instanceof DOMException && err.name === "NotAllowedError") {
        try {
          video.muted = true;
          await video.play();
        } catch (fallbackErr: unknown) {
          if (fallbackErr instanceof DOMException && fallbackErr.name === "AbortError") {
            return;
          }
          console.warn("Muted video playback fallback failed:", fallbackErr);
        }
        return;
      }
      console.warn("Video playback encountered an error:", err);
    }
  };

  const handleStartIntro = () => {
    setHasInteracted(true);
    startPlayback();
  };

  const triggerFadeOut = useCallback(() => {
    if (isFadingOut) return;
    setIsFadingOut(true);

    if (videoRef.current) {
      videoRef.current.pause();
    }

    fadeTimeoutRef.current = setTimeout(() => {
      onComplete();
    }, 1000);
  }, [isFadingOut, onComplete]);

  useEffect(() => {
    return () => {
      if (fadeTimeoutRef.current) {
        clearTimeout(fadeTimeoutRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (!hasInteracted) return;

    const handleSkip = (e: KeyboardEvent) => {
      if (e.key === " " || e.key === "Escape") {
        e.preventDefault();
        triggerFadeOut();
      }
    };

    window.addEventListener("keydown", handleSkip);
    return () => window.removeEventListener("keydown", handleSkip);
  }, [hasInteracted, triggerFadeOut]);

  return (
    <div
      className={`fixed inset-0 w-screen min-h-[100dvh] h-[100dvh] bg-black z-50 overflow-hidden transition-opacity duration-1000 ease-out select-none ${isFadingOut ? "opacity-0 pointer-events-none" : "opacity-100"
        }`}
    >
      <video
        ref={videoRef}
        src="/videos/intro.mp4"
        className="w-full h-full object-cover pointer-events-none"
        playsInline
        preload="auto"
        onEnded={triggerFadeOut}
      />

      {!hasInteracted ? (
        <div
          onClick={handleStartIntro}
          className="absolute inset-0 w-full h-full bg-slate-950 flex flex-col items-center justify-center z-50 cursor-pointer select-none overflow-hidden"
        >
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_50%,rgba(6,182,212,0.06)_0%,transparent_60%)] animate-pulse pointer-events-none" />
          <div className="relative font-mono text-xs md:text-sm tracking-[0.4em] text-cyan-400 uppercase animate-[pulse_2s_infinite] text-center px-4 pointer-events-none">
            {'// CLICK ANYWHERE TO INITIALIZE //'}
          </div>
        </div>
      ) : (
        <>
          <div
            onClick={triggerFadeOut}
            className="absolute inset-0 z-40 cursor-pointer"
          />
          <button
            onClick={(e) => {
              e.stopPropagation();
              triggerFadeOut();
            }}
            className={`group absolute bottom-8 right-8 z-50 flex items-center gap-2 bg-zinc-900/80 hover:bg-zinc-800 text-zinc-300 hover:text-white font-mono text-xs tracking-wider uppercase px-4 py-2.5 rounded-[var(--radius-control)] border border-zinc-800 hover:border-zinc-700 transition-all duration-150 backdrop-blur-md shadow-sm active:scale-[0.98] cursor-pointer select-none ${isFadingOut ? "opacity-0 scale-95 pointer-events-none" : "opacity-100"
              }`}
          >
            <span>SKIP INTRO</span>
            <span className="text-[10px] bg-zinc-800 border border-zinc-700 text-zinc-400 px-1.5 py-0.5 rounded">
              SPACE
            </span>
          </button>
        </>
      )}
    </div>
  );
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
  const [currentView, setCurrentView] = useState<AppState>('intro');
  const [gameOver, setGameOver] = useState<GameOverData | null>(null);
  const [gameKey, setGameKey] = useState(0);
  const [isMenuMounted, setIsMenuMounted] = useState(currentView === "menu");
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
      <main className="w-screen min-h-[100dvh] h-[100dvh] bg-slate-950 flex flex-col items-center justify-center gap-3 select-none">
        <div
            className="w-10 h-10 border-2 border-t-cyan-400 border-r-transparent border-b-transparent border-l-transparent rounded-full animate-spin"
            role="status"
            aria-label="Linking Excel Play session"
        />
        <span className="text-slate-400 font-mono text-xs tracking-[0.3em] uppercase">
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
      <main className="relative w-screen min-h-[100dvh] h-[100dvh] overflow-hidden bg-radial-dark flex flex-col items-center justify-center p-6 select-none">
        <MultiverseBackground />
        <div className="relative z-10 w-full max-w-md bg-slate-950/70 border border-rose-500/30 rounded-[var(--radius-panel)] p-8 text-center backdrop-blur-xl">
          <h1 className="text-xl font-black text-white tracking-tight uppercase mb-2">
            Session link failed
          </h1>
          <p className="text-sm text-slate-400 mb-6 leading-relaxed">
            Excel Play did not hand over a valid access token, so this climb
            cannot be scored to your account.
          </p>
          <button
            onClick={() => window.location.reload()}
            className="px-5 py-2.5 rounded-[var(--radius-control)] bg-cyan-500/15 hover:bg-cyan-500/25 border border-cyan-500/40 text-cyan-200 font-mono text-xs font-bold uppercase tracking-wider transition-colors cursor-pointer active:scale-[0.98]"
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
      <main className="w-screen min-h-[100dvh] h-[100dvh] bg-slate-950 flex flex-col items-center justify-center gap-3 select-none">
        <div className="relative w-10 h-10">
          <div className="absolute inset-0 border-2 border-t-cyan-400 border-r-transparent border-b-transparent border-l-transparent rounded-full animate-spin" />
          <div className="absolute inset-1.5 border-2 border-b-violet-500 border-r-transparent border-t-transparent border-l-transparent rounded-full animate-[spin_1s_linear_infinite_reverse]" />
        </div>
        <span className="text-slate-400 font-mono text-xs tracking-[0.3em] uppercase animate-pulse">
          Synthesizing Reality...
        </span>
      </main>
    );
  }

  // View: Unauthenticated Dimensional Terminal Gate
  if (!identity) {
    return (
      <main className="relative w-screen min-h-[100dvh] h-[100dvh] overflow-hidden bg-radial-dark flex flex-col items-center justify-center p-6 select-none">
        <MultiverseBackground />

        <div className="relative z-10 w-full max-w-md bg-slate-950/70 border border-violet-500/30 rounded-[var(--radius-panel)] p-8 md:p-10 backdrop-blur-xl shadow-[0_0_60px_rgba(139,92,246,0.15)] text-center flex flex-col items-center">
          {/* Top Holographic Flare */}
          <div className="absolute top-0 inset-x-0 h-0.5 bg-linear-to-r from-transparent via-cyan-400 to-transparent shadow-[0_0_15px_rgba(34,211,238,0.8)]" />

          {/* Central Logo Node */}
          <div className="relative w-28 h-28 mb-5 rounded-full border border-cyan-400/50 bg-slate-950/80 p-1.5 flex items-center justify-center shadow-[0_0_40px_rgba(6,182,212,0.35)]">
            <div className="absolute inset-[-6px] border border-dashed border-violet-400/40 rounded-full animate-[spin_30s_linear_infinite]" />
            <NextImage
              src="/logo.png"
              alt="Tetherverse Logo"
              width={104}
              height={104}
              priority
              className="w-full h-full object-contain rounded-full"
            />
          </div>

          <h1 className="text-4xl md:text-5xl font-black text-white tracking-tight uppercase mb-1">
            Tether<span className="text-transparent bg-clip-text bg-linear-to-r from-cyan-400 via-violet-400 to-fuchsia-500">verse</span>
          </h1>
          <p className="font-mono text-xs text-slate-400 tracking-[0.25em] uppercase mb-8">
            Dimensional Ascent Portal
          </p>

          <button
            onClick={handleLogin}
            className="group relative w-full flex items-center justify-center gap-3 bg-cyan-400 hover:bg-cyan-300 active:bg-cyan-500 text-slate-950 font-mono font-bold text-sm tracking-wider uppercase px-6 py-3.5 rounded-[var(--radius-control)] border border-cyan-300/60 transition-colors duration-150 shadow-[0_0_30px_rgba(34,211,238,0.25)] active:scale-[0.98] cursor-pointer select-none"
          >
            <svg className="w-5 h-5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4" />
              <polyline points="10 17 15 12 10 7" />
              <line x1="3" y1="12" x2="15" y2="12" />
            </svg>
            <span>Sign in with Excel Play</span>
          </button>

          <div className="mt-8 font-mono text-[10px] text-slate-500 uppercase tracking-widest flex items-center gap-2">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
            <span>TERMINAL // GATEWAY READY</span>
          </div>
        </div>
      </main>
    );
  }

  return (
    <MotionConfig reducedMotion="user">
      <main className="relative w-screen min-h-[100dvh] h-[100dvh] overflow-hidden bg-[#02040a] text-white select-none">
        {/* Intro Video Layer */}
        {currentView === 'intro' && (
          <IntroVideo
            onComplete={() => {
              setIsMenuMounted(true);
              setCurrentView("menu");
            }}
          />
        )}

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

        {/* Active Game Canvas & In-Game React HUD */}
        {(currentView === 'playing' || isMenuMounted) && (
          <div
            className={`w-full h-full absolute inset-0 transition-opacity duration-700 ${currentView === 'playing'
              ? "z-30 opacity-100 pointer-events-auto"
              : "z-10 opacity-30 pointer-events-none"
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

                <div className="relative w-full max-w-md bg-slate-900/70 border border-violet-500/30 rounded-[var(--radius-panel)] shadow-[0_0_60px_rgba(139,92,246,0.25)] overflow-hidden p-7 md:p-8 text-center backdrop-blur-xl">
                  {/* Top Glowing Red Accent */}
                  <div className="absolute top-0 inset-x-0 h-0.5 bg-linear-to-r from-transparent via-red-500/80 to-transparent shadow-[0_0_15px_rgba(239,68,68,0.8)]" />

                  {/* Multiverse Emblem */}
                  <div className="relative w-20 h-20 mx-auto rounded-full border border-red-500/40 bg-slate-950/80 p-1 flex items-center justify-center shadow-[0_0_30px_rgba(239,68,68,0.25)]">
                    <div className="absolute inset-[-4px] border border-dashed border-red-500/30 rounded-full animate-[spin_20s_linear_infinite]" />
                    <NextImage
                      src="/logo.png"
                      alt=""
                      width={72}
                      height={72}
                      className="w-full h-full object-contain rounded-full filter hue-rotate-180 brightness-95"
                    />
                  </div>

                  <p className="mt-5 font-mono text-[10px] tracking-[0.4em] text-red-400 uppercase">
                    Node Status // Signal Lost
                  </p>
                  <h2 className="mt-1 font-black text-4xl md:text-5xl tracking-tight uppercase text-transparent bg-clip-text bg-linear-to-r from-red-400 via-rose-300 to-amber-300">
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
                      <p className="mt-1 font-mono font-black text-3xl text-violet-400 tabular">
                        {gameOver.best}
                        <span className="text-sm font-normal text-violet-500 ml-0.5">m</span>
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
                      <span>RE-ENGAGE ASCENT</span>
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