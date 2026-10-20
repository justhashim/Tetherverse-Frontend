'use client';

import type { CSSProperties } from "react";

/**
 * The four verses, painted rather than drawn, and now with weather of their own.
 *
 * This file replaces a canvas that drew its own art every frame. The canvas
 * could only afford so much: every shape was a `fillRect` in one flat colour,
 * because there is no time at thirty frames a second on a phone to do anything
 * with edges. Hull plating, mushroom stalks and gantries therefore all came out
 * as the same rectangle in a different hue, in a single depth layer with
 * nothing to parallax against. That is what reads as cheap.
 *
 * The fix is to stop drawing and start compositing, split by what each medium
 * is actually good at:
 *
 *   bg.webp    raster. Nebula, haze and grain. SVG cannot hold a cloud: a
 *              gradient is a handful of stops and a cloud is a few hundred
 *              thousand values, so it bands. Raster also costs nothing at
 *              runtime - the pixels are already decided.
 *
 *   far.svg    vector, distant. Smaller shapes, hazier, lower contrast, because
 *              that is what distance looks like.
 *
 *   near.svg   vector, foreground. Larger, darker, rim-lit by the verse's own
 *              accent, which is what names a silhouette at ninety pixels wide.
 *
 *   motes.svg  vector, drift. Stars, spores and embers, on their own clock.
 *
 * Everything moves on `transform`, on the compositor, with no JavaScript at
 * all. The old canvas ran a rAF loop to repaint itself; this runs nothing.
 * That matters more than usual here, because everything above the sky is type
 * and the one control, and both have to hold sixty frames on a handset.
 *
 * The ambient layer adds what the drift cannot: four planes settling at four
 * speeds is depth, but it is the same depth for all four worlds. These give
 * each verse the one motion that names it - shafts crossing the hull, spores
 * lifting off the canopy, embers rising off the foundry, the Null's sky
 * displacing in slices - so that a player who cannot see the colour can still
 * tell which of the four they are looking at.
 *
 * Measured, backdrop animating, 60 being the vsync ceiling rather than an
 * estimate: 60fps at 1440x900 and 60fps at 390x844 on hardware GL, and 60fps
 * at 390x844 in a software rasteriser. The identical page measures 16fps at
 * 1440x900 under SwiftShader - roughly the same figure the canvas it replaced
 * scored there - which is the number to hold in mind before trusting a
 * headless capture. Sixteen masked layers look ruinously expensive in a
 * software rasteriser and cost nothing measurable anywhere a player is.
 */

const VERSES = ["verge", "bloom", "kiln", "null"] as const;

type VerseId = (typeof VERSES)[number];

type VerseLayer = {
    /** File stem inside /public/verses/<verse>/. */
    file: string;
    /** Absolute insets, in % of the slice. See EDGE_MASK and the note below. */
    top: string;
    bottom: string;
    /** Drift travel, as a % of the element's own height. */
    amp: string;
    /** Cycle length in seconds. Unequal across layers on purpose. */
    dur: number;
    /** The nebula tiles horizontally; the silhouettes are cover-fitted. */
    tile: boolean;
    /** Motes rise; everything else settles. */
    rise: boolean;
};

/**
 * One entry per independently drifting layer.
 *
 * `top` and `bottom` are the whole trick. A layer exactly as tall as its slice
 * exposes a gap at one edge the moment it moves, and simply making it taller is
 * not enough either: these silhouettes stand on a floor, so if that floor edge
 * is not pinned to the bottom of the slice the world reads as floating the
 * moment it drifts. Each layer therefore overhangs at the top, pins at the
 * bottom, and travels *downward* inside that headroom - the only direction that
 * can never uncover either edge.
 *
 * The motes layer is the exception in both respects: it hangs below instead and
 * rises. It is a scatter of dots on transparency, so there is no edge to
 * uncover in the first place.
 *
 * The amplitudes are held well inside the headroom: for a layer overhanging by
 * X% of the slice and moving Y% of its own height, the top edge lands at
 * -X + Y(100+X)/100, so Y must stay under 100X/(100+X). These all do, with room.
 *
 * Durations and amplitudes are deliberately unequal. Identical motion across
 * four layers is one layer moving; the spread is what makes it depth.
 */
