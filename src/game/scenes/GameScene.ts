import Phaser, { Scene } from "phaser";
import { Player } from "../entities/Player";
import { GAME_CONSTANTS } from "../config/game-constants";
import { environmentForAltitude, hazardStateForAltitude, profileForAltitude } from "../config/difficulty";
import { BasePlatform } from "../terrain/BasePlatform";
import { Coin, createCoinTexture } from "../terrain/Coin";
import { PivotEngine } from "../physics/PivotEngine";
import { LevelGenerator } from "../levels/LevelGenerator";
// [WORLDS] One import. Everything the portal system does to the scene enters
// through this type; see the field declaration below for why it is a single
// boundary rather than a set of scattered hooks.
import { WorldManager, type WorldContext } from "../worlds/WorldManager";
import { preloadAllSkinArt } from "../worlds/theming";
import { getCurrentRun, getCurrentRunOwner } from "../run-session";
import type { ServerRun } from "@/src/lib/server-run";
import {
    fetchServerBest,
    queuePendingRun,
    readStoredBest,
    submitPendingRun,
    writeStoredBest,
    type PendingRun,
} from "@/src/lib/score-store";

/**
 * Vertical speed below which the player counts as settled rather than flying past.
 *
 * Matter's velocity is in pixels per timestep, so this is small. It exists to stop
 * a fast arc that clips a platform on the way up from banking a haul.
 */
const BANKING_REST_SPEED = 2;

/** How far the player's feet may sit from a platform top and still count as a landing. */
const BANKING_FOOT_TOLERANCE = 18;

/**
 * How far outside the camera the sky may drift before it is moved back.
 *
 * The background is scenery, and scenery is scattered across a band rather
 * than pinned to the world: an object that has drifted out of the frame is put
 * back on the other side of it, so the sky is as full at 5000m as it is at 5m.
 */
const BACKGROUND_MARGIN = 1400;

/**
 * How far beyond the visible edge the sky is drawn, in world units.
 *
 * The sky is anchored from the camera's scroll during update(), but the camera
 * runs its follow lerp during preRender, so the anchor is always a frame
 * behind. A camera moving a hundred units a frame would otherwise open a
 * sliver of bare page at the edge on alternating frames.
 */
const BACKGROUND_OVERSCAN = 220;

/**
 * The stretch of mountain the window must always show, in world units.
 *
 * 1600 is the design height, and a 390x844 phone already shows exactly all of
 * it under the old scaling. Locking every viewport to it means a monitor gets
 * the same run rendered larger rather than a different run rendered small: the
 * player is 52px on a phone and 55px at 1440x900, instead of 184px on a
 * 1080p screen where it was, because the window's height, not its aspect
 * ratio, decides how much world there is.
 */
const DESIGN_HEIGHT = 1600;

/**
 * How wide the view may get, in world units, before the height rule is
 * overridden.
 *
 * The mountain is 2300 units wide (the corridor in the generator), so a view
 * up to about 3000 shows the whole thing with a little sky either side. Beyond
 * that the corridor becomes a stripe in the middle of an empty screen, and it
 * is better to give up some height than to give the player a letterbox. It
 * only binds on windows wider than about 2.6:1.
 */
const MAX_VIEW_WIDTH = 3000;

export class GameScene extends Scene {
    private player!: Player;
    private pivotEngine!: PivotEngine;
    private levelGenerator!: LevelGenerator;
    private platforms: BasePlatform[] = [];
    private backgroundLayer!: Phaser.GameObjects.TileSprite;
    private backgroundObjects: Phaser.GameObjects.Image[] = [];
    private tetherGraphics!: Phaser.GameObjects.Graphics;

    /**
     * [WORLDS] Owns the portal system and everything that is not the climb.
     *
     * It is given a context of getters rather than references, because this
     * scene rebuilds its generator and its platform list across restarts and a
     * captured reference would quietly point at the previous run's world. The
     * scene's own play, input, tether and death logic are untouched by it: the
     * only two things it asks of the scene are a tick at the end of update() and
     * the state it can already read.
     */
    private worldManager?: WorldManager;

    private readonly backgroundObjectTextures = [
        'background-asteroid-1',
        'background-asteroid-2',
        'background-planet-big',
        'background-planet-small',
        'background-blue-stars',
    ];


    private groundReferenceY: number = 1200;
    private maxAltitudeMeters: number = 0;

    /**
     * Coins held this run.
     *
     * PENDING are on the mountain and lost if the run ends before they are banked.
     * BANKED are safe, and survive the run, because coins are never spent.
     *
     * Banking happens by landing on ordinary ground. That is what keeps a risk line
     * a decision rather than a gift: the coins are only yours once you have proven
     * you can still climb.
     */
    private pendingCoins: number = 0;
    private bankedCoins: number = 0;

    /**
     * Coins banked during THIS run, as distinct from the persistent total.
     *
     * The score submission is about one run: `bankedCoins` is the player's
     * lifetime balance seeded from the cloud, and sending it back as this run's
     * haul would credit the same coins again on every climb. This counter is
     * reset when a run begins and is the only number the submission sends.
     */
    private runBankedCoins: number = 0;

    /** The server-issued run this scene is building, if any. */
    private serverRun: ServerRun | null = null;

    /** The account this run was opened for. Finished runs are filed under it. */
    private runOwner: string | null = null;

    private currentAltitudeMeters: number = 0; // Live altitude used to pick the difficulty tier
    private levelSeed: number = 0;

    private runLowestY: number = 0; // Tracks the highest point reached THIS run to move the death-zone up

    /**
     * The personal best as it stood before this run began.
     *
     * `maxAltitudeMeters` is raised by the run itself while the player climbs,
     * so by the time the run ends it already contains this run's own peak. Any
     * question of the form "was this a record?" asked against it compares the
     * peak with itself and always answers no - which is why the game-over
     * screen has never once shown its New record mark. This holds the number
     * the player was actually chasing.
     */
    private bestBeforeRun: number = 0;

    private isGameOver: boolean = false;
    private cameraFollowOffsetX: number = 0;
    private lastHazardImpactTime: number = 0;
    private playerIsFrayed: boolean = false;

    constructor() {
        super("GameScene");
    }

    init() {
        // The server owns the run's identity and its world. A fresh game is
        // created for every run, so reading the store here captures exactly
        // the run this scene belongs to; a null means development or an
        // unscored boot, which falls back to a local seed.
        this.serverRun = getCurrentRun();
        this.runOwner = getCurrentRunOwner();
        this.runBankedCoins = 0;

        // The player's best, from the cached placeholder the menu painted with.
        // It is keyed by account, and it is only a placeholder: the answer is
        // whichever number `GET /api/score` returns a moment from now, and that
        // one overwrites this. Nothing in this scene ever *saves* a best - a
        // climb is saved by the API and read back from it.
        this.maxAltitudeMeters = this.runOwner ? readStoredBest(this.runOwner) : 0;

        // Snapshot before the run can touch it. The cloud fetch below is seeded
        // afterwards so a higher stored best reaches this snapshot too.
        this.bestBeforeRun = this.maxAltitudeMeters;

        // 🚀 Fire off the background fetch to sync with the cloud
        this.loadDatabaseHighScore();
    }

