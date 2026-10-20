/**
 * Tuning for the whole game, in one place.
 *
 * The difficulty bands are the spine of the thing: every other system reads
 * them rather than deciding for itself, so moving a boundary in ALTITUDE moves
 * the platform shapes, the crumbling rolls, the hazard density, the weather and
 * the safety net together. Difficulty is one dial with many faces, not five
 * dials that have to be turned in step.
 *
 * The bands are rungs on a ladder rather than steps. A rung is an altitude and
 * the mountain as it stands there; the ground between two rungs is a blend of
 * the two, because a player who crosses a boundary must not meet a wall. The
 * blend lives in ./difficulty, which is the only thing that reads this table
 * and the only thing that decides what the mountain is at a given altitude.
 */

/**
 * Altitude in metres.
 *
 * Altitude is 10px = 1m and platforms sit 120-250px apart (12-25m), so these
 * gates decide how many hops a tier lasts. They are deliberately close
 * together: the mountain is meant to be over before a player has time to settle
 * into a rhythm, and the handcrafted tutorial only covers the first 80m.
 *
 * These are the rungs. A rung holds the authored shape of the mountain at that
 * altitude, and the climb between two rungs is a blend of the two, so the
 * numbers here are the numbers the mountain passes through on its way up.
 */
export const ALTITUDE_ZONES = {
    INTERMEDIATE_ZONE: 80,    // Altitude (m) where the Intermediate tier begins
    HARD_ZONE: 220,           // Altitude (m) where the Hard tier begins
    EXPERT_ZONE: 520,         // Altitude (m) where the Expert tier begins
    ENDLESS_ZONE: 1000,       // Altitude (m) where the Endless tier begins
} as const;

/**
 * The vocabulary of the mountain's movement.
 *
 * A pattern is a rhythm rather than a number, so it cannot be blended the way
 * the rest of the profile is: a set either has a pattern in it or it does not.
 * The pattern list belongs to the tier, which changes at a rung, and the
 * numbers arrive at the same rung - so the vocabulary and the shape of the
 * mountain always change hands together.
 */
export type PatternId =
    | "STRAIGHT_ASCENT"
    | "LEFT_SWING"
    | "RIGHT_SWING"
    | "ZIGZAG"
    | "WIDE_SWING"
    | "TIGHT_PRECISION"
    | "HOOK_CHAIN"
    | "VERTICAL_SHAFT"
    | "OFFSET_LANDING"
    | "LONG_RELEASE"
    | "HIGH_RISK_SHORTCUT"
    | "SWITCHBACK"
    | "RECOVERY_ROUTE";

/**
 * The shape of the mountain at one altitude.
 *
 * Every field here is a face of the same dial, and they are read together:
 * moving one boundary in ALTITUDE moves all of them at once, which is the
 * whole point of keeping them in one table.
 */
export interface DifficultyProfile {
    widthMin: number;
    widthMax: number;
    heightMin: number;
    heightMax: number;
    stepMin: number;
    stepMax: number;
    idealGap: number;
    horizontalRatio: number;
    idealHorizontal: number;
    anchorLiftMin: number;
    anchorLiftMax: number;
    recoveryChance: number;
    riskChance: number;
    reliefChance: number;
    chainLength: number;
    voidMargin: number;
    patterns: readonly PatternId[];
}

/**
 * How likely the things that end a run are to be there.
 *
 * A presence rather than a shape: a crumbling ledge, a patrolling asteroid, an
 * anchor that gives way. Blended the same way the profile is, so a hazard
 * arrives at the same rate the mountain it is hiding in gets worse.
 */
export interface HazardState {
    /** How many hazards a gap carries, on average. */
    density: number;
    /** Chance an ordinary ledge crumbles under a footfall. */
    crumble: number;
    /** Chance a ledge on the risk line crumbles. */
    riskCrumble: number;
    /** Chance a hook anchor gives way when it is used. */
    unstableAnchor: number;
}

/**
 * The weather at one altitude.
 *
 * The wind pushes sideways and the surge pushes down. Neither is large, but
 * they arrive at the exact moment the player is trying to read a long
 * release, which is what makes a high-altitude run feel different from a
 * low one rather than merely longer.
 */
export interface EnvironmentState {
    wind: number;
    windFrequency: number;
    surge: number;
}

