import Phaser from 'phaser';
import { SKINS, type SkinId, type WorldSkin } from './definitions';

/**
 * Every piece of art a verse needs, generated in code.
 *
 * The project generates its sprites rather than shipping them - the coin is
 * drawn at boot for exactly that reason - and a verse that swapped in PNGs would
 * be four more binaries that can go missing and fail silently as a
 * missing-texture warning. Everything here runs once per skin, is cached by key,
 * and costs a few milliseconds.
 *
 * The interesting one is the platform.
 *
 * `multiverse_platform` is a dark hull slab with magenta and cyan neon trim. A
 * tint cannot turn it green, because tinting is a multiply and a multiply of
 * magenta by green is mud. What turns it green is a duotone: read the frame's
 * luminance and remap it onto two colours, shadow and light. The slab's shading
 * survives, the neon trim becomes the light end, and one pass produces a
 * convincing plate in any palette. The art is downsampled as it is processed
 * because it is displayed at 120-280px wide; keeping a 1536px source for that
 * would cost 40x the memory for detail nobody can see.
 *
 * The silhouette is deliberately untouched. `BasePlatform` builds a physics box
 * the same size as the display box, so the visible top of the art is not where
 * the player's feet are - the player's drawn feet sit ~25px under the box top,
 * which lines up with the art's own top edge only because the art starts about
 * 29% of the way down the frame. Redrawing the platform with a different
 * silhouette would silently move where a landing looks like it happens, and that
 * is a gameplay change wearing a cosmetic coat.
 */

const PREFIX = 'tetherverse-world';

export const platformTextureKey = (skin: SkinId): string =>
    skin === 'VERGE' ? 'multiverse_platform' : `${PREFIX}-platform-${skin}`;

export const skyTextureKey = (skin: SkinId): string => `${PREFIX}-sky-${skin}`;

export const particleTextureKey = (kind: 'SPORES' | 'EMBERS' | 'GLITCH'): string =>
    `${PREFIX}-particle-${kind}`;

/** Screen-fixed radial: transparent centre darkening to black at the rim. */
export const VIGNETTE_TEXTURE_KEY = `${PREFIX}-vignette`;
/** Soft rising heat-noise strip for the KILN heat band. */
export const HEAT_TEXTURE_KEY = `${PREFIX}-heat`;
/** Tiny tileable scanline strip for the NULL atmosphere band. */
export const SCANLINE_TEXTURE_KEY = `${PREFIX}-scanlines`;
export const PORTAL_RING_KEY = `${PREFIX}-portal-ring`;
export const PORTAL_CORE_KEY = `${PREFIX}-portal-core`;
export const POD_TEXTURE_KEY = `${PREFIX}-pod`;

/**
 * Source resolution the platform art is remapped at.
 *
 * 768x512 is the largest size that stays under a 5ms pass on a mid laptop while
 * still being 1.8x more resolution than the widest platform is ever drawn at.
 */
const PLATFORM_REMAP_WIDTH = 768;

const makeCanvas = (width: number, height: number): HTMLCanvasElement => {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    return canvas;
};

const rgb = (colour: number): [number, number, number] => [
    (colour >> 16) & 0xff,
    (colour >> 8) & 0xff,
    colour & 0xff,
];

/**
 * Remaps `multiverse_platform` onto a verse's two colours.
 *
 * The source frame is the shared one, so the pass is skipped if the key already
 * exists: revisiting a verse is free, and the cache is bounded at four entries
 * for the whole run.
 */
function buildPlatformTexture(scene: Phaser.Scene, skin: WorldSkin): void {
    const key = platformTextureKey(skin.id);
    if (scene.textures.exists(key)) return;

    const source = scene.textures.get('multiverse_platform').getSourceImage() as
        HTMLImageElement | HTMLCanvasElement;
    const naturalWidth = (source as HTMLImageElement).naturalWidth || source.width;
    const naturalHeight = (source as HTMLImageElement).naturalHeight || source.height;
    if (!naturalWidth || !naturalHeight) return;

    const scale = PLATFORM_REMAP_WIDTH / naturalWidth;
    const canvas = makeCanvas(PLATFORM_REMAP_WIDTH, Math.round(naturalHeight * scale));
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return;

    ctx.drawImage(source, 0, 0, canvas.width, canvas.height);

    const image = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const data = image.data;
    const [dr, dg, db] = rgb(skin.palette.platformDark);
    const [lr, lg, lb] = rgb(skin.palette.platformLight);

    for (let i = 0; i < data.length; i += 4) {
        const a = data[i + 3];
        if (a === 0) continue;

        // Rec.709 luminance. The gamma pulls the mid-tones apart so the hull's
        // body stays in the shadow colour and only the neon trim reaches the
        // light end - without it every platform reads as a flat plate.
        const lum = (0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2]) / 255;
        const t = Math.pow(lum, 0.9);

        data[i] = dr + (lr - dr) * t;
        data[i + 1] = dg + (lg - dg) * t;
        data[i + 2] = db + (lb - db) * t;
    }

    ctx.putImageData(image, 0, 0);
    scene.textures.addCanvas(key, canvas);
}

