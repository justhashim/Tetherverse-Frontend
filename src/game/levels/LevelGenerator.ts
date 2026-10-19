import Phaser from "phaser";
import { BasePlatform } from "../terrain/BasePlatform";
import { CosmicHazard } from "../terrain/CosmicHazard";
import { Coin } from "../terrain/Coin";
import { GAME_CONSTANTS, type DifficultyProfile, type PatternId } from "../config/game-constants";
import { hazardStateForAltitude, profileForAltitude } from "../config/difficulty";
import { stratumForAltitude } from "../config/strata";
import { COLLISION_CHANNELS } from "../config/physics-channels";
import { createSeededRng, type Rng } from "./seeded-random";

type Beat =
    | "SAFE"
    | "CHALLENGE"
    | "RISK"
    | "RELIEF"
    | "HIGH_RISK"
    | "MAJOR_CLIMB";

/**
 * How a rhythm of movement bends the profile of the mountain.
 *
 * A pattern is a shape of climb rather than a number, so it scales the
 * profile the tier is holding rather than replacing it: a wide swing asks
 * more of the reach, a tight one asks for a narrower ledge, and a chain puts
 * two anchors in the air where there would otherwise be one.
 */
interface PatternSpec {
    spread: number;            // horizontal spread preference
    stepScale: number;         // vertical gap rhythm multiplier
    widthScale: number;        // platform width multiplier
    anchorLiftScale: number;
    isChain: boolean;          // spawns a 2-anchor mid-air chain for aerial flow
    risk: boolean;             // high-risk shortcut
    recovery: boolean;         // prefers an authored recovery rider
}

interface Candidate {
    x: number;
    y: number;
    width: number;
    height: number;
}

interface ScoredCandidate {
    candidate: Candidate;
    score: number;
}

/**
 * Visual width at which a risk platform starts paying a second coin.
 *
 * Thresholds are in display pixels, which is what `setDisplaySize` actually sets:
 * the generator works in half-widths and `BasePlatform` doubles them, so a
 * `widthMax` of 95 arrives here as 190.
 *
 * Wider platforms get a second coin because there is room for it. A coin is 34px
 * and two coins on a 90px ledge would overlap into an unreadable smear, which is
 * why this is a width test rather than a per-tier bonus.
 */
const COIN_SECOND_AT_WIDTH = 130;

const BEAT_SEQUENCE: Beat[] = [
    "SAFE",
    "CHALLENGE",
    "RISK",
    "RELIEF",
    "CHALLENGE",
    "HIGH_RISK",
    "MAJOR_CLIMB",
    "RELIEF",
];

const TUTORIAL_HOOKS: ReadonlyArray<{
    platformX: number;
    yOffset: number;
    horizontalOffset: number;
    ropeLength: number;
}> = [
        { platformX: 250, yOffset: 20, horizontalOffset: 140, ropeLength: 300 },
        { platformX: 450, yOffset: -150, horizontalOffset: 280, ropeLength: 410 },
        { platformX: 800, yOffset: -300, horizontalOffset: 300, ropeLength: 440 },
        { platformX: 1150, yOffset: -450, horizontalOffset: 320, ropeLength: 470 },
        { platformX: 1550, yOffset: -650, horizontalOffset: 340, ropeLength: 500 },
    ];

export class LevelGenerator {
    private readonly scene: Phaser.Scene;
    private readonly platforms: BasePlatform[];
    private readonly hookNodes: Phaser.Physics.Matter.Image[] = [];
    private readonly hazards: CosmicHazard[] = [];
    private readonly coins: Coin[] = [];
    private readonly rng: Rng;
    private readonly maxReach: number;
    private readonly ropeLength: number;

    private headX: number;
    private headY: number;
    private readonly groundReferenceY: number;
    private prevHeight: number = 35;
    private committedCount: number = 0;
    private lastPattern: PatternId | null = null;
    private currentProfile: DifficultyProfile;
    /**
     * Highest altitude reached this run. Difficulty is selected from this rather
     * than from the live altitude, so falling never makes the mountain kinder.
     *
     * A single launch can carry a player across a whole tier, so keying off the
     * live altitude let a strong player reach the top band without a single
     * platform being generated for the bands in between.
     */
    private peakAltitudeMeters: number = 0;
    private currentDirection: number = 1; // 1 = ascending rightward, -1 = ascending leftward
    private stepsInDirection: number = 0;

