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
 * The interesting one is the platform, and what changed about it.
 *
 * It used to be a per-pixel duotone of the one shared `multiverse_platform` PNG:
 * same slab, four palettes. That is recolouring, and it is exactly what stops
 * four dimensions from reading as four dimensions - a player who cannot name the
 * hues still has to know whether they are standing on hull plating, a mushroom
 * shelf, slag or a fragmenting floor.
 *
 * So the pipeline split in two. Each verse now DRAWS its own geometry in
 * greyscale - drawVergePlate, drawBloomShelf, drawKilnSlag, drawNullFragment,
 * differing in silhouette, edge treatment and material detail - and the duotone
 * then runs over the drawing exactly as it ran over the PNG. Two things fall
 * out of that. The palette still decides the colour, so the verses stay in
 * their established colours; and a dark plate still takes a multiply tint, so
 * the crumbling and risk ledges keep their warning colours instead of turning
 * to mud. Geometry changed, colour pipeline untouched.
 *
 * The frame invariant is the part that is not cosmetic. `BasePlatform` builds a
 * physics box the same size as the display box, so where the player's feet land
 * is set by the frame, not by the pixels: the drawn feet sit ~25px under the box
 * top, which lines up with the art's own top edge only because the art starts
 * about 29% of the way down. Every drawer here puts its top surface at
 * PLATFORM_TOP and varies everything beneath it. Move that line and landings
 * visibly move, which is a gameplay change wearing a cosmetic coat.
 */

const PREFIX = 'tetherverse-world';

/**
 * Texture keys.
 *
 * Every one of these is per-skin now, including VERGE's platform - which used
 * to be the shared `multiverse_platform` PNG, and was therefore the one world
 * whose ledges were the same object as every other game's ledges.
 */
export const platformTextureKey = (skin: SkinId): string => `${PREFIX}-platform-${skin}`;
/** The crumbling/risk variant: the verse's geometry, duotoned neutrally so the
    warning tint in WorldManager still lands on a plate with no hue of its own. */
export const warningPlatformTextureKey = (skin: SkinId): string => `${PREFIX}-platform-${skin}-warn`;
export const portalRingKey = (skin: SkinId): string => `${PREFIX}-portal-ring-${skin}`;
export const portalCoreKey = (skin: SkinId): string => `${PREFIX}-portal-core-${skin}`;
export const hookNodeTextureKey = (skin: SkinId): string => `${PREFIX}-hook-${skin}`;

/** Retained for the crumbling/risk fallback, which is the one shared frame. */
export const SHARED_PLATFORM_KEY = 'multiverse_platform';
/** Retained for anchors spawned before a world has been decided. */
export const SHARED_HOOK_KEY = 'hook_node';

/**
 * How the tether is dressed, per verse.
 *
 * The CORE is not in this table and never will be. It is `0x00ffcc`, cyan, and
 * cyan is the player - a line the player is swinging on at speed has to stay
 * findable against a busy KILN sky, and it stops being findable the moment a
 * verse recolours it. What varies is everything AROUND the core, and the
 * structure of that outer pass: BLOOM's is two filaments twisting round each
 * other, KILN's is a chain with couplers across it, NULL's keeps losing its
 * grip on where the line actually is. Four appearances, one player.
 *
 * Fraying overrides all of it to rose, in every verse: a damaged rope is
 * failure, and failure is the same colour everywhere.
 */
export type TetherPattern = 'solid' | 'braid' | 'coupled' | 'glitch';

export interface TetherStyle {
    /** Outer pass colour: the verse's own energy wrapped round the line. */
    glow: number;
    /** Outer pass width, px. */
    glowWidth: number;
    pattern: TetherPattern;
}

const TETHER_STYLES: Record<SkinId, TetherStyle> = {
    // A milled cable: one hard, even casing. Nothing in VERGE is soft.
    VERGE: { glow: 0xa855f7, glowWidth: 7, pattern: 'solid' },
    // Two filaments about the same span - the line grew, it was not extruded.
    BLOOM: { glow: 0x63ffb3, glowWidth: 10, pattern: 'braid' },
    // A chain: links along it, couplered across it.
    KILN: { glow: 0xff8a3a, glowWidth: 9, pattern: 'coupled' },
    // A signal dropping frames on its way to the anchor.
    NULL: { glow: 0xff2fd0, glowWidth: 8, pattern: 'glitch' },
};

export function tetherStyleFor(skin: SkinId): TetherStyle {
    return TETHER_STYLES[skin] ?? TETHER_STYLES.VERGE;
}

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
 * Remaps a greyscale drawing onto two colours.
 *
 * This is what turns each verse's own geometry into that verse's palette, and
 * it is also what keeps the crumbling and risk ledges legible: those are drawn
 * in NEUTRAL grey and sent through this same pass, so the multiply tint that
 * follows lands on a plate with no colour of its own. That matters because the
 * old neutral source is no longer neutral - KILN's ledge is already orange,
 * and an orange ledge tinted orange is an undifferentiated ledge.
 */