const LAYERS: readonly VerseLayer[] = [
    { file: "bg", top: "-6%", bottom: "0%", amp: "3%", dur: 110, tile: true, rise: false },
    { file: "far", top: "-9%", bottom: "0%", amp: "4%", dur: 80, tile: false, rise: false },
    { file: "near", top: "-12%", bottom: "0%", amp: "4.5%", dur: 58, tile: false, rise: false },
    { file: "motes", top: "0%", bottom: "-10%", amp: "6%", dur: 44, tile: false, rise: true },
];

/**
 * Each verse fades out over the outer 15% of its own width, so two of them
 * bleed into each other the way parallel skies should meet instead of cutting at
 * a seam. `white` rather than `black` for the opaque stop, so the mask resolves
 * correctly whether the engine reads it by alpha (the spec for gradients) or,
 * as some WebKit paths historically did, by luminance.
 *
 * The seam hairlines live in the DOM as siblings of this component rather than
 * inside it, so they are not masked and stay crisp against the blend.
 */
const EDGE_MASK = {
    maskImage:
        "linear-gradient(to right, transparent 0%, white 15%, white 85%, transparent 100%)",
    WebkitMaskImage:
        "linear-gradient(to right, transparent 0%, white 15%, white 85%, transparent 100%)",
} as const;

/**
 * The verse's own accent, for the focus scrim and rim.
 *
 * Duplicated from `src/game/worlds/definitions.ts` rather than imported, because
 * that module pulls in Phaser and this is a client component that must not. It
 * is four hex values; the cost of the duplication is four hex values of drift,
 * and the alternative is shipping a game engine to a menu.
 *
 * None of them is cyan. Cyan is the player, and the player is not on this
 * screen - the moment a slice takes it the one control stops being findable.
 */
const ACCENT: Record<VerseId, string> = {
    verge: "#a855f7",
    bloom: "#63ffb3",
    kiln: "#ff8a3a",
    null: "#ff2fd0",
};

/**
 * Deterministic scatter.
 *
 * A fixed mulberry32 rather than Math.random: these positions are read at
 * render, and random ones would reshuffle every spore whenever the menu
 * re-renders - which, with a pointer spring feeding it, is often. Seeded means
 * the weather is different per mote but the same on every render.
 */