    constructor(
        scene: Phaser.Scene,
        platforms: BasePlatform[],
        seed: number,
        groundReferenceY: number
    ) {
        this.scene = scene;
        this.platforms = platforms;
        this.rng = createSeededRng(seed);
        this.maxReach = GAME_CONSTANTS.PROCEDURAL.PLATFORM_REACH;
        this.ropeLength = GAME_CONSTANTS.PROCEDURAL.ROPE_LENGTH;
        this.groundReferenceY = groundReferenceY;
        this.currentProfile = profileForAltitude(0);

        // Handoff platform: positioned where Hook 4's swing arc lands (~2150, groundReferenceY - 780)
        const handoffPlatform = new BasePlatform(
            this.scene,
            2150,
            groundReferenceY - 780,
            140,
            35,
            { friction: 0.9, restitution: 0.05 }
        );
        this.platforms.push(handoffPlatform);

        this.headX = 2150;
        this.headY = groundReferenceY - 780;
        this.prevHeight = 35;
    }

    public get voidMargin(): number {
        return this.currentProfile.voidMargin;
    }

    /**
     * Determines the macro climb direction (-1 for left, 1 for right, 0 for vertical)
     * of the next reachable platform immediately above the player's current position.
     * This provides a stable, player-relative lookahead that never flutters with
     * platforms generated thousands of pixels ahead in the procedural queue.
     */
    public getRouteDirectionNear(playerX: number, playerY: number): number {
        let closestAbove: BasePlatform | null = null;
        let closestDist = Infinity;

        for (const p of this.platforms) {
            if (!p || !p.active || !p.body) continue;
            const dy = playerY - p.y;
            // Scan for platforms directly above the player within a realistic single-hop range
            if (dy > 20 && dy < 400) {
                const dist = Math.hypot(p.x - playerX, dy);
                if (dist < closestDist) {
                    closestDist = dist;
                    closestAbove = p;
                }
            }
        }

        if (closestAbove) {
            const dx = closestAbove.x - playerX;
            if (dx > 60) return 1;
            if (dx < -60) return -1;
            return 0; // Centered vertical climb or narrow zigzag
        }

        return 1; // Default to standard forward progression
    }

    // --- Public update: keep a distance-based lookahead ahead, then cull behind. ---
    public update(playerX: number, playerY: number, altitudeMeters: number): void {
        if (altitudeMeters > this.peakAltitudeMeters) {
            this.peakAltitudeMeters = altitudeMeters;
        }
        this.currentProfile = profileForAltitude(this.peakAltitudeMeters);

        const proc = GAME_CONSTANTS.PROCEDURAL;
        // Distance-based lookahead, NOT a fixed platform count. TARGET_SPACING only
        // tells us roughly how many meaningful hops that distance should contain
        // (ceil(GENERATION_AHEAD / TARGET_SPACING) ~ 8); each hop is a real challenge.
        const ahead = Math.max(proc.GENERATION_AHEAD, proc.MIN_FUTURE_PLATFORMS * proc.TARGET_SPACING);
        const maxPerFrame = proc.MAX_GENERATED_PER_FRAME;

        let generated = 0;
        while ((playerY - ahead) < this.headY) {
            if (generated >= maxPerFrame) break;
            this.generateOne();
            generated++;
        }

        this.cull(playerY);
    }

    // --- Tutorial hook layout (preserved from the original game). ---
    public seedTutorialHooks(): void {
        for (const node of this.hookNodes) {
            node.destroy();
        }
        this.hookNodes.length = 0;

        for (const hook of TUTORIAL_HOOKS) {
            this.spawnTopRightHookAnchor(
                hook.platformX,
                this.groundReferenceY + hook.yOffset,
                hook.horizontalOffset,
                hook.ropeLength
            );
        }
    }

    // =====================================================================
    //  Generation - one meaningful platform at a time; best-scoring wins
    // =====================================================================

