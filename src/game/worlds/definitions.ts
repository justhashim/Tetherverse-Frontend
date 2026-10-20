/**
 * The four verses, and the bleed between them.
 *
 * The game is called Tetherverse and until this file existed there was only one
 * verse in it. A verse is not a level and it is not a difficulty band: it is a
 * skin plus a set of MULTIPLIERS. The distinction is the whole design, and it is
 * forced by game-constants.ts, which says the difficulty bands are the spine of
 * the thing and that every other system reads them rather than deciding for
 * itself.
 *
 * So a verse never owns a number. It owns a ratio. `gravity: 1.16` means "16%
 * heavier than whatever the difficulty dial currently says", not "gravity is
 * 1.62". Move a boundary in ALTITUDE_ZONES, rescale a whole band, or let the
 * difficulty agent rewrite the ramp, and every verse rides the change without a
 * single edit here. If a verse ever needs a base value changed, the answer is a
 * multiplier in this file, not an edit to the dial.
 *
 * The second thing a verse owns is a SKIN, and the skins carry the one hard
 * invariant of the project: `signal` cyan is the player - the tether, the
 * altitude readout, the controls - and no verse touches it. That is why every
 * colour below is described as "not cyan". A verse that could recolour the
 * tether would be a palette swap; a verse that cannot is travel.
 */

/** The four verses, plus the state past all of them. */
export type WorldId = 'VERGE' | 'BLOOM' | 'KILN' | 'NULL' | 'BLEED';

/**
 * The four looks. `BLEED` is not a skin: it is the four of them taking turns,
 * which is why it composes skins rather than declaring a fifth.
 *
 * A skin id is also the cache key for that skin's generated art, so adding one
 * costs exactly one duotone pass and one gradient.
 */
export type SkinId = 'VERGE' | 'BLOOM' | 'KILN' | 'NULL';

/**
 * How a verse modulates the dial.
 *
 * Every field is a multiplier applied to a value read out of GAME_CONSTANTS at
 * the moment of use. None of them are added to, so none of them drift when the
 * base moves.
 */
export interface WorldMultipliers {
    /** Scales WORLD.GRAVITY_Y. > 1 makes the arc read heavier. */
    gravity: number;
    /**
     * Scales platform restitution. Matter resolves a collision with the higher
     * of the two bodies' restitution, and the player's is 0, so this number IS
     * the bounce the player feels. Base platform restitution is 0.05.
     */
    bounce: number;
    /** Scales platform friction. Lower is slicker footing. */
    grip: number;
    /**
     * Scales the presence of the generator's asteroid hazards.
     *
     * LevelGenerator owns the spawn roll and is another agent's file, so density
     * is applied by thinning at the point of use rather than by editing the
     * table. A multiplier above 1 is meaningless here - you cannot thin your way
     * to more asteroids - so a verse that wants MORE danger spends it on its own
     * hazards or on crumble instead.
     */
    hazardDensity: number;
    /**
     * Scales the crumble tables (HAZARD.crumble / HAZARD.riskCrumble).
     *
     * Both directions work: below 1 the verse un-crumbles ledges the generator
     * marked fragile, above 1 it crumbles ledges the generator left solid. The
     * safety net is exempt in both directions where the base exempts it, because
     * turning a recovery platform into a crumbling one removes the last rung of
     * a ladder the difficulty dial deliberately left in place.
     */
    crumbleRate: number;
}

/** Colours a verse may use. None of them are `signal` cyan. */
export interface WorldPalette {
    /** Vertical sky wash, drawn as a screen-fixed gradient behind the props. */
    skyTop: number;
    skyBottom: number;
    skyAlpha: number;
    /** Multiply tint on the nebula tile. White means "unchanged". */
    nebulaTint: number;
    /** Multiply tint on the drifting asteroids and planets. */
    propTint: number;
    /** Duotone endpoints the platform art is remapped to. */
    platformDark: number;
    platformLight: number;
    /** The verse's own colour, for the gate, the flash and the title. */
    accent: number;
    /** The same colour held back, for edges and glow falloff. */
    accentDim: number;
}

/** The four looks, in full. */
export interface WorldSkin {
    id: SkinId;
    name: string;
    tagline: string;
    palette: WorldPalette;
    /** Ambient particle field. One emitter per kind, reused across verses. */
    ambient: 'NONE' | 'SPORES' | 'EMBERS' | 'GLITCH';
    /** Screen-fixed overlay on the world layer. Never above the tether. */
    fx: {
        /** NULL: reality failing, drawn as a repeating scanline tile. */
        scanlines: number;
        /** KILN: heat shimmer, a slow-scrolling additive haze. */
        heat: number;
        /** Corner darkening. Small numbers; this is a mood, not a vignette filter. */
        vignette: number;
    };
}

