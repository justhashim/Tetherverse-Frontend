import type { ServerRun } from '@/src/lib/server-run';

/**
 * The run the Phaser scene should build.
 *
 * A module-level store rather than a constructor argument: `Phaser.Game` is
 * created from React, but the scene is instantiated by Phaser's own boot
 * sequence, so there is no convenient prop to thread through. The value is set
 * immediately before `new Phaser.Game(...)` and read in `GameScene.create()`,
 * which runs exactly once per game instance.
 *
 * A fresh game is created for every run rather than restarting the scene,
 * because GameScene registers a Matter `collisionstart` listener in `create()`
 * without removing it on shutdown; a restart would stack a second listener on
 * the same world. That means the store only ever has to describe one run at a
 * time.
 */
let currentRun: ServerRun | null = null;

/**
 * The account the run was opened for.
 *
 * Carried beside the run rather than inside it, because the run is the API's
 * shape and the owner is a frontend fact. The scene needs it when a climb ends
 * to file the finished run under the right player, so a shared browser cannot
 * post one player's climb to another player's board.
 */
let currentOwner: string | null = null;

export function setCurrentRun(run: ServerRun | null, owner: string | null = null): void {
    currentRun = run;
    currentOwner = run ? owner : null;
}

export function getCurrentRun(): ServerRun | null {
    return currentRun;
}

export function getCurrentRunOwner(): string | null {
    return currentOwner;
}