    private generateOne(): void {
        const profile = this.currentProfile;
        const proc = GAME_CONSTANTS.PROCEDURAL;

        const beat = this.currentBeat(profile);
        const pattern = this.pickPattern(beat, profile);
        const spec = this.getPatternSpec(pattern);

        const prevX = this.headX;
        const prevY = this.headY;

        let best: ScoredCandidate | null = null;
        for (let attempt = 0; attempt < proc.MAX_CANDIDATE_ATTEMPTS && !best; attempt++) {
            for (let i = 0; i < proc.CANDIDATE_COUNT; i++) {
                const candidate = this.sampleCandidate(profile, spec, pattern, prevX, prevY);
                if (!candidate) continue;

                if (!this.validateCandidate(candidate, prevX, prevY)) {
                    continue;
                }

                const score = this.scoreCandidate(candidate, prevX, prevY, profile);
                if (!best || score > best.score) {
                    best = { candidate, score };
                }
            }
        }

        if (best) {
            this.commitPlatform(best.candidate, prevX, prevY, profile, spec);
            this.maybeSpawnRecoveryRider(best.candidate.x, best.candidate.y, profile, spec);
            return;
        }

        this.spawnFallback(prevX, prevY, profile, spec);
    }

    private currentBeat(profile: DifficultyProfile): Beat {
        if (profile.chainLength <= 0) return "CHALLENGE";
        const idx = Math.floor(this.committedCount / profile.chainLength) % BEAT_SEQUENCE.length;

        // A relief slot is a breather, and a breather is the one thing the
        // difficulty budget is spent on. Past the tutorial, most of them are
        // spent on something else instead.
        if (BEAT_SEQUENCE[idx] === "RELIEF" && this.rng() >= profile.reliefChance) {
            return "CHALLENGE";
        }

        // riskChance is the chance a HIGH_RISK slot is used as such. It is 1 past the
        // tutorial, so those slots always land; only the tutorial, which must not
        // introduce risk, downgrades them to RISK.
        if (BEAT_SEQUENCE[idx] === "HIGH_RISK" && this.rng() >= profile.riskChance) {
            return "RISK";
        }
        return BEAT_SEQUENCE[idx];
    }

    private pickPattern(beat: Beat, profile: DifficultyProfile): PatternId {
        const allowed = new Set<PatternId>(profile.patterns);
        const pool = this.getBeatPool(beat).filter(p => allowed.has(p));

        if (pool.length === 0) {
            const basePool = profile.patterns;
            return basePool[Math.floor(this.rng() * basePool.length)];
        }

        let pick = pool[Math.floor(this.rng() * pool.length)];
        if (pick === this.lastPattern && pool.length > 1) {
            pick = pool[Math.floor(this.rng() * pool.length)];
        }
        this.lastPattern = pick;
        return pick;
    }

    private getBeatPool(beat: Beat): PatternId[] {
        switch (beat) {
            case "SAFE":
                return ["STRAIGHT_ASCENT", "RIGHT_SWING", "LEFT_SWING", "SWITCHBACK"];
            case "CHALLENGE":
                return ["OFFSET_LANDING", "WIDE_SWING", "HOOK_CHAIN", "SWITCHBACK", "ZIGZAG"];
            case "RISK":
                return ["WIDE_SWING", "LONG_RELEASE", "HOOK_CHAIN", "TIGHT_PRECISION", "SWITCHBACK"];
            case "RELIEF":
                return ["STRAIGHT_ASCENT", "WIDE_SWING", "RECOVERY_ROUTE"];
            case "HIGH_RISK":
                return ["HIGH_RISK_SHORTCUT", "LONG_RELEASE", "TIGHT_PRECISION"];
            case "MAJOR_CLIMB":
                return ["VERTICAL_SHAFT", "HOOK_CHAIN"];
        }
    }

    // =====================================================================
    //  Spatial sampling - multi-directional ascending climbing rhythm
    // =====================================================================

