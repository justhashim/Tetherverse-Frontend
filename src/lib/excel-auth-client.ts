'use client';

import { useCallback, useEffect, useState } from 'react';

/**
 * Excel Play session for standalone play.
 *
 * Sign-in is delegated to the Excel Play accounts frontend, which redirects back
 * with a refresh token. We exchange that for an access token, then verify it
 * server-side before treating any identity as real. This replaces the previous
 * Google OAuth flow.
 *
 * Embedded play does not use this hook: the launcher supplies the token directly,
 * see `bridge-auth.ts`.
 */

export type ExcelSessionStatus = 'loading' | 'authenticated' | 'anonymous';

export interface ExcelUser {
    id: string;
    name: string;
    email: string;
    picture: string | null;
}

const ACCESS_TOKEN_KEY = 'tetherverse:excel-access-token';
const REFRESH_TOKEN_KEY = 'tetherverse:excel-refresh-token';

/** Excel Play accounts frontend that hosts the sign-in page. */
function authFrontendRoot(): string {
    return (process.env.NEXT_PUBLIC_EXCEL_AUTH_FRONTEND_URL || 'https://auth.excelmec.org').replace(/\/$/, '');
}

/**
 * Confirms a token with our own server, which validates it against the accounts
 * backend. Returns null for a missing, rejected, or unreachable backend, so a
 * network failure can never be read as a valid session.
 */
async function verifyAccessToken(token: string | null): Promise<ExcelUser | null> {
    if (!token) return null;

    try {
        const response = await fetch('/api/bridge/verify', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ token }),
        });

        if (!response.ok) return null;

        const data = (await response.json()) as { user?: ExcelUser };
        return data?.user?.id ? data.user : null;
    } catch {
        return null;
    }
}

function storeTokens(accessToken: string, refreshToken?: string): void {
    sessionStorage.setItem(ACCESS_TOKEN_KEY, accessToken);
    window.__tetherverseAuthToken = accessToken;
    if (refreshToken) {
        sessionStorage.setItem(REFRESH_TOKEN_KEY, refreshToken);
    }
}

function clearTokens(): void {
    sessionStorage.removeItem(ACCESS_TOKEN_KEY);
    sessionStorage.removeItem(REFRESH_TOKEN_KEY);
    window.__tetherverseAuthToken = null;
}

export function useExcelSession() {
    const [status, setStatus] = useState<ExcelSessionStatus>('loading');
    const [user, setUser] = useState<ExcelUser | null>(null);

    useEffect(() => {
        let cancelled = false;

        const bootstrap = async () => {
            // The accounts frontend returns here with ?refreshToken=...
            const url = new URL(window.location.href);
            const refreshToken = url.searchParams.get('refreshToken');

            let accessToken = sessionStorage.getItem(ACCESS_TOKEN_KEY);

            if (refreshToken) {
                try {
                    const response = await fetch('/api/excel-auth/exchange', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ refreshToken }),
                    });

                    if (response.ok) {
                        const pair = (await response.json()) as {
                            accessToken?: string;
                            refreshToken?: string;
                        };
                        if (pair?.accessToken) {
                            accessToken = pair.accessToken;
                            storeTokens(pair.accessToken, pair.refreshToken);
                        }
                    }
                } catch {
                    // Fall through: an existing access token may still be usable.
                }

                // Keep the credential out of the address bar and history.
                url.searchParams.delete('refreshToken');
                window.history.replaceState({}, '', url.toString());
            }

            const verified = await verifyAccessToken(accessToken);

            if (cancelled) return;

            if (verified) {
                if (accessToken) storeTokens(accessToken);
                setUser(verified);
                setStatus('authenticated');
            } else {
                clearTokens();
                setUser(null);
                setStatus('anonymous');
            }
        };

        void bootstrap();

        return () => {
            cancelled = true;
        };
    }, []);

    const login = useCallback(() => {
        if (typeof window === 'undefined') return;
        const redirectTo = encodeURIComponent(window.location.origin + window.location.pathname);
        window.location.href = `${authFrontendRoot()}/auth/login?redirect_to=${redirectTo}`;
    }, []);

    const logout = useCallback(() => {
        clearTokens();
        const redirectTo = encodeURIComponent(window.location.origin);
        window.location.href = `${authFrontendRoot()}/auth/logout?redirect_to=${redirectTo}`;
    }, []);

    return { status, user, login, logout };
}