import Phaser from 'phaser';
import { portalCoreKey, portalRingKey } from '../worlds/theming';
import { SKINS, type SkinId } from '../worlds/definitions';

/**
 * A gate between verses.
 *
 * The rule that shaped this class is that the player must never stop moving, so
 * the portal is not a trigger volume you walk into and not a door that opens. It
 * is a hoop hung in mid-air on the route, and crossing it is a geometric fact
 * rather than a collision: {@link Portal.crossedBy} tests the segment the player
 * travelled this frame against the hoop.
 *
 * That matters more than it looks. Matter has no continuous collision detection,
 * so a fast launch - or anything that moves the body a long way in one step -
 * can step clean over a sensor without ever overlapping it, and the one gate the
 * player most deserves to hit is the one they hit fastest. A segment test cannot
 * miss, which is why the gate can be trusted to fire exactly when the player
 * passes and not one frame later.
 */

export interface PortalCrossing {
    x: number;
    y: number;
}

export class Portal {
    /** The skin the gate leads to. Displayed by nothing; used by WorldManager. */
    public readonly targetSkin: string;
    /** Hoop radius in world px. The crossing test is a circle test against it. */
    public readonly radius: number;

    private readonly scene: Phaser.Scene;
    private readonly ring: Phaser.GameObjects.Image;
    private readonly core: Phaser.GameObjects.Image;
    /** Object-local glow controller, absent on the Canvas fallback. */
    private glowFilter: { setActive(value: boolean): unknown } | null = null;

    public get x(): number { return this.ring.x; }
    public get y(): number { return this.ring.y; }

    constructor(
        scene: Phaser.Scene,
        x: number,
        y: number,
        radius: number,
        accent: number,
        targetSkin: string
    ) {
        this.scene = scene;
        this.radius = radius;
        this.targetSkin = targetSkin;

        // The gate is drawn in the shape of the VERSE IT LEADS TO, so a player
        // reading the horizon sees where they are going before they get there:
        // a corolla ahead means Bloom, a furnace mouth means Kiln. The art is
        // white and tinted to the accent, so the colour still lands on the game
        // object and the SILHOUETTE is what carries the difference.
        const skin: SkinId = (targetSkin in SKINS ? targetSkin : 'VERGE') as SkinId;

        // The core is additive and behind the ring so the gate reads as a hole
        // with light coming out of it rather than a decal.
        this.core = scene.add.image(x, y, portalCoreKey(skin))
            .setDepth(38)
            .setTint(accent)
            .setBlendMode(Phaser.BlendModes.ADD)
            .setDisplaySize(radius * 2.3, radius * 2.3);

        this.ring = scene.add.image(x, y, portalRingKey(skin))
            .setDepth(40)
            .setTint(accent)
            .setDisplaySize(radius * 2.2, radius * 2.2);

        // Object-local glow rather than a camera filter. A camera filter would
        // be one framebuffer for the whole frame, but it would also run over the
        // tether, and the tether's colour is the one thing in the game that no
        // verse may change - so the glow is pinned to the gate instead.
        const filtered = this.ring as Phaser.GameObjects.Image & {
            enableFilters?: () => void;
            filters?: {
                internal: {
                    addGlow: (color: number, outer: number, inner: number, knockout: boolean) =>
                        { setActive(value: boolean): unknown };
                };
            };
        };
        if (typeof filtered.enableFilters === 'function') {
            try {
                filtered.enableFilters();
                this.glowFilter = filtered.filters?.internal.addGlow(accent, 2.4, 0, false) ?? null;
            } catch {
                // Filters are WebGL-only. The Canvas fallback draws the hoop
                // without a halo, which is a quieter gate rather than a broken
                // one, so this is allowed to fail silently.
                this.glowFilter = null;
            }
        }

        // Slow counter-rotation keeps the gate alive without asking anything of
        // the player. The ring's own gaps do the mechanical reading.
        scene.tweens.add({
            targets: this.ring,
            angle: 360,
            duration: 9000,
            repeat: -1,
            ease: 'Linear',
        });
        scene.tweens.add({
            targets: this.core,
            angle: -360,
            duration: 14000,
            repeat: -1,
            ease: 'Linear',
        });
        scene.tweens.add({
            targets: this.core,
            alpha: { from: 0.6, to: 1 },
            duration: 1100,
            yoyo: true,
            repeat: -1,
            ease: 'Sine.easeInOut',
        });
    }

    /**
     * True when the segment `from -> to` passes through the hoop.
     *
     * Written against the travelled segment rather than the current position on
     * purpose: see the class note. Both arguments are WorldManager scratch
     * values, so this allocates nothing per frame.
     */
    public crossedBy(from: PortalCrossing, to: PortalCrossing): boolean {
        const dx = to.x - from.x;
        const dy = to.y - from.y;
        const lengthSq = dx * dx + dy * dy;

        let t = 0;
        if (lengthSq > 0) {
            t = ((this.x - from.x) * dx + (this.y - from.y) * dy) / lengthSq;
            t = t < 0 ? 0 : t > 1 ? 1 : t;
        }

        const closestX = from.x + dx * t;
        const closestY = from.y + dy * t;
        const distX = this.x - closestX;
        const distY = this.y - closestY;

        return distX * distX + distY * distY <= this.radius * this.radius;
    }

    /** World position of the hoop, for the flash that answers the crossing. */
    public crossingPoint(from: PortalCrossing, to: PortalCrossing, out: PortalCrossing): PortalCrossing {
        const dx = to.x - from.x;
        const dy = to.y - from.y;
        const lengthSq = dx * dx + dy * dy;

        let t = 0;
        if (lengthSq > 0) {
            t = ((this.x - from.x) * dx + (this.y - from.y) * dy) / lengthSq;
            t = t < 0 ? 0 : t > 1 ? 1 : t;
        }

        out.x = from.x + dx * t;
        out.y = from.y + dy * t;
        return out;
    }

    /**
     * Collapses the gate.
     *
     * There is no pause and no camera cut: the ring implodes, the core blows out
     * into the world layer, and the scene carries on mid-flight. WorldManager
     * owns the world change; all this has to do is stop existing.
     */
    public fire(): void {
        this.scene.tweens.killTweensOf(this.ring);
        this.scene.tweens.killTweensOf(this.core);

        this.scene.tweens.add({
            targets: this.ring,
            scale: this.ring.scale * 2.1,
            alpha: 0,
            duration: 340,
            ease: 'Quad.easeIn',
        });
        this.scene.tweens.add({
            targets: this.core,
            scale: this.core.scale * 3.4,
            alpha: 0,
            duration: 420,
            ease: 'Quad.easeOut',
        });

        // Destruction is scheduled rather than done in a tween's onComplete: a
        // tween whose target is destroyed mid-flight completes early, and that
        // would tear the gate down before its own burst has played.
        this.scene.time.delayedCall(480, () => this.destroy());

        if (this.glowFilter) {
            this.glowFilter.setActive(false);
        }
    }

    public destroy(): void {
        if (this.glowFilter) {
            try { this.glowFilter.setActive(false); } catch { /* filter already gone */ }
            this.glowFilter = null;
        }
        this.scene.tweens.killTweensOf(this.ring);
        this.scene.tweens.killTweensOf(this.core);
        if (this.ring.active) this.ring.destroy();
        if (this.core.active) this.core.destroy();
    }
}