function duotone(canvas: HTMLCanvasElement, dark: number, light: number): void {
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return;

    const image = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const data = image.data;
    const [dr, dg, db] = rgb(dark);
    const [lr, lg, lb] = rgb(light);

    for (let i = 0; i < data.length; i += 4) {
        const a = data[i + 3];
        if (a === 0) continue;

        // Rec.709 luminance. The gamma pulls the mid-tones apart so a plate's
        // body stays in the shadow colour and only its lit edge reaches the
        // light end - without it every platform reads as a flat colour.
        const lum = (0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2]) / 255;
        const t = Math.pow(lum, 0.9);

        data[i] = dr + (lr - dr) * t;
        data[i + 1] = dg + (lg - dg) * t;
        data[i + 2] = db + (lb - db) * t;
    }

    ctx.putImageData(image, 0, 0);
}

/**
 * Platform geometry, one drawer per verse.
 *
 * The invariant these all obey is in `BasePlatform`: the physics box is a
 * plain rectangle covering the whole display box, so where the player's feet
 * land is fixed by the frame, not by the pixels. The shared art started about
 * 29% down the frame, which is what lines the drawn ledge up with the box top,
 * so every drawer below puts its top surface at PLATFORM_TOP and varies
 * everything *under* it. Change that line and landings visibly move, which is
 * a gameplay change wearing a costume.
 *
 * Greyscale on purpose - the duotone decides the colour, and these decide the
 * material.
 */

/** VERGE: a machined hull plate. Milled bevel, panel seams, rivet rows, one
    strip of neon trim under the chamfer. Hard geometry, nothing organic.

    Coordinates are fractions of the frame, and the frame is deliberately small
    - 256x128 rather than the 768x512 it used to be. A platform is drawn at
    120-280px wide, so a frame four times that size scaled every stroke down to
    a third of a pixel: the seams survived because they were tall, and the
    rivets did not survive at all. Drawing at roughly the size it is displayed
    is what makes these details exist. */
function drawVergePlate(ctx: CanvasRenderingContext2D, W: number, H: number, yTop: number): void {
    const bodyH = H - yTop;

    ctx.fillStyle = '#3a3a44';
    ctx.fillRect(0, yTop, W, bodyH);

    // The milled chamfer: two steps, the first catching the most light.
    ctx.fillStyle = '#c8c8d6';
    ctx.fillRect(0, yTop, W, 2);
    ctx.fillStyle = '#5a5a68';
    ctx.fillRect(0, yTop + 2, W, 2);

    // Neon trim. The brightest thing in the frame, so the duotone sends it to
    // the light end and every plate carries a lit edge in its own accent.
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, yTop + 5, W, 2);

    // Panel seams, dividing the plate into eight bays.
    ctx.fillStyle = '#181820';
    for (let bay = 1; bay < 8; bay++) {
        ctx.fillRect(Math.round((bay / 8) * W), yTop + 8, 2, bodyH - 8);
    }

    // Two rivet rows, top and bottom.
    ctx.fillStyle = '#8a8a98';
    for (let bay = 0; bay < 8; bay++) {
        const x = Math.round(((bay + 0.5) / 8) * W);
        ctx.beginPath();
        ctx.arc(x, yTop + 11, 1.4, 0, Math.PI * 2);
        ctx.fill();
        ctx.beginPath();
        ctx.arc(x, H - 5, 1.4, 0, Math.PI * 2);
        ctx.fill();
    }

    // The under-hang, in shadow, so the plate reads as having thickness.
    ctx.fillStyle = '#20202a';
    ctx.fillRect(0, H - 5, W, 5);
}

/** BLOOM: a mycelial shelf. A soft cap with gills beneath it and root tendrils
    hanging off the underside. Nothing in it is straight. */
