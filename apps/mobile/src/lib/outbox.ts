import type { Contact, ContactCreateInput } from '@chatsoon/shared';
import { CARD_PLACEHOLDER_NAME } from '@chatsoon/shared';
import { useQueryClient, type QueryClient } from '@tanstack/react-query';
import * as Crypto from 'expo-crypto';
import * as Network from 'expo-network';
import { useEffect, useSyncExternalStore } from 'react';
import { AppState } from 'react-native';

import { api, ApiError, isNetworkError } from './api';
import { getCurrentEventId, setCurrentEventId } from './current-event';
import { deleteAllLocalImages, deleteLocalImage, localImageExists, resolveLocalImageUri } from './image';
import { putContactInCache, qk, removeContactFromCache } from './cache';
import { getJson, removeKey, setJson } from './storage';

// Offline outbox: new contacts (and their card photos) and Chatsoon QR connections are saved
// locally first and sent when the device is online. Contact ids are client-generated UUIDs so a
// retried POST /contacts is idempotent. Card photos are copied into the app's document directory
// so they survive restarts, uploaded with POST /files?purpose=card, then extracted with
// POST /extract/card.
//
// Progress is persisted per item (imageKey, created), so a retry resumes where it stopped instead
// of uploading the photo or creating the contact twice.

export type OutboxStatus = 'queued' | 'sending' | 'failed';

/** The step a contact item is on (or will run next). */
export type OutboxStage = 'upload' | 'create' | 'extract';

type OutboxBase = {
  /** For 'contact' items this is draft.id (the id the server will use). */
  id: string;
  createdAt: string;
  /** What to show in the contacts list while it waits, e.g. the person's name or "Card photo". */
  label: string;
  status: OutboxStatus;
  attempts: number;
  error?: string;
  /** Why a queued item is waiting: no connection, or a server error that will be retried shortly. */
  waiting?: 'offline' | 'retry';
  /** After a server error: don't retry before this time (ms since epoch). */
  nextAttemptAt?: number;
};

export type OutboxItem =
  | (OutboxBase & {
      kind: 'contact';
      draft: ContactCreateInput & { id: string };
      /** Local card photo to upload and extract after the contact is created. */
      photo?: { uri: string; mimeType?: string | null };
      stage?: OutboxStage;
      /** R2 key once the photo is uploaded. */
      imageKey?: string;
      /** True once POST /contacts has succeeded. */
      created?: boolean;
    })
  | (OutboxBase & {
      kind: 'connect';
      /** Chatsoon profile slug scanned while offline. */
      slug: string;
      eventId?: string | null;
    });

export type ContactOutboxItem = Extract<OutboxItem, { kind: 'contact' }>;
export type ConnectOutboxItem = Extract<OutboxItem, { kind: 'connect' }>;

type ItemPatch = Partial<OutboxBase> &
  Partial<Pick<ContactOutboxItem, 'draft' | 'stage' | 'imageKey' | 'created'>> &
  Partial<Pick<ConnectOutboxItem, 'eventId'>>;

const STORAGE_KEY = 'chatsoon.outbox.v1';
/** Server errors (5xx, 429) are retried this many times before the item is marked failed. */
const MAX_ATTEMPTS = 8;
const MAX_RETRY_DELAY_MS = 5 * 60_000;

/** A failure that retrying will not fix (e.g. the photo was deleted from the device). */
class PermanentError extends Error {}

// ---- Store ----

let items: OutboxItem[] = [];
let hydrated = false;
let hydrating: Promise<void> | null = null;
const listeners = new Set<() => void>();
let writeChain: Promise<void> = Promise.resolve();
/** Registered by <OutboxSync /> so sends can update the React Query cache. */
let queryClient: QueryClient | null = null;
/** Items discarded while their send was in flight: the sender cleans up the server copy. */
const discarded = new Set<string>();
let retryTimer: ReturnType<typeof setTimeout> | null = null;
let retryAt = 0;
/** Network failures in a row: the backoff for retrying while the OS still reports a connection. */
let networkFailures = 0;

function emit() {
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  void hydrate();
  return () => {
    listeners.delete(listener);
  };
}

const getItems = () => items;
const getHydrated = () => hydrated;

/** Writes the current items. Writes are chained so an older snapshot never lands last. */
function persist(): Promise<void> {
  const write = writeChain.then(() => setJson(STORAGE_KEY, items));
  writeChain = write.catch(() => {});
  return write;
}

function persistQuietly() {
  persist().catch((err) => console.warn('Could not save the outbox', err));
}

