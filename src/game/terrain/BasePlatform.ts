import Phaser from "phaser";
import { COLLISION_CHANNELS } from "../config/physics-channels";

export interface SurfaceProperties {
    friction: number;        // Tangential resistance for anchoring
    restitution: number;     // Bounciness on direct impact
    isSlippery?: boolean;    // Custom modifier flag for the Frozen biome
    isCrumbling?: boolean;   // Fragile high-altitude crumbling platform
    isRisk?: boolean;        // Risk line: narrow, crumbling sooner, and carries coins
}

export class BasePlatform extends Phaser.GameObjects.Image {
    public override body!: MatterJS.BodyType;
    public surfaceProps: SurfaceProperties;
    public isCrumblingTriggered: boolean = false;

    /**
     * True for platforms on the risk line.
     *
     * Read by the coin banking rule: a landing on risky ground does not bank the
     * haul, because otherwise a bounce off a risk platform would make the risk free.
     */
    public isRiskPlatform(): boolean {
        return this.surfaceProps.isRisk === true;
    }

    constructor(
        scene: Phaser.Scene,
        x: number,
        y: number,
        width: number,
        height: number,
        props: SurfaceProperties
    ) {
        super(scene, x, y, 'multiverse_platform');
        this.surfaceProps = props;

        scene.add.existing(this);
        const visualWidth = width * 2;
        const visualHeight = height * 2;

        this.setDisplaySize(visualWidth, visualHeight);
        this.setDepth(20);

        if (props.isCrumbling) {
            // Distinct fractured violet/fuchsia appearance for fragile platforms
            this.setTint(0xd946ef);
        } else if (props.isRisk) {
            // Amber, so a risk platform reads as a choice rather than as scenery.
            // Crumbling takes precedence visually, since it is the sharper hazard.
            this.setTint(0xffb347);
        }

        this.body = scene.matter.add.rectangle(x, y, visualWidth, visualHeight, {
            isStatic: true,
            friction: props.friction,
            restitution: props.restitution,
            label: "Platform",
            collisionFilter: {
                category: COLLISION_CHANNELS.TERRAIN,
                mask: COLLISION_CHANNELS.PLAYER | COLLISION_CHANNELS.JACK_TIP
            }
        }) as MatterJS.BodyType;
    }

    public triggerCrumble(): void {
        if (!this.surfaceProps.isCrumbling || this.isCrumblingTriggered || !this.active) {
            return;
        }

        this.isCrumblingTriggered = true;

        // 1. Warning vibration shake (1.2 seconds)
        this.scene.tweens.add({
            targets: this,
            x: { from: this.x - 3, to: this.x + 3 },
            duration: 50,
            repeat: 24, // 24 * 50ms = 1200ms
            yoyo: true,
            onComplete: () => {
                // The route recycles platforms while a crumble is still running,
                // and a destroyed GameObject has no scene left - so a shake that
                // outlived its platform used to throw here and take the frame
                // with it. Bailing out is also the correct behaviour: a platform
                // that no longer exists has no body left to remove.
                if (!this.scene || !this.active) return;

                // 2. Remove physics collision body so player can no longer stand on it
                if (this.body) {
                    this.scene.matter.world.remove(this.body);
                    this.body = undefined as unknown as MatterJS.BodyType;
                }

                // 3. Shatter drop and dissolve
                this.scene.tweens.add({
                    targets: this,
                    y: this.y + 120,
                    alpha: 0,
                    scaleX: 0.7,
                    duration: 350,
                    ease: 'Quad.easeIn',
                    onComplete: () => {
                        this.destroy();
                    }
                });
            }
        });
    }

    public override destroy(fromScene?: boolean): void {
        const matterBody = this.body;

        if (matterBody) {
            this.scene.matter.world.remove(matterBody);
            this.body = undefined as unknown as MatterJS.BodyType;
        }

        super.destroy(fromScene);
    }
}