    public dispatchAltitudeUpdate() {
        if (typeof window !== 'undefined') {
            const zone = this.levelGenerator ? this.levelGenerator.getZoneName(this.currentAltitudeMeters) : 'SURFACE';
            window.dispatchEvent(new CustomEvent('tetherverse:altitude-update', {
                detail: {
                    altitude: this.currentAltitudeMeters,
                    maxAltitude: this.maxAltitudeMeters,
                    zone,
                }
            }));
        }
    }

    // Fetch the high score from the database and update the static variable
    private async loadDatabaseHighScore() {
        // The API is the source of truth for a best: this is not a merge with a
        // local number, it is the number. `fetchServerBest` needs a verified
        // Excel Play identity and answers null when there is none, so an
        // anonymous boot keeps the placeholder instead of resetting to zero.
        const cloud = await fetchServerBest();
        if (!cloud) return;

        // The cloud is also reporting a pre-run value, and it can land well
        // after the player has started climbing. Raised unconditionally rather
        // than only when it beats the live figure: a cloud best that the run has
        // already overtaken is still the best that existed when the run began,
        // and dropping it would announce a record the player had in fact already
        // broken on an earlier visit.
        this.bestBeforeRun = Math.max(this.bestBeforeRun, cloud.best);

        if (cloud.best > this.maxAltitudeMeters) {
            this.maxAltitudeMeters = cloud.best;

            // Refresh the placeholder the menu paints with, so the next boot is
            // instant and correct. It is still only a cache of this answer.
            if (this.runOwner) writeStoredBest(this.runOwner, cloud.best);

            this.dispatchAltitudeUpdate();
        }

        // Coins are seeded outside the altitude branch: a player who has never
        // scored can still hold coins from earlier runs, so a 0m best must not
        // hide them.
        this.bankedCoins = cloud.coins;
    }

    preload() {
        // Drawn here rather than shipped as a PNG, so the coin cannot go missing
        // from the asset folder and fail silently as a missing-texture warning.
        createCoinTexture(this);

        this.load.image('game-background', '/background/background.png');
        this.load.image('background-asteroid-1', '/background/objects/asteroid-1.png');
        this.load.image('background-asteroid-2', '/background/objects/asteroid-2.png');
        this.load.image('hazard-asteroid-1', '/background/objects/asteroid-1.png');
        this.load.image('hazard-asteroid-2', '/background/objects/asteroid-2.png');
        this.load.image('background-blue-stars', '/background/objects/blue-stars.png');
        // this.load.image('background-blue-with-stars', '/background/objects/blue-with-stars.png');
        this.load.image('background-planet-big', '/background/objects/prop-planet-big.png');
        this.load.image('background-planet-small', '/background/objects/prop-planet-small.png');
        this.load.image('multiverse_platform', '/assets/platform.png');
        this.load.image('hook_node', '/assets/hook_node.png');

        // Load the player sprite sheet
        this.load.spritesheet('hero_sheet', '/character/hero.png', {
            frameWidth: 280,
            frameHeight: 280,
            margin: 0,
            spacing: 0
        });
    }