function isOutboxItem(value: unknown): value is OutboxItem {
  if (!value || typeof value !== 'object') return false;
  const v = value as Partial<OutboxItem>;
  if (typeof v.id !== 'string' || typeof v.label !== 'string') return false;
  if (v.kind === 'contact') return !!v.draft && typeof v.draft === 'object';
  if (v.kind === 'connect') return typeof v.slug === 'string';
  return false;
}

function hydrate(): Promise<void> {
  hydrating ??= getJson<unknown>(STORAGE_KEY, []).then((stored) => {
    const restored = (Array.isArray(stored) ? stored : []).filter(isOutboxItem).map(
      // Anything that was mid-send when the app stopped goes back in the queue.
      (item): OutboxItem => (item.status === 'sending' ? { ...item, status: 'queued' } : item),
    );
    const known = new Set(items.map((i) => i.id));
    items = [...restored.filter((i) => !known.has(i.id)), ...items];
    hydrated = true;
    emit();
  });
  return hydrating;
}

function getItem(id: string): OutboxItem | undefined {
  return items.find((i) => i.id === id);
}

function getContactItem(id: string): ContactOutboxItem | undefined {
  const item = getItem(id);
  return item?.kind === 'contact' ? item : undefined;
}

/** Applies changes to one item. Returns false if it no longer exists (discarded or cleared). */
function patch(id: string, changes: ItemPatch): boolean {
  let found = false;
  items = items.map((item) => {
    if (item.id !== id) return item;
    found = true;
    return { ...item, ...changes } as OutboxItem;
  });
  if (found) {
    emit();
    persistQuietly();
  }
  return found;
}

function removeItem(id: string) {
  const next = items.filter((i) => i.id !== id);
  if (next.length === items.length) return;
  items = next;
  emit();
  persistQuietly();
}

// ---- Sending ----

type Outcome = 'done' | 'offline' | 'unauthorized' | 'retry' | 'failed';

function isUnknownEventError(err: unknown): boolean {
  return err instanceof ApiError && err.status === 400 && /event/i.test(err.message);
}

/** A tag picked offline was deleted (e.g. on another device) before the contact was sent. */
function isUnknownTagError(err: unknown): boolean {
  return err instanceof ApiError && err.status === 400 && /tag/i.test(err.message);
}

/** The server is busy (rate limited, or a 5xx that isn't a failed extraction): worth retrying. */
function isTransientError(err: unknown): boolean {
  return err instanceof ApiError && (err.status === 429 || (err.status >= 500 && err.code !== 'extraction_failed'));
}

/** The current event was deleted or is no longer visible: stop tagging new contacts with it. */
function forgetEvent(eventId: string) {
  void getCurrentEventId().then((current) => {
    if (current === eventId) setCurrentEventId(null);
  });
}

async function fetchContact(id: string): Promise<Contact | null> {
  try {
    return await api.contacts.get(id);
  } catch {
    return null;
  }
}

/** Deletes a contact the user discarded after it had already reached the server. */
async function deleteServerCopy(id: string) {
  try {
    await api.contacts.remove(id);
  } catch {
    // Offline or already gone: it stays in their contacts, where they can delete it.
  }
  if (queryClient) removeContactFromCache(queryClient, id);
}

/**
 * Called after every await in a contact send. False means the item was discarded or cleared, and
 * the send should stop (cleaning up the server copy if the user discarded it after creation).
 */
async function stillWanted(id: string, created: boolean): Promise<boolean> {
  if (getItem(id)) return true;
  if (discarded.delete(id) && created) await deleteServerCopy(id);
  return false;
}

async function complete(id: string, contact: Contact | null) {
  const item = getItem(id);
  if (!item) return;
  // Cache first, then drop the item, so screens watching it switch straight to the contact.
  if (queryClient) {
    if (contact) putContactInCache(queryClient, contact);
    else void queryClient.invalidateQueries({ queryKey: qk.contacts });
  }
  removeItem(id);
  if (item.kind === 'contact' && item.photo) await deleteLocalImage(item.photo.uri);
}

async function createContact(item: ContactOutboxItem): Promise<Contact | null> {
  const input: ContactCreateInput = { ...item.draft, cardImageKey: item.imageKey ?? item.draft.cardImageKey ?? null };
  try {
    // A retry with the same id returns the existing contact (200). A 409 means another account owns
    // the id: it falls through to onSendError, which marks the item failed and keeps the draft.
    return await api.contacts.create(input);
  } catch (err) {
    if (input.eventId && isUnknownEventError(err)) {
      // Keep the contact, drop the event it can no longer be tagged with.
      forgetEvent(input.eventId);
      patch(item.id, { draft: { ...item.draft, eventId: null } });
      return await api.contacts.create({ ...input, eventId: null });
    }
    if (input.tagIds?.length && isUnknownTagError(err)) {
      // Keep the contact, drop the tags; the user can re-tag it.
      patch(item.id, { draft: { ...item.draft, tagIds: [] } });
      return await api.contacts.create({ ...input, tagIds: [] });
    }
    throw err;
  }
}

