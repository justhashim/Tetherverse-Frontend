'use client';

interface SkipButtonProps {
    onClick: () => void;
}

export default function SkipButton({ onClick }: SkipButtonProps) {
    return (
        <button
            onClick={(e) => {
                // Prevent clicking the button from bubbling up and triggering the parent div's onClick
                e.stopPropagation();
                onClick();
            }}
            className="group relative flex items-center gap-2 bg-zinc-900/80 hover:bg-zinc-800 text-zinc-300 hover:text-white font-mono text-xs uppercase tracking-wider px-4 py-2.5 rounded-[var(--radius-control)] border border-zinc-800 hover:border-zinc-700 transition-colors duration-150 backdrop-blur-md shadow-sm active:scale-[0.98] cursor-pointer select-none"
        >
            <span>Skip Sequence</span>

            <span className="text-[10px] bg-zinc-800 border border-zinc-700 text-zinc-400 px-1.5 py-0.5 rounded font-mono">
                SPACE
            </span>
        </button>
    );
}