'use client';

import type { CSSProperties } from "react";

/**
 * The four verses, painted rather than drawn.
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
 * Measured, backdrop animating, 60 being the vsync ceiling rather than an
 * estimate: 60fps at 1440x900 and 60fps at 390x844 on hardware GL, and 60fps
 * at 390x844 in a software rasteriser. The identical page measures 16fps at
 * 1440x900 under SwiftShader - roughly the same figure the canvas it replaced
 * scored there - which is the number to hold in mind before trusting a
 * headless capture. Sixteen masked layers look ruinously expensive in a
 * software rasteriser and cost nothing measurable anywhere a player is.
 */

const VERSES = ["verge", "bloom", "kiln", "null"] as const;

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

export default function VerseScenes({ className }: { className?: string }) {
    return (
        <div
            data-verse-scenes=""
            className={`flex ${className ?? ""}`}
            aria-hidden="true"
        >
            {VERSES.map((verse) => (
                <div
                    key={verse}
                    data-verse={verse}
                    className="relative flex-1"
                    style={EDGE_MASK}
                >
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

                    {/* The Null fails in horizontal bands. It is the one verse
                        whose sky is not weather but a display losing its grip,
                        and flat bands are the only shape that says so at this
                        width. Static on purpose: scanlines that drift read as
                        scrolling, and this world is meant to be stuck. */}
                    {verse === "null" && (
                        <div
                            className="absolute inset-0"
                            style={{
                                backgroundImage:
                                    "repeating-linear-gradient(to bottom, rgba(255,47,208,0.075) 0px, rgba(255,47,208,0.075) 1px, transparent 1px, transparent 5px)",
                            }}
                        />
                    )}
                </div>
            ))}
        </div>
    );
}
