import Phaser from "phaser";
import { GameScene } from "../scenes/GameScene";

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
};