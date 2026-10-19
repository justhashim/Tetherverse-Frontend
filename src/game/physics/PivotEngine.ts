import Phaser from "phaser";
import { Player } from "../entities/Player";
import { COLLISION_CHANNELS } from "../config/physics-channels";
import { GAME_CONSTANTS } from "../config/game-constants";

export class PivotEngine {
    private scene: Phaser.Scene;
    private player: Player;

    private pivotConstraint: MatterJS.ConstraintType | null = null;
    private anchorPoint: Phaser.Math.Vector2;
    private pointerVector: Phaser.Math.Vector2;

    private isHooked: boolean = false;
    private jackLength: number = GAME_CONSTANTS.PROCEDURAL.ROPE_LENGTH; // Matches procedural generation reach
    private anchorHitRadius: number = 140; // Forgiving tap detection near hook nodes

    // --- Unstable Quantum Anchor Decay State ---
    private isUnstableHooked: boolean = false;
    private unstableTimer: number = 0;
    private readonly UNSTABLE_MAX_DURATION: number = GAME_CONSTANTS.HAZARD.unstableDurationMs;
    private currentHookedAnchorBody: MatterJS.BodyType | null = null;

    private readonly pointerDownHandler = (pointer: Phaser.Input.Pointer) => this.attemptAnchor(pointer);
    private readonly pointerUpHandler = () => this.releaseAnchor();

    constructor(scene: Phaser.Scene, player: Player) {
        this.scene = scene;
        this.player = player;
        this.anchorPoint = new Phaser.Math.Vector2();
        this.pointerVector = new Phaser.Math.Vector2();

        this.scene.matter.body.set(this.player.body, "collisionFilter", {
            category: COLLISION_CHANNELS.PLAYER,
            mask: COLLISION_CHANNELS.TERRAIN | COLLISION_CHANNELS.HAZARD
        });

        this.setupInputBindings();
    }

    private setupInputBindings(): void {
        this.scene.input.on("pointerdown", this.pointerDownHandler, this);
        this.scene.input.on("pointerup", this.pointerUpHandler, this);
    }

    private attemptAnchor(pointer: Phaser.Input.Pointer): void {
        if (this.isHooked) return;
        if (!this.scene.input.enabled) return;

        const playerX = this.player.body.position.x;
        const playerY = this.player.body.position.y;

        const hookAnchors = this.scene.matter.world.getAllBodies().filter(
            (body: MatterJS.BodyType) => body.label === 'HookAnchor' || body.label === 'HookAnchor_Unstable'
        );

        let aimedAnchor: MatterJS.BodyType | null = null;
        let bestScore = Number.POSITIVE_INFINITY;

        const aimDirX = pointer.worldX - playerX;
        const aimDirY = pointer.worldY - playerY;
        const aimDist = Math.hypot(aimDirX, aimDirY);

        for (const body of hookAnchors) {
            const distanceToPlayer = Phaser.Math.Distance.Between(
                playerX,
                playerY,
                body.position.x,
                body.position.y
            );

            // Anchor must be within rope reach from the player (with a 25px grace threshold)
            if (distanceToPlayer > this.jackLength + 25) {
                continue;
            }

            const distanceToPointer = Phaser.Math.Distance.Between(
                pointer.worldX,
                pointer.worldY,
                body.position.x,
                body.position.y
            );

            let score = Number.POSITIVE_INFINITY;
            if (distanceToPointer <= this.anchorHitRadius) {
                // Direct tap / click near anchor
                score = distanceToPointer;
            } else if (aimDist > 30) {
                // Directional aim check: dot product between aim direction and anchor direction
                const toAnchorX = body.position.x - playerX;
                const toAnchorY = body.position.y - playerY;
                const dot = (aimDirX * toAnchorX + aimDirY * toAnchorY) / (aimDist * distanceToPlayer);
                // Within ~50 degree cone of tap direction and within reach
                if (dot > 0.65) {
                    score = 200 + (1 - dot) * 300 + distanceToPlayer * 0.2;
                }
            }

            if (score < bestScore) {
                aimedAnchor = body;
                bestScore = score;
            }
        }

        if (!aimedAnchor) {
            return;
        }

        this.anchorPoint.set(aimedAnchor.position.x, aimedAnchor.position.y);
        this.isHooked = true;
        this.currentHookedAnchorBody = aimedAnchor;
        this.isUnstableHooked = aimedAnchor.label === 'HookAnchor_Unstable';
        if (this.isUnstableHooked) {
            this.unstableTimer = this.UNSTABLE_MAX_DURATION;
        }
        this.player.updateState("LAUNCHED");

        this.pivotConstraint = this.scene.matter.add.constraint(
            this.player.body as MatterJS.BodyType,
            aimedAnchor,
            Phaser.Math.Distance.Between(
                this.player.body.position.x,
                this.player.body.position.y,
                aimedAnchor.position.x,
                aimedAnchor.position.y
            ),
            GAME_CONSTANTS.SWING.CONSTRAINT_STIFFNESS,
            {
                pointA: { x: 0, y: 0 },
                pointB: { x: 0, y: 0 }
            }
        );
    }

