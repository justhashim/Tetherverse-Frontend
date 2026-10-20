'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Bridge between Tetherverse and the Excel Play launcher.
 *
 * When Tetherverse runs standalone the Excel Play accounts own sign-in. When it is
 * embedded in the launcher the launcher supplies an Excel Play access token over
 * postMessage; we then verify that token against the accounts backend before
 * trusting a single field of it.
 */

export type BridgeStatus = 'standalone' | 'awaiting' | 'verified' | 'error';

export interface BridgeUser {
    id: string;
    name: string;
    email: string;
    picture: string | null;
}

const TOKEN_STORAGE_KEY = 'tetherverse:bridge-token';

declare global {
    interface Window {
        /**
         * Read by the Phaser scene when saving a score. The scene is not a React
         * component, so it cannot call the hook directly.
         */
        __tetherverseAuthToken?: string | null;
    }
}

/** Origins allowed to deliver an AUTH_TOKEN message. */
function launcherOrigins(): string[] {
    const configured = (process.env.NEXT_PUBLIC_LAUNCHER_ORIGIN ?? '')
        .split(',')
        .map((origin) => origin.trim().replace(/\/+$/, ''))
        .filter(Boolean);

    // Fail closed. With no launcher configured there is no origin that should be
    // trusted to hand us an identity, and returning a permissive default here
    // would mean the allowlist silently became "whatever is listening on the
    // local launcher port" for as long as the variable stayed unset - including
    // in a production build, where it would be a real attacker-reachable
    // address on a real player's machine. The local launcher is assumed in
    // development only, so the embed flow stays testable without a secret.
    if (configured.length) return configured;

    return process.env.NODE_ENV !== 'production' ? ['http://localhost:3000'] : [];
}

/** True when this document is running inside a parent frame. */
export function isEmbedded(): boolean {
    if (typeof window === 'undefined') return false;
    try {
        return window.self !== window.top;
    } catch {
        // A cross-origin parent throws on window.top access, which itself proves
        // we are framed.
        return true;
    }
}

export function useBridgeAuth() {
    const [status, setStatus] = useState<BridgeStatus>('standalone');
    const [user, setUser] = useState<BridgeUser | null>(null);
    const tokenRef = useRef<string | null>(null);

    const clearToken = useCallback(() => {
        tokenRef.current = null;
        window.__tetherverseAuthToken = null;
        sessionStorage.removeItem(TOKEN_STORAGE_KEY);
    }, []);

    const verify = useCallback(async (candidate: string) => {
        try {
            const response = await fetch('/api/bridge/verify', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ token: candidate }),
            });

            const data = response.ok
                ? ((await response.json()) as { user?: BridgeUser })
                : null;

            if (!data?.user?.id) {
                clearToken();
                setUser(null);
                setStatus('error');
                return;
            }

            tokenRef.current = candidate;
            window.__tetherverseAuthToken = candidate;
            sessionStorage.setItem(TOKEN_STORAGE_KEY, candidate);
            setUser(data.user);
            setStatus('verified');
        } catch {
            setStatus('error');
        }
    }, [clearToken]);

    const requestTokenFromLauncher = useCallback(() => {
        if (typeof window === 'undefined' || window.parent === window) return;
        for (const origin of launcherOrigins()) {
            window.parent.postMessage({ type: 'REQUEST_AUTH_TOKEN' }, origin);
        }
    }, []);

    useEffect(() => {
        if (!isEmbedded()) return;

        // Bootstrapping is deferred out of the effect body so it is not a synchronous
        // setState (which cascades renders), and so the server-rendered standalone
        // markup is not contradicted during hydration.
        const bootstrap = window.setTimeout(() => {
            setStatus('awaiting');

            // An in-frame reload keeps the same JS context in some browsers, so reuse
            // a token we already verified instead of flashing the connecting screen.
            const cached = sessionStorage.getItem(TOKEN_STORAGE_KEY);
            if (cached) {
                void verify(cached);
            } else {
                requestTokenFromLauncher();
            }
        }, 0);

        const handleMessage = (event: MessageEvent) => {
            if (event.source !== window.parent) return;
            if (!launcherOrigins().includes(event.origin)) return;

            const data = event.data as { type?: string; token?: unknown } | null;
            if (data?.type !== 'AUTH_TOKEN') return;

            const incoming = data.token;
            if (typeof incoming !== 'string' || !incoming) {
                setStatus('error');
                return;
            }

            // Deliberately ignoring any `user` payload sent alongside the token:
            // identity comes from the verified server response only.
            void verify(incoming);
        };

        window.addEventListener('message', handleMessage);

        // The launcher pushes on iframe load and on request, so ask once more in case
        // our listener attached after its first message.
        const retry = window.setTimeout(requestTokenFromLauncher, 400);

        return () => {
            window.removeEventListener('message', handleMessage);
            window.clearTimeout(bootstrap);
            window.clearTimeout(retry);
        };
    }, [requestTokenFromLauncher, verify]);

    // Do not leave a usable token behind when the frame goes away.
    useEffect(() => {
        return () => {
            window.__tetherverseAuthToken = null;
        };
    }, []);

    const authorizationHeader = useCallback((): Record<string, string> => {
        const current = tokenRef.current;
        return current ? { Authorization: `Bearer ${current}` } : {};
    }, []);

    return { status, user, getToken: () => tokenRef.current, authorizationHeader };
}