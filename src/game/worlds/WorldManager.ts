import Phaser from 'phaser';
import { Player } from '../entities/Player';
import { BasePlatform } from '../terrain/BasePlatform';
import { CosmicHazard } from '../terrain/CosmicHazard';
import { LevelGenerator } from '../levels/LevelGenerator';
import { PivotEngine } from '../physics/PivotEngine';
import { GAME_CONSTANTS, tierForAltitude } from '../config/game-constants';
import { Portal, type PortalCrossing } from '../entities/Portal';
import {
    BLEED_ALTITUDE,
    FIRST_PORTAL_ALTITUDE,
    PORTAL_ALTITUDE_INTERVAL,
    PORTAL_CHANNEL_OFFSET,
    PORTAL_FALLBACK_MARGIN,
    PORTAL_RADIUS,
    SKINS,
    TRANSITION_MS,
    TRANSITION_SWAP_MS,
    VERSE_ORDER,
    WORLDS,
    type WorldDefinition,
    type WorldSkin,
} from './definitions';
import {
    HEAT_TEXTURE_KEY,
    POD_TEXTURE_KEY,
    SCANLINE_TEXTURE_KEY,
    VIGNETTE_TEXTURE_KEY,
    SHARED_PLATFORM_KEY,
    ensureSkinArt,
    hookNodeTextureKey,
    particleTextureKey,
    platformTextureKey,
    skyTextureKey,
    warningPlatformTextureKey,
} from './theming';

/**
 * Everything that is not the climb.
 *
 * The scene owns the player, the tether, the generator and the death checks,
 * and it should keep owning them: those are the game. This class owns the fact
 * that the climb is happening inside one of five verses, and it is deliberately
 * reached through a handful of calls from GameScene so that the difficulty
 * rewrite and this feature can be rebased onto each other without either one
 * having to read the other's code.
 *
 * Three invariants are enforced here rather than remembered:
 *
 * 1. The player is never touched for a thematic reason. Velocity, state, input
 *    and the camera's follow are all out of reach of this class. A verse may
 *    change how heavy the world is and how the ground behaves; it may not pause,
 *    nudge or re-colour the player, because a game whose skill is momentum
 *    cannot afford a transition that costs momentum.
 *
 * 2. The world layer never draws above the tether. Every overlay this class
 *    creates sits at depth 74 or lower; the tether is at 90 and the player at
 *    100. That is the whole mechanism behind "cyan never changes" - it is not a
 *    colour choice that has to be remembered, it is a draw order that cannot be
 *    broken, which is why the transition is built from a wash on the world layer
 *    instead of a camera filter that would run over everything including the one
 *    thing no verse may recolour.
 *
 * 3. A verse owns ratios, not numbers. Everything read from GAME_CONSTANTS is
 *    multiplied by the current world's table at the point of use, so the base
 *    ramp stays the single source of truth.
 */

/**
 * Marks a platform as illusory. Stored on the platform rather than in a list
 * because the generator creates and culls platforms behind this class's back,
 * and a list of platforms would need its own culling to avoid holding destroyed
 * objects.
 */
const ILLUSORY = Symbol('tetherverse.illusory');

const OVERLAY_DEPTH = 70;
const VIGNETTE_DEPTH = 72;
const TITLE_DEPTH = 74;

/**
 * Hex blend.
 *
 * `Phaser.Display.Color.Interpolate.ColorWithColor` returns an RGB object, and
 * the usual `as unknown as number` cast through it produces a number that is
 * not a colour at all - it silently tints everything black. This returns the hex
 * the tint APIs actually want.
 */
function lerpColor(from: number, to: number, t: number): number {
    const k = Phaser.Math.Clamp(t, 0, 1);
    const fr = (from >> 16) & 0xff;
    const fg = (from >> 8) & 0xff;
    const fb = from & 0xff;
    const tr = (to >> 16) & 0xff;
    const tg = (to >> 8) & 0xff;
    const tb = to & 0xff;
    return (
        (Math.round(fr + (tr - fr) * k) << 16) |
        (Math.round(fg + (tg - fg) * k) << 8) |
        Math.round(fb + (tb - fb) * k)
    );
}

/** Pod hazard: how close, in px, the player has to be to get stuck. */
const POD_GRAB_RADIUS = 66;
/** Pod hazard: how long the drag lasts after a grab, in ms. */
const POD_GUNK_MS = 2200;
/** Pod hazard: chance a BLOOM ledge carries one. */
const POD_CHANCE = 0.24;

/** KILN heat: how long the player may stand still before the ground gives, in ms. */
const KILN_HEAT_MS = 3000;

/** BLEED: how long each verse's modifiers hold before the next one bleeds in. */
const BLEED_PHASE_MS = 11000;

/**
 * What GameScene hands over.
 *
 * Getters rather than values because the scene rebuilds its arrays and its
 * generator across restarts, and a snapshot would quietly point at the previous
 * run's world.
 */
export interface WorldContext {
    scene: Phaser.Scene;
    player: () => Player | null;
    platforms: () => BasePlatform[];
    generator: () => LevelGenerator | null;
    pivotEngine: () => PivotEngine | null;
    backgroundLayer: () => Phaser.GameObjects.TileSprite | null;
    backgroundObjects: () => Phaser.GameObjects.Image[];
    groundReferenceY: () => number;
    altitudeMeters: () => number;
}

interface Pod {
    sprite: Phaser.GameObjects.Image;
    platform: BasePlatform;
    gunkUntil: number;
}

/** Counters kept for measurement. Read by the harness; written by nobody else. */
export interface WorldStats {
    transitions: number;
    firedByCrossing: number;
    firedByFallback: number;
    portalsSpawned: number;
    themedPlatforms: number;
    thinnedHazards: number;
    dissolvedIllusory: number;
    podsTriggered: number;
    kilnScorches: number;
}

export class WorldManager {
    public readonly stats: WorldStats = {
        transitions: 0,
        firedByCrossing: 0,
        firedByFallback: 0,
        portalsSpawned: 0,
        themedPlatforms: 0,
        thinnedHazards: 0,
        dissolvedIllusory: 0,
        podsTriggered: 0,
        kilnScorches: 0,
    };

    private readonly ctx: WorldContext;

    private current: WorldDefinition = WORLDS.VERGE;

    private portal: Portal | null = null;
    /** The world this gate leads to, fixed at spawn so its colour cannot lie. */
    private portalTarget: WorldDefinition | null = null;
    private portalIndex: number = 0;
    private nextPortalAltitude: number = FIRST_PORTAL_ALTITUDE;

    private transition: { from: WorldDefinition; to: WorldDefinition; elapsed: number; swapped: boolean } | null = null;

    /** Platforms already given this verse's look. A WeakSet so culling frees them. */
    private themed: WeakSet<BasePlatform> = new WeakSet();
    /** Hook anchors already dressed for the current verse. Same reasoning, and
        for the same reason re-theming has to re-register them. */
    private themedHooks: WeakSet<Phaser.Physics.Matter.Image> = new WeakSet();
    /** Hazards already considered for density thinning. Same reasoning. */
    private hazarded: WeakSet<CosmicHazard> = new WeakSet();

