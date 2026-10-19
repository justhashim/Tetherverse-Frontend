'use client';

import { motion } from "framer-motion";
import Image from "next/image";

/**
 * The environment the interface sits inside.
 *
 * Every layer here is art the game already ships. The nebula is the same file
 * the Phaser scene tiles as its sky, the planets and asteroids are the same ones
 * it scrolls past, and the starfield is its own.
 *
 * The menu used to draw a second, parallel sky instead: a synthetic grid horizon
 * that exists in no asset, a layer of CSS stars that twinkle, and nebula
 * gradients that exist nowhere. That meant the world a player looked at before
 * playing was not the world they played in, and the transition between them was
 * a cross-fade between two different skies.
 *
 * Nothing here is a control, and nothing here moves fast enough to notice. The
 * motion is drift, at roughly the rate the game itself drifts.
 */
export default function MultiverseBackground() {
    return (
        <div className="absolute inset-0 pointer-events-none z-0 overflow-hidden select-none bg-[#030611]">
            {/* Layer 1: the game's own sky, drifting. */}
            <motion.div
                className="absolute inset-[-5%] w-[110%] h-[110%]"
                animate={{
                    scale: [1, 1.04, 1],
                    x: [0, -10, 0],
                    y: [0, -8, 0],
                }}
                transition={{
                    duration: 25,
                    repeat: Infinity,
                    ease: "easeInOut",
                }}
            >
                <Image
                    src="/background/background.png"
                    alt=""
                    fill
                    preload
                    className="object-cover opacity-90"
                />
            </motion.div>

            {/*
              Layer 2: the game's own starfield. Two instances, drifting at the
              slow rate the scene scrolls them at. This replaces a layer of
              twenty-eight CSS stars that each ran their own opacity and scale
              keyframe, which is a lot of animation for a background nobody
              looks at.
            */}
            <motion.div
                className="absolute top-[4%] left-[-6%] w-[48%] h-[30%] opacity-40"
                animate={{ x: [0, 24, 0], y: [0, -12, 0] }}
                transition={{ duration: 30, repeat: Infinity, ease: "easeInOut" }}
            >
                <Image
                    src="/background/objects/blue-stars.png"
                    alt=""
                    fill
                    className="object-contain"
                />
            </motion.div>

            <motion.div
                className="absolute bottom-[20%] right-[-4%] w-[40%] h-[27%] opacity-30"
                animate={{ x: [0, -18, 0], y: [0, 10, 0] }}
                transition={{ duration: 38, repeat: Infinity, ease: "easeInOut", delay: 2 }}
            >
                <Image
                    src="/background/objects/blue-stars.png"
                    alt=""
                    fill
                    className="object-contain"
                />
            </motion.div>

            {/*
              Layer 3: the celestial bodies the scene scrolls past, placed where
              the interface is not. The interface sits in the lower left, so the
              bodies live in the upper right and along the right edge.
            */}
            <motion.div
                className="absolute top-[6%] right-[4%] md:top-[10%] md:right-[8%] w-16 h-16 md:w-24 md:h-24"
                animate={{
                    y: [0, -12, 0],
                    rotate: [0, 10, 0],
                }}
                transition={{
                    duration: 14,
                    repeat: Infinity,
                    ease: "easeInOut",
                }}
            >
                <Image
                    src="/background/objects/prop-planet-big.png"
                    alt=""
                    width={96}
                    height={96}
                    className="w-full h-full object-contain"
                />
            </motion.div>

            <motion.div
                className="absolute top-[24%] left-[5%] md:left-[9%] w-8 h-8 md:w-12 md:h-12 opacity-80"
                animate={{
                    y: [0, 10, 0],
                    x: [0, 6, 0],
                }}
                transition={{
                    duration: 10,
                    repeat: Infinity,
                    ease: "easeInOut",
                    delay: 1,
                }}
            >
                <Image
                    src="/background/objects/prop-planet-small.png"
                    alt=""
                    width={48}
                    height={48}
                    className="w-full h-full object-contain"
                />
            </motion.div>

            <motion.div
                className="absolute top-[38%] right-[18%] w-9 h-8 opacity-70"
                animate={{
                    y: [0, -15, 0],
                    rotate: [0, 360],
                }}
                transition={{
                    duration: 32,
                    repeat: Infinity,
                    ease: "linear",
                }}
            >
                <Image
                    src="/background/objects/asteroid-1.png"
                    alt=""
                    width={36}
                    height={32}
                    className="w-full h-full object-contain"
                />
            </motion.div>

            <motion.div
                className="absolute bottom-[24%] right-[7%] w-6 h-5 opacity-60"
                animate={{
                    y: [0, 12, 0],
                    rotate: [360, 0],
                }}
                transition={{
                    duration: 24,
                    repeat: Infinity,
                    ease: "linear",
                }}
            >
                <Image
                    src="/background/objects/asteroid-2.png"
                    alt=""
                    width={24}
                    height={20}
                    className="w-full h-full object-contain"
                />
            </motion.div>

            {/*
              Layer 4: the scrim.

              Text needs a darker surface than the nebula gives it, but the whole
              screen does not. This is the base pass: a little weight at the top
              for the identity bar, a little at the bottom for the call to
              action, and nothing at all across the middle, so the world stays
              visible where there is nothing to read.

              Screens add their own local scrim over the region their text
              occupies. See MainMenu.
            */}
            <div className="absolute inset-0 bg-linear-to-b from-slate-950/75 via-transparent to-slate-950/60" />
        </div>
    );
}