function drawBloomShelf(ctx: CanvasRenderingContext2D, W: number, H: number, yTop: number): void {
    // The dome peaks exactly at yTop and droops below it at the edges. Peaking
    // ABOVE the contract line would put the player's feet visibly inside the
    // shelf, because the physics box still starts at the frame's top - so the
    // curve falls away downward and the landing surface is the top of the arch.
    const capEdgeY = yTop + 12;
    const capControlY = yTop - 6;
    // The quadratic evaluated at t, so the gills hang off the real curve
    // rather than off an approximation of it.
    const capAt = (t: number) => {
        const u = 1 - t;
        return u * u * capEdgeY + 2 * u * t * capControlY + t * t * capEdgeY;
    };
    const capEdge = () => ctx.quadraticCurveTo(W * 0.5, capControlY, W, capEdgeY);

    ctx.fillStyle = '#4a4a52';
    ctx.beginPath();
    ctx.moveTo(0, capEdgeY);
    capEdge();
    ctx.lineTo(W, H);
    ctx.lineTo(0, H);
    ctx.closePath();
    ctx.fill();

    // Bioluminescent rim: the light source in this world is the shelf itself.
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.moveTo(0, capEdgeY);
    capEdge();
    ctx.stroke();

    // Gills, radiating down from under the cap.
    ctx.strokeStyle = 'rgba(0,0,0,0.5)';
    ctx.lineWidth = 1.5;
    for (let i = 1; i < 16; i++) {
        const t = i / 16;
        const y = capAt(t);
        ctx.beginPath();
        ctx.moveTo(t * W, y + 4);
        ctx.lineTo(t * W, y + 13);
        ctx.stroke();
    }

    // Root tendrils, hanging past the bottom edge of the frame.
    ctx.strokeStyle = 'rgba(0,0,0,0.45)';
    ctx.lineWidth = 2;
    ctx.lineCap = 'round';
    for (let i = 0; i < 9; i++) {
        const x = (i + 0.5) * (W / 9);
        const len = 10 + ((i * 7) % 9);
        ctx.beginPath();
        ctx.moveTo(x, H);
        ctx.quadraticCurveTo(x + 4, H - len * 0.6, x - 2, H - len);
        ctx.stroke();
    }
}

/** KILN: a block of cooled slag over a still-molten interior. Chipped top
    corners, a charred crust, and fissures of light leaking through it. */
function drawKilnSlag(ctx: CanvasRenderingContext2D, W: number, H: number, yTop: number): void {
    const bodyH = H - yTop;

    // An irregular top edge: this world's ledges are broken, not milled. Its
    // highest vertex sits exactly on yTop - the contract line - and everything
    // else falls away below it.
    ctx.fillStyle = '#3c3430';
    ctx.beginPath();
    ctx.moveTo(0, yTop + 5);
    ctx.lineTo(W * 0.05, yTop + 1);
    ctx.lineTo(W * 0.2, yTop + 3);
    ctx.lineTo(W * 0.42, yTop);
    ctx.lineTo(W * 0.68, yTop + 4);
    ctx.lineTo(W * 0.86, yTop + 1);
    ctx.lineTo(W, yTop + 4);
    ctx.lineTo(W, H);
    ctx.lineTo(0, H);
    ctx.closePath();
    ctx.fill();

    // Charred crust along the top surface.
    ctx.fillStyle = '#161210';
    ctx.fillRect(0, yTop, W, 3);

    // Molten fissures running down the face. Bright, so they are what the
    // duotone puts in the light end: the ledge glows from inside.
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 2;
    ctx.lineJoin = 'round';
    const cracks: [number, number][] = [[0.12, 0.35], [0.3, 0.62], [0.5, 0.45], [0.73, 0.7], [0.9, 0.3]];
    for (const [fx, drift] of cracks) {
        let x = fx * W;
        let y = yTop + 6;
        ctx.beginPath();
        ctx.moveTo(x, y);
        for (let s = 0; s < 4; s++) {
            x += (drift - 0.5) * 11;
            y += (bodyH - 7) / 4;
            ctx.lineTo(x, y);
        }
        ctx.stroke();
    }

    // Eroded bottom edge, so the block does not end in a ruled line.
    ctx.globalCompositeOperation = 'destination-out';
    for (let x = 0; x < W; x += 9) {
        const bite = ((x * 13) % 7) + 1;
        ctx.fillRect(x, H - bite, 7, bite + 2);
    }
    ctx.globalCompositeOperation = 'source-over';
}

/** NULL: geometry that has stopped holding together. Horizontal slices pushed
    sideways, chunks missing entirely, a wireframe where the surface was. */
function drawNullFragment(ctx: CanvasRenderingContext2D, W: number, H: number, yTop: number): void {
    const bodyH = H - yTop;
    const slices = 6;
    // Each slice is pushed sideways, so the leftmost still starts at 0 and the
    // top surface is still the top surface - the offsets are what make it read
    // as failing, not a change in where it is.
    const shift = [0, 5, -8, 3, -6, 7];

    for (let i = 0; i < slices; i++) {
        const y = yTop + bodyH * (i / slices);
        const hgt = bodyH / slices - 1;
        ctx.fillStyle = i % 2 ? '#4a4a56' : '#35353f';
        ctx.fillRect(shift[i], y, W, hgt);
    }

    // Bites taken clean out of it.
    ctx.globalCompositeOperation = 'destination-out';
    ctx.fillRect(100, yTop + 10, 32, 14);
    ctx.fillRect(40, H - 24, 50, 16);
    ctx.fillRect(180, yTop + 42, 40, 12);
    ctx.globalCompositeOperation = 'source-over';

    // The wireframe left behind where a surface should be.
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 1.5;
    ctx.strokeRect(0.75, yTop, W - 1.5, bodyH);

    // Detached fragments, floating clear of the ledge. Kept thin: they are the
    // one thing here that sits above the contract line, and anything much
    // larger starts competing with the surface the player is aiming at.
    ctx.globalAlpha = 0.55;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(14, yTop - 9, 16, 3);
    ctx.fillRect(200, yTop - 15, 21, 2.5);
    ctx.fillRect(110, yTop - 6, 11, 2);
    ctx.globalAlpha = 1;
}