    private sampleCandidate(
        profile: DifficultyProfile,
        spec: PatternSpec,
        pattern: PatternId,
        prevX: number,
        prevY: number
    ): Candidate | null {
        const proc = GAME_CONSTANTS.PROCEDURAL;

        // 1. Vertical climb step
        const maxGap = Math.min(proc.MAX_VERTICAL_GAP, profile.stepMax * spec.stepScale);
        const minGap = Math.max(proc.MIN_VERTICAL_GAP, profile.stepMin * spec.stepScale);
        const stepUp = this.between(minGap, maxGap);

        // 2. Determine climbing direction
        let dir = this.currentDirection;
        if (prevX > proc.CORRIDOR_MAX_X - 350) {
            // Approaching mountain right boundary: force switchback left
            dir = -1;
        } else if (prevX < proc.CORRIDOR_MIN_X + 350) {
            // Approaching mountain left boundary: force switchback right
            dir = 1;
        } else if (pattern === "SWITCHBACK") {
            dir = -this.currentDirection;
        } else if (pattern === "ZIGZAG") {
            dir = -this.currentDirection;
        } else if (pattern === "LEFT_SWING") {
            dir = -1;
        } else if (pattern === "RIGHT_SWING") {
            dir = 1;
        }

        // 3. Horizontal travel derived from reach
        const maxHorizontalReach = Math.floor(Math.sqrt(Math.max(
            0,
            this.maxReach * this.maxReach - stepUp * stepUp
        )));

        // The tier decides how much of that reach may be spent sideways.
        // A climb that only uses half of it is a climb straight up the
        // mountain, which is what the tutorial is for; up high the swing is
        // the difficulty, so the climb spends nearly all of it.
        const sidewaysReach = Math.floor(maxHorizontalReach * profile.horizontalRatio);

        let minH = proc.MIN_HORIZONTAL_GAP;
        let usableMaxH = Math.min(proc.MAX_HORIZONTAL_GAP, Math.max(minH, sidewaysReach));

        // Chimney climbing for VERTICAL_SHAFT
        if (pattern === "VERTICAL_SHAFT") {
            minH = 40;
            usableMaxH = Math.min(usableMaxH, 95);
        }

        if (usableMaxH < minH) return null;

        const targetSpread = this.between(minH, usableMaxH) * spec.spread;
        const hGap = Math.max(minH, Math.min(usableMaxH, targetSpread));

        const targetX = prevX + hGap * dir;
        const width = Math.max(profile.widthMin, Math.round(this.between(profile.widthMin, profile.widthMax) * spec.widthScale));
        const height = Math.round(this.between(profile.heightMin, profile.heightMax));

        // Must stay inside mountain corridor bounds
        if (targetX - width < proc.CORRIDOR_MIN_X || targetX + width > proc.CORRIDOR_MAX_X) {
            return null;
        }

        return {
            x: targetX,
            y: prevY - stepUp,
            width,
            height
        };
    }

    private scoreCandidate(
        candidate: Candidate,
        prevX: number,
        prevY: number,
        profile: DifficultyProfile
    ): number {
        const deltaY = prevY - candidate.y;
        const deltaX = Math.abs(candidate.x - prevX);

        // Spacing score: prefer platforms near the tier's ideal vertical gap
        const spacingScore = Math.max(0, 100 - Math.abs(deltaY - profile.idealGap));

        // Horizontal flow: rewards steady horizontal rhythm in either direction
        const horizontalScore = Math.max(0, 80 - Math.abs(deltaX - profile.idealHorizontal));

        // Landing width score: generous width is rewarded slightly, but tight platforms remain valid
        const widthScore = Math.min(30, candidate.width * 0.25);

        return spacingScore + horizontalScore + widthScore;
    }

    // =====================================================================
    //  Validation gates
    // =====================================================================

    private validateCandidate(
        candidate: Candidate,
        prevX: number,
        prevY: number
    ): boolean {
        const proc = GAME_CONSTANTS.PROCEDURAL;

        // 1. Reachable check
        const dist = Math.hypot(candidate.x - prevX, candidate.y - prevY);
        if (dist > this.maxReach + 15) {
            return false;
        }

        // 2. Minimum progression check (must climb upward min 60px, and have at least 30px horizontal offset)
        if (candidate.y >= prevY - 60 || Math.abs(candidate.x - prevX) < 30) {
            return false;
        }

        // 3. Corridor bounds check
        if (candidate.x - candidate.width < proc.CORRIDOR_MIN_X || candidate.x + candidate.width > proc.CORRIDOR_MAX_X) {
            return false;
        }

        // 4. No physical overlap with existing platforms
        if (this.overlapsExisting(candidate.x, candidate.y, candidate.width, candidate.height)) {
            return false;
        }

        // 5. Headroom clearance: no platform directly overhead blocking launch trajectory
        if (!this.hasHeadroomClearance(candidate)) {
            return false;
        }

        return true;
    }

    private overlapsExisting(
        x: number,
        y: number,
        widthParam: number,
        heightParam: number
    ): boolean {
        const candidateVisualW = widthParam * 2;
        const candidateVisualH = heightParam * 2;

        for (const p of this.platforms) {
            if (!p || !p.active || !p.body) continue;
            const dx = Math.abs(p.x - x);
            const dy = Math.abs(p.y - y);
            if (dx > 600 || dy > 600) continue;

            const horizontalOverlap = dx < (p.displayWidth + candidateVisualW) / 2 + 20;
            const verticalOverlap = dy < (p.displayHeight + candidateVisualH) / 2 + 20;
            if (horizontalOverlap && verticalOverlap) {
                return true;
            }
        }
        return false;
    }