    private readonly baseGravityY: number;
    private readonly gravityScale: number;
    private gravityCurrent: number;

    // --- World layer ---
    private sky: Phaser.GameObjects.Image | null = null;
    private wash: Phaser.GameObjects.Rectangle | null = null;
    private scanTile: Phaser.GameObjects.TileSprite | null = null;
    private heatTile: Phaser.GameObjects.TileSprite | null = null;
    private vignette: Phaser.GameObjects.Image | null = null;
    private readonly overlays: Phaser.GameObjects.Components.Transform[] = [];

    /**
     * The view the world layer was last fitted to, in world units.
     *
     * Fitted only when it actually changes, so the per-frame path is one
     * comparison rather than five resizes.
     */
    private fittedView = { width: 0, height: 0 };

    /**
     * One ambient emitter, reused across verses.
     *
     * Creating and destroying a ParticleEmitter per verse churns its internal
     * pool exactly when a frame hitch is least affordable - mid transition - so
     * the emitter is built once and reconfigured. Leaving a verse stops it and
     * kills every live particle, which is what actually releases the memory; the
     * emitter shell is a few dozen bytes and is deliberately kept.
     */
    private ambient: Phaser.GameObjects.Particles.ParticleEmitter | null = null;
    private ambientKind: WorldSkin['ambient'] = 'NONE';

    private readonly pods: Pod[] = [];
    private heatMs: number = 0;
    private heatPlatform: BasePlatform | null = null;

    private wasHooked: boolean = false;
    private bleedPhase: number = 0;
    private bleedMs: number = 0;

    private readonly lastPos: PortalCrossing = { x: 0, y: 0 };
    private readonly crossPoint: PortalCrossing = { x: 0, y: 0 };
    private hasLastPos: boolean = false;

    private readonly onShutdown = () => this.dispose();

    constructor(ctx: WorldContext) {
        this.ctx = ctx;

        // Built after the scene's own create() has run, so the gravity the scene
        // set is the base this class modulates rather than competes with.
        const gravity = ctx.scene.matter.world.localWorld.gravity;
        this.baseGravityY = GAME_CONSTANTS.WORLD.GRAVITY_Y;
        this.gravityScale = gravity.scale || 0.001;
        this.gravityCurrent = this.baseGravityY;

        this.buildOverlays();
        ensureSkinArt(ctx.scene, this.current.skin);
        this.rethemeAllPlatforms();
        this.rethemeAllHooks();
        this.applyTintToBackdrop(this.current.skin);

        // Scene restarts are the normal way a run ends, and the shutdown hook is
        // the only place guaranteed to run on both death and restart.
        ctx.scene.events.once('shutdown', this.onShutdown);
    }

    // =====================================================================
    //  Public surface - the whole of GameScene's involvement
    // =====================================================================

    public update(time: number, delta: number): void {
        const player = this.ctx.player();
        if (!player || !player.body) return;

        this.updateGravity(delta);
        this.updateTransition(delta);
        this.themeNewPlatforms(time);
        this.themeNewHooks();
        this.thinHazards();
        this.updatePortal(player);
        this.updateVerseBehaviour(time, delta, player);
        this.positionOverlays();

        this.lastPos.x = player.x;
        this.lastPos.y = player.y;
        this.hasLastPos = true;
    }

    public getCurrentWorld(): WorldDefinition {
        return this.current;
    }

    /** Forces the next gate to appear immediately. Used by the measurement harness. */
    public forceNextPortal(altitudeMeters?: number): void {
        if (altitudeMeters !== undefined) {
            this.nextPortalAltitude = altitudeMeters;
        }
        this.nextPortalAltitude = Math.min(this.nextPortalAltitude, this.ctx.altitudeMeters() + 10);
    }

    /**
     * Development only: drop straight into a verse.
     *
     * The honest route is a climb through four gates, which is the right way to
     * play and a terrible way to check whether KILN's ledges read as slag. This
     * calls {@link startTransition} - the same method a gate crossing calls - so
     * the reveal card, the 600ms re-materialisation and the re-theming are all
     * the production path. Only the climbing is skipped, and only the art is
     * being looked at.
     *
     * Returns false for a name that is not a world, so a typo is silent rather
     * than a crash in the middle of a run.
     */
    public debugJumpTo(id: string): boolean {
        const to = WORLDS[id.toUpperCase() as keyof typeof WORLDS];
        if (!to || to.id === this.current.id) return false;
        // A jump mid-flight would drop the in-progress transition on the floor
        // and strand the player re-materialising inside whatever the old verse
        // had there. Refuse instead; the next press will land.
        if (this.transition) return false;
        this.startTransition(to);
        return true;
    }

    // =====================================================================
    //  Overlays. Every one of these lives at or below OVERLAY_DEPTH.
    // =====================================================================

    private buildOverlays(): void {
        const scene = this.ctx.scene;
        // Sized to the view in world units, not to `scene.scale`, which is the
        // window in pixels - see fitOverlays() for why those stopped being the
        // same number. positionOverlays() refits on every resize from here.
        const view = scene.cameras.main.worldView;
        const width = view.width;
        const height = view.height;
        this.fittedView = { width, height };

        this.sky = scene.add.image(0, 0, skyTextureKey('VERGE'))
            .setOrigin(0.5, 0.5)
            .setScrollFactor(0)
            .setDepth(-1900)
            .setDisplaySize(width, height)
            .setAlpha(0);

        this.wash = scene.add.rectangle(0, 0, width, height, 0x000000)
            .setOrigin(0.5, 0.5)
            .setScrollFactor(0)
            .setDepth(OVERLAY_DEPTH)
            .setAlpha(0);

        // The heat haze sits below the scanlines and the wash so a NULL crossing
        // in KILN-style heat still reads as two layers rather than one.
        this.heatTile = scene.add.tileSprite(0, 0, width, height, HEAT_TEXTURE_KEY)
            .setOrigin(0.5, 0.5)
            .setScrollFactor(0)
            .setDepth(OVERLAY_DEPTH - 3)
            .setAlpha(0)
            .setTileScale(10, 16);

        this.scanTile = scene.add.tileSprite(0, 0, width, height, SCANLINE_TEXTURE_KEY)
            .setOrigin(0.5, 0.5)
            .setScrollFactor(0)
            .setDepth(OVERLAY_DEPTH - 1)
            .setAlpha(0);

        this.vignette = scene.add.image(0, 0, VIGNETTE_TEXTURE_KEY)
            .setOrigin(0.5, 0.5)
            .setScrollFactor(0)
            .setDepth(VIGNETTE_DEPTH)
            .setAlpha(0)
            .setDisplaySize(width, height);

        this.overlays.push(this.sky, this.wash, this.heatTile, this.scanTile, this.vignette);
    }