    create() {
        this.backgroundLayer = this.add.tileSprite(0, 0, this.scale.width, this.scale.height, 'game-background')
            .setOrigin(0, 0)
            // World-space, and re-anchored to the camera's view every frame in
            // updateBackgroundMotion.
            //
            // It was scrollFactor(0), which pins a sprite to the frame under
            // zoom 1 and stops doing so the moment there is a zoom: the sky
            // came off the top and the left of the screen and left bare page
            // showing. Anchoring to worldView instead is true by construction -
            // the sprite is the rectangle the camera is looking at - and it
            // needs no special case for the scale mode, so the next person to
            // change how the window is sized does not have to find this again.
            .setScrollFactor(1)
            .setDepth(-2000)
            .setTileScale(3.5, 3.5);

        // The view is sized before anything is scattered against it: the sky's
        // band, the recycle edges and the line the run ends on are all measured
        // in world units of the view, and none of them has a value until the
        // camera knows how big the window is.
        this.applyViewport();
        this.scale.on(Phaser.Scale.Events.RESIZE, this.applyViewport, this);
        this.events.once("shutdown", () => {
            this.scale.off(Phaser.Scale.Events.RESIZE, this.applyViewport, this);
        });

        this.seedBackgroundObjects();

        this.matter.world.setGravity(0, GAME_CONSTANTS.WORLD.GRAVITY_Y);
        // The world is taller than any climb. The walls are the only part of
        // the Matter world with an extent, so they are drawn high enough that
        // no run will ever reach the top of them: their job is to stop a
        // player who has drifted sideways from leaving the mountain, and they
        // have to be there at every altitude to do it. The floor is left open
        // so falling into the void is unrestricted.
        this.matter.world.setBounds(
            0,
            -GAME_CONSTANTS.WORLD.BOUNDS_HEIGHT / 2,
            5000,
            GAME_CONSTANTS.WORLD.BOUNDS_HEIGHT,
            64,
            true,
            true,
            false,
            false
        );

        this.tetherGraphics = this.add.graphics();
        this.tetherGraphics.setDepth(90);

        // Inside src/game/scenes/GameScene.ts -> create()

        if (!this.anims.exists('hero_idle')) {
            // Row 1: Subtle 2-frame breathing idle (frames 1-2). Frames 0 and 3-4 in the
            // sheet are not center-aligned with the rest of the row, so looping the full
            // row makes the sprite visibly slide/hop; frames 1-2 share the same baseline.
            this.anims.create({
                key: 'hero_idle',
                frames: this.anims.generateFrameNumbers('hero_sheet', { start: 1, end: 2 }),
                frameRate: 2,
                repeat: -1
            });

            // Row 3: Freefall / Tumbling Down (Frames 10 to 14)
            this.anims.create({
                key: 'hero_fall',
                frames: this.anims.generateFrameNumbers('hero_sheet', { start: 10, end: 14 }),
                frameRate: 10,
                repeat: 0
            });

            // Row 4: Air-Drifting / Reaching Pose (Frames 15 to 19)
            this.anims.create({
                key: 'hero_swing',
                frames: this.anims.generateFrameNumbers('hero_sheet', { start: 15, end: 19 }),
                frameRate: 10,
                repeat: 0
            });
        }

        // Replace the platform & player initialization inside create() in GameScene.ts:

        // --- STARTING PLATFORM & PLAYER SPAWN FIX ---
        const standardProps = { friction: 0.9, restitution: 0.05 };

        // 1. Center starting platform at x = 250 (directly in line with tutorial lane)
        const platformX = 250;
        const platformY = this.groundReferenceY + 20;

        // Standardize all terrain as BasePlatform (visual = 280x80, matching the old sprite)
        const startPlatform = new BasePlatform(this, platformX, platformY, 140, 40, standardProps);

        const spawnX = startPlatform.x; // Exact center X of the platform body

        // Compute the surface spawn point BEFORE instantiating the player so it never
        // starts at Y=0 and drops from the sky on frame 1.
        const spawnY =
            startPlatform.y -
            (startPlatform.displayHeight / 2) -
            GAME_CONSTANTS.PLAYER.RADIUS;

        // Create player centered directly on the platform's top surface
        this.player = new Player(this, spawnX, spawnY);

        // Store the start platform in the standard array so it is treated uniformly
        this.platforms.push(startPlatform);

        // Reset velocity/forces and set initial state so gravity does not yank Jack down
        this.player.updateState("IDLE");

        this.matter.body.setVelocity(this.player.body, { x: 0, y: 0 });
        this.matter.body.setAngularVelocity(this.player.body, 0);

        const body = this.player.body as MatterJS.BodyType;
        body.force.x = 0;
        body.force.y = 0;
        body.torque = 0;

        // Initialize PivotEngine
        this.pivotEngine = new PivotEngine(this, this.player);

        // --- TUTORIAL ANCHORS & TEXT ALIGNMENT ---
        // Placed ahead at x = 450 for a clean diagonal grapple line
        this.platforms.push(
            new BasePlatform(this, 450, this.groundReferenceY - 150, 120, 40, standardProps)
        );

        // IN-WORLD TUTORIAL TEXT: Guides the player's eyes and actions perfectly.
        // Positioned directly above the first hook node (~460, 953) so the hint
        // truly points at the tappable anchor.
        this.add.text(390, this.groundReferenceY - 330, "1. Tap & HOLD here to Hook", {
            fontSize: "24px",
            fontFamily: "monospace",
            color: "#00ffcc",
            stroke: "#000000",
            strokeThickness: 4
        }).setOrigin(0.5, 0.5).setDepth(60);

        this.add.text(390, this.groundReferenceY - 290, "↓", {
            fontSize: "24px",
            fontFamily: "monospace",
            color: "#00ffcc",
            stroke: "#000000",
            strokeThickness: 4
        }).setOrigin(0.5, 0.5).setDepth(60);

        this.add.text(350, this.groundReferenceY - 50, "2. Keep holding to swing\n3. Release to LAUNCH!", {
            fontSize: "18px",
            fontFamily: "monospace",
            color: "#ffffff",
            align: "center",
            stroke: "#000000",
            strokeThickness: 3
        }).setDepth(60);

        // Spacing out the rest of the mountain to catch your launch
        this.platforms.push(
            new BasePlatform(this, 800, this.groundReferenceY - 300, 150, 30, standardProps)
        );
        this.platforms.push(
            new BasePlatform(this, 1150, this.groundReferenceY - 450, 150, 30, standardProps)
        );
        this.platforms.push(
            new BasePlatform(this, 1550, this.groundReferenceY - 650, 200, 150, standardProps)
        );

        // --- INFINITE PROCEDURAL LEVEL GENERATOR ---
        // Handcrafted intro above; from here-on the world is generated forever.
        // The generator owns `this.platforms` (shared reference) and seeds the
        // tutorial hook anchors, keeping culling and reachability in one place.
        //
        // The server picked the seed when it opened the run, so every client
        // builds the same mountain for the same attempt. The local seed is only
        // for a scene with no run behind it - development, or the pre-warmed
        // canvas the menu mounts before play.
        this.levelSeed = this.serverRun
            ? this.serverRun.seed >>> 0
            : this.generateLevelSeed();
        this.levelGenerator = new LevelGenerator(
            this,
            this.platforms,
            this.levelSeed,
            this.groundReferenceY
        );
        this.levelGenerator.seedTutorialHooks();

        // --- CAMERA SETUP ---
        // Subtle forward bias for initial tutorial climb (-45px), subpixel camera follow
        this.cameraFollowOffsetX = -45;
        this.cameras.main.startFollow(this.player, false, 0.08, 0.08);
        this.cameras.main.setFollowOffset(this.cameraFollowOffsetX, 150);

        this.runLowestY = this.groundReferenceY;
        this.currentAltitudeMeters = 0;
        this.isGameOver = false;
        this.playerIsFrayed = false;

        // Banked coins carry over between runs; pending coins do not, since the
        // mountain that held them is about to be rebuilt. The run's own haul
        // starts at zero even though the persistent total does not: only what
        // is banked during this climb is submitted at the end of it.
        this.pendingCoins = 0;
        this.runBankedCoins = 0;

        // Listen for collision with Cosmic Hazard sensor bodies
        this.matter.world.on('collisionstart', (event: Phaser.Physics.Matter.Events.CollisionStartEvent) => {
            for (const pair of event.pairs) {
                const bodyA = pair.bodyA;
                const bodyB = pair.bodyB;
                if (!this.player || !this.player.body) continue;

                if ((bodyA === this.player.body && bodyB.label === 'CosmicHazard') ||
                    (bodyB === this.player.body && bodyA.label === 'CosmicHazard')) {
                    const hazardBody = bodyA === this.player.body ? bodyB : bodyA;
                    this.handleHazardImpact(hazardBody);
                }

                if ((bodyA === this.player.body && bodyB.label === 'Coin') ||
                    (bodyB === this.player.body && bodyA.label === 'Coin')) {
                    const coinBody = bodyA === this.player.body ? bodyB : bodyA;
                    this.handleCoinPickup(coinBody);
                }
            }
        });

        this.dispatchAltitudeUpdate();

        // The HUD is mounted a moment after the scene, so it arrives too late
        // for the dispatch above and would sit at 0m until the player's first
        // metre. It asks for a snapshot instead of reading one out of storage:
        // the best is the API's number, and this scene is holding it.
        window.addEventListener('tetherverse:altitude-request', this.onAltitudeRequest);

        // Aborting is an ending, not a discard. The run cannot continue - React
        // tears the canvas down as soon as this returns - so the peak reached
        // and the coins banked are filed like any other finish, which has to
        // happen inside this handler because the unmount follows immediately.
        window.addEventListener('tetherverse:abort-run', this.onAbortRun);

        this.events.once('shutdown', () => {
            window.removeEventListener('tetherverse:altitude-request', this.onAltitudeRequest);
            window.removeEventListener('tetherverse:abort-run', this.onAbortRun);
        });

        // The dial, on the console, for development. It is the only way to
        // ask what the mountain is at an altitude without climbing to it, and
        // it is where a themed world reads the mountain it is modulating.
        if (process.env.NODE_ENV !== 'production') {
            (window as unknown as { __tetherverseDifficulty?: unknown }).__tetherverseDifficulty = {
                profileForAltitude,
                hazardStateForAltitude,
                environmentForAltitude,
            };
        }

        // [WORLDS] Built last, after every system it reads from, so the gravity
        // the scene set in create() is the base it modulates rather than
        // competes with. Pre-warming the verse art here keeps the first
        // transition free of a texture-generation hitch.
        preloadAllSkinArt(this);
        const worldContext: WorldContext = {
            scene: this,
            player: () => (this.player?.body ? this.player : null),
            platforms: () => this.platforms,
            generator: () => this.levelGenerator ?? null,
            pivotEngine: () => this.pivotEngine ?? null,
            backgroundLayer: () => this.backgroundLayer ?? null,
            backgroundObjects: () => this.backgroundObjects ?? [],
            groundReferenceY: () => this.groundReferenceY,
            altitudeMeters: () => this.currentAltitudeMeters,
        };
        this.worldManager = new WorldManager(worldContext);

        if (typeof window !== 'undefined') {
            window.dispatchEvent(new CustomEvent('tetherverse:game-ready'));
        }
    }