    private hasHeadroomClearance(candidate: Candidate): boolean {
        for (const p of this.platforms) {
            if (!p || !p.active || !p.body) continue;

            const dx = Math.abs(p.x - candidate.x);
            const dy = candidate.y - p.y; // Positive if 'p' is above 'candidate'

            // If an existing platform is directly above this candidate within 200px, it blocks launch
            if (dx < 140 && dy > 0 && dy < 200) {
                return false;
            }
        }
        return true;
    }

    // =====================================================================
    //  Forward-Biased Arc Anchor Computation
    // =====================================================================

    private computeAnchor(
        prevX: number,
        prevY: number,
        prevHeight: number,
        nextX: number,
        nextY: number,
        nextHeight: number,
        profile: DifficultyProfile,
        spec: PatternSpec
    ): { x: number; y: number } {
        const deltaX = nextX - prevX;

        // Standing position on the previous launch platform
        const standX = prevX;
        const standY = prevY - prevHeight - GAME_CONSTANTS.PLAYER.RADIUS;

        // Target surface of the destination platform
        const targetY = nextY - nextHeight - GAME_CONSTANTS.PLAYER.RADIUS;

        // Place anchor forward-biased between prevX and nextX (62% to 68% toward destination)
        const forwardRatio = 0.64 + this.between(-0.03, 0.03);
        const anchorX = prevX + deltaX * forwardRatio;

        // Anchor must be elevated above both the standing and landing surfaces
        const minSurfaceY = Math.min(standY, targetY);
        const desiredLift = this.between(profile.anchorLiftMin, profile.anchorLiftMax) * spec.anchorLiftScale;
        let anchorY = minSurfaceY - desiredLift;

        // Ensure anchor is within tether reach from the standing launch spot
        const dxFromStand = Math.abs(anchorX - standX);
        const maxReachDy = Math.sqrt(Math.max(0, (this.ropeLength - 15) * (this.ropeLength - 15) - dxFromStand * dxFromStand));
        const highestPossibleY = standY - maxReachDy;

        if (anchorY < highestPossibleY) {
            anchorY = highestPossibleY;
        }

        // Guarantee anchor is at least 70px above landing target so the swing never hits the ledge
        if (anchorY > targetY - 70) {
            anchorY = targetY - 70;
        }

        return { x: anchorX, y: anchorY };
    }

    // =====================================================================
    //  Commit Platform & Spawn Arc Anchors / Aerial Chains
    // =====================================================================