    /**
     * Pins the world layer to the view and drifts the atmosphere bands.
     *
     * Runs every frame rather than only during a transition: a band that stops
     * scrolling the instant the world has finished changing reads as a frozen
     * texture, and the whole point of these layers is that the air is moving.
     */
    private positionOverlays(): void {
        const scene = this.ctx.scene;
        const view = scene.cameras.main.worldView;
        const time = scene.time.now;

        if (view.width !== this.fittedView.width || view.height !== this.fittedView.height) {
            this.fitOverlays(view.width, view.height);
        }

        for (const overlay of this.overlays) {
            overlay.setPosition(view.centerX, view.centerY);
        }

        if (this.heatTile && this.heatTile.alpha > 0.001) {
            this.heatTile.tilePositionY = time * 0.012;
            this.heatTile.tilePositionX = Math.sin(time * 0.0009) * 26;
        }
        if (this.scanTile && this.scanTile.alpha > 0.001) {
            this.scanTile.tilePositionY = time * 0.02;
        }
    }

    /**
     * Sizes the world layer to the view.
     *
     * These were built from `scene.scale`, which is the window in pixels. That
     * number equalled the view in world units only while the camera sat at zoom
     * 1, and it stopped sitting at zoom 1 when the desktop scaling was fixed:
     * at 1440x900 the layer came out 1440x900 inside a 2560x1600 view, which
     * is a rectangle with four visible edges parked in the middle of the
     * screen. The view is the number that is correct in world units, and reading
     * it here rather than at construction also covers the window being resized
     * mid-run.
     */
    private fitOverlays(width: number, height: number): void {
        this.fittedView = { width, height };
        this.sky?.setDisplaySize(width, height);
        this.vignette?.setDisplaySize(width, height);
        this.wash?.setDisplaySize(width, height);
        // The atmosphere bands are sized rather than display-sized: TileSprite
        // setSize changes how much area it covers while leaving the scanline and
        // heat spacing inside it alone, where a display scale would stretch it.
        this.heatTile?.setSize(width, height);
        this.scanTile?.setSize(width, height);
    }

    // =====================================================================
    //  Gravity. The one multiplier that is a force rather than a table.
    // =====================================================================

    private updateGravity(delta: number): void {
        const target = this.baseGravityY * this.current.multipliers.gravity;

        // A chase rather than a snap. Gravity is applied every step, so changing
        // it instantly at the swap would be felt as a jolt in the middle of a
        // launch - and the whole point of the transition is that the player is
        // launching through it. A ~500ms approach reads as the air changing.
        const alpha = 1 - Math.exp(-6 * (delta / 1000));
        this.gravityCurrent = Phaser.Math.Linear(this.gravityCurrent, target, alpha);

        this.ctx.scene.matter.world.setGravity(0, this.gravityCurrent, this.gravityScale);
    }

    // =====================================================================
    //  The transition
    // =====================================================================

    private startTransition(to: WorldDefinition): void {
        if (this.transition) return;

        // Art first: the swap lands TRANSITION_SWAP_MS in, and generating the
        // duotone here gives it the whole run-up to be ready behind the flash.
        ensureSkinArt(this.ctx.scene, to.skin);

        this.transition = { from: this.current, to, elapsed: 0, swapped: false };
        this.stats.transitions++;

        const accent = to.skin.palette.accent;
        if (this.wash) {
            this.ctx.scene.tweens.killTweensOf(this.wash);
            this.wash.setFillStyle(accent, 1);
            this.wash.setAlpha(0);
            this.ctx.scene.tweens.add({
                targets: this.wash,
                alpha: 0.44,
                duration: TRANSITION_SWAP_MS,
                ease: 'Quad.easeOut',
            });
        }

        // A nudge, not a cut: the camera moves in position only. Any filter here
        // would desaturate the tether for the length of the flash, which is the
        // one frame-level regression this feature exists to avoid.
        this.ctx.scene.cameras.main.shake(190, 0.005);
    }

    private updateTransition(delta: number): void {
        const t = this.transition;
        if (!t) return;

        t.elapsed += delta;

        if (!t.swapped && t.elapsed >= TRANSITION_SWAP_MS) {
            t.swapped = true;
            this.commitWorld(t.to);
        }

        if (t.elapsed >= TRANSITION_MS) {
            this.transition = null;
            if (this.wash) {
                this.ctx.scene.tweens.killTweensOf(this.wash);
                this.ctx.scene.tweens.add({
                    targets: this.wash,
                    alpha: 0,
                    duration: 240,
                    ease: 'Quad.easeIn',
                });
            }
        }
    }

    /**
     * The moment the world changes.
     *
     * Everything below happens between two frames the player is already moving
     * through. Nothing here touches the player, the camera's follow, the input
     * or the generator's route, so the swing that carried the player through the
     * gate is the same swing that carries them out the other side.
     */
    private commitWorld(to: WorldDefinition): void {
        const from = this.current;
        this.current = to;

        // New WeakSets: the old ones remember the previous verse's decisions and
        // a platform themed for VERGE must be re-themed for BLOOM. The counters
        // are NOT reset - they measure the whole run, not the current verse, and
        // a counter that zeroes itself on the frame the interesting thing happens
        // is a counter that cannot be read.
        this.themed = new WeakSet();
        this.hazarded = new WeakSet();

        // Pods are torn down first: re-theming BLOOM platforms spawns a fresh
        // pod on each eligible ledge, and a pod left alive from the last visit
        // would then sit on top of its replacement.
        this.clearPods();
        this.heatMs = 0;
        this.heatPlatform = null;

        this.rethemeAllPlatforms();
        this.rethemeAllHooks();
        this.applyTintToBackdrop(to.skin);
        this.swapSky(from.skin, to.skin);
        this.applyScreenFx(from.skin, to.skin);
        this.swapAmbient(to.skin);

        this.showTitle(to);

        if (typeof window !== 'undefined') {
            window.dispatchEvent(new CustomEvent('tetherverse:world-change', {
                detail: {
                    world: to.id,
                    name: to.skin.name,
                    tagline: to.skin.tagline,
                    altitude: this.ctx.altitudeMeters(),
                },
            }));
        }
    }

    private swapSky(from: WorldSkin, to: WorldSkin): void {
        if (!this.sky) return;
        const scene = this.ctx.scene;

        scene.tweens.killTweensOf(this.sky);
        const targetAlpha = to.palette.skyAlpha;

        if (from.id === to.id) {
            this.sky.setTexture(skyTextureKey(to.id));
            this.sky.setAlpha(targetAlpha);
            return;
        }

        this.sky.setAlpha(0);
        this.sky.setTexture(skyTextureKey(to.id));
        scene.tweens.add({
            targets: this.sky,
            alpha: targetAlpha,
            duration: TRANSITION_MS - TRANSITION_SWAP_MS,
            ease: 'Quad.easeOut',
        });
    }