/**
 * The frame each verse's ledge is drawn in, and why it is this small.
 *
 * Platforms are DISPLAYED at 120-280px wide and roughly 62-94px tall - a real
 * aspect between 1.28 and 5.0, measured off live ledges. The frame used to be
 * 768x512, which is five times the display width, so every stroke in it was
 * scaled down to a third of a pixel: panel seams survived because they ran the
 * full height, and rivets, gills, tendrils and trim simply did not exist by
 * the time they reached the screen. Four worlds drawn with real detail were
 * therefore four worlds drawn as flat rectangles, which is the same failure
 * this work set out to fix.
 *
 * 256x128 is close to the typical ledge's own size, so detail drawn here is
 * detail that survives. It also cuts the duotone pass and the texture footprint
 * by a third, which is the direction every one of these numbers should move.
 *
 * The aspect is not the ledge's aspect - it cannot be, since ledges vary - so
 * there is some stretch left, and it is why each drawer works in fractions of
 * the frame rather than in absolute pixels: a proportion deforms into the same
 * proportion at any size.
 */
const PLATFORM_W = 256;
const PLATFORM_H = 128;
/** Where the drawn ledge's top surface sits in the frame. Gameplay-visible:
    BasePlatform's physics box covers the whole frame, so this is what decides
    where a landing looks like it happens. See the note at the top of the file. */
const PLATFORM_TOP = 0.29;

/** Draws one verse's ledge geometry, in greyscale, into the shared frame. */
function drawPlatformGeometry(
    skin: SkinId,
    ctx: CanvasRenderingContext2D,
    W: number,
    H: number,
    yTop: number
): void {
    switch (skin) {
        case 'VERGE': drawVergePlate(ctx, W, H, yTop); break;
        case 'BLOOM': drawBloomShelf(ctx, W, H, yTop); break;
        case 'KILN': drawKilnSlag(ctx, W, H, yTop); break;
        case 'NULL': drawNullFragment(ctx, W, H, yTop); break;
    }
}

/** The verse's geometry on a fresh canvas, or null if it cannot be drawn. */
function makePlatformCanvas(skin: SkinId): HTMLCanvasElement | null {
    const canvas = makeCanvas(PLATFORM_W, PLATFORM_H);
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    const yTop = Math.round(PLATFORM_H * PLATFORM_TOP);
    drawPlatformGeometry(skin, ctx, PLATFORM_W, PLATFORM_H, yTop);
    return canvas;
}

function buildPlatformTexture(scene: Phaser.Scene, skin: WorldSkin): void {
    const key = platformTextureKey(skin.id);
    if (scene.textures.exists(key)) return;

    const canvas = makePlatformCanvas(skin.id);
    if (!canvas) return;

    duotone(canvas, skin.palette.platformDark, skin.palette.platformLight);
    scene.textures.addCanvas(key, canvas);
}

/** Neutral ends for the warning plates. Deliberately colourless - a plate that
    already has a hue cannot be multiplied into an arbitrary one. */
const WARNING_DARK = 0x14141c;
const WARNING_LIGHT = 0xf2f2f8;

/**
 * The crumbling and risk ledges, and why they are not simply the verse's plate.
 *
 * They used to be the shared hull PNG, which worked for one reason: it was
 * neutral in every palette, so multiplying it by magenta or orange produced the
 * same readable warning in all four worlds. That reason is gone. KILN's own
 * ledge is already orange, and an orange ledge tinted orange is a danger the
 * player cannot see coming - which is not a cosmetic loss, it is the hazard
 * becoming unreadable.
 *
 * So the GEOMETRY stays the verse's and the duotone does not: it runs onto
 * neutral greys, leaving the plate with no colour of its own, and the multiply
 * tint in WorldManager lands on it exactly as it landed on the old hull. Verse
 * silhouette and warning colour, both intact.
 */
