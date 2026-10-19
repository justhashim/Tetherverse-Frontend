'use client';

import { useEffect, useRef } from "react";
import SkipButton from "./SkipButton";

interface IntroVideoProps {
    onComplete: () => void;
    onSkip: () => void;
}

export default function IntroVideo({ onComplete, onSkip }: IntroVideoProps) {
    const videoRef = useRef<HTMLVideoElement>(null);

    useEffect(() => {
        const video = videoRef.current;
        if (!video) return;

        // Force maximum performance bindings
        video.playbackRate = 1.0;
        video.play().catch((err: unknown) => {
            if (err instanceof DOMException && err.name === 'AbortError') return;
            console.warn("Autoplay blocked by browser policy, executing fallback click-to-play:", err);
        });

        // Event handler for keyboard skips
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === " " || e.key === "Escape") {
                e.preventDefault();
                onSkip();
            }
        };

        // Event handler for viewport interactive bypass
        const handleViewportClick = (e: MouseEvent) => {
            // Do not trigger skip if clicking the explicit interactive button
            if ((e.target as HTMLElement).closest('[data-skip-btn]')) return;
            onSkip();
        };

        window.addEventListener("keydown", handleKeyDown);
        window.addEventListener("click", handleViewportClick);

        return () => {
            window.removeEventListener("keydown", handleKeyDown);
            window.removeEventListener("click", handleViewportClick);
        };
    }, [onSkip]);

    return (
        <div className="fixed inset-0 w-screen h-screen bg-black z-50 overflow-hidden select-none">
            <video
                ref={videoRef}
                src="/videos/intro.mp4"
                className="w-full h-full object-cover pointer-events-none"
                autoPlay
                playsInline
                muted={false}
                onEnded={onComplete}
                preload="auto"
            />
            <div className="absolute bottom-8 right-8 z-50" data-skip-btn>
                <SkipButton onClick={onSkip} />
            </div>
        </div>
    );
}