    update(time: number, delta: number) {
        // [WORLDS] The world may change on any frame, including one where the
        // climb has already ended, so it ticks before the guard: a pending
        // transition still resolves and cleans up after a death rather than
        // leaving tweens and a gate pointing at a dead scene.
        this.worldManager?.update(time, delta);

        if (this.isGameOver) return;

        this.updateBackgroundMotion();

        // Smooth dynamic camera lookahead based on immediate route direction ahead of player
        if (this.levelGenerator && this.player && this.player.body) {
            const routeDir = this.levelGenerator.getRouteDirectionNear(this.player.x, this.player.y);
            // routeDir is 1 (climbing right), -1 (climbing left), or 0 (vertical / centered)
            const targetOffsetX = -routeDir * 45;

            // Delta-time based exponential smoothing for a completely continuous, butter-smooth transition
            const smoothRate = 1.8;
            const alpha = 1 - Math.exp(-smoothRate * (delta / 1000));
            this.cameraFollowOffsetX = Phaser.Math.Linear(this.cameraFollowOffsetX, targetOffsetX, alpha);
            this.cameras.main.setFollowOffset(this.cameraFollowOffsetX, 150);
        }

        // Update the pivot engine routines
        if (this.pivotEngine) {
            this.pivotEngine.updateEngineRoutines(delta);
        }

        // Bank any unbanked haul once the player settles on ordinary ground.
        this.maybeBankCoinsOnLanding();

        // Update active cosmic hazards
        if (this.levelGenerator) {
            const hazards = this.levelGenerator.getHazards();
            for (const hazard of hazards) {
                hazard.update(time);
            }
        }

        // Fast proximity check for hazards (prevents high-speed tunneling)
        if (this.levelGenerator && this.player && this.player.body) {
            const hazards = this.levelGenerator.getHazards();
            const px = this.player.x;
            const py = this.player.y;
            for (const h of hazards) {
                if (!h || !h.active || !h.body) continue;
                const dist = Phaser.Math.Distance.Between(px, py, h.x, h.y);
                if (dist < GAME_CONSTANTS.PLAYER.RADIUS + 22) {
                    this.handleHazardImpact(h.body);
                    break;
                }
            }
        }

        // Weather.
        //
        // Read against the live altitude rather than the peak, so a player who
        // has fallen out of the thin air gets a moment of calm to climb back
        // into it. The mountain's shape is keyed to the peak and does not
        // soften.
        if (this.player && this.player.body && this.player.playerState !== "IDLE") {
            const weather = environmentForAltitude(this.currentAltitudeMeters);

            if (weather.wind !== 0) {
                const windForceX = Math.sin(time * weather.windFrequency) * weather.wind;
                this.matter.body.applyForce(this.player.body, this.player.body.position, { x: windForceX, y: 0 });
            }

            if (weather.surge !== 0) {
                this.matter.body.applyForce(this.player.body, this.player.body.position, { x: 0, y: weather.surge });
            }
        }

        const activeAnchor = this.pivotEngine?.getActiveAnchorPoint();
        if (this.player && activeAnchor && this.pivotEngine?.isCurrentlyHooked()) {
            this.drawQuantumTether(
                this.player.x,
                this.player.y - 10,
                activeAnchor.x,
                activeAnchor.y
            );
        } else if (this.tetherGraphics) {
            this.tetherGraphics.clear();
        }

        this.applyTetherDamageTint();

        this.settlePlayerIfOnSurface();

        if (this.player && this.player.body) {
            const isHooked = this.pivotEngine?.isCurrentlyHooked() ?? false;
            const routeDir = this.levelGenerator
                ? this.levelGenerator.getRouteDirectionNear(this.player.x, this.player.y)
                : 1;

            // Update facing direction cleanly via GPU texture mirroring without modifying physics scale
            this.player.updateSpriteDirection(this.player.body.velocity.x, activeAnchor, isHooked, routeDir);

            // Altimeter calculation routines
            const pixelHeight = (this.groundReferenceY - this.player.y) - 20;
            const altitudeMeters = Math.max(0, Math.floor(pixelHeight / 10));

            const altitudeChanged = altitudeMeters !== this.currentAltitudeMeters;
            this.currentAltitudeMeters = altitudeMeters;

            if (altitudeMeters > this.maxAltitudeMeters) {
                this.maxAltitudeMeters = altitudeMeters;
                // Deliberately not written to storage. This is an unsubmitted
                // climb; the only thing that may raise a saved best is the API
                // accepting the run. Caching it here is how a rejected score
                // came to look saved until the next reload.
                this.dispatchAltitudeUpdate();
            } else if (altitudeChanged) {
                this.dispatchAltitudeUpdate();
            }

            // Track the highest point reached this specific run (Y decreases as you climb)
            if (this.player.y < this.runLowestY) {
                this.runLowestY = this.player.y;
            }

            // =====================================================================
            //  COMPREHENSIVE GAME OVER CHECKS
            // =====================================================================

            // 1. Fallen below the starting ground / base boundary:
            // Starting platform surface is at groundReferenceY (1200), bottom at 1240.
            // Falling past 1260 means the player has plunged into the bottom abyss.
            if (this.player.y > this.groundReferenceY + 60) {
                this.handlePlayerFailure();
                return;
            }

            // 2. The void below the peak.
            //
            // This used to measure against the bottom of the screen, and the
            // camera follows the player on BOTH axes (`startFollow`, lerp 0.08)
            // with a fixed offset - so `scrollY` travelled down with the player
            // and the line travelled with it. Once the follow had settled the
            // test reduced to `player.y > player.y + const`, which is never
            // true: a player could fall a long way and stay alive, and the run
            // only ended when a violent plummet happened to outrun the lerp on
            // the way down.
            //
            // The void is anchored to the PEAK instead. `runLowestY` is the
            // highest point reached this run, and its declaration has always
            // said it exists to move the death-zone up - it just was never read
            // for that. Now the floor rises as the player climbs, which is what
            // the void margin dial has been describing all along ("the void is
            // right under your feet" at the top, "forgiving death-void" at the
            // bottom) without the geometry ever having agreed with it.
            //
            // A full view-height of slack, so a missed ledge is still a
            // mistake that can be seen and recovered from rather than an
            // instant loss, with the tier's void margin on top deciding how
            // generous that is at altitude.
            //
            // This test is deliberately NOT gated on `isHooked`, unlike the
            // backstop below. The exemption existed so a player swinging on a
            // tether could not be killed by the screen edge, but the void is
            // not the screen edge, and `isHooked` is a bare flag that nothing
            // validates against the rope or the anchor still being there. A
            // stale one handed the player back to the base check alone - a
            // fall of some fifteen thousand pixels from the roof, through air
            // with nothing in it, alive the whole way down.
            //
            // It costs nothing to be absolute here, because the tether cannot
            // reach: the rope is 380px and stretches to at most 513px when
            // frayed all the way, while the slack below is a view-height plus
            // the void margin - 1612px at the tightest. No player hanging from
            // a rope they are actually attached to can ever be this far below
            // their own peak, so this cannot end a swing. It can only end a
            // fall.
            //
            // The old condition also asked for `velocity.y > 0`, so the void
            // killed you only on the way DOWN through it and not for being
            // inside it. That is the wrong shape for something called a void:
            // it made being there survivable whenever the player was not
            // actively descending, and settling on a ledge is exactly how a
            // player stops descending. Falling below the line is fatal
            // because of where the player is, not which way they are moving.
            const deathLine = this.runLowestY + this.viewHeight + this.levelGenerator.voidMargin;
            if (this.player.y > deathLine) {
                this.handlePlayerFailure();
                return;
            }

            // 3. Catastrophic drop to ground after climbing:
            // If the player reached significant altitude (>= 20m) and fell all the way back
            // to the mountain base without recovering, the ascent is failed.
            const peakPixels = (this.groundReferenceY - this.runLowestY) - 20;
            const peakMeters = Math.max(0, Math.floor(peakPixels / 10));
            if (peakMeters >= GAME_CONSTANTS.DEATH.climbMetres && this.player.y >= this.groundReferenceY - 10 && !isHooked) {
                this.handlePlayerFailure();
                return;
            }

            // --- ENDLESS GENERATION & CULLING ---
            // Generate ahead of Jack and prune geometry far behind him. Generation is
            // fully validated (reachable/hookable/overlap/dead-end) and capped per frame.
            this.levelGenerator.update(this.player.x, this.player.y, this.currentAltitudeMeters);
        }
    }