/**
 * The vertical light bleed, as a texture rather than a live gradient.
 *
 * `Graphics.fillGradientStyle` does not survive `generateTexture`, and a
 * screen-fixed shape redrawn every frame is a draw call for something that never
 * changes. A 8x256 canvas costs nothing and renders identically on the Canvas
 * fallback that WebGL gradients would quietly drop.
 */
function buildSkyTexture(scene: Phaser.Scene, skin: WorldSkin): void {
    const key = skyTextureKey(skin.id);
    if (scene.textures.exists(key)) return;

    const canvas = makeCanvas(8, 256);
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const [tr, tg, tb] = rgb(skin.palette.skyTop);
    const [br, bg, bb] = rgb(skin.palette.skyBottom);

    const gradient = ctx.createLinearGradient(0, 0, 0, 256);
    gradient.addColorStop(0, `rgba(${tr},${tg},${tb},0)`);
    gradient.addColorStop(0.38, `rgba(${tr},${tg},${tb},0.55)`);
    gradient.addColorStop(1, `rgba(${br},${bg},${bb},1)`);
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, 8, 256);

    scene.textures.addCanvas(key, canvas);
}

/**
 * Soft particles, drawn white on purpose.
 *
 * A white particle tinted by the emitter is one texture that any verse can make
 * green, orange or magenta, and the tint is per-particle so a field can drift
 * through a colour range without a second texture.
 */
function buildParticleTextures(scene: Phaser.Scene): void {
    const soft = (key: string, size: number, core: number) => {
        if (scene.textures.exists(key)) return;
        const canvas = makeCanvas(size, size);
        const ctx = canvas.getContext('2d');
        if (!ctx) return;
        const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
        g.addColorStop(0, `rgba(255,255,255,${core})`);
        g.addColorStop(0.45, `rgba(255,255,255,${core * 0.55})`);
        g.addColorStop(1, 'rgba(255,255,255,0)');
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, size, size);
        scene.textures.addCanvas(key, canvas);
    };

    soft(particleTextureKey('SPORES'), 18, 0.95);
    soft(particleTextureKey('EMBERS'), 10, 1);

    // Glitch motes are not soft. A 5px hard square that blinks out reads as a
    // dropped frame, which is exactly what NULL is supposed to feel like.
    const glitchKey = particleTextureKey('GLITCH');
    if (!scene.textures.exists(glitchKey)) {
        const canvas = makeCanvas(8, 8);
        const ctx = canvas.getContext('2d');
        if (ctx) {
            ctx.fillStyle = 'rgba(255,255,255,1)';
            ctx.fillRect(1, 1, 6, 2);
            ctx.fillRect(3, 3, 3, 2);
            scene.textures.addCanvas(glitchKey, canvas);
        }
    }
}

/** Repeating scanlines for NULL, small enough to tile 200x250 times. */
function buildScanlineTexture(scene: Phaser.Scene): void {
    if (scene.textures.exists(SCANLINE_TEXTURE_KEY)) return;

    const canvas = makeCanvas(4, 6);
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.fillStyle = 'rgba(4,4,8,0.85)';
    ctx.fillRect(0, 0, 4, 2);
    ctx.fillStyle = 'rgba(255,47,208,0.10)';
    ctx.fillRect(0, 2, 4, 1);

    scene.textures.addCanvas(SCANLINE_TEXTURE_KEY, canvas);
}

/**
 * Full-screen radial: transparent at the centre, darkening to near-opaque black
 * at the rim. Screen-fixed and depth-guarded (72 < tether 90), so it vignettes
 * the world without ever touching the tether line or the player.
 */
