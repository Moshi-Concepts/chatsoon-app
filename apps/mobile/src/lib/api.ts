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
};

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

  let res: Response;
  try {
    // Bearer only: never send or store cookies, so the web app is not exposed to CSRF.
    res = await fetch(url.toString(), { method, headers, body, credentials: 'omit' });
  } catch {
    throw new ApiError(0, 'network', 'No connection. Check your internet and try again.');
  }

  if (!res.ok) {
    let code = 'internal';
    let message = `Request failed (${res.status})`;
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
  const text = await res.text();
  return (text ? JSON.parse(text) : undefined) as T;
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
    // React Native's FormData accepts { uri, name, type } for files.
    form.append('file', { uri: file.uri, name, type } as unknown as Blob);
  }
  return request<UploadResponse>('POST', '/files', { raw: form, query: { purpose } });
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
    deleteAccount: () => request<void>('DELETE', '/me'),
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

  files: { upload },

  extract: {
    card: (contactId: string, imageKey: string) =>
      request<ExtractCardResponse>('POST', '/extract/card', { body: { contactId, imageKey } }),
  },

  moderation: {
    report: (input: ReportInput) => request<{ ok: true }>('POST', '/reports', { body: input }),
    block: (input: BlockInput) => request<{ ok: true }>('POST', '/blocks', { body: input }),
    /** Accepts a user id or a public slug. */
    unblock: (idOrSlug: string) => request<void>('DELETE', `/blocks/${encodeURIComponent(idOrSlug)}`),
  },
};