    private commitPlatform(
        candidate: Candidate,
        prevX: number,
        prevY: number,
        profile: DifficultyProfile,
        spec: PatternSpec
    ): void {
        // Crumbling and hazards follow the difficulty dial rather than raw
        // altitude, so they stay in step with the shape of the mountain when
        // the boundaries move.
        //
        // Risk platforms are where a run is meant to be lost, so they crumble
        // sooner and more often than ordinary ground. Recovery platforms are the
        // safety net and must never crumble.
        //
        // The chances come from the dial rather than from the tier, so a ledge
        // crumbles at the rate the mountain is crumbling at the altitude the
        // run has reached, and the tutorial's zero holds until the climb has
        // actually left the tutorial.
        const hazards = hazardStateForAltitude(this.peakAltitudeMeters);

        let isCrumbling = false;
        if (spec.risk) {
            isCrumbling = this.rng() < hazards.riskCrumble;
        } else if (!spec.recovery) {
            isCrumbling = this.rng() < hazards.crumble;
        }

        const platform = new BasePlatform(
            this.scene,
            candidate.x,
            candidate.y,
            candidate.width,
            candidate.height,
            { friction: 0.9, restitution: 0.05, isCrumbling, isRisk: spec.risk }
        );
        this.platforms.push(platform);

        // Coins sit on risk platforms only. Putting them anywhere else would make
        // the safe line the profitable one, which is the opposite of what they are
        // for: they are the reason to attempt the risk line at all.
        if (spec.risk) {
            this.spawnCoinsOn(platform);
        }

        // Maybe spawn Cosmic Hazard in the traversal gap
        this.maybeSpawnHazard(prevX, prevY, candidate.x, candidate.y);

        const deltaX = candidate.x - prevX;

        if (spec.isChain || Math.abs(deltaX) > 280) {
            // Aerial Hook Chain: Spawns 2 mid-air hook nodes for an exhilarating aerial double-grapple
            const standY = prevY - this.prevHeight - GAME_CONSTANTS.PLAYER.RADIUS;
            const targetY = candidate.y - candidate.height - GAME_CONSTANTS.PLAYER.RADIUS;

            const hook1X = prevX + deltaX * 0.35;
            const hook1Y = standY - 170;

            const hook2X = prevX + deltaX * 0.74;
            const hook2Y = Math.min(standY, targetY) - 180;

            this.spawnHookAnchor(hook1X, hook1Y);
            this.spawnHookAnchor(hook2X, hook2Y);
        } else {
            // Standard forward-biased swing anchor
            const anchor = this.computeAnchor(
                prevX,
                prevY,
                this.prevHeight,
                candidate.x,
                candidate.y,
                candidate.height,
                profile,
                spec
            );
            this.spawnHookAnchor(anchor.x, anchor.y);
        }

        // Track climbing direction for dynamic lookahead camera and boundary switchbacks
        const actualDir = candidate.x >= prevX ? 1 : -1;
        if (actualDir === this.currentDirection) {
            this.stepsInDirection += 1;
        } else {
            this.currentDirection = actualDir;
            this.stepsInDirection = 1;
        }

        this.headX = candidate.x;
        this.headY = candidate.y;
        this.prevHeight = candidate.height;
        this.committedCount += 1;
    }

    private maybeSpawnHazard(prevX: number, prevY: number, candX: number, candY: number): void {
        const hazards = hazardStateForAltitude(this.peakAltitudeMeters);

        const dist = Math.hypot(candX - prevX, candY - prevY);
        if (dist < GAME_CONSTANTS.HAZARD.minGap) return;

        // The density is a number of asteroids, not a coin flip, so a world
        // with more hazards in it can be more hazardous. The whole number is
        // always there and the remainder is the chance of one more.
        const whole = Math.floor(hazards.density);
        const remainder = hazards.density - whole;

        for (let i = 0; i < whole + (this.rng() < remainder ? 1 : 0); i++) {
            this.spawnHazard(prevX, prevY, candX, candY);
        }
    }

    private spawnHazard(prevX: number, prevY: number, candX: number, candY: number): void {
        // Position mid-air between platforms, offset slightly from direct line of flight
        const midX = (prevX + candX) / 2 + this.between(-30, 30);
        const midY = (prevY + candY) / 2 + this.between(-25, 25);

        const textureKey = this.rng() < 0.5 ? 'hazard-asteroid-1' : 'hazard-asteroid-2';
        const patrolDistance = this.between(60, 140);
        const axis: 'x' | 'y' = this.rng() < 0.35 ? 'y' : 'x';
        const speed = this.between(0.002, 0.0035);

        const hazard = new CosmicHazard(
            this.scene,
            midX,
            midY,
            textureKey,
            patrolDistance,
            axis,
            speed
        );
        this.hazards.push(hazard);
    }

    // Recovery platform & hook spawned below the mainline to save missed jumps
    /**
     * Scatters coins just above a risk platform.
     *
     * The count scales with the tier so a deep run is worth more than a shallow
     * one, which is the same curve the platform shapes follow. Capped so a long
     * platform cannot turn into a coin farm.
     */
    private spawnCoinsOn(platform: BasePlatform): void {
        const width = platform.displayWidth;
        const count = width >= COIN_SECOND_AT_WIDTH ? 2 : 1;
        const topY = platform.y - platform.displayHeight / 2;

        for (let i = 0; i < count; i++) {
            // Spread across the platform rather than stacking at the centre, so a
            // single arc can sweep them up.
            const t = count === 1 ? 0.5 : i / (count - 1);
            const x = platform.x + (t - 0.5) * Math.max(40, width - 90);
            const y = topY - this.between(18, 34);
            this.coins.push(new Coin(this.scene, x, y));
        }
    }