export interface WorldDefinition {
    id: WorldId;
    skin: WorldSkin;
    multipliers: WorldMultipliers;
}

/* ============================================================================
   The skins
   ============================================================================ */

const VERGE: WorldSkin = {
    id: 'VERGE',
    name: 'VERGE',
    tagline: 'THE ORIGIN VERSE',
    palette: {
        skyTop: 0x050816,
        skyBottom: 0x0b1030,
        skyAlpha: 0,
        // White tints are the identity of "unchanged": a multiply by white is the
        // no-op, and saying so here is what keeps VERGE free of special cases.
        nebulaTint: 0xffffff,
        propTint: 0xffffff,
        platformDark: 0x0a0a14,
        platformLight: 0xffffff,
        accent: 0xa855f7,
        accentDim: 0x6b21a8,
    },
    ambient: 'NONE',
    fx: { scanlines: 0, heat: 0, vignette: 0 },
};

const BLOOM: WorldSkin = {
    id: 'BLOOM',
    name: 'BLOOM',
    tagline: 'THE OVERGROWN VERSE',
    palette: {
        skyTop: 0x02120d,
        skyBottom: 0x0c4a30,
        skyAlpha: 0.62,
        nebulaTint: 0x63ffa8,
        propTint: 0x8affc4,
        // A cold body and a warm glow. Duotone maps shadow to shadow and the
        // platform's neon trim to the light end, so the trim becomes bio-glow
        // without a single platform sprite being redrawn by hand.
        platformDark: 0x0d2f24,
        platformLight: 0x9dffd0,
        accent: 0x63ffb3,
        accentDim: 0x1f7a55,
    },
    ambient: 'SPORES',
    fx: { scanlines: 0, heat: 0, vignette: 0.28 },
};

const KILN: WorldSkin = {
    id: 'KILN',
    name: 'KILN',
    tagline: 'THE MOLTEN VERSE',
    palette: {
        skyTop: 0x0d0605,
        skyBottom: 0x4a1505,
        skyAlpha: 0.66,
        nebulaTint: 0xff9a4d,
        propTint: 0xffab63,
        platformDark: 0x1c1310,
        platformLight: 0xff9d4d,
        accent: 0xff8a3a,
        accentDim: 0x7a2c10,
    },
    ambient: 'EMBERS',
    fx: { scanlines: 0, heat: 0.4, vignette: 0.34 },
};

const NULL: WorldSkin = {
    id: 'NULL',
    name: 'NULL',
    tagline: 'THE COLLAPSING VERSE',
    palette: {
        skyTop: 0x0a0a0e,
        skyBottom: 0x1a1420,
        skyAlpha: 0.55,
        nebulaTint: 0x9a9aa8,
        propTint: 0xb6b0c0,
        // Monochrome with a magenta bleed. The light end is deliberately almost
        // white so the platforms read as photocopied rather than tinted, which is
        // the only way "the world lost its colour" reads at 120px wide.
        platformDark: 0x17141c,
        platformLight: 0xe6e2ee,
        accent: 0xff2fd0,
        accentDim: 0x6b21a8,
    },
    ambient: 'GLITCH',
    fx: { scanlines: 0.22, heat: 0, vignette: 0.4 },
};

export const SKINS: Record<SkinId, WorldSkin> = { VERGE, BLOOM, KILN, NULL };

/* ============================================================================
   The verses
   ============================================================================ */

/**
 * The origin verse is the game as it was, which means its multipliers are all
 * exactly 1. It is not a null entry: it is the control group. If VERGE ever
 * stops feeling like the build before this file, a multiplier has leaked.
 */
const VERGE_WORLD: WorldDefinition = {
    id: 'VERGE',
    skin: VERGE,
    multipliers: { gravity: 1, bounce: 1, grip: 1, hazardDensity: 1, crumbleRate: 1 },
};

/**
 * Soft, springy, alive.
 *
 * Gravity is untouched because BLOOM's difference is in the landing, not the
 * arc: a 3x bounce turns every ledge into a pad, and the 60% crumble reduction
 * is what buys that. The hazard budget the crumble table gives back is spent by
 * the verse itself on sticky pods, which drag the tether rather than kill the
 * run - BLOOM is the verse where you are slowed, not the verse where you die.
 */
const BLOOM_WORLD: WorldDefinition = {
    id: 'BLOOM',
    skin: BLOOM,
    multipliers: { gravity: 1, bounce: 3, grip: 1.1, hazardDensity: 0.7, crumbleRate: 0.4 },
};