function buildVignetteTexture(scene: Phaser.Scene): void {
    if (scene.textures.exists(VIGNETTE_TEXTURE_KEY)) return;

    const size = 256;
    const canvas = makeCanvas(size, size);
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const g = ctx.createRadialGradient(size / 2, size / 2, size * 0.28, size / 2, size / 2, size * 0.52);
    g.addColorStop(0, 'rgba(0,0,0,0)');
    g.addColorStop(0.72, 'rgba(0,0,0,0.22)');
    g.addColorStop(1, 'rgba(0,0,0,0.9)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, size, size);

    scene.textures.addCanvas(VIGNETTE_TEXTURE_KEY, canvas);
}

/**
 * 128×256 soft heat shimmer: opaque along a wavering vertical spine and fading
 * out at the column edges, with horizontal bites taken out of it so a stack of
 * tiles reads as rising heat rather than a hard slab.
 */
function buildHeatTexture(scene: Phaser.Scene): void {
    if (scene.textures.exists(HEAT_TEXTURE_KEY)) return;

    const width = 128;
    const height = 256;
    const canvas = makeCanvas(width, height);
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const g = ctx.createLinearGradient(0, 0, width, 0);
    g.addColorStop(0, 'rgba(255,255,255,0)');
    g.addColorStop(0.38, 'rgba(255,255,255,0.5)');
    g.addColorStop(0.62, 'rgba(255,255,255,0.5)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, width, height);

    // Punch gaps so the band reads as shimmer, not a rectangle.
    ctx.globalCompositeOperation = 'destination-out';
    for (let y = 0; y < height; y += 10) {
        const wave = Math.sin(y * 0.09) * 0.5 + 0.5;
        ctx.fillStyle = `rgba(0,0,0,${(0.2 + wave * 0.45).toFixed(3)})`;
        ctx.fillRect(0, y, width, 5);
    }

    scene.textures.addCanvas(HEAT_TEXTURE_KEY, canvas);
}

/**
 * The gate.
 *
 * The ring is drawn with two gaps so that rotating it reads as a mechanism
 * rather than a spinning picture, and the core is a radial falloff that can be
 * tinted per verse. Both are white-based so the accent colour lives on the game
 * objects, not baked into the art.
 */
function buildPortalTextures(scene: Phaser.Scene): void {
    if (!scene.textures.exists(PORTAL_RING_KEY)) {
        const size = 256;
        const canvas = makeCanvas(size, size);
        const ctx = canvas.getContext('2d');
        if (ctx) {
            ctx.translate(size / 2, size / 2);
            ctx.lineCap = 'round';

            ctx.strokeStyle = 'rgba(255,255,255,0.95)';
            ctx.lineWidth = 9;
            ctx.beginPath();
            ctx.arc(0, 0, 108, 0.28 * Math.PI, 1.72 * Math.PI);
            ctx.stroke();

            ctx.strokeStyle = 'rgba(255,255,255,0.55)';
            ctx.lineWidth = 5;
            ctx.beginPath();
            ctx.arc(0, 0, 88, 1.15 * Math.PI, 2.55 * Math.PI);
            ctx.stroke();

            ctx.strokeStyle = 'rgba(255,255,255,0.3)';
            ctx.lineWidth = 3;
            ctx.beginPath();
            ctx.arc(0, 0, 124, 2.3 * Math.PI, 3.6 * Math.PI);
            ctx.stroke();

            scene.textures.addCanvas(PORTAL_RING_KEY, canvas);
        }
    }

    if (!scene.textures.exists(PORTAL_CORE_KEY)) {
        const size = 128;
        const canvas = makeCanvas(size, size);
        const ctx = canvas.getContext('2d');
        if (ctx) {
            const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
            g.addColorStop(0, 'rgba(255,255,255,0.9)');
            g.addColorStop(0.35, 'rgba(255,255,255,0.35)');
            g.addColorStop(1, 'rgba(255,255,255,0)');
            ctx.fillStyle = g;
            ctx.fillRect(0, 0, size, size);
            scene.textures.addCanvas(PORTAL_CORE_KEY, canvas);
        }
    }
}

/** A sticky pod: a sac of spores sitting on the ledge it is about to slow you down on. */
function buildPodTexture(scene: Phaser.Scene): void {
    if (scene.textures.exists(POD_TEXTURE_KEY)) return;

    const size = 48;
    const canvas = makeCanvas(size, size);
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const g = ctx.createRadialGradient(size / 2, size / 2 + 2, 2, size / 2, size / 2 + 2, size / 2);
    g.addColorStop(0, 'rgba(255,255,255,0.95)');
    g.addColorStop(0.4, 'rgba(210,255,235,0.8)');
    g.addColorStop(0.8, 'rgba(110,220,170,0.35)');
    g.addColorStop(1, 'rgba(60,180,130,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.ellipse(size / 2, size / 2 + 2, size / 2 - 2, size / 2 - 6, 0, 0, Math.PI * 2);
    ctx.fill();

    scene.textures.addCanvas(POD_TEXTURE_KEY, canvas);
}

/**
 * Builds everything one skin needs, once.
 *
 * Called at the start of a transition rather than at boot: the swap lands
 * ~180ms in, under the flash, so the few milliseconds this costs are spent
 * behind the one moment the player is not looking at the world.
 */
export function ensureSkinArt(scene: Phaser.Scene, skin: WorldSkin): void {
    if (skin.id !== 'VERGE') buildPlatformTexture(scene, skin);
    buildSkyTexture(scene, skin);
    buildParticleTextures(scene);
    buildScanlineTexture(scene);
    buildVignetteTexture(scene);
    buildHeatTexture(scene);
    buildPortalTextures(scene);
    buildPodTexture(scene);
}

/** Warms every skin at scene creation so the first transition has no hitch in it. */
export function preloadAllSkinArt(scene: Phaser.Scene): void {
    (Object.keys(SKINS) as SkinId[]).forEach((id) => ensureSkinArt(scene, SKINS[id]));
}
