import Phaser, { Scene } from "phaser";
import { Player } from "../entities/Player";
import { GAME_CONSTANTS } from "../config/game-constants";
import { environmentForAltitude } from "../config/difficulty";
import { BasePlatform } from "../terrain/BasePlatform";
import { Coin, createCoinTexture } from "../terrain/Coin";
import { PivotEngine } from "../physics/PivotEngine";
import { LevelGenerator } from "../levels/LevelGenerator";

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

export class GameScene extends Scene {
    private player!: Player;
    private pivotEngine!: PivotEngine;
    private levelGenerator!: LevelGenerator;
    private platforms: BasePlatform[] = [];
    private backgroundLayer!: Phaser.GameObjects.TileSprite;
    private backgroundObjects: Phaser.GameObjects.Image[] = [];
    private tetherGraphics!: Phaser.GameObjects.Graphics;

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
    private currentAltitudeMeters: number = 0; // Live altitude used to pick the difficulty tier
    private levelSeed: number = 0;

    private runLowestY: number = 0; // Tracks the highest point reached THIS run to move the death-zone up

    private isGameOver: boolean = false;
    private cameraFollowOffsetX: number = 0;
    private lastHazardImpactTime: number = 0;
    private playerIsFrayed: boolean = false;

    constructor() {
        super("GameScene");
    }

    init() {
        // Keep the local storage check as a fast-loading fallback!
        // It prevents the score from showing '0m' for half a second while the database loads.
        try {
            const saved = localStorage.getItem('maxAltitude');
            if (saved) {
                const parsed = parseInt(saved, 10);
                if (!isNaN(parsed) && parsed > this.maxAltitudeMeters) {
                    this.maxAltitudeMeters = parsed;
                }
            }
        } catch {
            // Silently ignore
        }

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
        try {
            // This endpoint needs a verified Excel Play identity, so it must carry
            // the same bearer the score save uses. Without the header the request
            // is always 401 and the database best never seeds maxAltitudeMeters.
            const bridgeToken = typeof window !== 'undefined'
                ? window.__tetherverseAuthToken
                : null;

            const response = await fetch('/api/score', {
                headers: bridgeToken ? { Authorization: `Bearer ${bridgeToken}` } : {},
            });

            // Anonymous boot, or the launcher has not delivered a token yet. Abort
            // quietly: the menu falls back to the locally stored best.
            if (!response.ok) return;

            const data = await response.json();

            // If the cloud score is higher than what the local game thinks...
            if (data.success && data.maxAltitude > this.maxAltitudeMeters) {
                // 1. Update the static variable
                this.maxAltitudeMeters = data.maxAltitude;

                // 2. Sync it back to local storage so the next page refresh is instant
                localStorage.setItem('maxAltitude', data.maxAltitude.toString());

                // 3. Dispatch altitude event to update HUD overlay
                this.dispatchAltitudeUpdate();

                console.debug('[tetherverse] cloud best', data.maxAltitude);
            }

            // Coins are seeded outside the altitude branch: a player who has never
            // scored can still hold coins from earlier runs, so a 0m best must not
            // hide them.
            this.bankedCoins = data.coins ?? 0;
        } catch (error) {
            console.error("Failed to sync high score from cloud", error);
        }
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
            .setScrollFactor(0)
            .setDepth(-2000)
            .setTileScale(3.5, 3.5);

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
        this.levelSeed = this.generateLevelSeed();
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
        // mountain that held them is about to be rebuilt.
        this.pendingCoins = 0;

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

        if (typeof window !== 'undefined') {
            window.dispatchEvent(new CustomEvent('tetherverse:game-ready'));
        }
    }