/**
 * Heavy, brittle, hot.
 *
 * 16% gravity is the smallest change that makes a swing feel like it is being
 * pulled down rather than merely missing, and it is deliberately paired with a
 * dead bounce: in KILN a landing is a landing, there is no second chance built
 * into the surface. The 1.8x crumble is where "falling debris" comes from - the
 * mountain itself is the debris field - and it is also why the pods of BLOOM
 * have no equivalent here.
 */
const KILN_WORLD: WorldDefinition = {
    id: 'KILN',
    skin: KILN,
    multipliers: { gravity: 1.16, bounce: 0.2, grip: 0.78, hazardDensity: 0.9, crumbleRate: 1.8 },
};

/**
 * Deception itself.
 *
 * The numbers are almost the dial's own, and that is on purpose: NULL's hazard
 * is not a force, it is a lie, so its multipliers stay close to neutral and the
 * illusory platforms do the work. Hazard density drops because the verse has no
 * interest in an asteroid hitting you when a floor can simply not be there.
 */
const NULL_WORLD: WorldDefinition = {
    id: 'NULL',
    skin: NULL,
    multipliers: { gravity: 1, bounce: 1, grip: 0.9, hazardDensity: 0.5, crumbleRate: 1.2 },
};

/**
 * THE BLEED: the four verses no longer take turns, they overlap.
 *
 * The skin rotates and the multipliers escalate on a timer set by WorldManager,
 * so everything below is the STATE AT PHASE ZERO - the mildest blend. The
 * escalation factor multiplies the whole set from there.
 */
const BLEED_WORLD: WorldDefinition = {
    id: 'BLEED',
    skin: VERGE,
    multipliers: { gravity: 1.1, bounce: 1.5, grip: 0.95, hazardDensity: 1, crumbleRate: 1.6 },
};

export const WORLDS: Record<WorldId, WorldDefinition> = {
    VERGE: VERGE_WORLD,
    BLOOM: BLOOM_WORLD,
    KILN: KILN_WORLD,
    NULL: NULL_WORLD,
    BLEED: BLEED_WORLD,
};

/* ============================================================================
   The schedule
   ============================================================================ */

/**
 * Where the gates are, in metres.
 *
 * These three numbers are the pacing of the whole feature and they are the ones
 * worth arguing about. 250m is far enough past the handcrafted tutorial that the
 * first gate is a reward rather than an interruption, and 400m of each verse is
 * roughly forty swings - enough to learn a verse's material, not enough to get
 * bored of it before the next one arrives.
 */
export const FIRST_PORTAL_ALTITUDE = 250;
export const PORTAL_ALTITUDE_INTERVAL = 400;

/**
 * Where the verses stop being separate.
 *
 * 50,000m is deliberately unreachable by ordinary play, which is the point: it
 * is the payoff the endless climb has been promising, not a place anyone farms.
 */
export const BLEED_ALTITUDE = 50000;

/**
 * The order the verses arrive in after VERGE.
 *
 * BLOOM first because it is the kindest material and the hardest idea (the pods
 * teach the player that a verse can touch the tether); KILN second because its
 * hazard is legible; NULL third because by then the player trusts the ground.
 * VERGE returns last so the loop closes on the origin and the contrast is
 * available again.
 */
export const VERSE_ORDER: readonly SkinId[] = ['BLOOM', 'KILN', 'NULL', 'VERGE'];

/**
 * How far above a gate's altitude, in world px, the player may pass before it
 * fires anyway. 550px is ~55m of climb: past that, going back down to swing
 * through the ring is not a challenge the climb supports, so the gate stops
 * being an obstacle and becomes a door. Counted separately from crossings.
 */
export const PORTAL_FALLBACK_MARGIN = 550;

/**
 * Radius, in world px, of the gate a player has to swing through.
 *
 * 210 rather than the first guess of 170 because the closest measured approach
 * on a real swing was 218px centre-to-centre at 61px lateral offset: at 170 the
 * player passed under a gate they had clearly flown at, which reads as a bug
 * rather than as a miss. 420px of ring is legible at the 1024px camera width
 * without filling the screen.
 */
export const PORTAL_RADIUS = 210;

/**
 * How far below the ledge pair's altitude a gate actually hangs.
 *
 * A tether swings you *under* your anchor, never over it, so the flight channel
 * between two ledges sits below the altitude the schedule asks for. Measured on
 * the live route: the player cleared a gate centred exactly on the scheduled
 * altitude by 167px vertically while passing within 5px horizontally. Nudging
 * the ring into the channel turns that from a near miss into a pass-through.
 */
export const PORTAL_CHANNEL_OFFSET = 100;

/** Length of the world re-materialisation, in ms. */
export const TRANSITION_MS = 600;

/** ms into the transition at which the world actually swaps under the flash. */
export const TRANSITION_SWAP_MS = 180;
