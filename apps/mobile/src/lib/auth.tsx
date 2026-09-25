import type { Me } from '@chatsoon/shared';
import { SESSION_STORAGE_KEY } from '@chatsoon/shared/src/profile-page';
import { useQueryClient } from '@tanstack/react-query';
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Platform } from 'react-native';

import { api, getAuthToken, setAuthToken, setUnauthorizedHandler } from './api';
import { qk } from './cache';
import { deleteExportedFiles } from './export';
import { clearOutbox } from './outbox';
import { getJson, removeKey, secureDelete, secureGet, secureSet, setJson } from './storage';

// The web SPA's session key: SESSION_STORAGE_KEY (packages/shared/src/profile-page.ts) is the
// localStorage key the server-rendered /id/:slug page reads to decide whether to hand the visit
// over to this app.
const TOKEN_KEY = SESSION_STORAGE_KEY;
/** Who the outbox belongs to, so an expired session keeps its offline captures for the same user. */
const OUTBOX_OWNER_KEY = 'chatsoon.outboxOwner';
/**
 * The last GET /me of the signed-in account (written by useMe), so a cold start with no signal,
 * say at an event, still opens the app instead of stopping at "Couldn't load your account".
 * It holds the account's email: cleared on every sign-out and sign-in so it never seeds another account.
 */
export const ME_CACHE_KEY = 'chatsoon.me';

const forgetMe = () => removeKey(ME_CACHE_KEY).catch(() => {});

type AuthStatus = 'loading' | 'signedOut' | 'signedIn';

type AuthContextValue = {
  status: AuthStatus;
  /** Sends a 6 digit sign-in code to the email. */
  sendCode: (email: string) => Promise<void>;
  /** Verifies the code and stores the session. */
  verifyCode: (email: string, code: string) => Promise<void>;
  /** Finishes a social sign-in redirect (issue #24, /auth-complete) and stores the session. */
  completeSocialSignIn: () => Promise<void>;
  /** Clears the local session and everything stored for it (and tells the server when online). */
  signOut: () => Promise<void>;
  /** Clears the local session and everything stored for it, without calling the server (after account deletion). */
  clearSession: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const [status, setStatus] = useState<AuthStatus>('loading');

  /** Drops the token and cached data. Offline captures stay unless `wipe` is set. */
  const endSession = useCallback(
    async (wipe: boolean) => {
      const token = getAuthToken();
      setAuthToken(null);
      // After a 401, only drop the stored token if it is still ours: on web another tab may have
      // signed in since, and its session must survive this tab's stale one.
      if (wipe || (await secureGet(TOKEN_KEY)) === token) await secureDelete(TOKEN_KEY);
      if (wipe) {
        await clearOutbox();
        await setJson(OUTBOX_OWNER_KEY, null);
      }
      await forgetMe();
      deleteExportedFiles();
      queryClient.clear();
      setStatus('signedOut');
    },
    [queryClient],
  );

  const clearSession = useCallback(() => endSession(true), [endSession]);

  useEffect(() => {
    let cancelled = false;
    secureGet(TOKEN_KEY)
      .then(async (token) => {
        if (cancelled) return;
        if (token) {
          // Seed the account from the last launch, marked stale so it refetches straight away. Only
          // if it is the account this device signed in as last (a late write can't cross accounts).
          const [cached, owner] = await Promise.all([
            getJson<Me | null>(ME_CACHE_KEY, null),
            getJson<string | null>(OUTBOX_OWNER_KEY, null),
          ]);
          if (cancelled) return;
          if (cached?.user?.id && cached.user.id === owner) queryClient.setQueryData(qk.me, cached, { updatedAt: 0 });
        }
        setAuthToken(token);
        setStatus(token ? 'signedIn' : 'signedOut');
      })
      .catch(() => {
        // Never leave the splash screen up: without a readable token, start signed out.
        if (cancelled) return;
        setAuthToken(null);
        setStatus('signedOut');
      });
    return () => {
      cancelled = true;
    };
  }, [queryClient]);

  useEffect(() => {
    // Web: tabs share localStorage but each keeps its own session and outbox in memory. When another
    // tab signs in or out, reload so this tab can't act on (or send captures under) a stale session.
    if (Platform.OS !== 'web' || typeof window === 'undefined') return;
    const onStorage = (e: StorageEvent) => {
      if (e.key === null || e.key === TOKEN_KEY || e.key === OUTBOX_OWNER_KEY) window.location.reload();
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  useEffect(() => {
    // Any 401 from an authenticated call means the session expired or was revoked. Keep the
    // outbox: contacts captured offline are sent once the same person signs back in.
    setUnauthorizedHandler(() => void endSession(false));
    return () => setUnauthorizedHandler(null);
  }, [endSession]);

  /** Shared by the email-code and social flows: stores the new session the same way for both. */
  const finishSignIn = useCallback(
    async (token: string, user: { id: string }) => {
      // One account's offline captures must never be sent as another's.
      const owner = await getJson<string | null>(OUTBOX_OWNER_KEY, null);
      if (owner !== user.id) await clearOutbox();
      await setJson(OUTBOX_OWNER_KEY, user.id);
      await forgetMe();
      await secureSet(TOKEN_KEY, token);
      setAuthToken(token);
      queryClient.clear();
      setStatus('signedIn');
    },
    [queryClient],
  );

  const value = useMemo<AuthContextValue>(
    () => ({
      status,
      sendCode: async (email) => {
        await api.auth.sendCode(email.trim().toLowerCase());
      },
      verifyCode: async (email, code) => {
        const { token, user } = await api.auth.signIn(email.trim().toLowerCase(), code.trim());
        await finishSignIn(token, user);
      },
      completeSocialSignIn: async () => {
        const { token, user } = await api.auth.completeSocialSignIn();
        await finishSignIn(token, user);
      },
      signOut: async () => {
        try {
          await api.auth.signOut();
        } catch {
          // Offline or already expired: still sign out locally.
        }
        await clearSession();
      },
      clearSession,
    }),
    [status, finishSignIn, clearSession],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