    update(time: number, delta: number) {
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
                try {
                    localStorage.setItem('maxAltitude', this.maxAltitudeMeters.toString());
                } catch {
                    // ignore
                }
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

            // 2. Off the bottom of the screen:
            // If the player is unhooked and has plummeted off the visible screen,
            // the run is over. How far below the screen they may fall before it
            // counts is the mountain's business: the void margin is a dial, and
            // up high it is nearly closed.
            const deathLine = this.getVisibleBottom() + this.levelGenerator.voidMargin;
            if (!isHooked && this.player.y > deathLine && this.player.body.velocity.y > 0) {
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
     * The bottom of the screen, in world coordinates.
     *
     * The camera's rectangle is the game's resolution, and in ENVELOP mode
     * that is taller than the window: the canvas is scaled up until it covers
     * the screen and the top and the bottom of it are cropped away. The
     * player can only see the middle of the camera's rectangle, so the line
     * the run ends on has to be measured against the part of it that is
     * actually on the screen. Measured against the camera instead, the player
     * falls most of a screen past the bottom of the window before the game
     * notices that they are gone.
     */
    private getVisibleBottom(): number {
        const camera = this.cameras.main;
        const game = this.scale.gameSize;
        const parent = this.scale.parentSize;

        // The canvas is scaled up until it covers the window, so the height of
        // the world the player can see is the height of the window divided by
        // that scale. A quarter of the game is the floor: a window that has
        // not been measured yet must not put the end of the run above the
        // player's feet.
        const canvasScale = game.width > 0 ? this.scale.displaySize.width / game.width : 1;
        const visibleHeight = Math.max(
            game.height * 0.25,
            Math.min(game.height, parent.height / canvasScale)
        );

        return camera.scrollY + (game.height + visibleHeight) / 2;
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

        const camera = this.cameras.main;

        // The band is the camera's own rectangle plus the margin on each
        // side, which is where an object may sit and still be somewhere the
        // player could see it. The density is the density the sky has always
        // had, so the world looks the same as it did when the band was a
        // fixed strip of the world.
        let offset = camera.height + BACKGROUND_MARGIN;
        while (offset > -BACKGROUND_MARGIN) {
            const object = this.createBackgroundObject(
                Phaser.Math.Between(-180, camera.width + 180),
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
            this.backgroundLayer.tilePositionY = this.cameras.main.scrollY * 0.25;
            this.backgroundLayer.tilePositionX = this.cameras.main.scrollX * 0.05;
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

            if (cameraY > camera.height + BACKGROUND_MARGIN) {
                // Drifted off the bottom: put it back above the top.
                this.recycleBackgroundObject(object, cameraX, -BACKGROUND_MARGIN);
            } else if (cameraY < -BACKGROUND_MARGIN) {
                this.recycleBackgroundObject(object, cameraX, camera.height + BACKGROUND_MARGIN);
            } else if (cameraX > camera.width + BACKGROUND_MARGIN) {
                this.recycleBackgroundObject(object, -BACKGROUND_MARGIN, cameraY);
            } else if (cameraX < -BACKGROUND_MARGIN) {
                this.recycleBackgroundObject(object, camera.width + BACKGROUND_MARGIN, cameraY);
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

    private handlePlayerFailure() {
        if (this.isGameOver) return;
        this.isGameOver = true;

        // Capture the run peak altitude (highest point reached this run) before pausing.
        const peakPixels = (this.groundReferenceY - this.runLowestY) - 20;
        const peakMeters = Math.max(0, Math.floor(peakPixels / 10));

        // 1. Capture and save the high score immediately before anything is destroyed
        if (this.maxAltitudeMeters) {
            this.saveHighScore(this.maxAltitudeMeters, this.bankedCoins);
        }

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
                    coins: this.bankedCoins,
                    // Reported so the overlay can say what was lost, rather than the
                    // player wondering where the coins they just swept up went.
                    lostCoins: this.pendingCoins,
                }
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

    // Saving high scores to the database (called on game over)
    private async saveHighScore(finalAltitude: number, coins: number) {
        try {
            // When embedded in the Excel Play launcher the token arrives by postMessage
            // rather than from a sign-in redirect, and there is no session cookie,
            // so it travels as a bearer. The scene is not a React component, so the
            // token is read from the global that the auth hooks maintain.
            const bridgeToken = typeof window !== 'undefined'
                ? window.__tetherverseAuthToken
                : null;

            const response = await fetch('/api/score', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    ...(bridgeToken ? { Authorization: `Bearer ${bridgeToken}` } : {}),
                },
                body: JSON.stringify({
                    // The column the score lands in is a 32-bit integer, so a
                    // run that somehow climbed past its ceiling is reported at
                    // the ceiling: a score that does not fit is a score that
                    // was never saved.
                    score: Math.min(
                        Math.floor(finalAltitude),
                        GAME_CONSTANTS.WORLD.MAX_ALTITUDE_METERS
                    ),
                    // Banked coins only. Pending ones were earned on the mountain
                    // and the run just ended, so they are lost with it.
                    coins: Math.floor(coins),
                })
            });

            const data = await response.json();

            if (data.updated) {
                console.debug('[tetherverse] new best saved', data.maxAltitude);
                // You could trigger a Phaser UI text here saying "NEW RECORD!"
            }

            // The server holds the authoritative total, so adopt it rather than
            // trusting the local count.
            if (data.success && typeof data.coins === 'number') {
                this.bankedCoins = data.coins;
                this.pendingCoins = 0;
            }

        } catch (error) {
            console.error("Could not reach the database to save score.", error);
        }
    }
}