    private maybeSpawnRecoveryRider(
        x: number,
        y: number,
        profile: DifficultyProfile,
        spec: PatternSpec
    ): void {
        if (spec.risk) return;
        if (!(this.rng() < profile.recoveryChance)) return;

        const rx = x - 60 * this.currentDirection;
        const ry = y + this.between(220, 300);

        if (this.overlapsExisting(rx, ry, 90, 30)) return;

        const rider = new BasePlatform(
            this.scene,
            rx,
            ry,
            100,
            30,
            { friction: 0.9, restitution: 0.05 }
        );
        this.platforms.push(rider);

        // Hook node above the recovery platform so player can climb back onto the route
        this.spawnHookAnchor(rx, ry - 190);
    }

    private spawnFallback(
        prevX: number,
        prevY: number,
        profile: DifficultyProfile,
        spec: PatternSpec
    ): void {
        const proc = GAME_CONSTANTS.PROCEDURAL;
        let dir = this.currentDirection;
        if (prevX > proc.CORRIDOR_MAX_X - 350) {
            dir = -1;
        } else if (prevX < proc.CORRIDOR_MIN_X + 350) {
            dir = 1;
        }

        let x = prevX + 160 * dir;
        x = Math.max(proc.CORRIDOR_MIN_X + 100, Math.min(proc.CORRIDOR_MAX_X - 100, x));
        const y = prevY - 150;
        const width = Math.max(profile.widthMin, 80);
        const height = 35;

        this.commitPlatform(
            { x, y, width, height },
            prevX,
            prevY,
            profile,
            spec
        );
    }

    // =====================================================================
    //  Culling - remove only geometry far below the player that is no longer
    //  realistically reachable. Future route and current platform are kept.
    // =====================================================================

    private cull(playerY: number): void {
        const cullDist = GAME_CONSTANTS.PROCEDURAL.CULL_DISTANCE;

        for (let i = this.platforms.length - 1; i >= 0; i--) {
            const p = this.platforms[i];
            if (!p || !p.body) {
                this.platforms.splice(i, 1);
                continue;
            }

            // Cull strictly by depth, so recovery paths stay alive and memory is bounded.
            if (p.y - playerY > cullDist) {
                p.destroy();
                this.platforms.splice(i, 1);
            }
        }

        for (let i = this.hookNodes.length - 1; i >= 0; i--) {
            const node = this.hookNodes[i];
            if (!node || !node.body) {
                this.hookNodes.splice(i, 1);
                continue;
            }
            if (node.body.position.y - playerY > cullDist + 500) {
                node.destroy();
                this.hookNodes.splice(i, 1);
            }
        }

        for (let i = this.hazards.length - 1; i >= 0; i--) {
            const h = this.hazards[i];
            if (!h || !h.active) {
                this.hazards.splice(i, 1);
                continue;
            }
            if (h.y - playerY > cullDist + 300) {
                h.destroy();
                this.hazards.splice(i, 1);
            }
        }

        // Coins are swept with the rest of the geometry. Without this they
        // accumulate for the whole run, since a coin is never destroyed by
        // landing on it.
        for (let i = this.coins.length - 1; i >= 0; i--) {
            const c = this.coins[i];
            if (!c || !c.active) {
                this.coins.splice(i, 1);
                continue;
            }
            if (c.y - playerY > cullDist + 300) {
                c.destroy();
                this.coins.splice(i, 1);
            }
        }
    }

    // =====================================================================
    //  Difficulty selection
    // =====================================================================

    public getZoneName(altitudeMeters: number): string {
        return stratumForAltitude(altitudeMeters);
    }

    // =====================================================================
    //  Pattern table - each pattern encodes a gameplay rhythm
    // =====================================================================

