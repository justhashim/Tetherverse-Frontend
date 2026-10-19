import { tierForAltitude, type DifficultyTier } from './game-constants';

/**
 * The bands of altitude, named.
 *
 * These names are the same everywhere: the HUD reads them while the player is
 * climbing, and the menu reads them to say how far a player's best climb
 * reached. They used to be defined twice, with different boundaries, so the
 * menu could call a 600m best an Exosphere while the game was still calling
 * 600m the Stratosphere. One table, one answer.
 */
export const STRATA = [
    'SURFACE',
    'TROPOSPHERE',
    'STRATOSPHERE',
    'MESOSPHERE',
    'EXOSPHERE',
] as const;

export type Stratum = typeof STRATA[number];

const STRATUM_BY_TIER: Record<DifficultyTier, Stratum> = {
    TUTORIAL: 'SURFACE',
    INTERMEDIATE: 'TROPOSPHERE',
    HARD: 'STRATOSPHERE',
    EXPERT: 'MESOSPHERE',
    ENDLESS: 'EXOSPHERE',
};

/** The band an altitude falls in. */
export function stratumForAltitude(altitudeMeters: number): Stratum {
    return STRATUM_BY_TIER[tierForAltitude(altitudeMeters)];
}