function scatter(seed: number, count: number): number[] {
    let a = seed >>> 0;
    const out: number[] = [];
    for (let i = 0; i < count; i++) {
        a = (a + 0x6d2b79f5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        out.push(((t ^ (t >>> 14)) >>> 0) / 4294967296);
    }
    return out;
}

/**
 * One verse's ambient weather.
 *
 * Kept deliberately small in element count - a dozen motes per slice, not a
 * particle system - because these are composited over four masked, drifting
 * backdrops on a phone. Each is a positioned dot with its own animation-delay
 * and travel, so a dozen of them read as a field rather than as a row.
 */
function Ambient({ verse }: { verse: VerseId }) {
    if (verse === "verge") {
        // Two shafts on offset clocks, so the hull is never lit by both at once.
        return (
            <>
                {[0, 1].map((i) => (
                    <span
                        key={i}
                        aria-hidden="true"
                        className="absolute inset-y-[-10%] w-[46%] mix-blend-screen"
                        style={{
                            left: i === 0 ? "4%" : "46%",
                            background:
                                "linear-gradient(90deg, transparent, rgba(168,85,247,0.16) 42%, rgba(200,150,255,0.26) 50%, rgba(168,85,247,0.16) 58%, transparent)",
                            animation: `verse-shaft ${26 + i * 9}s linear infinite`,
                            animationDelay: `${i * -13}s`,
                        }}
                    />
                ))}
            </>
        );
    }

    if (verse === "bloom") {
        const r = scatter(0xb100, 14);
        return (
            <>
                {r.slice(0, 14).map((v, i) => {
                    const r2 = r[(i + 5) % r.length];
                    const size = 2 + (v as number) * 3.5;
                    return (
                        <span
                            key={i}
                            aria-hidden="true"
                            className="absolute rounded-full mix-blend-screen"
                            style={{
                                left: `${(v as number) * 100}%`,
                                bottom: `${6 + (r2 as number) * 30}%`,
                                width: size,
                                height: size,
                                background:
                                    "radial-gradient(circle, rgba(190,255,220,0.95), rgba(99,255,179,0) 70%)",
                                "--drift": `${(r2 as number) * 26 - 13}px`,
                                "--travel": `${-90 - (v as number) * 120}px`,
                                animation: `verse-spore ${11 + (r2 as number) * 9}s ease-in-out infinite`,
                                animationDelay: `${-((v as number) * 14)}s`,
                            } as CSSProperties}
                        />
                    );
                })}
                {/* The canopy itself, breathing on a slower clock. */}
                <span
                    aria-hidden="true"
                    className="absolute inset-x-[-10%] bottom-[-6%] h-[34%] mix-blend-screen"
                    style={{
                        background:
                            "radial-gradient(120% 100% at 50% 100%, rgba(99,255,179,0.34), rgba(99,255,179,0) 68%)",
                        animation: "verse-canopy 13s ease-in-out infinite",
                    }}
                />
            </>
        );
    }

    if (verse === "kiln") {
        const r = scatter(0x211, 16);
        return (
            <>
                {r.slice(0, 16).map((v, i) => {
                    const r2 = r[(i + 7) % r.length];
                    const size = 1.5 + (v as number) * 2.5;
                    return (
                        <span
                            key={i}
                            aria-hidden="true"
                            className="absolute rounded-full mix-blend-screen"
                            style={{
                                left: `${(v as number) * 100}%`,
                                bottom: `${-4 + (r2 as number) * 18}%`,
                                width: size,
                                height: size * 1.6,
                                background:
                                    "radial-gradient(circle, rgba(255,220,150,0.95), rgba(255,138,58,0) 72%)",
                                "--drift": `${(r2 as number) * 16 - 8}px`,
                                /* Embers travel further and faster than spores:
                                   hot air goes straight up and does not linger. */
                                "--travel": `${-170 - (v as number) * 150}px`,
                                animation: `verse-ember ${2.6 + (r2 as number) * 3.4}s ease-out infinite`,
                                animationDelay: `${-((v as number) * 5)}s`,
                            } as CSSProperties}
                        />
                    );
                })}
                {/* The furnace band, pulsing on its own clock. */}
                <span
                    aria-hidden="true"
                    className="absolute inset-x-[-10%] bottom-[-8%] h-[28%]"
                    style={{
                        background:
                            "radial-gradient(120% 100% at 50% 100%, rgba(255,138,58,0.42), rgba(122,44,16,0) 70%)",
                        animation: "verse-furnace 7.5s ease-in-out infinite",
                    }}
                />
            </>
        );
    }

    // NULL has no weather - it has failure. The displaced slices and the
    // refresh roll are rendered beside the scanlines in the slice itself,
    // because they belong to the same broken signal rather than to an
    // atmosphere layered over one.
    return null;
}

export default function VerseScenes({
    className,
    focused = null,
}: {
    className?: string;
    /** Index of the verse the player is pointing at, or null. */
    focused?: number | null;
}) {
    return (
        <div
            data-verse-scenes=""
            className={`flex ${className ?? ""}`}
            aria-hidden="true"
        >
            {VERSES.map((verse, index) => {
                const isFocused = focused === index;
                const dimmed = focused !== null && !isFocused;
                return (
                    <div
                        key={verse}
                        data-verse={verse}
                        data-focus={isFocused ? "true" : "false"}
                        data-dimmed={dimmed ? "true" : "false"}
                        className="verse-slice relative flex-1"
                        style={EDGE_MASK}
                    >
                        <div className="verse-depth absolute inset-0">
                            {LAYERS.map((layer) => (
                                <div
                                    key={layer.file}
                                    className="absolute w-full"
                                    style={
                                        {
                                            top: layer.top,
                                            bottom: layer.bottom,
                                            backgroundImage: `url(/verses/${verse}/${layer.file}.${layer.tile ? "webp" : "svg"})`,
                                            backgroundPosition: layer.tile ? "left top" : "bottom center",
                                            backgroundRepeat: layer.tile ? "repeat-x" : "no-repeat",
                                            backgroundSize: layer.tile ? "auto 100%" : "cover",
                                            /* --amp is read by verse-settle / verse-rise
                                               in globals.css, so one pair of keyframes
                                               serves all four layers at four different
                                               travels. */
                                            "--amp": layer.amp,
                                            animation: `${layer.rise ? "verse-rise" : "verse-settle"} ${layer.dur}s ease-in-out infinite alternate`,
                                        } as CSSProperties
                                    }
                                />
                            ))}

                            <Ambient verse={verse} />

                            {/* The Null fails in horizontal bands. It is the one verse
                                whose sky is not weather but a display losing its grip,
                                and flat bands are the only shape that says so at this
                                width. */}
                            {verse === "null" && (
                                <>
                                    <div
                                        className="absolute inset-0"
                                        style={{
                                            backgroundImage:
                                                "repeating-linear-gradient(to bottom, rgba(255,47,208,0.075) 0px, rgba(255,47,208,0.075) 1px, transparent 1px, transparent 5px)",
                                        }}
                                    />
                                    {/* A refresh roll sweeping down once in a while. */}
                                    <div
                                        className="absolute inset-x-0 h-[8%]"
                                        style={{
                                            background:
                                                "linear-gradient(to bottom, transparent, rgba(255,47,208,0.16), rgba(255,255,255,0.10), transparent)",
                                            animation: "verse-roll 9s linear infinite",
                                        }}
                                    />
                                    {/* Displaced slices, stepped rather than eased. */}
                                    {[0, 1, 2].map((i) => (
                                        <div
                                            key={i}
                                            className="absolute inset-x-[-6%]"
                                            style={{
                                                top: `${22 + i * 24}%`,
                                                height: `${4 + i * 3}%`,
                                                background: `linear-gradient(90deg, transparent, ${ACCENT.null}33, transparent)`,
                                                "--gx": `${7 + i * 5}px`,
                                                animation: `verse-glitch ${5 + i * 2.5}s steps(1, end) infinite`,
                                                animationDelay: `${i * -1.7}s`,
                                            } as CSSProperties}
                                        />
                                    ))}
                                </>
                            )}
                        </div>

                        {/* Focus scrim: the slice's own accent rising behind the
                            silhouette when the player points at it. */}
                        <div
                            className="verse-illum absolute inset-0 mix-blend-screen"
                            style={{
                                background: `radial-gradient(120% 80% at 50% 62%, ${ACCENT[verse]}40, transparent 70%)`,
                            }}
                        />

                        {/* Rim light down the inner edge, so the lit slice reads as
                            nearer than its neighbours rather than merely brighter. */}
                        <div
                            className="verse-rim absolute inset-y-[8%] w-px"
                            style={{
                                left: index === VERSES.length - 1 ? "auto" : "0",
                                right: index === VERSES.length - 1 ? "0" : "auto",
                                background: `linear-gradient(to bottom, transparent, ${ACCENT[verse]}, transparent)`,
                            }}
                        />
                    </div>
                );
            })}
        </div>
    );
}
