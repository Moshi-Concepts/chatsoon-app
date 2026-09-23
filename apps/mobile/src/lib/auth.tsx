import { useQueryClient } from '@tanstack/react-query';
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

import { api, setAuthToken, setUnauthorizedHandler } from './api';
import { deleteExportedFiles } from './export';
import { clearOutbox } from './outbox';
import { getJson, secureDelete, secureGet, secureSet, setJson } from './storage';

const TOKEN_KEY = 'chatsoon.session';
/** Who the outbox belongs to, so an expired session keeps its offline captures for the same user. */
const OUTBOX_OWNER_KEY = 'chatsoon.outboxOwner';

type AuthStatus = 'loading' | 'signedOut' | 'signedIn';

type AuthContextValue = {
  status: AuthStatus;
  /** Sends a 6 digit sign-in code to the email. */
  sendCode: (email: string) => Promise<void>;
  /** Verifies the code and stores the session. */
  verifyCode: (email: string, code: string) => Promise<void>;
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
      setAuthToken(null);
      await secureDelete(TOKEN_KEY);
      if (wipe) {
        await clearOutbox();
        await setJson(OUTBOX_OWNER_KEY, null);
      }
      deleteExportedFiles();
      queryClient.clear();
      setStatus('signedOut');
    },
    [queryClient],
  );

  const clearSession = useCallback(() => endSession(true), [endSession]);

  useEffect(() => {
    let cancelled = false;
    secureGet(TOKEN_KEY).then((token) => {
      if (cancelled) return;
      setAuthToken(token);
      setStatus(token ? 'signedIn' : 'signedOut');
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    // Any 401 from an authenticated call means the session expired or was revoked. Keep the
    // outbox: contacts captured offline are sent once the same person signs back in.
    setUnauthorizedHandler(() => void endSession(false));
    return () => setUnauthorizedHandler(null);
  }, [endSession]);

  const value = useMemo<AuthContextValue>(
    () => ({
      status,
      sendCode: async (email) => {
        await api.auth.sendCode(email.trim().toLowerCase());
      },
      verifyCode: async (email, code) => {
        const { token, user } = await api.auth.signIn(email.trim().toLowerCase(), code.trim());
        // One account's offline captures must never be sent as another's.
        const owner = await getJson<string | null>(OUTBOX_OWNER_KEY, null);
        if (owner !== user.id) await clearOutbox();
        await setJson(OUTBOX_OWNER_KEY, user.id);
        await secureSet(TOKEN_KEY, token);
        setAuthToken(token);
        queryClient.clear();
        setStatus('signedIn');
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
    [status, queryClient, clearSession],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