    /**
     * Sizes the view to the window.
     *
     * Everything about how much world reaches the screen lives here and
     * nowhere else. It used to be spread across a scale mode, a camera and a
     * crop, and on a landscape monitor the three of them disagreed, which is
     * how the player ended up at 184px on a 1080p screen and 52px on a phone.
     *
     * The window's height decides how much mountain there is: always the
     * design's 1600 units, so every device plays the same run and a bigger
     * screen simply draws it bigger. The width follows the aspect ratio until
     * it would become a letterbox, at which point the height rule bends.
     *
     * Called from create() and on every resize; RESIZE mode makes the canvas
     * the window, so a resize changes both the window and what is drawn in it.
     */
    private applyViewport() {
        const width = this.scale.width;
        const height = this.scale.height;
        if (width <= 0 || height <= 0) return;

        const zoom = Math.max(height / DESIGN_HEIGHT, width / MAX_VIEW_WIDTH);
        this.cameras.main.setZoom(zoom);
        // The sky is sized and placed from this same view every frame in
        // updateBackgroundMotion, so there is nothing else to tell about it.
    }

    /**
     * The window in world units: what the player can actually see.
     *
     * `camera.width` is the viewport in pixels, and it stops being the world
     * shown the moment there is a zoom - which there always is now. Every
     * off-screen test and every scatter band in this scene is measured against
     * the view rather than against the camera's rectangle.
     */
    private get viewWidth(): number {
        return this.cameras.main.width / this.cameras.main.zoom;
    }

    private get viewHeight(): number {
        return this.cameras.main.height / this.cameras.main.zoom;
    }

    /**
     * Draws the tether.
     *
     * A frayed rope is drawn in pieces and in rose, because the player is
     * swinging on it at speed and cannot look away to read a status bar: the
     * state of the rope has to be on the rope. Cyan is the player's colour
     * and means the tether is whole; rose is the failure colour and means it
     * is not.
     */
    private drawQuantumTether(startX: number, startY: number, targetX: number, targetY: number): void {
        this.tetherGraphics.clear();

        const isUnstable = this.pivotEngine?.isAttachedToUnstable() ?? false;
        const progress = this.pivotEngine?.getUnstableProgress() ?? 1;
        const fray = this.pivotEngine?.getFrayAmount() ?? 0;

        if (isUnstable) {
            const isStrobe = progress < 0.35 && (Math.floor(Date.now() / 80) % 2 === 0);
            const outerColor = isStrobe ? 0xffffff : 0xff0055;
            const innerColor = isStrobe ? 0xff0022 : 0xff7700;

            this.tetherGraphics.lineStyle(9, outerColor, 0.5);
            this.drawTetherRun(startX, startY, targetX, targetY, fray);

            this.tetherGraphics.lineStyle(4, innerColor, 0.85);
            this.drawTetherRun(startX, startY, targetX, targetY, fray);

            this.tetherGraphics.lineStyle(1.8, 0xffffff, 1.0);
            this.drawTetherRun(startX, startY, targetX, targetY, fray);
        } else {
            const core = fray > 0 ? 0xff0055 : 0x00ffcc;

            this.tetherGraphics.lineStyle(8, 0xff007f, 0.4);
            this.drawTetherRun(startX, startY, targetX, targetY, fray);

            this.tetherGraphics.lineStyle(4, core, 0.8);
            this.drawTetherRun(startX, startY, targetX, targetY, fray);

            this.tetherGraphics.lineStyle(1.5, 0xffffff, 1.0);
            this.drawTetherRun(startX, startY, targetX, targetY, fray);
        }
    }

    /**
     * Draws the tether, in pieces if it is frayed.
     *
     * The gaps are where the rope is worn thin, and there are more of them
     * the worse the damage is, so the rope looks worse the worse it is.
     */
    private drawTetherRun(
        startX: number,
        startY: number,
        targetX: number,
        targetY: number,
        fray: number
    ): void {
        if (fray <= 0) {
            this.tetherGraphics.lineBetween(startX, startY, targetX, targetY);
            return;
        }

        const pieces = 6 + Math.round(fray * 10);
        for (let i = 0; i < pieces; i += 2) {
            const from = i / pieces;
            const to = Math.min(1, (i + 1) / pieces);
            this.tetherGraphics.lineBetween(
                startX + (targetX - startX) * from,
                startY + (targetY - startY) * from,
                startX + (targetX - startX) * to,
                startY + (targetY - startY) * to
            );
        }
    }