    public updateEngineRoutines(delta: number = 16.6): void {
        const pointer = this.scene.input.activePointer;

        // Drag-to-scan for a wall hook without requiring a fresh tap
        if (pointer.isDown && !this.isHooked) {
            this.attemptAnchor(pointer); // Scans for a wall hook while dragging
        }

        // Early return if not hooked
        if (!this.isHooked || !this.pivotConstraint) return;

        // Handle unstable anchor decay and visual countdown
        if (this.isUnstableHooked && this.currentHookedAnchorBody) {
            this.unstableTimer -= delta;

            const anchorGameObject = (this.currentHookedAnchorBody as { gameObject?: Phaser.GameObjects.Image }).gameObject;
            if (anchorGameObject && anchorGameObject.active) {
                if (this.unstableTimer < 700) {
                    // Critical countdown: frantic strobe
                    const strobe = Math.floor(this.unstableTimer / 70) % 2 === 0;
                    anchorGameObject.setTint(strobe ? 0xffffff : 0xff0044);
                } else {
                    // Decay pulse: cycling between neon magenta and amber warning
                    const pulse = Math.sin((this.UNSTABLE_MAX_DURATION - this.unstableTimer) * 0.015);
                    anchorGameObject.setTint(pulse > 0 ? 0xff0066 : 0xff6600);
                }
            }

            if (this.unstableTimer <= 0) {
                this.shatterCurrentAnchor();
                this.forceRelease();
                return;
            }
        }

        // Apply swing drive physics while the pointer is held down
        if (pointer.isDown) {
            const swingRadius = new Phaser.Math.Vector2(
                this.player.x - this.anchorPoint.x,
                this.player.y - this.anchorPoint.y
            );
            const tangent = new Phaser.Math.Vector2(-swingRadius.y, swingRadius.x).normalize();

            const velocity = this.player.body.velocity;
            const currentSpeed = Math.hypot(velocity.x, velocity.y);

            // Only accelerate if below the max swing speed cap
            if (currentSpeed < GAME_CONSTANTS.SWING.MAX_SWING_SPEED) {
                const dot = tangent.x * velocity.x + tangent.y * velocity.y;

                // If player is already moving along the arc, drive force reinforces current motion!
                if (dot < -0.01) {
                    tangent.negate();
                } else if (Math.abs(dot) <= 0.01) {
                    // If stationary, pump forward (rightward / upward)
                    if (tangent.x < 0) {
                        tangent.negate();
                    }
                }

                const driveForce = GAME_CONSTANTS.SWING.DRIVE_FORCE;

                this.scene.matter.body.applyForce(
                    this.player.body,
                    this.player.body.position,
                    { x: tangent.x * driveForce, y: tangent.y * driveForce }
                );
            }
        }
    }

