import type {
  ApiErrorBody,
  AuthProvidersResponse,
  AvatarFromProviderResponse,
  BlockInput,
  CancelDeletionByTokenResponse,
  CancelDeletionResponse,
  ChatsoonEvent,
  ConnectFormInput,
  ConnectFormResponse,
  Contact,
  ContactCreateInput,
  ContactsResponse,
  ContactUpdateInput,
  EmailPrefsResponse,
  EventsResponse,
  ExtractCardResponse,
  Me,
  MyProfile,
  ProfileInput,
  PublicProfile,
  ReportInput,
  ScanConnectResponse,
  ScheduleDeletionResponse,
  SignInResponse,
  SocialProvider,
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

    /** Enabled social sign-in providers (issue #24), so the sign-in page shows only live buttons. */
    providers: () => request<AuthProvidersResponse>('GET', '/auth-providers', { skipAuthHandler: true }),

    /** Starts a redirect-based social sign-in. Navigate the browser to the returned `url`. */
    socialSignIn: (
      provider: SocialProvider,
      urls: { callbackURL: string; errorCallbackURL: string; newUserCallbackURL: string },
    ) =>
      request<{ url: string; redirect: boolean }>('POST', '/auth/sign-in/social', {
        body: { provider, ...urls },
        skipAuthHandler: true,
      }),

    /**
     * Called from /auth-complete once the provider's redirect lands back on our own origin: the OAuth
     * callback (api.chatsoon.app/auth/callback/<provider>) already set Better Auth's session cookie on
     * the API origin, so this exchanges it for the bearer token the app actually stores. `credentials:
     * 'include'` is used only here, and only for this one same-site call to our own API - never for
     * any other request `request()` makes (those stay `credentials: 'omit'`, see below), never to a
     * third party, and the token that comes back is held in memory and stored exactly like the email
     * code flow's token, never put in a URL.
     */
    completeSocialSignIn: async (): Promise<SignInResponse> => {
      let res: Response;
      try {
        res = await fetch(`${API_URL}/auth/get-session`, {
          credentials: 'include',
          headers: { Accept: 'application/json' },
        });
      } catch (err) {
        if (isTransportError(err)) throw new ApiError(0, 'network', NETWORK_MESSAGE);
        throw err;
      }
      if (!res.ok) throw new ApiError(res.status, 'internal', fallbackMessage(res.status));
      // The bearer plugin only sets `set-auth-token` when it also refreshes the session cookie, which
      // a session this fresh won't yet need - so the header is checked first (belt and braces) but
      // `session.token` in the JSON body (Better Auth never strips it from GET /auth/get-session) is
      // what actually carries the token on this call.
      let data: { session?: { token?: string }; user?: { id: string; email: string } } | null = null;
      try {
        data = await res.json();
      } catch {
        // handled below: no token, no user.
      }
      const token = res.headers.get('set-auth-token') || data?.session?.token;
      if (!token || !data?.user) {
        throw new ApiError(0, 'invalid_token', "We couldn't finish signing you in. Please try again.");
      }
      return { token, user: { id: data.user.id, email: data.user.email } };
    },
  },

  me: {
    get: () => request<Me>('GET', '/me'),
    updateProfile: (input: ProfileInput) => request<MyProfile>('PUT', '/me/profile', { body: input }),
    /** Turns the new-account "tips" nudge emails on or off (issue #7). Works even before onboarding. */
    updateEmailPrefs: (tipsEmails: boolean) =>
      request<EmailPrefsResponse>('PUT', '/me/email-prefs', { body: { tipsEmails } }),
    /**
     * Schedules delayed account deletion (issue #8), or runs it immediately for the App Review
     * account. Idempotent. Deleting every file and row (for the reviewer) can take a while; a
     * client timeout must not cut it short.
     */
    scheduleDeletion: () =>
      request<ScheduleDeletionResponse>('POST', '/me/deletion', { body: { confirm: 'DELETE' }, timeoutMs: SLOW_TIMEOUT_MS }),
    /** Cancels a pending scheduled deletion. 404s (as an ApiError) if nothing is pending. */
    cancelDeletion: () => request<CancelDeletionResponse>('DELETE', '/me/deletion'),
    /** CSV text of all contacts. */
    exportCsv: async (): Promise<string> => {
      const res = await request<Response>('GET', '/me/export.csv', { asResponse: true });
      return res.text();
    },
    /** Downloads the photo from a social sign-in (issue #24) into R2 as a normal avatar upload. */
    avatarFromProvider: () => request<AvatarFromProviderResponse>('POST', '/me/avatar/from-provider', { body: {} }),
  },

  /** The signed-out flow from the "scheduled" email's cancel link (issue #8). */
  accountDeletion: {
    cancelByToken: (token: string) =>
      request<CancelDeletionByTokenResponse>('POST', '/account-deletion/cancel', {
        body: { token },
        skipAuthHandler: true,
      }),
  },

  /** The signed-out /unsubscribe page (issue #7), reached from a tips email's link. No auth. */
  email: {
    unsubscribe: (token: string) =>
      request<{ ok: true }>('POST', '/email/unsubscribe', {
        query: { token },
        body: {},
        skipAuthHandler: true,
      }),
  },

  profiles: {
    get: (slug: string) => request<PublicProfile>('GET', `/id/${encodeURIComponent(slug)}`),
    vcardUrl: (slug: string) => `${API_URL}/id/${encodeURIComponent(slug)}/vcard`,
    connect: (slug: string, input: ConnectFormInput) =>
      request<ConnectFormResponse>('POST', `/id/${encodeURIComponent(slug)}/connect`, { body: input }),
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
