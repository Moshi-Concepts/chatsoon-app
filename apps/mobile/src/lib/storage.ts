import AsyncStorage from '@react-native-async-storage/async-storage';
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