async function sendContact(id: string): Promise<void> {
  let item = getContactItem(id);
  if (!item) return;

  if (item.photo && !item.imageKey) {
    patch(id, { stage: 'upload' });
    const uri = resolveLocalImageUri(item.photo.uri);
    if (!localImageExists(uri)) throw new PermanentError('The photo is no longer on this device.');
    const { key } = await api.files.upload({ uri, mimeType: item.photo.mimeType || 'image/jpeg' }, 'card');
    if (!(await stillWanted(id, false))) return;
    patch(id, { imageKey: key });
  }

  let contact: Contact | null = null;
  item = getContactItem(id);
  if (!item) return;
  if (!item.created) {
    patch(id, { stage: 'create' });
    contact = await createContact(item);
    if (!(await stillWanted(id, true))) return;
    patch(id, { created: true });
  }

  item = getContactItem(id);
  if (!item) return;
  if (item.photo && item.imageKey) {
    patch(id, { stage: 'extract' });
    try {
      contact = (await api.extract.card(id, item.imageKey)).contact;
    } catch (err) {
      // Offline or signed out: try the extraction again later.
      if (isNetworkError(err) || (err instanceof ApiError && err.status === 401)) throw err;
      // Rate limited (e.g. a stack of offline cards sending at once) or a server error: retry in
      // the background while attempts remain.
      if (isTransientError(err) && item.attempts + 1 < MAX_ATTEMPTS) throw err;
      // Anything else (usually 502 extraction_failed) is not an outbox failure: the contact
      // exists and the review screen asks for the details. The copy from the create step is out
      // of date (the server has marked it failed), so fetch it fresh below.
      contact = null;
    }
    if (!(await stillWanted(id, true))) return;
  }

  await complete(id, contact ?? (await fetchContact(id)));
}

async function scanConnect(item: ConnectOutboxItem) {
  try {
    return await api.connections.scan(item.slug, item.eventId ?? null);
  } catch (err) {
    if (item.eventId && isUnknownEventError(err)) {
      forgetEvent(item.eventId);
      patch(item.id, { eventId: null });
      return await api.connections.scan(item.slug, null);
    }
    throw err;
  }
}

async function sendConnect(id: string): Promise<void> {
  const item = getItem(id);
  if (item?.kind !== 'connect') return;
  const { contact } = await scanConnect(item);
  await complete(id, contact);
}

/** Exponential backoff: 2 s, 4 s, 8 s ... capped at 5 minutes. */
function retryDelay(attempts: number): number {
  return Math.min(MAX_RETRY_DELAY_MS, 2_000 * 2 ** Math.max(0, attempts - 1));
}

/** Wakes the outbox at `at` (keeps whichever pending wake-up is sooner). */
function scheduleFlush(at: number) {
  if (retryTimer && retryAt <= at) return;
  if (retryTimer) clearTimeout(retryTimer);
  retryAt = at;
  retryTimer = setTimeout(
    () => {
      retryTimer = null;
      void flushOutbox();
    },
    Math.max(0, at - Date.now()),
  );
}

function onSendError(id: string, err: unknown): Outcome {
  const item = getItem(id);
  if (!item) {
    discarded.delete(id);
    return 'done';
  }
  if (isNetworkError(err)) {
    patch(id, { status: 'queued', waiting: 'offline', error: undefined });
    // The OS may still report a connection (weak venue signal, captive portal, a timeout), and then
    // no network event comes when requests start working again: try again with backoff. If the
    // device really is offline, runFlush returns without sending and the network listener takes over.
    networkFailures += 1;
    scheduleFlush(Date.now() + retryDelay(networkFailures));
    return 'offline';
  }
  if (err instanceof ApiError && err.status === 401) {
    patch(id, { status: 'queued', waiting: 'offline', error: undefined });
    return 'unauthorized';
  }
  const message = err instanceof Error && err.message ? err.message : 'Something went wrong';
  const permanent =
    err instanceof PermanentError || (err instanceof ApiError && err.status < 500 && err.status !== 429);
  if (permanent) {
    patch(id, { status: 'failed', waiting: undefined, error: message });
    return 'failed';
  }
  const attempts = item.attempts + 1;
  if (attempts >= MAX_ATTEMPTS) {
    patch(id, { status: 'failed', waiting: undefined, attempts, error: message });
    return 'failed';
  }
  const nextAttemptAt = Date.now() + retryDelay(attempts);
  patch(id, { status: 'queued', waiting: 'retry', attempts, error: message, nextAttemptAt });
  scheduleFlush(nextAttemptAt);
  return 'retry';
}

