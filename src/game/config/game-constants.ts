/**
 * Tuning for the whole game, in one place.
 *
 * The difficulty bands are the spine of the thing: every other system reads
 * them rather than deciding for itself, so moving a boundary in ALTITUDE moves
 * the platform shapes, the crumbling rolls, the hazard density, the weather and
 * the safety net together. Difficulty is one dial with many faces, not five
 * dials that have to be turned in step.
 */

/**
 * Altitude in metres.
 *
 * Altitude is 10px = 1m and platforms sit 120-250px apart (12-25m), so these
 * gates decide how many hops a tier lasts. They are deliberately close
 * together: the mountain is meant to be over before a player has time to settle
 * into a rhythm, and the handcrafted tutorial only covers the first 80m.
 */
export const ALTITUDE_ZONES = {
    INTERMEDIATE_ZONE: 80,    // Altitude (m) where the Intermediate tier begins
    HARD_ZONE: 220,           // Altitude (m) where the Hard tier begins
    EXPERT_ZONE: 520,         // Altitude (m) where the Expert tier begins
    ENDLESS_ZONE: 1000,       // Altitude (m) where the Endless tier begins
} as const;

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
    WORLD: {
        /**
         * Downward acceleration.
         *
         * Higher than it looks like it should be, because the game is about
         * reading a fast arc rather than riding a slow one.
         */
        GRAVITY_Y: 1.4,
    },
    DEATH: {
        /**
         * How far below the bottom of the camera the player must fall before the
         * run ends. Small, because a player who has dropped off the bottom of
         * the screen is not coming back.
         */
        cameraMargin: 10,
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
        GENERATION_WIDTH: 3000,         // Dynamic generation corridor width
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
    ALTITUDE: ALTITUDE_ZONES,
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
            anchorOffsetMax: 40,
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
            anchorOffsetMax: 90,
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
            anchorOffsetMax: 130,
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
            anchorOffsetMax: 160,
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
            anchorOffsetMax: 180,
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
    },
    /**
     * Weather, per tier.
     *
     * The wind pushes sideways and the surge pushes down. Neither is large, but
     * they arrive at the exact moment the player is trying to read a long
     * release, which is what makes a high-altitude run feel different from a
     * low one rather than merely longer.
     *
     * Keyed to the tier, so this and the platform shapes change together.
     */
    ENVIRONMENT: {
        TUTORIAL: { wind: 0, windFrequency: 0, surge: 0 },
        INTERMEDIATE: { wind: 0.0006, windFrequency: 0.0012, surge: 0 },
        HARD: { wind: 0.0010, windFrequency: 0.0016, surge: 0.0003 },
        EXPERT: { wind: 0.0014, windFrequency: 0.0020, surge: 0.0006 },
        ENDLESS: { wind: 0.0018, windFrequency: 0.0024, surge: 0.0009 },
    },
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
        /** Chance a gap long enough to cross carries a patrolling hazard. */
        chance: { TUTORIAL: 0, INTERMEDIATE: 0.40, HARD: 0.40, EXPERT: 0.65, ENDLESS: 0.85 },
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
         * Long enough to hook and begin a swing, not long enough to finish one
         * comfortably. The swing has to be read, not waited out.
         */
        unstableDurationMs: 1600,
    },
};

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

/** The band an altitude falls in. */
export function tierForAltitude(altitudeMeters: number): DifficultyTier {
    const a = ALTITUDE_ZONES;
    if (altitudeMeters < a.INTERMEDIATE_ZONE) return 'TUTORIAL';
    if (altitudeMeters < a.HARD_ZONE) return 'INTERMEDIATE';
    if (altitudeMeters < a.EXPERT_ZONE) return 'HARD';
    if (altitudeMeters < a.ENDLESS_ZONE) return 'EXPERT';
    return 'ENDLESS';
}
