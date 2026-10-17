import { createContext, createElement, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { Permission } from '@proctor/types';
import { ApiError, api, onAuthChange, refreshSession, setAccessToken } from '../lib/api.js';

/**
 * Authentication context.
 *
 * Two properties matter for correctness here:
 *
 *  1. On mount the app attempts a silent refresh. If the refresh cookie is still valid
 *     the user lands straight on the dashboard, which is the normal case on a shared
 *     recruiting desk.
 *
 *  2. Permissions are enforced *in the UI* for convenience, but the real enforcement
 *     is server-side on every route. A hidden button is a usability feature; it is not
 *     treated as a security control anywhere in this codebase.
 */

export interface SessionUser {
  id: string;
  email: string;
  name: string;
  roles: string[];
  permissions: Permission[];
  totpEnabled: boolean;
  lastLoginAt: string | null;
}

interface AuthState {
  user: SessionUser | null;
  status: 'loading' | 'authenticated' | 'anonymous';
  demoMode: boolean;
  siteName: string;
  login(email: string, password: string, totpCode?: string): Promise<void>;
  logout(): Promise<void>;
  can(permission: Permission): boolean;
  canAny(permissions: Permission[]): boolean;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<SessionUser | null>(null);
  const [status, setStatus] = useState<AuthState['status']>('loading');
  const [meta, setMeta] = useState({ demoMode: false, siteName: 'Recruitment Admin' });

  useEffect(() => {
    let cancelled = false;

    const bootstrap = async () => {
      try {
        const status0 = await api<{ requiresTwoFactor: boolean; demoMode: boolean; siteName: string }>('/auth/status');
        if (!cancelled) setMeta({ demoMode: status0.demoMode, siteName: status0.siteName });
      } catch (err) {
        // A status probe failure is not fatal: it only disables the demo banner.
        if (process.env.NODE_ENV === 'development') console.warn('Auth status probe failed', err);
      }

      const refreshed = await refreshSession();
      if (cancelled) return;
      if (refreshed) {
        try {
          const me = await api<SessionUser>('/auth/me');
          if (!cancelled) setUser(me);
        } catch {
          setUser(null);
        }
      }
      if (!cancelled) setStatus(refreshed ? 'authenticated' : 'anonymous');
    };

    void bootstrap();
    return () => {
      cancelled = true;
    };
  }, []);

  // A refresh failure anywhere in the app drops the session back to the login screen.
  useEffect(
    () =>
      onAuthChange((authenticated) => {
        if (!authenticated) {
          setUser(null);
          setStatus('anonymous');
        }
      }),
    [],
  );

  const login = useCallback(async (email: string, password: string, totpCode?: string) => {
    const result = await api<{ accessToken: string; user: SessionUser }>('/auth/login', {
      body: { email, password, ...(totpCode ? { totpCode } : {}) },
      retryOn401: false,
    });
    setAccessToken(result.accessToken);
    const me = await api<SessionUser>('/auth/me');
    setUser(me);
    setStatus('authenticated');
  }, []);

  const logout = useCallback(async () => {
    try {
      await api('/auth/logout', { method: 'POST' });
    } catch {
      // Even if the server call fails, the local session must end.
    }
    setAccessToken(null);
    setUser(null);
    setStatus('anonymous');
  }, []);

  const can = useCallback((permission: Permission) => Boolean(user?.permissions.includes(permission)), [user]);
  const canAny = useCallback(
    (permissions: Permission[]) => Boolean(user?.permissions.some((p) => permissions.includes(p))),
    [user],
  );

  const value = useMemo<AuthState>(
    () => ({ user, status, demoMode: meta.demoMode, siteName: meta.siteName, login, logout, can, canAny }),
    [user, status, meta, login, logout, can, canAny],
  );

  return createElement(AuthContext.Provider, { value }, children);
}

export function useAuth(): AuthState {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used inside <AuthProvider>');
  return context;
}

/** Rejects a render for a route the current user may not open, showing a clear reason. */
export function usePermission(permission: Permission): { allowed: boolean; reason: string | null } {
  const { can, user } = useAuth();
  const allowed = can(permission);
  return {
    allowed,
    reason: allowed ? null : `Your role (${user?.roles.join(', ') ?? 'none'}) does not include "${permission}".`,
  };
}

export { ApiError };