    private getPatternSpec(id: PatternId): PatternSpec {
        switch (id) {
            case "STRAIGHT_ASCENT":
                return { spread: 1.0, stepScale: 1.0, widthScale: 1.1, anchorLiftScale: 1.0, isChain: false, risk: false, recovery: false };
            case "LEFT_SWING":
            case "RIGHT_SWING":
                return { spread: 1.1, stepScale: 1.0, widthScale: 1.0, anchorLiftScale: 1.1, isChain: false, risk: false, recovery: false };
            case "ZIGZAG":
                return { spread: 1.0, stepScale: 1.05, widthScale: 0.95, anchorLiftScale: 1.05, isChain: false, risk: false, recovery: false };
            case "WIDE_SWING":
                return { spread: 1.25, stepScale: 0.95, widthScale: 1.0, anchorLiftScale: 1.2, isChain: false, risk: false, recovery: false };
            case "TIGHT_PRECISION":
                return { spread: 0.9, stepScale: 0.9, widthScale: 0.75, anchorLiftScale: 1.0, isChain: false, risk: false, recovery: false };
            case "HOOK_CHAIN":
                return { spread: 1.35, stepScale: 1.0, widthScale: 1.0, anchorLiftScale: 1.1, isChain: true, risk: false, recovery: false };
            case "VERTICAL_SHAFT":
                return { spread: 0.85, stepScale: 1.2, widthScale: 0.9, anchorLiftScale: 1.15, isChain: false, risk: false, recovery: false };
            case "OFFSET_LANDING":
                return { spread: 1.15, stepScale: 1.05, widthScale: 0.95, anchorLiftScale: 1.0, isChain: false, risk: false, recovery: false };
            case "LONG_RELEASE":
                return { spread: 1.3, stepScale: 1.0, widthScale: 0.95, anchorLiftScale: 1.25, isChain: false, risk: false, recovery: false };
            case "HIGH_RISK_SHORTCUT":
                return { spread: 1.2, stepScale: 1.25, widthScale: 0.8, anchorLiftScale: 1.15, isChain: false, risk: true, recovery: false };
            case "SWITCHBACK":
                return { spread: 1.1, stepScale: 1.1, widthScale: 1.1, anchorLiftScale: 1.25, isChain: false, risk: false, recovery: true };
            case "RECOVERY_ROUTE":
                return { spread: 0.95, stepScale: 0.9, widthScale: 1.1, anchorLiftScale: 0.95, isChain: false, risk: false, recovery: true };
        }
    }

    // =====================================================================
    //  Hook node spawning
    // =====================================================================

    private spawnTopRightHookAnchor(
        platformX: number,
        platformY: number,
        horizontalOffset: number,
        ropeLength: number
    ): void {
        const verticalOffset = Math.sqrt(Math.max(
            0,
            (ropeLength * ropeLength) - (horizontalOffset * horizontalOffset)
        ));
        this.spawnHookAnchor(platformX + horizontalOffset, platformY - verticalOffset);
    }

    private spawnHookAnchor(x: number, y: number, forceUnstable?: boolean): Phaser.Physics.Matter.Image {
        let isUnstable = false;
        if (forceUnstable !== undefined) {
            isUnstable = forceUnstable;
        } else {
            // An unstable anchor gives way on contact, so it is the same kind of
            // decision as a crumbling platform: rare early, common high up.
            const hazards = hazardStateForAltitude(this.peakAltitudeMeters);
            isUnstable = this.rng() < hazards.unstableAnchor;
        }

        const label = isUnstable ? 'HookAnchor_Unstable' : 'HookAnchor';
        const node = this.scene.matter.add.image(x, y, 'hook_node', undefined, {
            isStatic: true,
            isSensor: true,
            label,
            collisionFilter: {
                category: COLLISION_CHANNELS.HOOK_NODE,
                mask: 0
            }
        });

        node.setDisplaySize(80, 80);
        node.setDepth(20);

        if (isUnstable) {
            // Distinct unstable visual: neon magenta tint and breathing pulse
            node.setTint(0xff0066);
            this.scene.tweens.add({
                targets: node,
                alpha: 0.65,
                duration: 450,
                yoyo: true,
                repeat: -1,
                ease: 'Sine.easeInOut'
            });
        }

        this.hookNodes.push(node);
        return node;
    }

    public getHazards(): readonly CosmicHazard[] {
        return this.hazards;
    }

    /**
     * Live platforms. The scene reads this to tell a safe landing from a landing on
     * the risk line, which is what decides whether a coin haul is banked.
     */
    public getPlatforms(): readonly BasePlatform[] {
        return this.platforms;
    }

    /** Drops a collected coin so it stops colliding and stops being drawn. */
    public removeCoin(coin: Coin): void {
        const i = this.coins.indexOf(coin);
        if (i !== -1) this.coins.splice(i, 1);
    }

    public destroyAll(): void {
        for (const h of this.hazards) {
            if (h && h.active) h.destroy();
        }
        this.hazards.length = 0;
        for (const n of this.hookNodes) {
            if (n && n.active) n.destroy();
        }
        this.hookNodes.length = 0;
        for (const c of this.coins) {
            if (c && c.active) c.destroy();
        }
        this.coins.length = 0;
    }

    private between(min: number, max: number): number {
        return min + this.rng() * (max - min);
    }
}
