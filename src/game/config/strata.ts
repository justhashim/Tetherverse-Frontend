import { tierForAltitude, type DifficultyTier } from './game-constants';

/**
 * The bands of altitude, named.
 *
 * These names are the same everywhere: the HUD reads them while the player is
 * climbing, and the menu reads them to say how far a player's best climb
 * reached. They used to be defined twice, with different boundaries, so the
 * menu could call a 600m best an Exosphere while the game was still calling
 * 600m the Stratosphere. One table, one answer.
 *
 * The first five names are the difficulty bands, so the name follows the
 * mountain's shape automatically. The ladder of difficulty ends at the roof,
 * but the climb does not, and a name that stopped changing would be a lie
 * told to the player about where they are - so the names carry on above the
 * roof in the table below.
 */
export const STRATA = [
    'SURFACE',
    'TROPOSPHERE',
    'STRATOSPHERE',
    'MESOSPHERE',
    'EXOSPHERE',
    'THERMOSPHERE',
    'KARMAN LINE',
    'LOW ORBIT',
    'DEEP SPACE',
    'THE VOID',
] as const;

export type Stratum = typeof STRATA[number];

const STRATUM_BY_TIER: Record<DifficultyTier, Stratum> = {
    TUTORIAL: 'SURFACE',
    INTERMEDIATE: 'TROPOSPHERE',
    HARD: 'STRATOSPHERE',
    EXPERT: 'MESOSPHERE',
    ENDLESS: 'EXOSPHERE',
};

/**
 * The names above the roof, and the altitudes they start at.
 *
 * The boundaries land where the climb changes character: the weather starts
 * to bite, the air runs out, the ground stops being a place and becomes a
 * direction, and eventually there is nothing under the player at all.
 */
const UPPER_STRATA: ReadonlyArray<{ from: number; name: Stratum }> = [
    { from: 2000, name: 'THERMOSPHERE' },
    { from: 5000, name: 'KARMAN LINE' },
    { from: 12000, name: 'LOW ORBIT' },
    { from: 35000, name: 'DEEP SPACE' },
    { from: 100000, name: 'THE VOID' },
];

/** The band an altitude falls in. */
export function stratumForAltitude(altitudeMeters: number): Stratum {
    const tier = tierForAltitude(altitudeMeters);
    if (tier !== 'ENDLESS') {
        return STRATUM_BY_TIER[tier];
    }

    // Searched from the top down: the table is written in the order a player
    // climbs through it, and the last band an altitude has reached is the one
    // that names it.
    for (let i = UPPER_STRATA.length - 1; i >= 0; i--) {
        if (altitudeMeters >= UPPER_STRATA[i].from) {
            return UPPER_STRATA[i].name;
        }
    }

    return STRATUM_BY_TIER.ENDLESS;
}