    /**
     * The player wears the damage.
     *
     * Rose is the failure colour and cyan is the player's, so a frayed tether
     * is a rose player until the rope re-braids itself. The player should not
     * have to look at the rope to know that the rope is hurt.
     */
    private applyTetherDamageTint(): void {
        const frayed = (this.pivotEngine?.getFrayAmount() ?? 0) > 0;
        if (frayed === this.playerIsFrayed) return;
        this.playerIsFrayed = frayed;

        if (frayed) {
            this.player.setTint(0xff0055);
        } else {
            this.player.clearTint();
        }
    }

    private settlePlayerIfOnSurface(): void {
        // Must NEVER settle if player is aiming, launched, OR currently tethered to an anchor!
        if (
            !this.player ||
            this.player.playerState === "LAUNCHED" ||
            (this.pivotEngine && this.pivotEngine.isCurrentlyHooked())
        ) {
            return;
        }

        const playerRadius = GAME_CONSTANTS.PLAYER.RADIUS;
        const playerBottom = this.player.body.position.y + playerRadius;
        const playerX = this.player.body.position.x;

        for (const platform of this.platforms) {
            if (!platform || !platform.active || !platform.body) {
                continue;
            }

            const platformTop = platform.body.position.y - (platform.displayHeight / 2);
            const halfW = platform.displayWidth / 2;
            const platformLeft = platform.body.position.x - halfW;
            const platformRight = platform.body.position.x + halfW;

            // Must be vertically contacting the top surface of the platform
            const withinSurfaceBand = playerBottom >= platformTop - 1 && playerBottom <= platformTop + 5;
            // Player's horizontal center must be firmly on the platform surface (not hovering off the edges)
            const withinHorizontalBounds = playerX >= platformLeft && playerX <= platformRight;

            if (withinSurfaceBand && withinHorizontalBounds) {
                // If this is a crumbling platform, trigger the collapse countdown on surface contact!
                if (platform.surfaceProps?.isCrumbling && !platform.isCrumblingTriggered) {
                    platform.triggerCrumble();
                }

                const velocity = this.player.body.velocity;
                const speed = Math.hypot(velocity.x, velocity.y);

                // Settle only gentle descents onto the platform surface (prevents halting fast airborne flights)
                if (velocity.y >= 0 && speed < GAME_CONSTANTS.LANDING.SPEED_THRESHOLD) {
                    this.matter.body.setVelocity(this.player.body, { x: 0, y: 0 });
                    this.matter.body.setAngularVelocity(this.player.body, 0);

                    this.player.updateState("IDLE");
                    return;
                }
            }
        }
    }

    /**
     * Scatters the sky.
     *
     * The background is not a place in the world, it is a backdrop, and a
     * backdrop that was scattered once and never again is a sky that runs
     * out. The climb has no ceiling, so the sky has to be enterable at any
     * height: the objects are placed against the camera rather than against
     * the ground, and the recycling keeps them in frame for as long as the
     * run lasts.
     */
    private seedBackgroundObjects() {
        this.backgroundObjects.forEach(object => object.destroy());
        this.backgroundObjects = [];

        // The band is the view's own rectangle plus the margin on each side,
        // which is where an object may sit and still be somewhere the player
        // could see it. The density is the density the sky has always had, so
        // the world looks the same as it did when the band was a fixed strip
        // of the world. It is the view and not the camera's rectangle, because
        // zoom makes those two different sizes.
        let offset = this.viewHeight + BACKGROUND_MARGIN;
        while (offset > -BACKGROUND_MARGIN) {
            const object = this.createBackgroundObject(
                Phaser.Math.Between(-180, this.viewWidth + 180),
                offset
            );
            this.backgroundObjects.push(object);
            offset -= Phaser.Math.Between(220, 520);
        }
    }

    /**
     * Puts one piece of the sky at a given place on the screen.
     *
     * The parallax factor is drawn first, because where an object sits in the
     * world depends on it: an object that drifts slowly is far away, and the
     * world height that puts it in front of the player is not the same one
     * that puts a fast-drifting object there.
     */
    private createBackgroundObject(cameraX: number, cameraY: number) {
        const textureKey = Phaser.Utils.Array.GetRandom(this.backgroundObjectTextures);
        const parallax = Phaser.Math.FloatBetween(0.08, 0.25);
        const scale = textureKey.includes('planet')
            ? Phaser.Math.FloatBetween(0.25, 0.6)
            : textureKey.includes('asteroid')
                ? Phaser.Math.FloatBetween(0.15, 0.45)
                : Phaser.Math.FloatBetween(0.45, 0.95);

        const camera = this.cameras.main;

        const object = this.add.image(
            cameraX + camera.scrollX * parallax,
            cameraY + camera.scrollY * parallax,
            textureKey
        )
            .setScrollFactor(parallax)
            .setDepth(-1500)
            .setAlpha(textureKey.includes('stars') ? 0.55 : 0.9)
            .setScale(scale)
            .setRotation(Phaser.Math.FloatBetween(0, Math.PI * 2));

        return object;
    }

    private updateBackgroundMotion() {
        if (this.backgroundLayer) {
            const camera = this.cameras.main;

            // The view's own rectangle, worked out the way Phaser's preRender
            // works it out: the centre sits half a viewport along from the
            // scroll, and the view spans `viewport / zoom` either side of that
            // centre. Computed rather than read from camera.worldView because
            // preRender - which writes it, and which also runs the camera's
            // follow lerp - has not happened yet when update() runs, so the
            // worldView still describes the previous frame.
            //
            // The +OVERSCAN keeps the edge a frame's camera movement away from
            // the screen, so the lag in the scroll value never shows up as a
            // sliver of page down either side.
            const viewW = this.viewWidth;
            const viewH = this.viewHeight;
            const left = camera.scrollX + camera.width / 2 - viewW / 2 - BACKGROUND_OVERSCAN;
            const top = camera.scrollY + camera.height / 2 - viewH / 2 - BACKGROUND_OVERSCAN;

            this.backgroundLayer.setPosition(left, top);
            this.backgroundLayer.setSize(viewW + BACKGROUND_OVERSCAN * 2, viewH + BACKGROUND_OVERSCAN * 2);

            // Slower than the world: that is what makes it sky.
            this.backgroundLayer.tilePositionY = camera.scrollY * 0.25;
            this.backgroundLayer.tilePositionX = camera.scrollX * 0.05;
        }

        if (!this.backgroundObjects.length) {
            return;
        }

        const camera = this.cameras.main;

        for (const object of this.backgroundObjects) {
            // A parallax object does not travel with the camera: it moves at
            // its own fraction of the camera's speed, so the part of the
            // world it can be seen in shrinks as the camera climbs. Asking
            // where the object is in the world says nothing about whether it
            // is still in frame; asking where it is on the screen does.
            const cameraY = object.y - camera.scrollY * object.scrollFactorY;
            const cameraX = object.x - camera.scrollX * object.scrollFactorX;

            if (cameraY > this.viewHeight + BACKGROUND_MARGIN) {
                // Drifted off the bottom: put it back above the top.
                this.recycleBackgroundObject(object, cameraX, -BACKGROUND_MARGIN);
            } else if (cameraY < -BACKGROUND_MARGIN) {
                this.recycleBackgroundObject(object, cameraX, this.viewHeight + BACKGROUND_MARGIN);
            } else if (cameraX > this.viewWidth + BACKGROUND_MARGIN) {
                this.recycleBackgroundObject(object, -BACKGROUND_MARGIN, cameraY);
            } else if (cameraX < -BACKGROUND_MARGIN) {
                this.recycleBackgroundObject(object, this.viewWidth + BACKGROUND_MARGIN, cameraY);
            }
        }
    }