function buildWarningPlatformTexture(scene: Phaser.Scene, skin: WorldSkin): void {
    // VERGE communicates crumbling and risk by overlay sweep rather than ledge
    // tint, so it has no warning plate and does not pay for one.
    if (skin.id === 'VERGE') return;

    const key = warningPlatformTextureKey(skin.id);
    if (scene.textures.exists(key)) return;

    const canvas = makePlatformCanvas(skin.id);
    if (!canvas) return;

    duotone(canvas, WARNING_DARK, WARNING_LIGHT);
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
 * The gate, one frame per verse.
 *
 * All four are white-based so the accent colour lives on the game objects and
 * can still be tinted, swapped and tweened at runtime - only the SHAPE is
 * per-verse, and the shape is where the differentiation has to live, because a
 * tint cannot make one ring into four rings.
 *
 * Each is drawn around a radius of roughly 105-118 on a 256 canvas, matching
 * the shared gate's footprint, so `setDisplaySize(radius * 2.2)` in Portal.ts
 * places every verse's gate where the crossing test expects it. Nothing here
 * moves the hoop.
 */

/** VERGE: a machined iris. Straight aperture blades meeting at an octagonal
    opening, a bezel of concentric rings, tick marks around the rim. Hard
    geometry - this world has a floor, a light source and a tolerance. */
function drawVergeIris(ctx: CanvasRenderingContext2D): void {
    ctx.lineCap = 'butt';

    // Eight aperture blades, meeting at straight chords rather than an arc.
    const r = 104;
    ctx.strokeStyle = 'rgba(255,255,255,0.95)';
    ctx.lineWidth = 8;
    ctx.beginPath();
    for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2;
        const a2 = ((i + 1) / 8) * Math.PI * 2;
        const mid = (a + a2) / 2;
        const cx = Math.cos(mid) * r * 0.78;
        const cy = Math.sin(mid) * r * 0.78;
        const x1 = Math.cos(a) * r;
        const y1 = Math.sin(a) * r;
        const x2 = Math.cos(a2) * r;
        const y2 = Math.sin(a2) * r;
        // Chord pulled in toward the centre, so the opening reads as a blade
        // edge rather than a polygon side.
        ctx.moveTo(x1, y1);
        ctx.quadraticCurveTo(cx, cy, x2, y2);
        ctx.stroke();
    }

    // Bezel rings: two machined bands outside the blades.
    ctx.strokeStyle = 'rgba(255,255,255,0.5)';
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.arc(0, 0, 116, 0, Math.PI * 2);
    ctx.stroke();

    ctx.strokeStyle = 'rgba(255,255,255,0.32)';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(0, 0, 88, 0, Math.PI * 2);
    ctx.stroke();

    // Index ticks, so rotating the ring reads as a mechanism turning.
    ctx.strokeStyle = 'rgba(255,255,255,0.75)';
    ctx.lineWidth = 3;
    for (let i = 0; i < 36; i++) {
        const a = (i / 36) * Math.PI * 2;
        const inner = i % 3 === 0 ? 96 : 103;
        ctx.beginPath();
        ctx.moveTo(Math.cos(a) * inner, Math.sin(a) * inner);
        ctx.lineTo(Math.cos(a) * 112, Math.sin(a) * 112);
        ctx.stroke();
    }
}

/** BLOOM: a corolla. Overlapping pointed petals opening outward around a soft
    inner ring. Nothing about it is radially regular - petals vary in length. */
function drawBloomCorolla(ctx: CanvasRenderingContext2D): void {
    ctx.lineCap = 'round';

    const petals = 9;
    for (let i = 0; i < petals; i++) {
        const a = (i / petals) * Math.PI * 2;
        // Per-petal variation: a flower is not a gear.
        const len = 100 + ((i * 29) % 26);
        const half = 0.16 + ((i * 7) % 5) * 0.012;
        const tipX = Math.cos(a) * len;
        const tipY = Math.sin(a) * len;
        const leftX = Math.cos(a - half) * 62;
        const leftY = Math.sin(a - half) * 62;
        const rightX = Math.cos(a + half) * 62;
        const rightY = Math.sin(a + half) * 62;

        ctx.fillStyle = i % 2 ? 'rgba(255,255,255,0.55)' : 'rgba(255,255,255,0.38)';
        ctx.beginPath();
        ctx.moveTo(leftX, leftY);
        ctx.quadraticCurveTo(Math.cos(a) * (len * 0.62) + Math.cos(a + 1.57) * 16,
            Math.sin(a) * (len * 0.62) + Math.sin(a + 1.57) * 16, tipX, tipY);
        ctx.quadraticCurveTo(Math.cos(a) * (len * 0.62) - Math.cos(a + 1.57) * 16,
            Math.sin(a) * (len * 0.62) - Math.sin(a + 1.57) * 16, rightX, rightY);
        ctx.closePath();
        ctx.fill();
    }

    // The throat of the flower, which is where the player is heading.
    ctx.strokeStyle = 'rgba(255,255,255,0.95)';
    ctx.lineWidth = 7;
    ctx.beginPath();
    ctx.arc(0, 0, 58, 0, Math.PI * 2);
    ctx.stroke();

    ctx.strokeStyle = 'rgba(255,255,255,0.4)';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(0, 0, 112, 0, Math.PI * 2);
    ctx.stroke();
}