    private applyScreenFx(from: WorldSkin, to: WorldSkin): void {
        const scene = this.ctx.scene;

        if (this.scanTile) {
            scene.tweens.killTweensOf(this.scanTile);
            scene.tweens.add({
                targets: this.scanTile,
                alpha: to.fx.scanlines,
                duration: TRANSITION_MS,
                ease: 'Quad.easeOut',
            });
            if (to.fx.scanlines === 0 && from.fx.scanlines > 0) {
                this.scanTile.setAlpha(0);
            }
        }

        if (this.heatTile) {
            scene.tweens.killTweensOf(this.heatTile);
            scene.tweens.add({
                targets: this.heatTile,
                alpha: to.fx.heat,
                duration: TRANSITION_MS,
                ease: 'Quad.easeOut',
            });
            if (to.fx.heat === 0 && from.fx.heat > 0) {
                this.heatTile.setAlpha(0);
            }
        }

        // The vignette is generated as a transparent-centred black radial, so it
        // needs no tint at all: its opacity is simply the verse's number.
        if (this.vignette) {
            scene.tweens.killTweensOf(this.vignette);
            scene.tweens.add({
                targets: this.vignette,
                alpha: to.fx.vignette,
                duration: TRANSITION_MS,
                ease: 'Quad.easeOut',
            });
        }
    }

    private showTitle(to: WorldDefinition): void {
        const scene = this.ctx.scene;
        const view = scene.cameras.main.worldView;
        const accent = to.skin.palette.accent;

        const title = scene.add.text(view.centerX, view.centerY - 180, to.skin.name, {
            fontFamily: 'monospace',
            fontSize: '64px',
            fontStyle: 'bold',
            color: '#ffffff',
            stroke: '#000000',
            strokeThickness: 6,
        })
            .setOrigin(0.5)
            .setScrollFactor(0)
            .setDepth(TITLE_DEPTH)
            .setAlpha(0)
            .setTint(accent);

        const tag = scene.add.text(view.centerX, view.centerY - 118, to.skin.tagline, {
            fontFamily: 'monospace',
            fontSize: '18px',
            color: '#ffffff',
            stroke: '#000000',
            strokeThickness: 4,
        })
            .setOrigin(0.5)
            .setScrollFactor(0)
            .setDepth(TITLE_DEPTH)
            .setAlpha(0)
            .setTint(to.skin.palette.accentDim);

        // No modal and no pause: the title rides along with the climb and takes
        // itself out again. It is the only place a verse says its own name, and
        // it has to be legible over a nebula, hence the readout shadow.
        scene.tweens.add({
            targets: [title, tag],
            alpha: { from: 0, to: 1 },
            duration: 420,
            ease: 'Quad.easeOut',
            onComplete: () => {
                scene.tweens.add({
                    targets: [title, tag],
                    alpha: 0,
                    delay: 900,
                    duration: 520,
                    ease: 'Quad.easeIn',
                    onComplete: () => {
                        title.destroy();
                        tag.destroy();
                    },
                });
            },
        });
    }

    // =====================================================================
    //  Portal scheduling, spawning and firing
    // =====================================================================

    private updatePortal(player: Player): void {
        if (this.transition) return;

        // No new gates once the climb is inside BLEED: that verse's whole
        // escalation is time spent rather than distance travelled, so a gate
        // there would have nowhere left to take the player.
        if (this.current.id === 'BLEED') return;

        if (!this.portal) {
            if (this.ctx.altitudeMeters() >= this.nextPortalAltitude - 60) {
                this.spawnPortal();
            }
            return;
        }

        // The crossing test. `lastPos` is where the player was at the end of the
        // previous frame, so this segment is the path actually travelled - which
        // is what makes a gate reliable at launch speed where a sensor is not.
        if (!this.hasLastPos) {
            this.lastPos.x = player.x;
            this.lastPos.y = player.y;
            this.hasLastPos = true;
        }

        if (this.portal.crossedBy(this.lastPos, player)) {
            this.firePortal('crossing');
            return;
        }

        // Fallback: the player went around the gate at speed, or the route
        // carried them past it. A gate that can be missed forever is a broken
        // feature rather than a challenge, because the climb is unbounded and
        // there is no reason to ever come back down. Generous enough to be rare,
        // and counted separately so it can be measured rather than assumed.
        if (player.y < this.portal.y - PORTAL_FALLBACK_MARGIN) {
            this.firePortal('fallback');
        }
    }

    private spawnPortal(): void {
        const targetY = this.ctx.groundReferenceY() - this.nextPortalAltitude * 10;
        const spot = this.findGateSpot(targetY);
        if (!spot) {
            // The route has not been generated that far ahead yet. Try again on
            // the next frame rather than hanging a gate in empty air.
            return;
        }

        // Resolved ONCE, at spawn. Deciding the destination when the gate fires
        // instead of when it was built would let a gate that took 30 seconds to
        // reach hand the player a different world than the one its colour has
        // been promising for all of them.
        const target = this.nextTarget();
        this.portalTarget = target;

        ensureSkinArt(this.ctx.scene, target.skin);
        this.portal = new Portal(
            this.ctx.scene,
            spot.x,
            spot.y,
            PORTAL_RADIUS,
            target.skin.palette.accent,
            target.skin.id
        );
        this.stats.portalsSpawned++;
    }

    /**
     * Where to hang the gate.
     *
     * Horizontally, between two ledges: the route's nearest platform to the
     * scheduled altitude and its nearest neighbour straddle that altitude, so
     * their midpoint is open air on the flight path - which is the only place a
     * swing reliably goes through. A gate centred on a ledge is one the player
     * is already inside when they stand up.
     *
     * Vertically, in the channel under that pair rather than on the altitude
     * itself (PORTAL_CHANNEL_OFFSET). A tether swings you beneath your anchor,
     * so the flight path sits low; measured on the live route, a gate on the
     * exact altitude was cleared by 167px vertically while passing within 5px
     * horizontally. Both numbers are in definitions.ts.
     */
    private findGateSpot(targetY: number): { x: number; y: number } | null {
        const platforms = this.ctx.platforms();

        let nearest: BasePlatform | null = null;
        let nearestDist = Infinity;
        for (const p of platforms) {
            if (!p || !p.active || !p.body) continue;
            const dist = Math.abs(p.y - targetY);
            if (dist < nearestDist) {
                nearestDist = dist;
                nearest = p;
            }
        }
        if (!nearest || nearestDist > 700) return null;

        let neighbour: BasePlatform | null = null;
        let neighbourDist = Infinity;
        for (const p of platforms) {
            if (!p || !p.active || !p.body || p === nearest) continue;
            // The partner has to be the next hop up or down, not the next ledge
            // along: a neighbour 2000px to the side would put the gate in a wall.
            if (Math.abs(p.x - nearest.x) > 520) continue;
            const straddles = (p.y - targetY) * (nearest.y - targetY) <= 0;
            if (!straddles) continue;
            const dist = Math.abs(p.y - nearest.y);
            if (dist < neighbourDist) {
                neighbourDist = dist;
                neighbour = p;
            }
        }

        const x = neighbour ? (neighbour.x + nearest.x) / 2 : nearest.x;
        // Hung *below* the scheduled altitude, not on it: a tether swings you
        // under your anchor, so the channel two ledges straddle sits lower than
        // the ledge tops. Measured: a gate on the exact altitude was cleared by
        // 167px vertically while passing within 5px horizontally.
        return { x, y: targetY + PORTAL_CHANNEL_OFFSET };
    }