async function send(item: OutboxItem): Promise<Outcome> {
  patch(item.id, { status: 'sending', waiting: undefined, nextAttemptAt: undefined });
  try {
    if (item.kind === 'contact') await sendContact(item.id);
    else await sendConnect(item.id);
    networkFailures = 0;
    return 'done';
  } catch (err) {
    return onSendError(item.id, err);
  }
}

async function isOffline(): Promise<boolean> {
  try {
    return (await Network.getNetworkStateAsync()).isConnected === false;
  } catch {
    return false;
  }
}

async function runFlush() {
  await hydrate();
  if (!items.some((i) => i.status === 'queued')) return;
  if (await isOffline()) {
    for (const item of items) {
      if (item.status === 'queued' && item.waiting !== 'offline') patch(item.id, { waiting: 'offline' });
    }
    return;
  }
  const now = Date.now();
  for (const { id } of items.filter((i) => i.status === 'queued')) {
    const item = getItem(id);
    if (!item || item.status !== 'queued') continue;
    // Backing off after a server error: the scheduled wake-up picks it up.
    if (item.nextAttemptAt && item.nextAttemptAt > now) {
      scheduleFlush(item.nextAttemptAt);
      continue;
    }
    const outcome = await send(item);
    // No connection (or no session): the rest would fail the same way.
    if (outcome === 'offline' || outcome === 'unauthorized') break;
  }
}

let flushing: Promise<void> | null = null;
let flushAgain = false;

// ---- Public API ----

function contactLabel(draft: ContactCreateInput, hasPhoto: boolean): string {
  if (hasPhoto && (!draft.name || draft.name === CARD_PLACEHOLDER_NAME)) return 'Card photo';
  return draft.name;
}

/** 'peter-bui-7f3a' -> 'Peter Bui', for showing a queued connection before we know their name. */
function nameFromSlug(slug: string): string {
  const parts = slug.split('-').filter(Boolean);
  if (parts.length > 1) parts.pop();
  return parts.map((p) => p.charAt(0).toUpperCase() + p.slice(1)).join(' ') || slug;
}

/** Adds a contact to the outbox and tries to send it straight away. */
export async function enqueueContact(
  draft: ContactCreateInput & { id: string },
  photo?: { uri: string; mimeType?: string | null },
): Promise<void> {
  await hydrate();
  const item: ContactOutboxItem = {
    kind: 'contact',
    id: draft.id,
    createdAt: new Date().toISOString(),
    label: contactLabel(draft, !!photo),
    status: 'queued',
    attempts: 0,
    draft,
    photo,
    stage: photo ? 'upload' : 'create',
  };
  const previous = getItem(item.id);
  items = [...items.filter((i) => i.id !== item.id), item];
  emit();
  try {
    await persist();
  } catch (err) {
    // Storage full (on web each queued photo is kept inline in localStorage) or unavailable. Don't
    // keep an item that would vanish on reload: take it back out and tell the user, so what they
    // see always matches what is saved.
    console.warn('Could not save the outbox', err);
    const current = getContactItem(item.id);
    if (current && (current.status === 'sending' || current.imageKey || current.created)) {
      // A flush already started sending it while the write failed: let it finish from memory.
      void flushOutbox();
      return;
    }
    items = items.filter((i) => i.id !== item.id);
    if (previous) items = [...items, previous];
    emit();
    const previousPhoto = previous?.kind === 'contact' ? previous.photo?.uri : undefined;
    if (photo && photo.uri !== previousPhoto) void deleteLocalImage(photo.uri);
    void flushOutbox();
    throw new Error(
      photo
        ? "There's no room to keep another card on this device. Connect to send the cards waiting to sync, then try again."
        : "Couldn't save this contact on this device. Try again.",
    );
  }
  void flushOutbox();
}

