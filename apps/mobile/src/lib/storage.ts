import { isValidReferralCode } from '@chatsoon/shared';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Crypto from 'expo-crypto';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

// Secrets (the session token) go to the Keychain / Keystore on native and localStorage on web.

export async function secureGet(key: string): Promise<string | null> {
  if (Platform.OS === 'web') {
    try {
      return window.localStorage.getItem(key);
    } catch {
      return null;
    }
  }
  try {
    return await SecureStore.getItemAsync(key);
  } catch {
    // The Keystore couldn't decrypt the entry (seen after some Android OEM updates and restores).
    // It would fail the same way on every launch, so drop it and let the user sign in again.
    await SecureStore.deleteItemAsync(key).catch(() => undefined);
    return null;
  }
}

export async function secureSet(key: string, value: string): Promise<void> {
  if (Platform.OS === 'web') {
    try {
      window.localStorage.setItem(key, value);
    } catch {
      // Private mode or blocked storage: the session lasts for this tab only.
    }
    return;
  }
  try {
    await SecureStore.setItemAsync(key, value);
  } catch {
    // Keychain / Keystore unavailable: like blocked storage on web, the session lasts until the app closes.
  }
}

export async function secureDelete(key: string): Promise<void> {
  if (Platform.OS === 'web') {
    try {
      window.localStorage.removeItem(key);
    } catch {
      // ignore
    }
    return;
  }
  try {
    await SecureStore.deleteItemAsync(key);
  } catch {
    // Best effort: signing out must always finish.
  }
}

/** Non-secret JSON storage (outbox, UI prefs). */
export async function getJson<T>(key: string, fallback: T): Promise<T> {
  try {
    const raw = await AsyncStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

export async function setJson(key: string, value: unknown): Promise<void> {
  await AsyncStorage.setItem(key, JSON.stringify(value));
}

export async function removeKey(key: string): Promise<void> {
  await AsyncStorage.removeItem(key);
}

// ---------------------------------------------------------------------------
// Referrals (issue #11, docs/referrals.md "Mobile files" / "How attribution works")
// ---------------------------------------------------------------------------

const DEVICE_ID_KEY = 'chatsoon.deviceId';
const PENDING_REFERRAL_KEY = 'chatsoon.pendingReferralCode';
/** Set by the PR 3 web landing page (`/r/<code>`) and the profile island (`/id/<slug>?ref=`). */
const WEB_CS_REF_KEY = 'cs_ref';
const CONTACTS_BANNER_DISMISSED_KEY = 'chatsoon.referralBannerDismissed';

/** A random UUID generated once per install (`X-Chatsoon-Device`, lib/api.ts): Keychain/Keystore on
 * native, localStorage on web (secureGet/secureSet above), so it survives app restarts but not a
 * reinstall or "clear data" - which is exactly what device dedupe wants (docs/referrals.md). */
export async function ensureDeviceId(): Promise<string> {
  const existing = await secureGet(DEVICE_ID_KEY);
  if (existing) return existing;
  const id = Crypto.randomUUID();
  await secureSet(DEVICE_ID_KEY, id);
  return id;
}

export type PendingReferralCode = { code: string; capturedAt: number };

/** Reads `localStorage.cs_ref` (web only), the same key the server-rendered `/r/<code>` and
 * `/id/<slug>?ref=` pages write client-side (docs/referrals.md "How attribution works" step 2). */
function readWebCsRef(): string | null {
  if (Platform.OS !== 'web') return null;
  try {
    return window.localStorage.getItem(WEB_CS_REF_KEY);
  } catch {
    return null;
  }
}

/** The stored pending code, or (web only) `localStorage.cs_ref` as a fallback source. Never returns
 * something that doesn't look like a real code, so a stale/garbage cs_ref never reaches the onboarding
 * field or an attribute call. */
export async function getPendingReferralCode(): Promise<PendingReferralCode | null> {
  const stored = await getJson<PendingReferralCode | null>(PENDING_REFERRAL_KEY, null);
  if (stored && isValidReferralCode(stored.code)) return stored;

  const csRef = readWebCsRef()?.trim().toUpperCase() ?? null;
  return csRef && isValidReferralCode(csRef) ? { code: csRef, capturedAt: Date.now() } : null;
}

/** Stores a freshly captured code (from `/r/<code>`, `/id/<slug>?ref=`, or typed) with a captured-at
 * timestamp. Overwrites any previous pending code: only the most recently seen one matters. */
export async function setPendingReferralCode(code: string): Promise<void> {
  await setJson(PENDING_REFERRAL_KEY, { code: code.toUpperCase(), capturedAt: Date.now() } satisfies PendingReferralCode);
}

/** Clears the pending code after a successful (or permanently failed) attribute call, both the
 * AsyncStorage copy and, on web, `localStorage.cs_ref` so it isn't picked up again. */
export async function clearPendingReferralCode(): Promise<void> {
  await removeKey(PENDING_REFERRAL_KEY);
  if (Platform.OS !== 'web') return;
  try {
    window.localStorage.removeItem(WEB_CS_REF_KEY);
  } catch {
    // ignore
  }
}

/** The Contacts tab banner ("Connect a social account so <name>'s invite counts") is shown once, then
 * dismissed for good (docs/referrals.md "What the user sees"). */
export async function isReferralBannerDismissed(): Promise<boolean> {
  return getJson(CONTACTS_BANNER_DISMISSED_KEY, false);
}

export async function dismissReferralBanner(): Promise<void> {
  await setJson(CONTACTS_BANNER_DISMISSED_KEY, true);
}