/** KILN: a furnace mouth. A ring of fire-brick segments with flame licks
    reaching through the opening. The gaps between bricks are the tell. */
function drawKilnMouth(ctx: CanvasRenderingContext2D): void {
    ctx.lineCap = 'butt';

    const bricks = 14;
    for (let i = 0; i < bricks; i++) {
        const a0 = (i / bricks) * Math.PI * 2 + 0.03;
        const a1 = ((i + 1) / bricks) * Math.PI * 2 - 0.03;
        const rIn = 86;
        const rOut = 118;
        ctx.fillStyle = i % 2 ? 'rgba(255,255,255,0.85)' : 'rgba(255,255,255,0.6)';
        ctx.beginPath();
        ctx.arc(0, 0, rOut, a0, a1);
        ctx.arc(0, 0, rIn, a1, a0, true);
        ctx.closePath();
        ctx.fill();
    }

    // Flame licks reaching in through the mouth: tapered, curling inward.
    ctx.strokeStyle = 'rgba(255,255,255,0.75)';
    ctx.lineCap = 'round';
    for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2 + 0.18;
        const curl = i % 2 ? 0.34 : -0.34;
        ctx.lineWidth = 6 - (i % 3);
        ctx.beginPath();
        ctx.moveTo(Math.cos(a) * 84, Math.sin(a) * 84);
        ctx.quadraticCurveTo(
            Math.cos(a + curl) * 56, Math.sin(a + curl) * 56,
            Math.cos(a) * (26 + (i % 3) * 8), Math.sin(a) * (26 + (i % 3) * 8)
        );
        ctx.stroke();
    }

    // A thin seared rim inside the bricks.
    ctx.strokeStyle = 'rgba(255,255,255,0.35)';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(0, 0, 78, 0, Math.PI * 2);
    ctx.stroke();
}

/** NULL: a frame that has stopped agreeing with itself. Arc segments of
    varying width and angle, several of them misaligned, plus a wireframe
    where part of the rim should be. It must still read as a hoop. */
function drawNullBroken(ctx: CanvasRenderingContext2D): void {
    ctx.lineCap = 'butt';

    // Arc segments, deliberately uneven, several with radial offset so the
    // circle is visibly out of true.
    const segs: [number, number, number, number][] = [
        [0.02, 0.46, 106, 9],
        [0.52, 0.86, 110, 7],
        [0.94, 1.38, 104, 10],
        [1.46, 1.70, 114, 5],
        [1.80, 2.34, 106, 8],
        [2.42, 2.66, 98, 6],
        [2.74, 3.30, 108, 9],
        [3.40, 3.66, 118, 4],
    ];
    for (const [a0, a1, r, w] of segs) {
        ctx.strokeStyle = `rgba(255,255,255,${0.55 + (w / 10) * 0.4})`;
        ctx.lineWidth = w;
        ctx.beginPath();
        ctx.arc(0, 0, r, a0 * Math.PI, a1 * Math.PI);
        ctx.stroke();
    }

    // Two pieces knocked clean off centre - the frame is not just gapped, it
    // is displaced.
    ctx.strokeStyle = 'rgba(255,255,255,0.7)';
    ctx.lineWidth = 6;
    ctx.beginPath();
    ctx.arc(10, -7, 96, 2.05 * Math.PI, 2.3 * Math.PI);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(-12, 6, 118, 0.62 * Math.PI, 0.8 * Math.PI);
    ctx.stroke();

    // Where the surface should be, only the wireframe survived.
    ctx.setLineDash([7, 11]);
    ctx.strokeStyle = 'rgba(255,255,255,0.45)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(0, 0, 124, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);
}

/** The light behind each gate. Four falloffs, because a radial gradient is a
    shape too - VERGE's is concentric and mechanical, NULL's is banded and
    blocky, BLOOM's is scalloped like the flower in front of it. */