/**
 * The bands of difficulty, in order.
 *
 * A tier is chosen from the highest altitude a run has reached rather than the
 * altitude it is at, so falling never makes the mountain kinder.
 */
export const DIFFICULTY_TIERS = [
    'TUTORIAL',
    'INTERMEDIATE',
    'HARD',
    'EXPERT',
    'ENDLESS',
] as const;

export type DifficultyTier = typeof DIFFICULTY_TIERS[number];

export const GAME_CONSTANTS = {
    PLAYER: {
        RADIUS: 24,
        DENSITY: 0.004, // Matter.js automatically calculates mass based on area * density
        FRICTION: 0.1,
        FRICTION_STATIC: 0.5,
        FRICTION_AIR: 0.02,
        BOUNCE: 0,      // Restitution (0 so Jack settles without bouncing off surfaces)
    },
    SWING: {
        /**
         * Tether spring stiffness (lower = softer pull).
         *
         * Soft on purpose. A stiff rope turns the swing into a pendulum and the
         * player into a passenger; a slack one has to be pumped, and pumping is
         * the skill the game is about.
         */
        CONSTRAINT_STIFFNESS: 0.06,
        /**
         * Swing acceleration pump.
         *
         * This is the only energy the player is given for free, so it is the
         * smallest number in the game. Everything past the first rotation has
         * to be earned by timing the release.
         */
        DRIVE_FORCE: 0.024,
        MAX_SWING_SPEED: 14,             // Speed ceiling while hooked to keep swings manageable
        FRICTION_AIR: 0.025,             // Air drag while hooked/swinging (balanced momentum)
        FALLING_FRICTION_AIR: 0.045,    // Air drag during free-fall/launch (predictable arcs)
        LAUNCH_BOOST: 1.0,               // No free momentum on release: the swing ends where it ended
        MAX_LAUNCH_SPEED: 16,            // Hard cap on released launch velocity
    },
    LANDING: {
        /**
         * Max total speed allowed for a settle-to-IDLE landing.
         *
         * Below this, the player sticks. Above it, they bounce off and slide,
         * which on a narrow platform is the difference between a landing and a
         * fall past it.
         */
        SPEED_THRESHOLD: 5,
    },
    /**
     * The tether, and what it costs to hurt it.
     *
     * The tether is the only tool the player has and the only thing they are
     * holding, so it is where a consequence belongs: the damage is on the
     * rope in their hands, not on a number they are not looking at. A frayed
     * rope is a longer rope - it pays out under the load - so the swing it
     * holds is a bigger, lower arc and the release comes from further down.
     *
     * The player is not killed for hitting something. They are handed a worse
     * swing for the next ten seconds, which is a punishment they can climb
     * out of, and a rope that re-braids itself afterwards.
     */
    TETHER: {
        /** How much one impact frays the rope. Three of them is the worst of it. */
        frayPerHit: 0.34,
        /** The most the rope can be frayed. */
        maxFray: 1,
        /** How much longer the rope is when it is frayed all the way, as a fraction. */
        stretchAtMaxFray: 0.35,
        /**
         * How fast the rope re-braids itself, in frays per second.
         *
         * Slow on purpose. The damage has to outlast the swing it happened
         * in, or it is not a consequence but a hiccup.
         */
        repairPerSecond: 0.05,
    },
    WORLD: {
        /**
         * Downward acceleration.
         *
         * Higher than it looks like it should be, because the game is about
         * reading a fast arc rather than riding a slow one.
         */
        GRAVITY_Y: 1.4,
        /**
         * How tall the world is, in pixels.
         *
         * The climb has no ceiling. The score column is a 32-bit integer, so
         * the tallest run the server will keep is 2,147,483,647m, which at
         * 10px to the metre is 2.1e10 pixels above the ground - and the world
         * has to be able to hold a player who gets there. The walls are the only
         * part of the Matter world with an extent, so they are drawn at a
         * height no run will reach: their job is to stop a player who has
         * drifted sideways from leaving the mountain, and they have to do that
         * at every altitude.
         */
        BOUNDS_HEIGHT: 2e11,
        /**
         * The tallest climb the server will store, in metres.
         *
         * The altitude itself is a plain number and keeps counting past this,
         * but a score is an integer column and a value that does not fit in it
         * is a score that was never saved. The run reports the truth; the
         * submission is the part that has to fit.
         */
        MAX_ALTITUDE_METERS: 2147483647,
    },
    DEATH: {
        /**
         * Height, in metres, that counts as having climbed.
         *
         * Below this, a fall back to the base is a stumble rather than a lost
         * run, so the run does not end on a mistake made in the first few
         * jumps.
         */
        climbMetres: 20,
    },
    PROCEDURAL: {
        ROPE_LENGTH: 380,               // Max tether reach (matches PivotEngine.ropeLength)
        PLATFORM_REACH: 360,            // Reachable center-to-center distance band
        GENERATION_AHEAD: 1800,         // Distance-based lookahead kept above the player
        TARGET_SPACING: 200,            // Desired spacing between platforms
        MIN_FUTURE_PLATFORMS: 6,        // Minimum future platforms kept alive ahead
        MIN_VERTICAL_GAP: 120,          // Minimum vertical separation between route platforms
        MAX_VERTICAL_GAP: 270,          // Maximum vertical separation
        MIN_HORIZONTAL_GAP: 80,         // Minimum sideways travel per platform (allows tighter vertical ascents)
        MAX_HORIZONTAL_GAP: 320,        // Maximum sideways travel per platform
        CORRIDOR_MIN_X: 450,            // Mountain left boundary for switchbacks
        CORRIDOR_MAX_X: 2750,           // Mountain right boundary for switchbacks
        CANDIDATE_COUNT: 12,            // Candidates sampled per placement
        MAX_CANDIDATE_ATTEMPTS: 5,      // Retry rounds before fallback
        MAX_GENERATED_PER_FRAME: 4,     // Work cap per frame
        CULL_DISTANCE: 3000,            // Destroy platforms/hooks this far below the player
    },
    DIFFICULTY: {
        // Width ranges are the BasePlatform width parameter (~visual width / 2).
        // Every band is hard-capped by PROCEDURAL.PLATFORM_REACH so a tier can never
        // generate a physically impossible platform.
        TUTORIAL: {
            widthMin: 60, widthMax: 80,             // visual ~120-160
            heightMin: 30, heightMax: 48,           // tall, forgiving landings
            stepMin: 140, stepMax: 185,             // meaningful rhythm climb
            idealGap: 155,                          // spacing score target
            horizontalRatio: 0.50,                  // fraction of reach usable sideways
            idealHorizontal: 120,                   // horizontal score target
            anchorLiftMin: 140, anchorLiftMax: 200,
            recoveryChance: 0.30,                   // authored recovery riders
            riskChance: 0,                          // tutorial never introduces risk
            reliefChance: 1,                        // every breather slot is a real breather
            chainLength: 4,                         // platforms per adrenaline beat
            voidMargin: 220,                        // forgiving death-void
            patterns: [
                'STRAIGHT_ASCENT',
                'LEFT_SWING',
                'RIGHT_SWING',
                'ZIGZAG',
                'SWITCHBACK',
            ] as const,
        },
        INTERMEDIATE: {
            widthMin: 42, widthMax: 62,             // visual ~84-124
            heightMin: 26, heightMax: 44,
            stepMin: 155, stepMax: 205,
            idealGap: 175,
            horizontalRatio: 0.72,
            idealHorizontal: 145,
            anchorLiftMin: 175, anchorLiftMax: 255,
            recoveryChance: 0.10,                   // the safety net starts thinning out
            riskChance: 1,
            reliefChance: 0.8,
            chainLength: 4,
            voidMargin: 150,
            patterns: [
                'STRAIGHT_ASCENT',
                'LEFT_SWING',
                'RIGHT_SWING',
                'ZIGZAG',
                'WIDE_SWING',
                'HOOK_CHAIN',
                'OFFSET_LANDING',
                'SWITCHBACK',
                'VERTICAL_SHAFT',
            ] as const,
        },
        HARD: {
            widthMin: 34, widthMax: 50,             // visual ~68-100
            heightMin: 24, heightMax: 40,
            stepMin: 170, stepMax: 225,
            idealGap: 190,
            horizontalRatio: 0.85,
            idealHorizontal: 158,
            anchorLiftMin: 205, anchorLiftMax: 305,
            recoveryChance: 0.04,                   // a missed jump is now usually a lost run
            riskChance: 1,
            reliefChance: 0.55,
            chainLength: 4,
            voidMargin: 115,
            patterns: [
                'STRAIGHT_ASCENT',
                'ZIGZAG',
                'WIDE_SWING',
                'TIGHT_PRECISION',
                'HOOK_CHAIN',
                'OFFSET_LANDING',
                'LONG_RELEASE',
                'VERTICAL_SHAFT',
                'SWITCHBACK',
            ] as const,
        },
        EXPERT: {
            widthMin: 30, widthMax: 44,             // visual ~60-88 (precision landing)
            heightMin: 22, heightMax: 36,
            stepMin: 180, stepMax: 240,
            idealGap: 205,
            horizontalRatio: 0.92,
            idealHorizontal: 168,
            anchorLiftMin: 235, anchorLiftMax: 335,
            recoveryChance: 0.02,                   // the net is all but gone
            riskChance: 1,
            reliefChance: 0.3,
            chainLength: 5,
            voidMargin: 90,
            patterns: [
                'ZIGZAG',
                'WIDE_SWING',
                'TIGHT_PRECISION',
                'HOOK_CHAIN',
                'OFFSET_LANDING',
                'LONG_RELEASE',
                'VERTICAL_SHAFT',
                'HIGH_RISK_SHORTCUT',
                'SWITCHBACK',
                'RECOVERY_ROUTE',
            ] as const,
        },
        ENDLESS: {
            widthMin: 26, widthMax: 38,             // visual ~52-76, barely wider than the player
            heightMin: 20, heightMax: 32,
            stepMin: 190, stepMax: 250,
            idealGap: 215,
            horizontalRatio: 0.98,
            idealHorizontal: 178,
            anchorLiftMin: 245, anchorLiftMax: 345,
            recoveryChance: 0,                      // no safety net at all
            riskChance: 1,
            reliefChance: 0.12,
            chainLength: 5,
            voidMargin: 60,                         // the void is right under your feet
            patterns: [
                'ZIGZAG',
                'WIDE_SWING',
                'TIGHT_PRECISION',
                'HOOK_CHAIN',
                'OFFSET_LANDING',
                'LONG_RELEASE',
                'VERTICAL_SHAFT',
                'HIGH_RISK_SHORTCUT',
                'SWITCHBACK',
                'RECOVERY_ROUTE',
            ] as const,
        },
    } satisfies Record<DifficultyTier, DifficultyProfile>,
    /**
     * The roof of the climb.
     *
     * The ladder cannot climb for ever, and the shape is the reason. A ledge
     * narrower than the player cannot be landed on at all, so by the time the
     * mountain reaches the roof the width has run out of room and the safety
     * net and the void and the weather are already at their worst.
     *
     * What is left is how much of the mountain is trying to kill you at once,
     * and that has plenty of room left in it. These are the numbers the climb
     * is heading for, and the climb approaches them asymptotically: the
     * mountain never quite stops getting worse and never becomes unwinnable.
     *
     * Only the dials that still have somewhere to go are listed. Anything
     * missing from here holds at the Endless value, which is how the shape
     * says that it has run out.
     */
    ROOF: {
        /**
         * The scale of the approach, in metres.
         *
         * Small, and that is the whole dial. Pressure is (1 - e^-d/reach)², so
         * this is the distance over which the mountain closes on the roof, and
         * at 150 the climb has taken:
         *
         *   1100m -> 24%     1400m -> 87%
         *   1200m -> 54%     1500m -> 93%
         *   1300m -> 75%     1600m -> 96%
         *
         * So 1500m is where the run ends for almost everyone, which is the
         * point. The curve is still asymptotic, so the end is a slope that
         * steepens under a player rather than a wall they hit at a named metre
         * - they can always see how they died and what the next notch would
         * have been.
         *
         * At 2000 this read 4.9% at 1500m, which is why 1500m used to be a
         * distance rather than a barrier: a player needed to reach 3000m to
         * meet even 40% of what is here.
         */
        reachMetres: 150,
        profile: {
            widthMax: 34,                          // the narrow end is already as narrow as it can be
            heightMin: 14, heightMax: 20,          // thinnest ledges the landing can still forgive
            stepMin: 230, stepMax: 310,            // long flights with nothing to correct against
            idealGap: 300,
            horizontalRatio: 1,
            idealHorizontal: 265,
            anchorLiftMin: 320, anchorLiftMax: 450, // anchors out of reach, so every save is a stretch
            recoveryChance: 0,                     // there was never a net up here
            riskChance: 1,
            reliefChance: 0,                       // no breather at all
            chainLength: 8,                        // long unbroken sequences
            voidMargin: 12,                        // the void is under your feet
        } satisfies Partial<DifficultyProfile>,
        hazard: {
            density: 2.2,                          // every gap, most of them twice
            crumble: 0.8,                          // an ordinary ledge is more likely to go than to hold
            riskCrumble: 1,                        // the risk line is always fatal
            unstableAnchor: 1,                     // every anchor lets go
        } satisfies Partial<HazardState>,
        environment: {
            wind: 0.005,
            windFrequency: 0.0055,
            surge: 0.0032,
        } satisfies Partial<EnvironmentState>,
    },
    /**
     * Weather, per tier.
     *
     * Keyed to the tier, so this and the platform shapes change together.
     */
    ENVIRONMENT: {
        TUTORIAL: { wind: 0, windFrequency: 0, surge: 0 },
        INTERMEDIATE: { wind: 0.0006, windFrequency: 0.0012, surge: 0 },
        HARD: { wind: 0.0010, windFrequency: 0.0016, surge: 0.0003 },
        EXPERT: { wind: 0.0014, windFrequency: 0.0020, surge: 0.0006 },
        ENDLESS: { wind: 0.0018, windFrequency: 0.0024, surge: 0.0009 },
    } satisfies Record<DifficultyTier, EnvironmentState>,
    /**
     * How likely the things that end a run are to be there.
     *
     * These sit outside the difficulty profiles because they are not a shape
     * but a presence: a crumbling ledge, a patrolling asteroid, an anchor that
     * gives way.
     *
     * Every table is complete across all five tiers. The tutorial's entries are
     * zero, which is the point: the mountain does not start fighting back until
     * the player has been taught how to fight.
     */
    HAZARD: {
        /**
         * How many patrolling hazards a gap carries, on average.
         *
         * A number rather than a chance, so that a world with more hazards
         * in it can be more hazardous without the number running out of room:
         * 0.4 means four gaps in ten carry one, and 1.4 means every gap
         * carries one and some of them carry two.
         */
        density: { TUTORIAL: 0, INTERMEDIATE: 0.40, HARD: 0.40, EXPERT: 0.65, ENDLESS: 0.85 },
        /** Shortest gap that can hold a hazard. Shorter gaps cannot be patrolled safely. */
        minGap: 150,
        /** Chance an ordinary ledge crumbles under a footfall. */
        crumble: { TUTORIAL: 0, INTERMEDIATE: 0.16, HARD: 0.16, EXPERT: 0.30, ENDLESS: 0.30 },
        /** Chance a ledge on the risk line crumbles. */
        riskCrumble: { TUTORIAL: 0, INTERMEDIATE: 0.35, HARD: 0.35, EXPERT: 0.50, ENDLESS: 0.50 },
        /** Chance a hook anchor gives way when it is used. */
        unstableAnchor: { TUTORIAL: 0, INTERMEDIATE: 0.30, HARD: 0.50, EXPERT: 0.65, ENDLESS: 0.80 },
        /**
         * How long an unstable anchor holds before it lets go, in milliseconds.
         *
         * Short enough that a hook has to be spent immediately: there is no
         * hanging on to read the swing, because hanging on is now the thing
         * that kills you. Long enough that a correct hook still completes -
         * this is the roof, not a dead end.
         */
        unstableDurationMs: 1000,
    } satisfies {
        density: Record<DifficultyTier, number>;
        minGap: number;
        crumble: Record<DifficultyTier, number>;
        riskCrumble: Record<DifficultyTier, number>;
        unstableAnchor: Record<DifficultyTier, number>;
        unstableDurationMs: number;
    },
};

/** The band an altitude falls in. */
export function tierForAltitude(altitudeMeters: number): DifficultyTier {
    const a = ALTITUDE_ZONES;
    if (altitudeMeters < a.INTERMEDIATE_ZONE) return 'TUTORIAL';
    if (altitudeMeters < a.HARD_ZONE) return 'INTERMEDIATE';
    if (altitudeMeters < a.EXPERT_ZONE) return 'HARD';
    if (altitudeMeters < a.ENDLESS_ZONE) return 'EXPERT';
    return 'ENDLESS';
}