    public getActiveAnchorPoint(): Phaser.Math.Vector2 | null {
        if (!this.isHooked) {
            return null;
        }

        return new Phaser.Math.Vector2(this.anchorPoint.x, this.anchorPoint.y);
    }

    public isCurrentlyHooked(): boolean {
        return this.isHooked;
    }

    public isAttachedToUnstable(): boolean {
        return this.isHooked && this.isUnstableHooked;
    }

    public getUnstableProgress(): number {
        if (!this.isHooked || !this.isUnstableHooked) return 0;
        return Math.max(0, this.unstableTimer / this.UNSTABLE_MAX_DURATION);
    }

    private shatterCurrentAnchor(): void {
        if (!this.currentHookedAnchorBody) return;
        const anchorX = this.currentHookedAnchorBody.position.x;
        const anchorY = this.currentHookedAnchorBody.position.y;
        const anchorGameObject = (this.currentHookedAnchorBody as { gameObject?: Phaser.GameObjects.Image }).gameObject;

        this.scene.cameras.main.shake(160, 0.008);

        const shatterRing = this.scene.add.circle(anchorX, anchorY, 15, 0xff0055, 0.85).setDepth(25);
        this.scene.tweens.add({
            targets: shatterRing,
            scale: 3,
            alpha: 0,
            duration: 350,
            ease: 'Power2',
            onComplete: () => shatterRing.destroy()
        });

        this.scene.matter.world.remove(this.currentHookedAnchorBody);
        if (anchorGameObject && anchorGameObject.destroy) {
            anchorGameObject.destroy();
        }
        this.currentHookedAnchorBody = null;
    }

    public forceRelease(): void {
        if (!this.isHooked) return;

        this.isHooked = false;
        this.isUnstableHooked = false;
        this.currentHookedAnchorBody = null;
        this.unstableTimer = 0;
        this.anchorPoint.set(0, 0);

        if (this.pivotConstraint) {
            this.scene.matter.world.remove(this.pivotConstraint);
            this.pivotConstraint = null;
        }

        this.player.updateState("FALLING");
    }

    private releaseAnchor(): void {
        if (!this.isHooked) return;

        const swingVelocity = this.player.body.velocity;

        this.isHooked = false;
        this.isUnstableHooked = false;
        this.currentHookedAnchorBody = null;
        this.unstableTimer = 0;
        this.anchorPoint.set(0, 0);
        if (this.pivotConstraint) {
            this.scene.matter.world.remove(this.pivotConstraint);
            this.pivotConstraint = null;
        }

        // The release is the swing, exactly. There used to be an upward nudge
        // added here for a launch that was moving sideways and falling, which
        // handed back a little height the swing had not earned. A run that
        // reads the arc should be the only way up.
        const boostX = swingVelocity.x * GAME_CONSTANTS.SWING.LAUNCH_BOOST;
        const boostY = swingVelocity.y * GAME_CONSTANTS.SWING.LAUNCH_BOOST;

        const boostedSpeed = Math.hypot(boostX, boostY);
        const maxSpeed = GAME_CONSTANTS.SWING.MAX_LAUNCH_SPEED;

        if (boostedSpeed > maxSpeed && boostedSpeed > 0) {
            const scale = maxSpeed / boostedSpeed;
            this.scene.matter.body.setVelocity(this.player.body, {
                x: boostX * scale,
                y: boostY * scale
            });
        } else {
            this.scene.matter.body.setVelocity(this.player.body, {
                x: boostX,
                y: boostY
            });
        }

        this.player.updateState("FALLING");
    }

    public destroy(): void {
        this.scene.input.off("pointerdown", this.pointerDownHandler, this);
        this.scene.input.off("pointerup", this.pointerUpHandler, this);
        this.releaseAnchor();
    }
}