function drawPortalCore(canvas: HTMLCanvasElement, skin: SkinId): void {
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const size = canvas.width;
    const c = size / 2;

    if (skin === 'VERGE') {
        // Concentric machined falloff: a lens, not a blob.
        for (let i = 7; i >= 0; i--) {
            const r = c * ((i + 1) / 8);
            ctx.fillStyle = `rgba(255,255,255,${0.06 + (7 - i) * 0.045})`;
            ctx.beginPath();
            ctx.arc(c, c, r, 0, Math.PI * 2);
            ctx.fill();
        }
        return;
    }

    if (skin === 'BLOOM') {
        // Scalloped light - the corolla's own shadow, thrown inward.
        const g = ctx.createRadialGradient(c, c, 0, c, c, c);
        g.addColorStop(0, 'rgba(255,255,255,0.92)');
        g.addColorStop(0.4, 'rgba(255,255,255,0.34)');
        g.addColorStop(1, 'rgba(255,255,255,0)');
        ctx.fillStyle = g;
        for (let i = 0; i < 12; i++) {
            const a = (i / 12) * Math.PI * 2;
            ctx.beginPath();
            ctx.ellipse(c + Math.cos(a) * c * 0.34, c + Math.sin(a) * c * 0.34, c * 0.5, c * 0.36, a, 0, Math.PI * 2);
            ctx.fill();
        }
        ctx.beginPath();
        ctx.arc(c, c, c * 0.5, 0, Math.PI * 2);
        ctx.fill();
        return;
    }

    if (skin === 'KILN') {
        // Hot centre with streaks radiating out - heat, not bloom.
        const g = ctx.createRadialGradient(c, c, 0, c, c, c);
        g.addColorStop(0, 'rgba(255,255,255,1)');
        g.addColorStop(0.3, 'rgba(255,255,255,0.55)');
        g.addColorStop(1, 'rgba(255,255,255,0)');
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, size, size);
        ctx.strokeStyle = 'rgba(255,255,255,0.35)';
        ctx.lineCap = 'round';
        for (let i = 0; i < 20; i++) {
            const a = (i / 20) * Math.PI * 2;
            ctx.lineWidth = 2 + (i % 3);
            ctx.beginPath();
            ctx.moveTo(c + Math.cos(a) * c * 0.18, c + Math.sin(a) * c * 0.18);
            ctx.lineTo(c + Math.cos(a) * c * (0.62 + (i % 4) * 0.08), c + Math.sin(a) * c * (0.62 + (i % 4) * 0.08));
            ctx.stroke();
        }
        return;
    }

    // NULL: light that arrives in horizontal bands, some dropped.
    for (let y = 0; y < size; y += 6) {
        const t = 1 - Math.abs(y - c) / c;
        const band = (y / 6) % 3 === 0 ? 0.45 : 1;
        ctx.fillStyle = `rgba(255,255,255,${Math.max(0, t) * 0.8 * band})`;
        ctx.fillRect(0, y, size, 6);
    }
    // Punch out two missing rows, so the light itself is failing.
    ctx.clearRect(0, c - 22, size, 9);
    ctx.clearRect(0, c + 12, size, 6);
}

