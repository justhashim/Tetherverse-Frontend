'use client';

import { motion, useReducedMotion } from "framer-motion";

interface AnimatedButtonProps {
    children: React.ReactNode;
    onClick?: () => void;
    variant?: "primary" | "secondary" | "danger" | "ghost";
    size?: "md" | "lg";
    className?: string;
    type?: "button" | "submit" | "reset";
    ref?: React.Ref<HTMLButtonElement>;
}

/**
 * The primary variant is the only cyan control in the product.
 *
 * Cyan is the player's own presence: the tether, the altitude readout, the
 * controls the player causes. The one thing on a screen that a player must not
 * miss is the action that starts the climb, so that is where the signal colour
 * goes, and nowhere else.
 */
export default function AnimatedButton({
    children,
    onClick,
    variant = "primary",
    size = "md",
    className = "",
    type = "button",
    ref,
}: AnimatedButtonProps) {
    const getVariantClasses = () => {
        switch (variant) {
            case "primary":
                return "bg-cyan-400 text-slate-950 font-bold hover:bg-cyan-300 active:bg-cyan-500 border border-cyan-300/70 shadow-[0_0_30px_rgba(34,211,238,0.25)]";
            case "secondary":
                return "bg-zinc-900/90 hover:bg-zinc-800 text-zinc-200 hover:text-white border border-zinc-800 hover:border-zinc-700 shadow-sm";
            case "danger":
                return "bg-rose-600 hover:bg-rose-500 active:bg-rose-700 text-white font-semibold border border-rose-500/80 shadow-sm";
            case "ghost":
                return "bg-transparent hover:bg-zinc-900/80 text-zinc-400 hover:text-zinc-100 border border-transparent hover:border-zinc-800";
            default:
                return "bg-cyan-400 text-slate-950 font-bold hover:bg-cyan-300 active:bg-cyan-500 border border-cyan-300/70 shadow-[0_0_30px_rgba(34,211,238,0.25)]";
        }
    };

    const getSizeClasses = () => {
        switch (size) {
            case "lg":
                return "min-h-[56px] md:min-h-[60px] px-7 md:px-9 text-sm md:text-base";
            case "md":
            default:
                return "min-h-[48px] md:min-h-[52px] px-6 py-3.5 text-xs md:text-sm";
        }
    };

    // A button that lifts and squashes is decoration. Honouring the preference
    // here costs one hook and removes the only motion these controls produce.
    const reduced = useReducedMotion();

    return (
        <motion.button
            ref={ref}
            type={type}
            whileHover={reduced ? undefined : { y: -1 }}
            whileTap={reduced ? undefined : { scale: 0.98 }}
            transition={{ duration: 0.15, ease: "easeOut" }}
            onClick={onClick}
            className={`group relative font-mono tracking-wider uppercase rounded-[var(--radius-control)] transition-colors duration-150 flex items-center justify-center gap-2.5 cursor-pointer select-none ${getVariantClasses()} ${getSizeClasses()} ${className}`}
        >
            <span className="relative z-10 flex items-center justify-center gap-2">{children}</span>
        </motion.button>
    );
}