    /**
     * Moves a piece of the sky to the other side of the frame.
     *
     * It is a new piece of sky rather than the same one moved: a different
     * texture, a different size, a different depth of field. The player is
     * climbing through a sky that is always slightly different, and never
     * through the same handful of planets being dragged along behind them.
     */
    private recycleBackgroundObject(
        object: Phaser.GameObjects.Image,
        cameraX: number,
        cameraY: number
    ) {
        const textureKey = Phaser.Utils.Array.GetRandom(this.backgroundObjectTextures);
        const parallax = Phaser.Math.FloatBetween(0.08, 0.25);
        const scale = textureKey.includes('planet')
            ? Phaser.Math.FloatBetween(0.25, 0.6)
            : textureKey.includes('asteroid')
                ? Phaser.Math.FloatBetween(0.15, 0.45)
                : Phaser.Math.FloatBetween(0.45, 0.95);

        const camera = this.cameras.main;

        object.setTexture(textureKey);
        object.setScrollFactor(parallax);
        object.setAlpha(textureKey.includes('stars') ? 0.55 : 0.9);
        object.setScale(scale);
        object.setRotation(Phaser.Math.FloatBetween(0, Math.PI * 2));
        object.setPosition(
            cameraX + camera.scrollX * parallax,
            cameraY + camera.scrollY * parallax
        );
    }

    /**
     * Ends the climb on request (Escape), keeping what it earned.
     *
     * It deliberately does not open the game-over screen: the player asked to
     * leave, not to be told how the run ended. What it does do is file the run,
     * because a climb that reached 900m and banked four coins is a climb that
     * happened, and dropping it was the old behaviour - the one place where a
     * score could vanish without anyone being told.
     */
    private readonly onAbortRun = (): void => {
        if (this.isGameOver) return;
        this.isGameOver = true;
        this.recordRun(this.runPeakMeters());
    };

    /** The HUD asking what the numbers are, because it mounted after create(). */
    private readonly onAltitudeRequest = (): void => {
        this.dispatchAltitudeUpdate();
    };

    private handlePlayerFailure() {
        if (this.isGameOver) return;
        this.isGameOver = true;

        // Capture the run peak altitude (highest point reached this run) before pausing.
        const peakMeters = this.runPeakMeters();

        // 1. File this run before anything is destroyed, and before the first
        //    byte of the request leaves. `peakMeters` is where THIS climb reached
        //    and `runBankedCoins` is what it banked - not the personal best and
        //    not the lifetime coin total, both of which belong to other runs.
        const recorded = this.recordRun(peakMeters);

        // 2. Destroy the previous engine runtime references to safely unbind old event listeners 
        // and eliminate pointer registration leaks
        if (this.pivotEngine) {
            this.pivotEngine.destroy();
        }

        if (this.levelGenerator) {
            this.levelGenerator.destroyAll();
        }

        // 3. Freeze the world so the scene renders a still frame behind the React overlay
        this.matter.world.pause();

        // 4. Hand control to the React layer: it renders the themed GAME OVER overlay and
        //    decides between rerunning (remount) or exiting back to the launcher.
        if (typeof window !== "undefined") {
            window.dispatchEvent(new CustomEvent("tetherverse:gameover", {
                detail: {
                    altitude: peakMeters,
                    best: this.maxAltitudeMeters,
                    // Carried separately from `best`, because they are different
                    // questions. `best` is where the player stands now; this is
                    // where they stood before the run, and only the difference
                    // between them says whether this climb beat anything.
                    bestBefore: this.bestBeforeRun,
                    coins: this.bankedCoins,
                    // Reported so the overlay can say what was lost, rather than the
                    // player wondering where the coins they just swept up went.
                    lostCoins: this.pendingCoins,
                    // The run id, so a save that settles after the overlay is up
                    // is applied to the screen it belongs to and not to whatever
                    // run is on screen by then.
                    runId: this.serverRun?.runId ?? null,
                    // How the save is going. A climb with no server run is a
                    // practice climb and says so, rather than showing a spinner
                    // that will never resolve.
                    save: recorded ? { status: 'saving' } : { status: 'unscored' },
                }
            }));
        }
    }

    /** This run's peak altitude in metres, measured from its highest pixel. */
    private runPeakMeters(): number {
        const peakPixels = (this.groundReferenceY - this.runLowestY) - 20;
        return Math.max(0, Math.floor(peakPixels / 10));
    }

    /**
     * Writes the finished run into the outbox, then asks the API to score it.
     *
     * The order is the point. The queue entry is written synchronously, before
     * the request exists, so the climb survives a tab that closes, a connection
     * that drops, or a deploy that unloads the page: the worst case becomes a
     * save that lands on the next visit rather than a climb that never happened.
     *
     * Returns the filed run, or null when this climb had no server run behind it
     * (development, or a boot that could not open one) and so cannot be scored.
     */
    private recordRun(peakMeters: number): PendingRun | null {
        if (!this.serverRun || peakMeters <= 0) return null;

        const entry: PendingRun = {
            runId: this.serverRun.runId,
            // The column the score lands in is a 32-bit integer, so a run that
            // somehow climbed past its ceiling is filed at the ceiling: a score
            // that does not fit is a score that was never saved.
            score: Math.min(peakMeters, GAME_CONSTANTS.WORLD.MAX_ALTITUDE_METERS),
            coins: Math.floor(this.runBankedCoins),
            owner: this.runOwner ?? '',
            at: Date.now(),
        };

        queuePendingRun({
            runId: entry.runId,
            score: entry.score,
            coins: entry.coins,
            owner: entry.owner,
        });

        void this.saveRun(entry);
        return entry;
    }