function buildPortalTextures(scene: Phaser.Scene, skin: WorldSkin): void {
    const ringKey = portalRingKey(skin.id);
    const coreKey = portalCoreKey(skin.id);

    if (!scene.textures.exists(ringKey)) {
        const size = 256;
        const canvas = makeCanvas(size, size);
        const ctx = canvas.getContext('2d');
        if (ctx) {
            ctx.translate(size / 2, size / 2);
            switch (skin.id) {
                case 'VERGE': drawVergeIris(ctx); break;
                case 'BLOOM': drawBloomCorolla(ctx); break;
                case 'KILN': drawKilnMouth(ctx); break;
                case 'NULL': drawNullBroken(ctx); break;
            }
            scene.textures.addCanvas(ringKey, canvas);
        }
    }

    if (!scene.textures.exists(coreKey)) {
        const size = 128;
        const canvas = makeCanvas(size, size);
        drawPortalCore(canvas, skin.id);
        scene.textures.addCanvas(coreKey, canvas);
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
 * The anchor the tether bites onto. One per verse, and unlike the gate these
 * are drawn in near-white so `setTint` still works on them - an unstable anchor
 * has to be able to go hot pink, and a coloured plate multiplied by pink is mud.
 *
 * Silhouette is what carries the difference: a machined hex plate, a seed pod,
 * a riveted eye-bolt, a wireframe that is not quite closed.
 */
function buildHookNodeTexture(scene: Phaser.Scene, skin: WorldSkin): void {
    const key = hookNodeTextureKey(skin.id);
    if (scene.textures.exists(key)) return;

    const size = 128;
    const canvas = makeCanvas(size, size);
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.translate(size / 2, size / 2);
    ctx.lineJoin = 'round';

    if (skin.id === 'VERGE') {
        // Hex docking plate with a bored centre.
        ctx.fillStyle = '#e8e8f2';
        ctx.beginPath();
        for (let i = 0; i < 6; i++) {
            const a = (i / 6) * Math.PI * 2 - Math.PI / 2;
            const x = Math.cos(a) * 52;
            const y = Math.sin(a) * 52;
            if (i === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
        }
        ctx.closePath();
        ctx.fill();
        // Bore.
        ctx.globalCompositeOperation = 'destination-out';
        ctx.beginPath();
        ctx.arc(0, 0, 24, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalCompositeOperation = 'source-over';
        // Bolt holes, one per flat.
        ctx.fillStyle = '#3a3a44';
        for (let i = 0; i < 6; i++) {
            const a = (i / 6) * Math.PI * 2;
            ctx.beginPath();
            ctx.arc(Math.cos(a) * 38, Math.sin(a) * 38, 5, 0, Math.PI * 2);
            ctx.fill();
        }
        // Keyway slot on the bore, so it reads as something a hook seats into.
        ctx.fillStyle = '#e8e8f2';
        ctx.fillRect(-6, -34, 12, 22);
    } else if (skin.id === 'BLOOM') {
        // A seed pod: swelling oval, a stem above it, filaments below.
        const g = ctx.createRadialGradient(0, 6, 4, 0, 6, 44);
        g.addColorStop(0, '#ffffff');
        g.addColorStop(0.6, '#dff5ea');
        g.addColorStop(1, '#9fd9c2');
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.ellipse(0, 8, 36, 44, 0, 0, Math.PI * 2);
        ctx.fill();
        // Seam down the pod.
        ctx.strokeStyle = 'rgba(40,70,60,0.55)';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(0, -32);
        ctx.quadraticCurveTo(7, 8, 0, 50);
        ctx.stroke();
        // Stem.
        ctx.strokeStyle = '#cdeede';
        ctx.lineWidth = 7;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(0, -36);
        ctx.quadraticCurveTo(-9, -52, -3, -62);
        ctx.stroke();
        // Stigma filaments, catching the light.
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 3;
        for (const d of [-16, -5, 6, 17]) {
            ctx.beginPath();
            ctx.moveTo(d * 0.6, 44);
            ctx.quadraticCurveTo(d, 58, d * 1.3, 66);
            ctx.stroke();
        }
    } else if (skin.id === 'KILN') {
        // Riveted eye-bolt: a heavy ring with a shackle lug on top.
        ctx.strokeStyle = '#f2ece6';
        ctx.lineWidth = 17;
        ctx.beginPath();
        ctx.arc(0, 12, 34, 0, Math.PI * 2);
        ctx.stroke();
        ctx.globalCompositeOperation = 'destination-out';
        ctx.beginPath();
        ctx.arc(0, 12, 26, 0, Math.PI * 2);
        ctx.stroke();
        ctx.globalCompositeOperation = 'source-over';
        // Lug above the ring.
        ctx.fillStyle = '#f2ece6';
        ctx.fillRect(-14, -52, 28, 30);
        ctx.globalCompositeOperation = 'destination-out';
        ctx.beginPath();
        ctx.ellipse(0, -34, 8, 11, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalCompositeOperation = 'source-over';
        // Rivet heads around the ring.
        ctx.fillStyle = '#8a8078';
        for (let i = 0; i < 8; i++) {
            const a = (i / 8) * Math.PI * 2;
            ctx.beginPath();
            ctx.arc(Math.cos(a) * 34, 12 + Math.sin(a) * 34, 4, 0, Math.PI * 2);
            ctx.fill();
        }
    } else {
        // NULL: a wireframe node that is not quite closed, with its own
        // displaced copy showing through. Reads as broken even in white.
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 5;
        ctx.beginPath();
        ctx.moveTo(0, -44);
        ctx.lineTo(44, 0);
        ctx.lineTo(0, 44);
        ctx.lineTo(-44, 0);
        // Left edge deliberately omitted, then re-drawn displaced.
        ctx.stroke();
        ctx.lineWidth = 3;
        ctx.strokeStyle = 'rgba(255,255,255,0.55)';
        ctx.beginPath();
        ctx.moveTo(-46, -4);
        ctx.lineTo(-40, 40);
        ctx.stroke();
        // Inner node.
        ctx.fillStyle = 'rgba(255,255,255,0.85)';
        ctx.fillRect(-9, -9, 18, 18);
        ctx.clearRect(-3, 6, 12, 7);
        // Detached corner fragment.
        ctx.fillStyle = 'rgba(255,255,255,0.7)';
        ctx.fillRect(30, -54, 20, 7);
    }

    scene.textures.addCanvas(key, canvas);
}

/**
 * Builds everything one skin needs, once.
 *
 * Called at the start of a transition rather than at boot: the swap lands
 * ~180ms in, under the flash, so the few milliseconds this costs are spent
 * behind the one moment the player is not looking at the world.
 */
export function ensureSkinArt(scene: Phaser.Scene, skin: WorldSkin): void {
    buildPlatformTexture(scene, skin);
    buildWarningPlatformTexture(scene, skin);
    buildSkyTexture(scene, skin);
    buildParticleTextures(scene);
    buildScanlineTexture(scene);
    buildVignetteTexture(scene);
    buildHeatTexture(scene);
    buildPortalTextures(scene, skin);
    buildHookNodeTexture(scene, skin);
    buildPodTexture(scene);
}

/** Warms every skin at scene creation so the first transition has no hitch in it. */
export function preloadAllSkinArt(scene: Phaser.Scene): void {
    (Object.keys(SKINS) as SkinId[]).forEach((id) => ensureSkinArt(scene, SKINS[id]));
}
