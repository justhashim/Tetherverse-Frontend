"use client";

import { useEffect, useRef, useState } from "react";
import type { Game as PhaserGame } from "phaser";

interface GameProps {
  isActive?: boolean;
}

export default function Game({ isActive = true }: GameProps) {
  const gameRef = useRef<PhaserGame | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [isReady, setIsReady] = useState(false);

  useEffect(() => {
    const handleGameReady = () => setIsReady(true);
    window.addEventListener("tetherverse:game-ready", handleGameReady);
    return () => window.removeEventListener("tetherverse:game-ready", handleGameReady);
  }, []);

  // Synchronize scene input activation with the active view state
  useEffect(() => {
    if (!gameRef.current) return;
    try {
      const scene = gameRef.current.scene?.getScene("GameScene");
      if (scene) {
        scene.input.enabled = isActive;
      }
    } catch {
      // Scene may not be mounted yet
    }
  }, [isActive, isReady]);

  useEffect(() => {
    // 2. Ensure the container div is physically loaded in the DOM tree before running
    if (!containerRef.current) return;

    // 3. Keep a flag to prevent double-initialization in React Strict Mode
    let isDestroyed = false;

    async function initPhaser() {
      try {
        // 4. Dynamically import Phaser so it ONLY loads on the client browser
        const Phaser = (await import("phaser")).default;
        const { gameConfig } = await import("./config/phaser-config");

        // Check if the component unmounted while downloading the library
        if (isDestroyed) return;

        if (!gameRef.current && containerRef.current) {
          gameRef.current = new Phaser.Game({
            ...gameConfig,
            parent: containerRef.current, // Pass the direct node reference safely
          });

          // The running game is otherwise unreachable from the page: the scene
          // is private to the React tree and Phaser keeps no global registry.
          // A handle on it is what makes a climb testable - the altitude, the
          // world the generator is building, the frame time - without a
          // second pair of eyes on the screen. Development only; the bundler
          // drops the branch in a production build.
          if (process.env.NODE_ENV !== "production") {
            (window as unknown as { __tetherverseGame?: PhaserGame }).__tetherverseGame =
              gameRef.current;
          }
        }
      } catch (err) {
        console.error("Failed to load or initialize Phaser engine:", err);
      }
    }

    initPhaser();

    return () => {
      isDestroyed = true;
      if (gameRef.current) {
        gameRef.current.destroy(true);
        gameRef.current = null;
      }
    };
  }, []);

  return (
    <div className="relative w-screen h-screen overflow-hidden">
      <div
        ref={containerRef} // This guarantees Phaser can target the canvas without racing the DOM
        id="game-container"
        style={{
          width: "100vw",
          height: "100vh",
        }}
      />

      {/* Cybernetic loading indicator during asset load or initial boot.
          No backdrop-blur on this scrim: it covers the booting canvas, and a
          backdrop-filter over a live canvas measured 18 -> 8 fps in WebKit
          (model A/B; Chromium 60fps either way). At 90% opaque the blur was
          nearly invisible behind it. */}
      {!isReady && isActive && (
        <div className="absolute inset-0 z-50 flex flex-col items-center justify-center bg-slate-950/90 transition-opacity duration-300">
          {/* One spinner, still. The counter-rotating inner ring doubled the
              moving parts without adding information. */}
          <div
              className="w-16 h-16 mb-4 border-2 border-cyan-500/20 border-t-cyan-400 rounded-full animate-spin"
              role="status"
              aria-label="Initializing ascent vector"
          />
          <p className="font-mono text-xs font-bold text-cyan-400 tracking-[0.25em] uppercase">
            Initializing Ascent Vector...
          </p>
          <p className="font-mono text-[10px] text-slate-500 tracking-widest mt-1 uppercase">
            Calibrating Quantum Tether
          </p>
        </div>
      )}
    </div>
  );
}