    private nextTarget(): WorldDefinition {
        // Above the BLEED altitude the verse stops being one of four and becomes
        // all of them, so the gate that leads there is coloured by BLEED's own
        // accent rather than by whichever verse happened to be next in line.
        if (this.ctx.altitudeMeters() >= BLEED_ALTITUDE) return WORLDS.BLEED;

        const skin = SKINS[VERSE_ORDER[this.portalIndex % VERSE_ORDER.length]];
        return WORLDS[skin.id];
    }

    private firePortal(reason: 'crossing' | 'fallback'): void {
        const portal = this.portal;
        const target = this.portalTarget;
        if (!portal || !target) return;

        this.portal = null;
        this.portalTarget = null;

        portal.crossingPoint(this.lastPos, this.ctx.player() ?? { x: 0, y: 0 }, this.crossPoint);
        portal.fire();

        this.portalIndex++;
        this.nextPortalAltitude = FIRST_PORTAL_ALTITUDE + this.portalIndex * PORTAL_ALTITUDE_INTERVAL;

        if (reason === 'fallback') {
            this.stats.firedByFallback++;
        } else {
            this.stats.firedByCrossing++;
        }

        // The burst is raised at the point of crossing, so the flash comes from
        // where the player went through rather than from the middle of nowhere.
        this.burst(this.crossPoint.x, this.crossPoint.y, target.skin.palette.accent);
        this.startTransition(target);
    }

    private burst(x: number, y: number, tint: number): void {
        const scene = this.ctx.scene;
        const ring = scene.add.circle(x, y, 30, tint, 0.55)
            .setDepth(OVERLAY_DEPTH - 2)
            .setBlendMode(Phaser.BlendModes.ADD);

        scene.tweens.add({
            targets: ring,
            scale: 6,
            alpha: 0,
            duration: 460,
            ease: 'Quad.easeOut',
            onComplete: () => ring.destroy(),
        });
    }

    // =====================================================================
    //  Platform theming, materials and the crumble multiplier
    // =====================================================================

    private themeNewPlatforms(time: number): void {
        const platforms = this.ctx.platforms();
        const skin = this.current.skin;

        for (const p of platforms) {
            if (!p || !p.active) continue;
            if (this.themed.has(p)) {
                // The flicker runs here rather than on a tween so that a culled
                // platform cannot leave a live tween pointing at a destroyed
                // object. It is one sine per NULL platform per frame.
                if (skin.id === 'NULL' && (p as unknown as Record<symbol, boolean>)[ILLUSORY]) {
                    const wave = Math.sin(time * 0.004 + p.x * 0.021);
                    const blink = Math.sin(time * 0.017 + p.y * 0.013) > 0.93;
                    p.alpha = blink ? 0.22 : 0.55 + 0.45 * (0.5 + 0.5 * wave);
                }
                continue;
            }

            this.themed.add(p);
            this.stats.themedPlatforms++;
            this.applySkinToPlatform(p, skin);
        }
    }

    private rethemeAllPlatforms(): void {
        for (const p of this.ctx.platforms()) {
            if (!p || !p.active) continue;
            // A full re-theme makes every platform new again as far as the
            // WeakSet is concerned, so it has to re-register them: without this
            // the incremental pass would theme them a second time on the next
            // frame and spawn a second pod on every BLOOM ledge.
            if (!this.themed.has(p)) {
                this.themed.add(p);
                this.stats.themedPlatforms++;
            }
            this.applySkinToPlatform(p, this.current.skin);
        }
    }

    /**
     * One tether anchor, dressed for the current verse.
     *
     * The anchor is what the line bites onto, so it is where the world's
     * technology shows: a machined hardpoint in VERGE, a seed pod in BLOOM, a
     * riveted eye-bolt in KILN, a wireframe node in NULL. All four are drawn
     * near-white precisely so that `setTint` still reaches them - an unstable
     * anchor has to be able to go hot pink, and a coloured plate multiplied by
     * pink is mud.
     *
     * `setDisplaySize` is re-asserted after the swap because `setTexture`
     * resets an image to its frame's natural size, and the anchor's 80px is a
     * gameplay dimension rather than a look.
     */
    private applySkinToHook(node: Phaser.Physics.Matter.Image, skin: WorldSkin): void {
        const key = hookNodeTextureKey(skin.id);
        if (!node || !node.active || !this.ctx.scene.textures.exists(key)) return;

        node.setTexture(key);
        node.setDisplaySize(80, 80);

        // Re-asserted rather than remembered: the unstable warning is the one
        // piece of gameplay information on this object, and it must not be
        // something a texture swap is able to lose. Phaser's body union does
        // not agree with Matter on whether `label` is present, so it is read
        // defensively - the label is a hint here, not a protocol.
        const label = (node.body as { label?: string } | undefined)?.label ?? '';
        if (label === 'HookAnchor_Unstable') {
            node.setTint(0xff0066);
        } else {
            node.clearTint();
        }
    }

    private themeNewHooks(): void {
        const hooks = this.ctx.generator()?.getHookNodes();
        if (!hooks) return;

        const skin = this.current.skin;
        for (const node of hooks) {
            if (!node || !node.active) continue;
            if (this.themedHooks.has(node)) continue;
            this.themedHooks.add(node);
            this.applySkinToHook(node, skin);
        }
    }

    /** The whole anchor set at once, for the two moments a verse changes. */
    private rethemeAllHooks(): void {
        const hooks = this.ctx.generator()?.getHookNodes();
        if (!hooks) return;

        const skin = this.current.skin;
        for (const node of hooks) {
            if (!node || !node.active) continue;
            if (!this.themedHooks.has(node)) this.themedHooks.add(node);
            this.applySkinToHook(node, skin);
        }
    }

