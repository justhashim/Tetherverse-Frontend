import {
    ALTITUDE_ZONES,
    GAME_CONSTANTS,
    type DifficultyProfile,
    type DifficultyTier,
    type EnvironmentState,
    type HazardState,
    type PatternId,
} from './game-constants';

/**
 * The dial.
 *
 * The table in ./game-constants is the mountain as it is at each rung; this is
 * the mountain at an altitude. Everything that gets harder as the climb goes
 * on asks this module and nothing else, so the shape of the ledges, the
 * crumbling rolls, the hazard density, the weather and the safety net are all
 * the same number read five ways.
 *
 * Two rules hold everywhere:
 *
 * - The climb is continuous. Between two rungs the mountain is a blend of the
 *   two, and above the last rung it approaches the roof without a seam. A
 *   player who crosses a boundary meets the same game a metre later, one notch
 *   tighter, never a wall.
 *
 * - The climb never gets kinder. The blend only ever moves from a rung toward
 *   the rung above it, and every rung above is harder than the one below, so
 *   the mountain at an altitude is at least as hard as the mountain the tier
 *   table alone would put there.
 */

/**
 * The rungs, in order.
 *
 * The last rung is where the authored ladder ends and the approach to the roof
 * begins: the shape of the mountain is the Endless shape from here up, and
 * everything else about it keeps closing on the roof.
 */
const RUNGS: ReadonlyArray<{ altitude: number; tier: DifficultyTier }> = [
    { altitude: 0, tier: 'TUTORIAL' },
    { altitude: ALTITUDE_ZONES.INTERMEDIATE_ZONE, tier: 'INTERMEDIATE' },
    { altitude: ALTITUDE_ZONES.HARD_ZONE, tier: 'HARD' },
    { altitude: ALTITUDE_ZONES.EXPERT_ZONE, tier: 'EXPERT' },
    { altitude: ALTITUDE_ZONES.ENDLESS_ZONE, tier: 'ENDLESS' },
];

/**
 * The roof, with every dial that still has room turned all the way over.
 *
 * The dials the roof does not mention keep their Endless values, which is how
 * the shape of the mountain says that it has run out of road.
 */
const ROOF_PROFILE: DifficultyProfile = {
    ...GAME_CONSTANTS.DIFFICULTY.ENDLESS,
    ...GAME_CONSTANTS.ROOF.profile,
};

const ROOF_HAZARD: HazardState = {
    density: GAME_CONSTANTS.ROOF.hazard.density ?? GAME_CONSTANTS.HAZARD.density.ENDLESS,
    crumble: GAME_CONSTANTS.ROOF.hazard.crumble ?? GAME_CONSTANTS.HAZARD.crumble.ENDLESS,
    riskCrumble: GAME_CONSTANTS.ROOF.hazard.riskCrumble ?? GAME_CONSTANTS.HAZARD.riskCrumble.ENDLESS,
    unstableAnchor: GAME_CONSTANTS.ROOF.hazard.unstableAnchor ?? GAME_CONSTANTS.HAZARD.unstableAnchor.ENDLESS,
};

const ROOF_ENVIRONMENT: EnvironmentState = {
    wind: GAME_CONSTANTS.ROOF.environment.wind ?? GAME_CONSTANTS.ENVIRONMENT.ENDLESS.wind,
    windFrequency: GAME_CONSTANTS.ROOF.environment.windFrequency ?? GAME_CONSTANTS.ENVIRONMENT.ENDLESS.windFrequency,
    surge: GAME_CONSTANTS.ROOF.environment.surge ?? GAME_CONSTANTS.ENVIRONMENT.ENDLESS.surge,
};

