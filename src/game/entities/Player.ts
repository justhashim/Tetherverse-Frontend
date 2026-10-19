import Phaser from "phaser";
import { GAME_CONSTANTS } from "../config/game-constants";
import { COLLISION_CHANNELS } from "../config/physics-channels";

export type PlayerState = "IDLE" | "LAUNCHED" | "FALLING";

export class Player extends Phaser.GameObjects.Sprite {
    public override body!: MatterJS.BodyType;
    public playerState: PlayerState = "IDLE";

    private coreBodyRadius: number;
    private facingDirection: number = 1; // 1 = facing right, -1 = facing left

    constructor(scene: Phaser.Scene, x: number, y: number) {
        // Frame 1 is the base idle pose (matches the 2-frame breathing idle anim), so the
        // sprite spawns already in a stable idle pose instead of flashing a tumbling frame.
        super(scene, x, y, "hero_sheet", 1);

        this.coreBodyRadius = GAME_CONSTANTS.PLAYER.RADIUS;

        this.setDisplaySize(98, 98);
        this.setOrigin(0.5, 0.5);
        this.setFlipX(false);

        // --- 2. DEPTH & MULTIVERSE GLOW ---
        this.setDepth(100);

        const selfWithPostFX = this as Phaser.GameObjects.Sprite & {
            postFX?: {
                addGlow: (color: number, intensity: number, blur: number, knockout: boolean) => void;
            };
        };
        if (selfWithPostFX.postFX) {
            selfWithPostFX.postFX.addGlow(0xFF007F, 3, 0, false);
        }

        scene.add.existing(this);

        // --- 3. MATTER.JS PHYSICS BODY ---
        const targetConfig: Phaser.Types.Physics.Matter.MatterBodyConfig = {
            shape: { type: 'circle', radius: this.coreBodyRadius },
            density: GAME_CONSTANTS.PLAYER.DENSITY,
            friction: GAME_CONSTANTS.PLAYER.FRICTION,
            frictionStatic: GAME_CONSTANTS.PLAYER.FRICTION_STATIC,
            frictionAir: GAME_CONSTANTS.PLAYER.FRICTION_AIR,
            restitution: GAME_CONSTANTS.PLAYER.BOUNCE,
            label: "PlayerBody",
            collisionFilter: {
                category: COLLISION_CHANNELS.PLAYER,
                mask: 0xFFFFFFFF
            }
        };

        scene.matter.add.gameObject(this, targetConfig);

        // Lock rotation by giving the body infinite rotational inertia. This is how
        // matter-js implements a "fixed rotation" so the body settles on platforms
        // without micro-bouncing (setFixedRotation is not exposed in this version).
        this.scene.matter.body.setInertia(this.body, Infinity);

        // --- 4. SAFE ANIMATION TRIGGER ---
        if (scene.anims.exists('hero_idle')) {
            this.play('hero_idle');
        }
    }

    public updateState(newState: PlayerState): void {
        if (this.playerState === newState) return;
        this.playerState = newState;
        this.stop();

        // Per-state air drag for controlled, punchy movement.
        if (newState === "LAUNCHED") {
            this.body.frictionAir = GAME_CONSTANTS.SWING.FRICTION_AIR;
        } else if (newState === "FALLING") {
            this.body.frictionAir = GAME_CONSTANTS.SWING.FALLING_FRICTION_AIR;
        } else {
            this.body.frictionAir = GAME_CONSTANTS.PLAYER.FRICTION_AIR;
        }

        if (newState === "IDLE") {
            this.scene.matter.body.setVelocity(this.body, { x: 0, y: 0 });
            this.scene.matter.body.setAngularVelocity(this.body, 0);
            this.play('hero_idle', true);
        } else if (newState === "LAUNCHED") {
            this.play('hero_swing', true);
        } else if (newState === "FALLING") {
            this.play('hero_fall', true);
        }
    }

    /**
     * Updates the sprite facing direction (left/right) cleanly using texture UV mirroring (setFlipX).
     * Strictly avoids modifying Matter physics body scale or rotation, guaranteeing 100% stable physics.
     */
    public updateSpriteDirection(
        velocityX: number,
        activeAnchorPoint?: Phaser.Math.Vector2 | null,
        isHooked?: boolean,
        routeDirection: number = 1
    ): void {
        if (!this.body) return;

        let targetDirection = this.facingDirection;

        // 1. When hooked to an anchor, face swing velocity direction or face anchor near apex
        if (isHooked && activeAnchorPoint) {
            if (Math.abs(velocityX) > 0.6) {
                targetDirection = velocityX > 0 ? 1 : -1;
            } else {
                const dxToAnchor = activeAnchorPoint.x - this.x;
                if (Math.abs(dxToAnchor) > 15) {
                    targetDirection = dxToAnchor > 0 ? 1 : -1;
                }
            }
        } else if (Math.abs(velocityX) > 0.8) {
            // Airborne flight / movement: face horizontal momentum with deadzone
            targetDirection = velocityX > 0 ? 1 : -1;
        } else if (this.playerState === "IDLE" && routeDirection !== 0) {
            // Grounded: face upcoming route direction
            targetDirection = routeDirection;
        }

        this.facingDirection = targetDirection;
        // setFlipX cleanly flips texture UVs without touching Matter physics scale or vertices!
        this.setFlipX(this.facingDirection < 0);
    }
}