    /**
     * One platform, dressed for the current verse.
     *
     * Two decisions live here that look cosmetic and are not.
     *
     * Crumbling and risk platforms keep the ORIGINAL tints in every verse. They
     * are semantics, not scenery: amber means the coins are on this ledge, and
     * the fuchsia fringe means this ledge gives way. A player learns those two
     * colours once and reads them at 120px wide in a fast arc; remapping them
     * to a verse's palette would trade a law the game already has for a
     * consistency nobody asked for.
     *
     * What they no longer keep is the original GEOMETRY. They carry the verse's
     * own ledge, duotoned neutrally. The reason they used to share one hull was
     * that it was the only plate neutral enough to multiply into either warning
     * colour and read identically in all four worlds - and KILN's own ledge is
     * orange, so an orange ledge tinted amber is a hazard the player cannot see
     * coming. Geometry belongs to the verse; the colour still belongs to the
     * law.
     *
     * The material multipliers apply to every platform including those two,
     * because a brittle ledge in KILN should be brittle whether it is fragile
     * ground or not.
     */
    private applySkinToPlatform(p: BasePlatform, skin: WorldSkin): void {
        const props = p.surfaceProps;
        const visualWidth = p.displayWidth;
        const visualHeight = p.displayHeight;

        this.applyCrumbleMultiplier(p);

        let key = platformTextureKey(skin.id);
        let tint = 0xffffff;
        if (skin.id !== 'VERGE') {
            // Verse geometry on a neutral plate, so the warning tints below land
            // on something with no hue of its own. The shared hull is the
            // fallback if that plate is somehow absent: a warning that is briefly
            // drawn in the old style still reads as a warning, and a missing
            // texture does not.
            const warn = warningPlatformTextureKey(skin.id);
            const warnKey = this.ctx.scene.textures.exists(warn) ? warn : SHARED_PLATFORM_KEY;
            if (p.surfaceProps.isCrumbling) {
                key = warnKey;
                tint = 0xd946ef;
            } else if (p.surfaceProps.isRisk) {
                key = warnKey;
                tint = 0xffb347;
            }
        }

        if (p.texture.key !== key) {
            // setTexture keeps the scale, and the scale was derived from the old
            // frame's pixel size, so the display box - and therefore where the
            // player's feet land relative to the art - would change with it.
            p.setTexture(key);
            p.setDisplaySize(visualWidth, visualHeight);
        }
        p.setTint(tint);
        p.alpha = 1;

        const body = p.body;
        if (body) {
            // Read the BASE values the generator stored, never the modulated
            // ones, so re-theming on a world change cannot compound.
            body.restitution = Math.min(0.6, props.restitution * this.current.multipliers.bounce);
            body.friction = Math.min(1, props.friction * this.current.multipliers.grip);
        }

        if (skin.id === 'BLOOM' && !p.surfaceProps.isRisk && !p.surfaceProps.isCrumbling) {
            this.maybeSpawnPod(p);
        }

        if (
            skin.id === 'NULL' &&
            !p.surfaceProps.isRisk &&
            !p.surfaceProps.isCrumbling &&
            !(p as unknown as Record<symbol, boolean>)[ILLUSORY]
        ) {
            // The roll happens once per platform and then sticks to it. The
            // incremental pass skips anything already themed, so this cannot
            // re-roll a platform that has been decided.
            (p as unknown as Record<symbol, boolean>)[ILLUSORY] = Math.random() < 0.32;
        }
    }

    /**
     * The crumble multiplier, applied by rolling the base tables again rather
     * than by editing them.
     *
     * LevelGenerator decides crumbling from GAME_CONSTANTS.HAZARD at spawn time
     * and owns that decision, so the verse adjusts the outcome: below 1 it
     * un-marks ledges the generator called fragile, above 1 it marks ledges the
     * generator left solid using the same table read. Both are the same
     * multiplier on the same number, taken at the point of use.
     */
    private applyCrumbleMultiplier(p: BasePlatform): void {
        const mult = this.current.multipliers.crumbleRate;
        if (mult === 1) return;
        if (p.isCrumblingTriggered) return;

        const props = p.surfaceProps;
        const tier = tierForAltitude(this.ctx.altitudeMeters());
        const base = props.isRisk
            ? GAME_CONSTANTS.HAZARD.riskCrumble[tier]
            : GAME_CONSTANTS.HAZARD.crumble[tier];

        if (mult < 1 && props.isCrumbling) {
            // The generator already rolled a `base` chance and won. Keeping that
            // outcome with probability `mult` leaves the effective rate at
            // base * mult, which is the multiplier doing exactly what it says.
            if (Math.random() > mult) props.isCrumbling = false;
        } else if (mult > 1 && !props.isCrumbling) {
            if (base > 0 && Math.random() < base * (mult - 1)) props.isCrumbling = true;
        }
    }

    // =====================================================================
    //  Hazard density
    // =====================================================================

    private thinHazards(): void {
        const density = this.current.multipliers.hazardDensity;
        if (density >= 1) return;

        const hazards = this.ctx.generator()?.getHazards();
        if (!hazards) return;

        for (const h of hazards) {
            if (!h || !h.active) continue;
            if (this.hazarded.has(h)) continue;
            this.hazarded.add(h);

            if (Math.random() > density) {
                // destroy() removes the sensor body as well, and the generator's
                // own cull drops the reference on the next pass, so nothing is
                // left pointing at this hazard.
                h.destroy();
                this.stats.thinnedHazards++;
            }
        }
    }

    // =====================================================================
    //  Verse behaviour: BLOOM pods, KILN heat, NULL lies, BLEED cycling
    // =====================================================================

    private updateVerseBehaviour(time: number, delta: number, player: Player): void {
        const id = this.current.id;

        if (id === 'BLEED') {
            this.updateBleed(delta);
        }

        if (this.current.skin.id === 'BLOOM') {
            this.updatePods(time, player);
        } else if (this.pods.length > 0) {
            this.clearPods();
            this.releaseDrag(player);
        }

        if (this.current.skin.id === 'KILN') {
            this.updateKilnHeat(time, delta, player);
        } else {
            this.releaseHeat();
        }

        if (this.current.skin.id === 'NULL') {
            this.updateIllusory(player);
        }
        this.wasHooked = this.ctx.pivotEngine()?.isCurrentlyHooked() ?? false;
    }

    // --- BLOOM ------------------------------------------------------------

    private maybeSpawnPod(p: BasePlatform): void {
        if (this.pods.length > 24) return;
        if (Math.random() > POD_CHANCE) return;

        const scene = this.ctx.scene;
        const top = p.y - p.displayHeight / 2;
        const x = p.x + Phaser.Math.FloatBetween(-p.displayWidth * 0.3, p.displayWidth * 0.3);

        const sprite = scene.add.image(x, top - 10, POD_TEXTURE_KEY)
            .setDepth(22)
            .setTint(0xa8ffcf)
            .setDisplaySize(46, 40);

        scene.tweens.add({
            targets: sprite,
            scaleX: sprite.scaleX * 1.12,
            scaleY: sprite.scaleY * 0.9,
            duration: 1400 + Math.random() * 900,
            yoyo: true,
            repeat: -1,
            ease: 'Sine.easeInOut',
        });

        this.pods.push({ sprite, platform: p, gunkUntil: 0 });
    }