/**
 * How close the climb is to the roof, as a fraction of the way.
 *
 * The approach is asymptotic, because a mountain that arrives exactly at the
 * roof is a wall and not a climb: the shortfall is squared, so the climb
 * starts flat and bites, and it never quite gets there.
 *
 * The scale is `ROOF.reachMetres`, and it is deliberately short - 150. At
 * that scale the climb has taken three quarters of the way by 1300m and nine
 * tenths by 1500m, so 1500m is where a run ends for almost everyone. The
 * curve is still a slope rather than a cliff: it keeps getting worse after
 * 1500m, it just does so from a place almost no one reaches.
 *
 * It used to be 2000, which put 4.9% of the roof's cruelty at 1500m and made
 * 1500m a distance a good player could plan for rather than a barrier.
 */
function roofPressure(metresAboveRoof: number): number {
    const shortfall = 1 - Math.exp(-metresAboveRoof / GAME_CONSTANTS.ROOF.reachMetres);
    return shortfall * shortfall;
}

function lerp(from: number, to: number, t: number): number {
    return from + (to - from) * t;
}

/**
 * Eases the blend in and out.
 *
 * The rate of change is zero at both ends of a band, so the mountain arrives
 * at a rung and then holds it for a while before it starts climbing again.
 * A straight line between the rungs would put a corner in the difficulty at
 * every boundary, and a corner at a specific metre is exactly the thing a
 * player feels as a wall.
 */
function smoothstep(t: number): number {
    const clamped = t < 0 ? 0 : t > 1 ? 1 : t;
    return clamped * clamped * (3 - 2 * clamped);
}

/**
 * Which two rungs an altitude sits between, and how far between them.
 */
function bracketFor(altitudeMeters: number): { lower: number; upper: number; t: number } {
    if (altitudeMeters <= RUNGS[0].altitude) {
        return { lower: 0, upper: 0, t: 0 };
    }

    for (let i = 0; i < RUNGS.length - 1; i++) {
        const from = RUNGS[i].altitude;
        const to = RUNGS[i + 1].altitude;
        if (altitudeMeters < to) {
            return { lower: i, upper: i + 1, t: (altitudeMeters - from) / (to - from) };
        }
    }

    const last = RUNGS.length - 1;
    return { lower: last, upper: last, t: 1 };
}

function blendProfile(
    from: DifficultyProfile,
    to: DifficultyProfile,
    t: number,
    patterns: readonly PatternId[]
): DifficultyProfile {
    return {
        widthMin: lerp(from.widthMin, to.widthMin, t),
        widthMax: lerp(from.widthMax, to.widthMax, t),
        heightMin: lerp(from.heightMin, to.heightMin, t),
        heightMax: lerp(from.heightMax, to.heightMax, t),
        stepMin: lerp(from.stepMin, to.stepMin, t),
        stepMax: lerp(from.stepMax, to.stepMax, t),
        idealGap: lerp(from.idealGap, to.idealGap, t),
        horizontalRatio: lerp(from.horizontalRatio, to.horizontalRatio, t),
        idealHorizontal: lerp(from.idealHorizontal, to.idealHorizontal, t),
        anchorLiftMin: lerp(from.anchorLiftMin, to.anchorLiftMin, t),
        anchorLiftMax: lerp(from.anchorLiftMax, to.anchorLiftMax, t),
        recoveryChance: lerp(from.recoveryChance, to.recoveryChance, t),
        riskChance: lerp(from.riskChance, to.riskChance, t),
        reliefChance: lerp(from.reliefChance, to.reliefChance, t),
        chainLength: lerp(from.chainLength, to.chainLength, t),
        voidMargin: lerp(from.voidMargin, to.voidMargin, t),
        patterns,
    };
}

/**
 * The shape of the mountain at an altitude.
 *
 * The pattern list is the tier's, because a set cannot be blended: the
 * vocabulary of the mountain changes hands at a rung, and the numbers arrive
 * at the same rung, so the two never disagree.
 */
