import type {
  ApiErrorBody,
  BlockInput,
  ChatsoonEvent,
  ConnectFormInput,
  Contact,
  ContactCreateInput,
  ContactsResponse,
  ContactUpdateInput,
  EventsResponse,
  ExtractCardResponse,
  Me,
  MyProfile,
  ProfileInput,
  PublicProfile,
  ReportInput,
  ScanConnectResponse,
  SignInResponse,
  Tag,
  TagsResponse,
  UploadPurpose,
  UploadResponse,
} from '@chatsoon/shared';
import { API_ORIGIN } from '@chatsoon/shared';
import { File as FsFile } from 'expo-file-system';
import { Platform } from 'react-native';

export const API_URL = (process.env.EXPO_PUBLIC_API_URL || API_ORIGIN).replace(/\/+$/, '');

export class ApiError extends Error {
  constructor(
    /** HTTP status, or 0 when the request never reached the server. */
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

/** True when the request failed because the device is offline or the server is unreachable. */
export function isNetworkError(err: unknown): boolean {
  return err instanceof ApiError && err.status === 0;
}

let authToken: string | null = null;
let onUnauthorized: (() => void) | null = null;

/** Called by AuthProvider. */
export function setAuthToken(token: string | null) {
  authToken = token;
}
export function getAuthToken(): string | null {
  return authToken;
}
export function setUnauthorizedHandler(handler: (() => void) | null) {
  onUnauthorized = handler;
}

type RequestOpts = {
  body?: unknown;
  query?: Record<string, string | undefined | null>;
  /** FormData or Blob body, sent as-is. */
  raw?: BodyInit;
  /** Return the Response instead of parsing JSON. */
  asResponse?: boolean;
  /** Do not treat 401 as "session expired" (auth endpoints). */
  skipAuthHandler?: boolean;
  /** Give up after this long (default DEFAULT_TIMEOUT_MS). */
  timeoutMs?: number;
};

/**
 * Native fetch has no timeout of its own (OkHttp and NSURLSession are set to wait forever), so a
 * dead venue connection would leave a request, and the outbox behind it, hanging until a restart.
 */
const DEFAULT_TIMEOUT_MS = 30_000;
/** Photo uploads on a weak signal, and card extraction (the server can take about 51 s). */
const SLOW_TIMEOUT_MS = 120_000;

const NETWORK_MESSAGE = 'No connection. Check your internet and try again.';

/**
 * True when fetch failed to reach the server. Anything else is a bug on this side (e.g. a body
 * fetch can't encode) and must not be mistaken for being offline, which would park the outbox.
 */
function isTransportError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  if (err.name === 'AbortError') return true;
  // expo/fetch wraps every native failure as "fetch failed: ..."; RN's own fetch (if ever enabled
  // with EXPO_PUBLIC_USE_RN_FETCH) throws "Network request failed".
  if (Platform.OS !== 'web') return err.message.startsWith('fetch failed') || err.message === 'Network request failed';
  // Browsers throw a TypeError ("Failed to fetch", "Load failed", "NetworkError when attempting...").
  return err instanceof TypeError;
}

/** Friendly text for an error response that isn't JSON (e.g. a Cloudflare error page). */
function fallbackMessage(status: number): string {
  if (status >= 500) return 'Something went wrong on our side. Please try again.';
  if (status === 429) return 'Too many requests. Please wait a minute and try again.';
  return 'Something went wrong. Please try again.';
}

async function request<T>(method: string, path: string, opts: RequestOpts = {}): Promise<T> {
  const url = new URL(API_URL + path);
  for (const [k, v] of Object.entries(opts.query ?? {})) if (v) url.searchParams.set(k, v);

  const headers: Record<string, string> = { Accept: 'application/json' };
  if (authToken) headers.Authorization = `Bearer ${authToken}`;
  let body: BodyInit | undefined = opts.raw;
  if (opts.body !== undefined) {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(opts.body);
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  const timedOut = () =>
    new ApiError(0, 'timeout', 'The connection is too slow right now. Check your internet and try again.');
  try {
    let res: Response;
    try {
      // Bearer only: never send or store cookies, so the web app is not exposed to CSRF.
      res = await fetch(url.toString(), { method, headers, body, credentials: 'omit', signal: controller.signal });
    } catch (err) {
      if (controller.signal.aborted) throw timedOut();
      if (isTransportError(err)) throw new ApiError(0, 'network', NETWORK_MESSAGE);
      throw err;
    }

    if (!res.ok) {
      let code = 'internal';
      let message = fallbackMessage(res.status);
      try {
        const data = (await res.json()) as Partial<ApiErrorBody> & { message?: string; code?: string };
        if (data.error) {
          code = data.error.code;
          message = data.error.message;
        } else if (data.message) {
          // Better Auth error shape
          code = data.code ?? code;
          message = data.message;
        }
      } catch {
        // not JSON
      }
      if (res.status === 401 && !opts.skipAuthHandler && authToken) onUnauthorized?.();
      throw new ApiError(res.status, code, message);
    }

    if (opts.asResponse) return res as unknown as T;
    if (res.status === 204) return undefined as T;
    let text: string;
    try {
      text = await res.text();
    } catch {
      throw controller.signal.aborted ? timedOut() : new ApiError(0, 'network', NETWORK_MESSAGE);
    }
    // On Android an abort mid-body can still resolve text() with part of the body.
    if (controller.signal.aborted) throw timedOut();
    return (text ? JSON.parse(text) : undefined) as T;
  } finally {
    clearTimeout(timer);
  }
}

export type UploadSource = {
  /** file://, content://, blob: or data: URI from the camera / picker. */
  uri: string;
  mimeType?: string | null;
  fileName?: string | null;
};

async function upload(file: UploadSource, purpose: UploadPurpose): Promise<UploadResponse> {
  const type = file.mimeType || 'image/jpeg';
  const name = file.fileName || `${purpose}.${type.split('/')[1] ?? 'jpg'}`;
  const form = new FormData();
  if (Platform.OS === 'web') {
    const blob = await (await fetch(file.uri)).blob();
    form.append('file', new Blob([blob], { type }), name);
  } else {
    // Since SDK 57 the native global fetch is expo/fetch, whose multipart encoder rejects React
    // Native's { uri, name, type } parts ("Unsupported FormDataPart implementation"). An
    // expo-file-system File implements Blob (bytes(), name, type), so it is encoded as a file part
    // named after the file. Only file:// URIs get here (persisted card photos, resized avatars).
    // The server sniffs the image type from the bytes.
    form.append('file', new FsFile(file.uri) as unknown as Blob, name);
  }
  return request<UploadResponse>('POST', '/files', { raw: form, query: { purpose }, timeoutMs: SLOW_TIMEOUT_MS });
}

export const api = {
  auth: {
    sendCode: (email: string) =>
      request<{ success: boolean }>('POST', '/auth/email-otp/send-verification-otp', {
        body: { email, type: 'sign-in' },
        skipAuthHandler: true,
      }),
    /** Verifies the 6 digit code. Returns the bearer token to store. */
    signIn: async (email: string, otp: string): Promise<SignInResponse> => {
      const res = await request<Response>('POST', '/auth/sign-in/email-otp', {
        body: { email, otp },
        asResponse: true,
        skipAuthHandler: true,
      });
      const data = (await res.json()) as SignInResponse;
      const headerToken = res.headers.get('set-auth-token');
      return { ...data, token: headerToken || data.token };
    },
    signOut: () => request<unknown>('POST', '/auth/sign-out', { body: {}, skipAuthHandler: true }),
  },

  me: {
    get: () => request<Me>('GET', '/me'),
    updateProfile: (input: ProfileInput) => request<MyProfile>('PUT', '/me/profile', { body: input }),
    // Deleting every file and row can take a while; a client timeout must not cut it short.
    deleteAccount: () => request<void>('DELETE', '/me', { timeoutMs: SLOW_TIMEOUT_MS }),
    /** CSV text of all contacts. */
    exportCsv: async (): Promise<string> => {
      const res = await request<Response>('GET', '/me/export.csv', { asResponse: true });
      return res.text();
    },
  },

  profiles: {
    get: (slug: string) => request<PublicProfile>('GET', `/id/${encodeURIComponent(slug)}`),
    vcardUrl: (slug: string) => `${API_URL}/id/${encodeURIComponent(slug)}/vcard`,
    connect: (slug: string, input: ConnectFormInput) =>
      request<{ ok: true }>('POST', `/id/${encodeURIComponent(slug)}/connect`, { body: input }),
  },

  connections: {
    scan: (slug: string, eventId?: string | null) =>
      request<ScanConnectResponse>('POST', '/connections/scan', { body: { slug, eventId: eventId ?? null } }),
  },

  contacts: {
    list: (params?: { q?: string; tag?: string; event?: string }) =>
      request<ContactsResponse>('GET', '/contacts', { query: params }),
    get: (id: string) => request<Contact>('GET', `/contacts/${encodeURIComponent(id)}`),
    create: (input: ContactCreateInput) => request<Contact>('POST', '/contacts', { body: input }),
    update: (id: string, input: ContactUpdateInput) =>
      request<Contact>('PUT', `/contacts/${encodeURIComponent(id)}`, { body: input }),
    remove: (id: string) => request<void>('DELETE', `/contacts/${encodeURIComponent(id)}`),
  },

  tags: {
    list: () => request<TagsResponse>('GET', '/tags'),
    create: (name: string) => request<Tag>('POST', '/tags', { body: { name } }),
    remove: (id: string) => request<void>('DELETE', `/tags/${encodeURIComponent(id)}`),
  },

  events: {
    list: () => request<EventsResponse>('GET', '/events'),
    create: (name: string) => request<ChatsoonEvent>('POST', '/events', { body: { name } }),
  },

  files: {
    upload,
    /** Deletes an uploaded card photo that no contact uses (a queued card discarded after its upload). */
    removeCard: (key: string) => request<void>('DELETE', '/files/card', { body: { key } }),
  },

  extract: {
    card: (contactId: string, imageKey: string) =>
      request<ExtractCardResponse>('POST', '/extract/card', {
        body: { contactId, imageKey },
        timeoutMs: SLOW_TIMEOUT_MS,
      }),
  },

  moderation: {
    report: (input: ReportInput) => request<{ ok: true }>('POST', '/reports', { body: input }),
    block: (input: BlockInput) => request<{ ok: true }>('POST', '/blocks', { body: input }),
    /** Accepts a user id or a public slug. */
    unblock: (idOrSlug: string) => request<void>('DELETE', `/blocks/${encodeURIComponent(idOrSlug)}`),
  },
};
