'use client';

import { useState, useEffect } from 'react';

interface GameHUDProps {
    onAbort: () => void;
}

interface AltitudeDetail {
    altitude: number;
    maxAltitude: number;
    zone: string;
}

export default function GameHUD({ onAbort }: GameHUDProps) {
    const [altitude, setAltitude] = useState<number>(0);
    const [maxAltitude, setMaxAltitude] = useState<number>(() => {
        if (typeof window !== 'undefined') {
            const saved = localStorage.getItem('maxAltitude');
            return saved ? parseInt(saved, 10) || 0 : 0;
        }
        return 0;
    });
    const [zone, setZone] = useState<string>('SURFACE');

    useEffect(() => {
        const handleAltitudeUpdate = (e: Event) => {
            const detail = (e as CustomEvent<AltitudeDetail>).detail;
            if (detail) {
                setAltitude(detail.altitude);
                setMaxAltitude(detail.maxAltitude);
                if (detail.zone) setZone(detail.zone);
            }
        };

        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape') {
                e.preventDefault();
                onAbort();
            }
        };

        window.addEventListener('tetherverse:altitude-update', handleAltitudeUpdate);
        window.addEventListener('keydown', handleKeyDown);

        return () => {
            window.removeEventListener('tetherverse:altitude-update', handleAltitudeUpdate);
            window.removeEventListener('keydown', handleKeyDown);
        };
    }, [onAbort]);

    const isNewRecord = altitude > maxAltitude && altitude > 0;

    const getZoneColor = (z: string) => {
        switch (z) {
            case 'TROPOSPHERE':
                return 'border-cyan-500/40 bg-cyan-950/40 text-cyan-300 shadow-[0_0_10px_rgba(6,182,212,0.2)]';
            case 'STRATOSPHERE':
                return 'border-violet-500/40 bg-violet-950/40 text-violet-300 shadow-[0_0_10px_rgba(139,92,246,0.2)]';
            case 'MESOSPHERE':
                return 'border-fuchsia-500/40 bg-fuchsia-950/40 text-fuchsia-300 shadow-[0_0_10px_rgba(217,70,239,0.2)]';
            case 'EXOSPHERE':
                return 'border-amber-500/40 bg-amber-950/40 text-amber-300 shadow-[0_0_15px_rgba(245,158,11,0.3)] animate-pulse';
            case 'SURFACE':
            default:
                return 'border-emerald-500/40 bg-emerald-950/40 text-emerald-400 shadow-[0_0_10px_rgba(16,185,129,0.15)]';
        }
    };

    return (
        <div className="absolute inset-0 pointer-events-none z-40 flex flex-col justify-between p-4 md:p-6 select-none overflow-hidden">
            {/* Top Navigation & Telemetry Bar */}
            <header className="w-full flex items-start justify-between">
                {/* Abort Ascent Action */}
                <button
                    onClick={onAbort}
                    className="pointer-events-auto group flex items-center gap-2.5 bg-zinc-950/80 hover:bg-zinc-900 border border-zinc-800 hover:border-rose-900/50 text-zinc-400 hover:text-rose-200 px-3.5 py-2 rounded-[var(--radius-control)] font-mono text-xs font-semibold tracking-wider backdrop-blur-md transition-all duration-150 shadow-sm active:scale-[0.98] cursor-pointer select-none"
                    aria-label="Abort Current Ascent"
                >
                    <span className="text-base group-hover:-translate-x-0.5 transition-transform">←</span>
                    <span>ABORT ASCENT</span>
                    <span className="text-[10px] bg-zinc-900 group-hover:bg-rose-950/60 text-zinc-500 group-hover:text-rose-300 px-1.5 py-0.5 rounded border border-zinc-800 group-hover:border-rose-800/40">
                        ESC
                    </span>
                </button>

                {/* Cyberpunk Altimeter Module */}
                <div className="pointer-events-auto flex flex-col items-end gap-1.5 bg-slate-950/70 border border-cyan-500/30 backdrop-blur-md rounded-[var(--radius-panel)] px-5 py-3 shadow-[0_0_30px_rgba(6,182,212,0.15)]">
                    {/* Stratum Zone Badge */}
                    <div className="flex items-center gap-2">
                        <div className={`flex items-center gap-1.5 font-mono text-[10px] font-black uppercase tracking-widest px-2.5 py-0.5 rounded-full border ${getZoneColor(zone)}`}>
                            <span className="w-1.5 h-1.5 rounded-full bg-current animate-ping" />
                            <span>ZONE // {zone}</span>
                        </div>
                    </div>

                    {/* Main Digital Altitude Metric */}
                    <div className="flex items-baseline gap-1">
                        <span className="font-mono text-xs text-slate-500 tracking-widest uppercase mr-1">ALT</span>
                        <span className="font-mono font-black text-3xl md:text-4xl text-white tracking-tight tabular">
                            {altitude.toLocaleString().padStart(4, '0')}
                        </span>
                        <span className="font-mono font-bold text-cyan-400 text-sm md:text-base tracking-wide">
                            m
                        </span>
                    </div>

                    {/* Personal Best / Record Indicator */}
                    <div className="font-mono text-[11px] tracking-wider">
                        {isNewRecord ? (
                            <span className="inline-flex items-center gap-1.5 font-bold text-cyan-300 animate-pulse">
                                {/* A rising bar rather than a lightning glyph: same
                                    idea, drawn in the game's own accent, and it
                                    inherits colour instead of shipping an emoji
                                    font's artwork. */}
                                <svg
                                    width="10"
                                    height="10"
                                    viewBox="0 0 10 10"
                                    fill="currentColor"
                                    aria-hidden="true"
                                    focusable="false"
                                    className="shrink-0"
                                >
                                    <rect x="0" y="7" width="2.5" height="3" rx="0.4" />
                                    <rect x="3.75" y="4.5" width="2.5" height="5.5" rx="0.4" />
                                    <rect x="7.5" y="0" width="2.5" height="10" rx="0.4" />
                                </svg>
                                <span>NEW RECORD</span>
                            </span>
                        ) : (
                            <span className="text-slate-400">
                                BEST: <span className="text-violet-400 font-bold tabular">{maxAltitude.toLocaleString()}m</span>
                            </span>
                        )}
                    </div>
                </div>
            </header>

            {/* Bottom Floating Control HUD */}
            <footer className="w-full flex justify-center pb-2">
                <div className="flex items-center gap-2.5 md:gap-4 bg-slate-950/70 border border-slate-800/80 backdrop-blur-md px-4 py-2 rounded-[var(--radius-panel)] font-mono text-[10px] md:text-[11px] text-slate-400 tracking-wider uppercase shadow-xl">
                    <span>
                        <span className="text-slate-300 font-bold">HOLD</span>{' '}
                        <span className="hidden sm:inline">[CLICK/SPACE]</span>
                        <span className="sm:hidden">[TAP]</span> TETHER
                    </span>
                    <span className="text-slate-300 font-bold">RELEASE</span> LAUNCH
                    <span className="hidden sm:inline">
                        <span className="text-slate-300 font-bold">[A/D]</span> STEER
                    </span>
                </div>
            </footer>
        </div>
    );
}

