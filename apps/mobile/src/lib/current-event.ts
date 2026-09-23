import { useSyncExternalStore } from 'react';

import { getJson, removeKey, setJson } from './storage';

// The event the user is at right now (e.g. Token2049). Persisted on the device and used as the
// default eventId for new contacts and QR connections. A tiny module store keeps every screen
// in sync without a provider.

const STORAGE_KEY = 'chatsoon.currentEvent';

let currentId: string | null = null;
/** Set once the stored value has been read (or something was set before it finished). */
let settled = false;
let loading: Promise<void> | null = null;
const listeners = new Set<() => void>();
let writes: Promise<void> = Promise.resolve();

function emit() {
  for (const listener of listeners) listener();
}

function load(): Promise<void> {
  loading ??= getJson<string | null>(STORAGE_KEY, null).then((stored) => {
    // A setEventId() call that raced the read wins over the stored value.
    if (settled) return;
    currentId = typeof stored === 'string' && stored ? stored : null;
    settled = true;
    emit();
  });
  return loading;
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  void load();
  return () => {
    listeners.delete(listener);
  };
}

const getSnapshot = () => currentId;

/** Reads the current event outside React (waits for the stored value on first use). */
export async function getCurrentEventId(): Promise<string | null> {
  await load();
  return currentId;
}

/** Sets (or clears, with null) the current event and persists it. */
export function setCurrentEventId(id: string | null) {
  // Before the stored value has loaded, storage may hold something else (e.g. clearing it on sign
  // out before anything read it), so only skip the write once the value is known.
  const unchanged = settled && currentId === id;
  settled = true;
  if (unchanged) return;
  if (currentId !== id) {
    currentId = id;
    emit();
  }
  // Chained so quick changes land in order. If storage is unavailable the choice still holds for this session.
  writes = writes.then(() => (id ? setJson(STORAGE_KEY, id) : removeKey(STORAGE_KEY))).catch(() => {});
}

export function useCurrentEvent(): {
  eventId: string | null;
  setEventId: (id: string | null) => void;
} {
  const eventId = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  return { eventId, setEventId: setCurrentEventId };
}