    /**
     * Tries to deliver one filed run, and tells React how it went.
     *
     * Success is the API's, not this scene's: the run leaves the outbox only on
     * a 2xx or a duplicate, and the best that comes back is the best that
     * exists. A climb that cannot be delivered stays queued and the overlay
     * says so, because a player who cannot see that their score did not land
     * will assume it did.
     */
    private async saveRun(entry: PendingRun): Promise<void> {
        const result = await submitPendingRun(entry);

        if (result.status === 'saved' && typeof result.best === 'number') {
            this.maxAltitudeMeters = Math.max(this.maxAltitudeMeters, result.best);
        }
        if (result.status === 'saved' && typeof result.coins === 'number') {
            this.bankedCoins = result.coins;
            this.pendingCoins = 0;
        }

        if (typeof window !== "undefined") {
            window.dispatchEvent(new CustomEvent("tetherverse:run-saved", {
                detail: {
                    runId: entry.runId,
                    status: result.status,
                    message: result.message,
                    // The numbers forwarded are the ones the API returned, not
                    // this scene's. `this.maxAltitudeMeters` already contains the
                    // climb's own live peak, so sending it here would report an
                    // unconfirmed height as the player's record - the same lie,
                    // one path over. Undefined when the API said nothing, and the
                    // listener then keeps what it has.
                    best: result.best,
                    coins: result.coins,
                },
            }));
        }
    }

    /**
     * Collects a coin the player has touched.
     *
     * The coin is matched back to its display object through the Matter body's
     * `plugin`, which is what `Coin` uses to carry a reference, so the scene never
     * has to search its list. The body is removed from the world first: a sensor
     * that is still colliding would be collected again on every subsequent frame.
     */
    private handleCoinPickup(coinBody: MatterJS.BodyType): void {
        if (this.isGameOver) return;

        const coin = coinBody?.plugin?.gameObject as Coin | undefined;
        if (!coin || !coin.active) return;

        // Held as pending, not banked. Landing on ordinary ground is what commits
        // them, and that usually happens well after the last coin, so the check
        // runs per frame in update() rather than here.
        this.pendingCoins += 1;

        // `collect` owns the Matter body: a sensor left in the world would be
        // collected again on every frame it overlaps the player.
        this.levelGenerator?.removeCoin(coin);
        coin.collect();
        this.spawnPickupPopup(coin.x, coin.y);
    }

    /**
     * A brief `+1` where the coin was.
     *
     * Coins carry no HUD counter, so this is the only confirmation that one was
     * actually taken. Drawing it in world space means it sits on the coin rather
     * than at a fixed screen corner, which is what makes a pickup in a fast climb
     * legible at all.
     *
     * It rises and fades on its own, so nothing has to clean it up: the tween's
     * onComplete destroys the text.
     */
    private spawnPickupPopup(x: number, y: number): void {
        const label = this.add
            .text(x, y, '+1', {
                fontFamily: 'monospace',
                fontSize: '20px',
                fontStyle: 'bold',
                color: '#ffd76a',
                stroke: '#3a2600',
                strokeThickness: 4,
            })
            .setOrigin(0.5)
            // Above the coins and hazards, so it is never occluded by a platform.
            .setDepth(60);

        this.tweens.add({
            targets: label,
            y: y - 52,
            alpha: 0,
            // Slow out: the label should still be legible for most of its life
            // rather than blinking away.
            duration: 700,
            ease: 'Quad.easeOut',
            onComplete: () => label.destroy(),
        });
    }

    /**
     * Banks the pending haul once the player has settled on ordinary ground.
     *
     * Called every frame rather than only on pickup, because the landing usually
     * happens well after the last coin. It returns immediately when there is
     * nothing pending, so the per-frame cost is a single comparison.
     *
     * Two conditions guard the test. The player's feet must be level with a
     * platform top, and their vertical velocity must be near zero: flying past a
     * platform at speed must not read as a landing. Risky ground does not count
     * either, since banking on a bounce off the very platform the coins sit on
     * would make the risk free.
     */
    private maybeBankCoinsOnLanding(): void {
        if (this.pendingCoins === 0) return;
        if (!this.player?.body) return;

        const velocityY = this.player.body.velocity?.y ?? 0;
        if (Math.abs(velocityY) > BANKING_REST_SPEED) return;

        const feetY = this.player.y + this.player.displayHeight / 2;

        const platform = (this.levelGenerator?.getPlatforms() ?? []).find((p) => {
            const top = p.y - p.displayHeight / 2;
            const withinX = Math.abs(p.x - this.player.x) <= p.displayWidth / 2 + 8;
            return withinX && Math.abs(feetY - top) <= BANKING_FOOT_TOLERANCE;
        });

        // No match means airborne, and a match on the risk line means the haul is
        // still out on the mountain.
        if (!platform || platform.isRiskPlatform()) return;

        this.bankPendingCoins();
    }

    /**
     * Commits the pending haul.
     *
     * Split from the landing test so the game-over path can bank nothing while
     * still reading the counters, and so the rule lives in one place.
     */
    private bankPendingCoins(): void {
        if (this.pendingCoins === 0) return;

        this.bankedCoins += this.pendingCoins;
        this.runBankedCoins += this.pendingCoins;
        this.pendingCoins = 0;
    }

    private handleHazardImpact(hazardBody: MatterJS.BodyType): void {
        const now = Date.now();
        if (now - this.lastHazardImpactTime < 700) return;
        this.lastHazardImpactTime = now;

        // Force release grapple tether if hooked
        if (this.pivotEngine) {
            this.pivotEngine.forceRelease();
            // The rope is what the hit costs. The run continues, but the swing
            // the player has next is a worse one, and the next one after that
            // is worse still.
            this.pivotEngine.damageTether(GAME_CONSTANTS.TETHER.frayPerHit);
        }

        // Radial deflection impulse away from hazard center
        const dx = this.player.x - hazardBody.position.x;
        const dy = this.player.y - hazardBody.position.y;
        const angle = Math.atan2(dy, dx);
        const deflectSpeed = 10;

        this.matter.body.setVelocity(this.player.body, {
            x: Math.cos(angle) * deflectSpeed,
            y: Math.min(-3, Math.sin(angle) * deflectSpeed)
        });

        // Screen shake and impact flash
        this.cameras.main.shake(180, 0.012);

        const blastRing = this.add.circle(this.player.x, this.player.y, 20, 0xff0077, 0.9).setDepth(85);
        this.tweens.add({
            targets: blastRing,
            scale: 3,
            alpha: 0,
            duration: 280,
            ease: 'Power2',
            onComplete: () => blastRing.destroy()
        });
    }

    private generateLevelSeed(): number {
        // A fresh seed every run keeps runs rerollable; the same seed always
        // reproduces the exact same level (useful for debugging and balancing).
        return (Date.now() ^ ((Math.random() * 0x100000000) >>> 0)) >>> 0;
    }
}