/** Queues a Chatsoon QR connection scanned while offline. */
export async function enqueueConnect(slug: string, eventId?: string | null): Promise<void> {
  await hydrate();
  const existing = items.find((i): i is ConnectOutboxItem => i.kind === 'connect' && i.slug === slug);
  if (existing) {
    if (existing.status !== 'sending') {
      patch(existing.id, {
        eventId: eventId ?? null,
        status: 'queued',
        attempts: 0,
        error: undefined,
        nextAttemptAt: undefined,
      });
    }
  } else {
    const item: ConnectOutboxItem = {
      kind: 'connect',
      id: Crypto.randomUUID(),
      createdAt: new Date().toISOString(),
      label: nameFromSlug(slug),
      status: 'queued',
      attempts: 0,
      slug,
      eventId: eventId ?? null,
    };
    items = [...items, item];
    emit();
    try {
      await persist();
    } catch (err) {
      console.warn('Could not save the outbox', err);
    }
  }
  void flushOutbox();
}

/** Tries to send every queued item. Safe to call often: only one flush runs at a time. */
export function flushOutbox(): Promise<void> {
  if (flushing) {
    flushAgain = true;
    return flushing;
  }
  flushing = (async () => {
    try {
      do {
        flushAgain = false;
        await runFlush();
      } while (flushAgain);
    } catch (err) {
      console.warn('Outbox flush failed', err);
    } finally {
      flushing = null;
    }
  })();
  return flushing;
}

/** Sends everything now, including items waiting out a retry delay (the user asked for it). */
export function syncOutboxNow(): Promise<void> {
  for (const item of items) {
    if (item.status === 'queued' && item.nextAttemptAt) patch(item.id, { nextAttemptAt: undefined });
  }
  return flushOutbox();
}

/** Retries one failed item. */
export async function retryOutboxItem(id: string): Promise<void> {
  await hydrate();
  const item = getItem(id);
  if (!item || item.status === 'sending') return;
  patch(id, { status: 'queued', attempts: 0, error: undefined, waiting: undefined, nextAttemptAt: undefined });
  await flushOutbox();
}

/** Removes an item without sending it. If the contact already reached the server, deletes it there too. */
export async function discardOutboxItem(id: string): Promise<void> {
  await hydrate();
  const item = getItem(id);
  if (!item) return;
  // A send in flight notices the item is gone after its current request and deletes what it created.
  if (item.status === 'sending') discarded.add(id);
  removeItem(id);
  if (item.kind !== 'contact') return;
  if (item.photo) await deleteLocalImage(item.photo.uri);
  if (item.created) await deleteServerCopy(id);
}

/** Drops everything (on sign out / account deletion). Also forgets the current event. */
export async function clearOutbox(): Promise<void> {
  await hydrate();
  const photos = items.flatMap((i) => (i.kind === 'contact' && i.photo ? [i.photo.uri] : []));
  items = [];
  discarded.clear();
  if (retryTimer) clearTimeout(retryTimer);
  retryTimer = null;
  networkFailures = 0;
  emit();
  writeChain = writeChain.then(() => removeKey(STORAGE_KEY)).catch(() => {});
  await writeChain;
  await Promise.all(photos.map(deleteLocalImage));
  await deleteAllLocalImages();
  setCurrentEventId(null);
}

/** The item with this id right now (outside React). */
export function getOutboxItem(id: string): OutboxItem | undefined {
  return getItem(id);
}

/**
 * Pending items, for showing "waiting to sync" rows in the contacts list. `flush` is for user
 * actions (pull to refresh, Sync now), so it also retries items that are waiting out a delay.
 */
export function useOutbox(): { items: OutboxItem[]; flush: () => Promise<void> } {
  const list = useSyncExternalStore(subscribe, getItems, getItems);
  return { items: list, flush: syncOutboxNow };
}

/** One outbox item by id (the review screen follows a card through upload and extraction). */
export function useOutboxItem(id: string | undefined): OutboxItem | undefined {
  const select = () => (id ? getItem(id) : undefined);
  return useSyncExternalStore(subscribe, select, select);
}

/** False until the saved outbox has been read from storage after launch. */
export function useOutboxReady(): boolean {
  return useSyncExternalStore(subscribe, getHydrated, getHydrated);
}

/** Mounted once in the root layout (inside QueryClientProvider): flushes on start, when back online and on foreground. */
export function OutboxSync(): null {
  const qc = useQueryClient();
  useEffect(() => {
    queryClient = qc;
    void flushOutbox();
    const network = Network.addNetworkStateListener((state) => {
      if (state.isConnected === false) return;
      networkFailures = 0;
      void flushOutbox();
    });
    const appState = AppState.addEventListener('change', (state) => {
      if (state === 'active') void flushOutbox();
    });
    return () => {
      network.remove();
      appState.remove();
      if (queryClient === qc) queryClient = null;
    };
  }, [qc]);
  return null;
}
