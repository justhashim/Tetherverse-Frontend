import Phaser from "phaser";
import { GameScene } from "../scenes/GameScene";

/**
 * The live game instance, for the measurement harness.
 *
 * The harness drives the game over CDP and needs a way in that does not go
 * through the React tree. The newest game wins: dev StrictMode boots twice.
 */
declare global {
    interface Window {
        __tetherverseGame?: Phaser.Game;
    }
}

export const gameConfig: Phaser.Types.Core.GameConfig = {
    type: Phaser.AUTO,
    parent: "game-container",
    backgroundColor: "#050816",

    // Define a base virtual resolution
    width: 1024,
    height: 1600,

    scale: {
        /**
         * RESIZE, not ENVELOP.
         *
         * The game is a portrait design: 1024x1600 world units. ENVELOP scales
         * the canvas up until it covers the window, and on a landscape window
         * that means scaling until the *width* fits, which throws away the top
         * and bottom of the camera to make room. Measured:
         *
         *     1920x1080  shows 1024x576  - 36% of the camera, magnified 1.875x
         *     1440x900   shows 1024x640  - 40%, magnified 1.406x
         *      390x844   shows  739x1600 - all of it, at 0.527x
         *
         * The bigger the monitor, the more the game was blown up: the player
         * sprite was 52px on a phone and 184px on a 1080p screen. That is the
         * whole complaint about desktop looking enlarged, and no amount of
         * tuning inside the scene can fix it, because the crop is this mode's.
         *
         * RESIZE makes the canvas the size of the window and nothing else, so
         * there is no overflow to crop. What the camera shows is then decided
         * by its zoom, in one place in GameScene, where it can be locked to the
         * design height instead of to the window's aspect ratio.
         *
         * The world is unchanged: still 1024x1600 design units, so every
         * platform, hook and altitude in the generator means exactly what it
         * meant before.
         */
        mode: Phaser.Scale.RESIZE,
        autoCenter: Phaser.Scale.CENTER_BOTH,
    },

    physics: {
        default: "matter",
        matter: {
            gravity: { x: 0, y: 1 },
            debug: false,
        },
    },

    scene: [GameScene],

    /**
     * Hands the running game to the measurement harness.
     *
     * Deliberately a config callback rather than a line inside GameScene: the
     * scene is owned by another agent's concurrent diff, and a debug handle is
     * not worth a merge conflict. The newest game wins, because dev StrictMode
     * boots the game twice and the harness has to talk to the live one.
     */
    callbacks: {
        postBoot: (game: Phaser.Game) => {
            if (typeof window !== "undefined") {
                window.__tetherverseGame = game;
            }
        },
    },
};