export function profileForAltitude(altitudeMeters: number): DifficultyProfile {
    if (altitudeMeters >= ALTITUDE_ZONES.ENDLESS_ZONE) {
        const pressure = roofPressure(altitudeMeters - ALTITUDE_ZONES.ENDLESS_ZONE);
        return blendProfile(
            GAME_CONSTANTS.DIFFICULTY.ENDLESS,
            ROOF_PROFILE,
            pressure,
            GAME_CONSTANTS.DIFFICULTY.ENDLESS.patterns
        );
    }

    const bracket = bracketFor(altitudeMeters);
    const from = GAME_CONSTANTS.DIFFICULTY[RUNGS[bracket.lower].tier];
    const to = GAME_CONSTANTS.DIFFICULTY[RUNGS[bracket.upper].tier];

    return blendProfile(from, to, smoothstep(bracket.t), from.patterns);
}

/**
 * The hazard state at an altitude.
 *
 * The same blend as the shape, because a hazard that arrives at a different
 * rate than the mountain it is hiding in is a hazard the player cannot read.
 */
export function hazardStateForAltitude(altitudeMeters: number): HazardState {
    if (altitudeMeters >= ALTITUDE_ZONES.ENDLESS_ZONE) {
        const pressure = roofPressure(altitudeMeters - ALTITUDE_ZONES.ENDLESS_ZONE);
        return {
            density: lerp(GAME_CONSTANTS.HAZARD.density.ENDLESS, ROOF_HAZARD.density, pressure),
            crumble: lerp(GAME_CONSTANTS.HAZARD.crumble.ENDLESS, ROOF_HAZARD.crumble, pressure),
            riskCrumble: lerp(GAME_CONSTANTS.HAZARD.riskCrumble.ENDLESS, ROOF_HAZARD.riskCrumble, pressure),
            unstableAnchor: lerp(GAME_CONSTANTS.HAZARD.unstableAnchor.ENDLESS, ROOF_HAZARD.unstableAnchor, pressure),
        };
    }

    const bracket = bracketFor(altitudeMeters);
    const from = GAME_CONSTANTS.HAZARD;
    const lower = RUNGS[bracket.lower].tier;
    const upper = RUNGS[bracket.upper].tier;
    const t = smoothstep(bracket.t);

    return {
        density: lerp(from.density[lower], from.density[upper], t),
        crumble: lerp(from.crumble[lower], from.crumble[upper], t),
        riskCrumble: lerp(from.riskCrumble[lower], from.riskCrumble[upper], t),
        unstableAnchor: lerp(from.unstableAnchor[lower], from.unstableAnchor[upper], t),
    };
}

/**
 * The weather at an altitude.
 *
 * Read against the live altitude rather than the peak, so a player who has
 * fallen out of the thin air gets a moment of calm to climb back into it.
 * The mountain's shape is keyed to the peak and does not soften.
 */
export function environmentForAltitude(altitudeMeters: number): EnvironmentState {
    if (altitudeMeters >= ALTITUDE_ZONES.ENDLESS_ZONE) {
        const pressure = roofPressure(altitudeMeters - ALTITUDE_ZONES.ENDLESS_ZONE);
        return {
            wind: lerp(GAME_CONSTANTS.ENVIRONMENT.ENDLESS.wind, ROOF_ENVIRONMENT.wind, pressure),
            windFrequency: lerp(GAME_CONSTANTS.ENVIRONMENT.ENDLESS.windFrequency, ROOF_ENVIRONMENT.windFrequency, pressure),
            surge: lerp(GAME_CONSTANTS.ENVIRONMENT.ENDLESS.surge, ROOF_ENVIRONMENT.surge, pressure),
        };
    }

    const bracket = bracketFor(altitudeMeters);
    const from = GAME_CONSTANTS.ENVIRONMENT;
    const lower = RUNGS[bracket.lower].tier;
    const upper = RUNGS[bracket.upper].tier;
    const t = smoothstep(bracket.t);

    return {
        wind: lerp(from[lower].wind, from[upper].wind, t),
        windFrequency: lerp(from[lower].windFrequency, from[upper].windFrequency, t),
        surge: lerp(from[lower].surge, from[upper].surge, t),
    };
}