    /**
     * The sticky pods.
     *
     * "Degrade the tether" is implemented as air drag on the player rather than
     * as a change to the rope, and that is a deliberate trade: the honest
     * version would shorten the tether or weaken the swing drive, both of which
     * live in PivotEngine and would put a second system's file into this
     * feature's diff. Drag is felt in exactly the same place - the swing loses
     * energy and the arc comes up short - and it is one line of engine semantics
     * (`frictionAir`) rather than a hand-rolled force.
     */
    private updatePods(time: number, player: Player): void {
        const playerBody = player.body;
        if (!playerBody) return;

        let gunked = false;

        for (let i = this.pods.length - 1; i >= 0; i--) {
            const pod = this.pods[i];

            if (!pod.platform.active || pod.platform.y - player.y > GAME_CONSTANTS.PROCEDURAL.CULL_DISTANCE) {
                this.destroyPod(pod);
                this.pods.splice(i, 1);
                continue;
            }

            if (time < pod.gunkUntil) gunked = true;

            if (pod.gunkUntil === 0) {
                const dx = pod.sprite.x - player.x;
                const dy = pod.sprite.y - player.y;
                if (dx * dx + dy * dy <= POD_GRAB_RADIUS * POD_GRAB_RADIUS) {
                    pod.gunkUntil = time + POD_GUNK_MS;
                    gunked = true;
                    this.stats.podsTriggered++;
                    this.spoilPod(pod.sprite.x, pod.sprite.y);
                }
            }
        }

        // Base air drag for the current state, plus the pod's contribution. Read
        // from the constants rather than from the body, because the body's value
        // is the one this line is about to overwrite.
        const base = player.playerState === 'LAUNCHED'
            ? GAME_CONSTANTS.SWING.FRICTION_AIR
            : player.playerState === 'FALLING'
                ? GAME_CONSTANTS.SWING.FALLING_FRICTION_AIR
                : GAME_CONSTANTS.PLAYER.FRICTION_AIR;

        playerBody.frictionAir = gunked ? base + 0.075 : base;
    }

    /**
     * Hands the tether's air drag back to the game.
     *
     * While BLOOM is live this class writes `frictionAir` last each frame so its
     * contribution cannot be overwritten mid-frame. Leaving the verse has to
     * undo that explicitly, because the base value it replaced depends on the
     * player's state and that state may not change again for several seconds.
     */
    private releaseDrag(player: Player): void {
        const body = player.body;
        if (!body) return;

        body.frictionAir =
            player.playerState === 'LAUNCHED'
                ? GAME_CONSTANTS.SWING.FRICTION_AIR
                : player.playerState === 'FALLING'
                    ? GAME_CONSTANTS.SWING.FALLING_FRICTION_AIR
                    : GAME_CONSTANTS.PLAYER.FRICTION_AIR;
    }

    private spoilPod(x: number, y: number): void {
        const emitter = this.ctx.scene.add.particles(x, y, particleTextureKey('SPORES'), {
            speed: { min: 30, max: 90 },
            lifespan: 700,
            quantity: 7,
            scale: { start: 0.8, end: 0 },
            alpha: { start: 0.85, end: 0 },
            tint: [0x9dffd6, 0x63ffb3, 0xd8ffe9],
            emitting: false,
            maxAliveParticles: 24,
        }).setDepth(OVERLAY_DEPTH - 2);

        emitter.explode(7);
        this.ctx.scene.time.delayedCall(760, () => emitter.destroy());
    }

    private destroyPod(pod: Pod): void {
        this.ctx.scene.tweens.killTweensOf(pod.sprite);
        pod.sprite.destroy();
    }

    private clearPods(): void {
        for (const pod of this.pods) this.destroyPod(pod);
        this.pods.length = 0;
    }

    // --- KILN -------------------------------------------------------------

    /**
     * The ground radiates. Stand still on it and it gives way.
     *
     * This is KILN's answer to "heat proximity": rather than a status bar or a
     * temperature readout, the hazard is the thing the player is already doing -
     * resting - becoming expensive. It reuses the crumble machinery so the
     * warning is the shake the player already knows means "this ledge is going",
     * and it gives the verse a character that no amount of extra gravity can.
     */
    private updateKilnHeat(time: number, delta: number, player: Player): void {
        const ground = this.platformUnderPlayer(player);

        if (player.playerState !== 'IDLE' || !ground) {
            this.releaseHeat();
            return;
        }

        if (this.heatPlatform !== ground) {
            this.releaseHeat();
            this.heatPlatform = ground;
        }

        this.heatMs += delta;
        const ratio = Math.min(1, this.heatMs / KILN_HEAT_MS);

        // The ledge itself is the gauge. It warms from the verse's own material
        // colour toward the ember end, so the read is in the world rather than
        // on the HUD - which is also the only place a verse is allowed to put it.
        ground.setTint(lerpColor(0xffffff, 0xff7828, ratio));

        if (ratio >= 1 && !ground.isCrumblingTriggered) {
            ground.surfaceProps.isCrumbling = true;
            ground.triggerCrumble();
            this.stats.kilnScorches++;
            this.ctx.scene.cameras.main.shake(140, 0.006);
            this.heatMs = 0;
            this.heatPlatform = null;
        }
    }

    private releaseHeat(): void {
        this.heatMs = 0;
        if (this.heatPlatform && this.heatPlatform.active) {
            this.heatPlatform.setTint(0xffffff);
        }
        this.heatPlatform = null;
    }

    /**
     * The ledge the player is standing on, if any.
     *
     * Same measure GameScene settles with: the physics body's bottom against the
     * platform's drawn top. Using the sprite's own height instead would look at
     * the wrong place entirely - the art hangs below the collision box - and
     * KILN's whole hazard would then never see the player standing on it.
     */
    private platformUnderPlayer(player: Player): BasePlatform | null {
        if (!player.body) return null;

        const feetY = player.body.position.y + GAME_CONSTANTS.PLAYER.RADIUS;
        const x = player.body.position.x;

        for (const p of this.ctx.platforms()) {
            if (!p || !p.active || !p.body) continue;
            const top = p.body.position.y - p.displayHeight / 2;
            if (Math.abs(p.body.position.x - x) > p.displayWidth / 2) continue;
            if (Math.abs(feetY - top) > 26) continue;
            return p;
        }
        return null;
    }

    // --- NULL -------------------------------------------------------------

    /**
     * The lie.
     *
     * An illusory platform looks like ground right up until the moment the
     * tether takes hold, and then it is not ground. The tell is that it flickers
     * harder than the rest of a verse that is flickering anyway, which is a fair
     * warning at 120px and an unreadable one at speed - which is the point.
     *
     * Only platforms ABOVE the player are dissolved. The one underfoot staying
     * solid is what keeps this a deception rather than a coin flip: the player
     * always has the ledge they are standing on, and loses the one they were
     * aiming at.
     */
    private updateIllusory(player: Player): void {
        const hooked = this.ctx.pivotEngine()?.isCurrentlyHooked() ?? false;
        if (!hooked || this.wasHooked) return;

        let target: BasePlatform | null = null;
        let targetDist = Infinity;

        for (const p of this.ctx.platforms()) {
            if (!p || !p.active || !p.body) continue;
            if (!(p as unknown as Record<symbol, boolean>)[ILLUSORY]) continue;
            const dy = player.y - p.y;
            if (dy < 40 || dy > 520) continue;
            const dist = Math.hypot(p.x - player.x, dy);
            if (dist < targetDist) {
                targetDist = dist;
                target = p;
            }
        }

        if (!target) return;

        this.dissolve(target);
    }

