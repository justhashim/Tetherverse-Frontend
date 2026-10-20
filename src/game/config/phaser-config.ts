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
         * ENVELOP, not FIT.
         *
         * FIT scales the game down until all of it fits, which on a landscape
         * screen leaves the 1024x1600 world in a narrow column down the middle
         * with the page background either side of it. The game world and the
         * page behind it were two different skies with a hard seam down the
         * middle of the screen.
         *
         * ENVELOP scales the game up until it covers the screen, cropping the
         * overflow instead. The camera follows the player, so what gets
         * cropped is sky and mountain that were never in play, and the world
         * reaches the edges of the screen on every device.
         *
         * The world itself is unchanged: the game is still 1024x1600 world
         * units, so every platform, hook and altitude in the generator means
         * exactly what it meant before.
         */
        mode: Phaser.Scale.ENVELOP,
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