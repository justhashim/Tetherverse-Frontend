/**
 * Recovers a page that was left open across a deploy.
 *
 * ── Why this exists ────────────────────────────────────────────────────────
 *
 * Every build names its chunks after their contents, and a deploy replaces the
 * whole asset set at once. A document that was served by the previous build is
 * still holding the previous names, so the next thing it asks for - a lazily
 * imported chunk, a CSS file the router had not needed yet - is a 404. The
 * browser reports it as "Refused to apply style ... MIME type ('text/plain')"
 * or `ChunkLoadError`, and the tab looks broken until someone hard-refreshes.
 *
 * That is fine when the only person with a tab open is the developer who just
 * deployed. It is not fine during an event, when the launcher has been open all
 * evening and a fix ships underneath it: the player sees a menu with no styling
 * and no way to know a reload is all it needs.
 *
 * ── What it does ───────────────────────────────────────────────────────────
 *
 * Watches for a failed `/_next/static/` resource or a chunk-load rejection and
 * reloads once. Once, because a reload that loops is worse than a stale page: if
 * the document that comes back fails the same way, the flag stops a second
 * attempt and the error is left to surface normally.
 *
 * The flag is cleared after the page has held together for a while, so a session
 * that survives two deploys recovers from both.
 */

const STORAGE_KEY = 'tetherverse:chunk-recovery';

/** How long a page must survive before it may recover itself again. */
const HEALTHY_MS = 15_000;

/** Names the previous build would have used, and the errors that mention them. */
const CHUNK_ERROR = /ChunkLoadError|Loading (CSS )?chunk [\w-]+ failed|Importing a module script failed/i;

function isStaticAsset(element: EventTarget | null): boolean {
    if (element instanceof HTMLLinkElement) return element.href.includes('/_next/static/');
    if (element instanceof HTMLScriptElement) return element.src.includes('/_next/static/');
    return false;
}

function recover(reason: string): void {
    if (sessionStorage.getItem(STORAGE_KEY)) {
        // A reload already failed to fix it. The page is genuinely broken, not
        // stale, and reloading again would only hide the real error.
        console.warn('[chunk-recovery] still failing after a reload:', reason);
        return;
    }

    sessionStorage.setItem(STORAGE_KEY, reason);
    console.warn('[chunk-recovery] reloading for a build that has moved on:', reason);
    window.location.reload();
}

/**
 * Installs the watchers, and returns the function that removes them.
 *
 * Call once, from the client root. Resource errors do not bubble, so the `error`
 * listener has to be in the capture phase - without `true` a failed stylesheet
 * is never seen by anything but the browser's own console.
 */
export function installChunkRecovery(): () => void {
    const onResourceError = (event: Event) => {
        if (isStaticAsset(event.target)) recover(String((event.target as Element).getAttribute('href')));
    };

    const onRejection = (event: PromiseRejectionEvent) => {
        const reason = event.reason as { message?: string; name?: string } | string | undefined;
        const message = typeof reason === 'string' ? reason : reason?.message ?? '';
        if (CHUNK_ERROR.test(message)) recover(message);
    };

    window.addEventListener('error', onResourceError, true);
    window.addEventListener('unhandledrejection', onRejection);

    // A page that is still here after this long is serving the build it was
    // given, so the next deploy may recover it too.
    const healthy = window.setTimeout(() => sessionStorage.removeItem(STORAGE_KEY), HEALTHY_MS);

    return () => {
        window.clearTimeout(healthy);
        window.removeEventListener('error', onResourceError, true);
        window.removeEventListener('unhandledrejection', onRejection);
    };
}