    private dissolve(p: BasePlatform): void {
        const scene = this.ctx.scene;
        this.stats.dissolvedIllusory++;

        // The body goes first so the ground stops existing the frame the tether
        // takes hold, rather than half a second later when the tween ends. The
        // sprite is left to fade so the player sees what happened.
        if (p.body) {
            scene.matter.world.remove(p.body);
            p.body = undefined as unknown as MatterJS.BodyType;
        }

        scene.tweens.add({
            targets: p,
            alpha: 0,
            scaleX: p.scaleX * 0.82,
            duration: 260,
            ease: 'Quad.easeIn',
            onComplete: () => {
                if (p.active) p.destroy();
            },
        });
    }

    // --- BLEED ------------------------------------------------------------

    /**
     * The four verses, at once, escalating.
     *
     * Rather than a fifth set of numbers, BLEED rotates the four real ones and
     * multiplies the whole set by a factor that climbs with time spent there.
     * That is the payoff the endless climb has been promising: the rules stop
     * being one verse's rules and become all of them, and they keep getting
     * worse for as long as the player can hold on.
     */
    private updateBleed(delta: number): void {
        this.bleedMs += delta;
        if (this.bleedMs < BLEED_PHASE_MS) return;

        this.bleedMs = 0;
        this.bleedPhase = (this.bleedPhase + 1) % VERSE_ORDER.length;

        const escalation = 1 + Math.min(0.6, this.bleedPhase * 0.13);
        const base = WORLDS.BLEED.multipliers;

        this.startTransition({
            id: 'BLEED',
            skin: SKINS[VERSE_ORDER[this.bleedPhase]],
            multipliers: {
                gravity: base.gravity * escalation,
                bounce: base.bounce * escalation,
                grip: Math.max(0.45, base.grip - (escalation - 1) * 0.3),
                hazardDensity: Math.min(1, base.hazardDensity * escalation),
                crumbleRate: base.crumbleRate * escalation,
            },
        });
    }

    // =====================================================================
    //  Ambient particles and the backdrop tint
    // =====================================================================

    private swapAmbient(to: WorldSkin): void {
        const sameEmitter = to.ambient !== 'NONE' && to.ambient === this.ambientKind;

        // Stopping kills every live particle, which is the point when the verse
        // is genuinely leaving - but doing it between two verses that share an
        // emitter would visibly clear the screen for no reason.
        if (!sameEmitter && this.ambient) {
            this.ambient.stop(true);
            this.ambient.setActive(false);
            this.ambient.setVisible(false);
        }

        if (to.ambient === 'NONE') {
            this.ambientKind = 'NONE';
            return;
        }
        if (sameEmitter && this.ambient?.active) return;

        const emitter = this.getAmbient(to.ambient);
        if (!emitter) return;

        this.ambientKind = to.ambient;
        emitter.setActive(true).setVisible(true);
        emitter.setParticleTint(to.palette.accent);
        emitter.flow(this.ambientFrequency(to.ambient));
    }

    /** Emission interval per kind. Read at flow time so a reconfigure is one call. */
    private ambientFrequency(kind: Exclude<WorldSkin['ambient'], 'NONE'>): number {
        return kind === 'GLITCH' ? 26 : 110;
    }

    /**
     * Builds the one ambient emitter the game will ever need.
     *
     * It is created once, on first use, and reconfigured per verse afterwards:
     * the particle pool is pre-allocated (`reserve`) so the first verse to ask
     * for spores pays for the objects and every later verse reuses them. That is
     * the difference between a transition that costs a few bytes and one that
     * costs a garbage-collection pause at the exact frame the player is flying
     * through a gate.
     */
    private getAmbient(kind: Exclude<WorldSkin['ambient'], 'NONE'>): Phaser.GameObjects.Particles.ParticleEmitter | null {
        if (this.ambient) return this.ambient;

        const scene = this.ctx.scene;
        const { width, height } = scene.scale;

        const base = {
            depth: OVERLAY_DEPTH - 5,
            maxAliveParticles: 180,
            reserve: 180,
            lifespan: 13000,
            scale: { start: 0.75, end: 0.2 },
            alpha: { start: 0.5, end: 0 },
        };

        let config: Phaser.Types.GameObjects.Particles.ParticleEmitterConfig;

        if (kind === 'GLITCH') {
            config = {
                ...base,
                x: { min: -40, max: width + 40 },
                y: { min: -40, max: height + 40 },
                lifespan: 520,
                frequency: 26,
                quantity: 2,
                maxAliveParticles: 90,
                scale: { start: 1, end: 0.4 },
                alpha: { start: 0.9, end: 0 },
                speedX: 0,
                speedY: 0,
            };
        } else {
            // Born just under the screen and drifting up, so nothing ever pops
            // into existence in the middle of the view: spores rise out of the
            // overgrowth and embers out of the kiln, which is where both of them
            // are supposed to come from anyway.
            config = {
                ...base,
                x: { min: -30, max: width + 30 },
                y: height + 60,
                speedX: { min: -18, max: 18 },
                speedY: { min: -130, max: -70 },
                frequency: 110,
                quantity: 1,
            };
        }

        const texture = particleTextureKey(kind);
        const emitter = scene.add.particles(0, 0, texture, config);
        // The ambient layer is screen furniture, not world furniture: without
        // this the field it was created with (a valid but unset 1) would leave
        // spores scrolling away with the climb instead of hanging in the air.
        emitter.setScrollFactor(0);
        emitter.stop();
        this.ambient = emitter;
        return emitter;
    }

    /**
     * The backdrop is shared geometry - one tile of nebula and a dozen recycled
     * asteroids - so a verse reaches into it and multiplies it rather than
     * replacing it. The recolour happens once per verse, not per frame, because
     * `restyleBackgroundObject` re-uses the tint when it recycles an object.
     */
    private applyTintToBackdrop(skin: WorldSkin): void {
        const layer = this.ctx.backgroundLayer();
        if (layer) layer.setTint(skin.palette.nebulaTint);

        for (const object of this.ctx.backgroundObjects()) {
            if (!object || !object.active) continue;
            // The starfield keeps a lighter hand: multiplying a near-black star
            // texture by a strong accent removes it from the sky entirely.
            const texture = object.texture.key;
            const strength = texture.includes('stars') ? 0.55 : 1;
            object.setTint(lerpColor(0xffffff, skin.palette.propTint, strength));
        }
    }

    // =====================================================================
    //  Teardown
    // =====================================================================

    private dispose(): void {
        this.ctx.scene.events.off('shutdown', this.onShutdown);

        if (this.portal) {
            this.portal.destroy();
            this.portal = null;
            this.portalTarget = null;
        }

        this.clearPods();
        this.releaseHeat();

        if (this.ambient) {
            // `stop(true)` kills the live particles; that is the memory release.
            // The emitter itself is left for the scene to take down with it.
            this.ambient.stop(true);
            this.ambient = null;
        }

        this.transition = null;
    }
}
