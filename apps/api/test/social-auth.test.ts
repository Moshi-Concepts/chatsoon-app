import type { AuthProvidersResponse } from '@chatsoon/shared';
import { REVIEWER_EMAIL } from '@chatsoon/shared';
import { createExecutionContext, waitOnExecutionContext } from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { Env } from '../src/env';
import app from '../src/index';
import { appleClientSecret, resetAppleClientSecretCacheForTests } from '../src/lib/apple-client-secret';
import { buildSocialProviders, createAuth } from '../src/lib/auth';
import { call, signIn } from './helpers';

// GET /auth-providers, the socialProviders gating in lib/auth.ts (buildSocialProviders), Apple's
// self-signed client secret (lib/apple-client-secret.ts), POST /me/avatar/from-provider, and the
// reviewer/banned-email block in `user.validateUserInfo` (issue #24).

/** A copy of env with some values replaced. A copy, not Object.create(env): see auth.test.ts. */
const withEnv = (overrides: Partial<Env>): Env => ({ ...env, ...overrides });

// A real (test-only) EC P-256 PKCS8 key, generated with Node's crypto module. Not used for anything
// but signing a throwaway JWT in this suite.
const TEST_APPLE_PRIVATE_KEY = `-----BEGIN PRIVATE KEY-----
MIGHAgEAMBMGByqGSM49AgEGCCqGSM49AwEHBG0wawIBAQQg8DD2Mmb2wiOMwy0X
r7lmPXszfa7WfKb330xBICjCj0uhRANCAATLiL9npHSCbZ8apFoFd5bxZQ81UC43
hiJWAFu2nlAN+OX9ziXzcbflSIGThO8DFnETsWdkg23J+/KLLJdVlUQC
-----END PRIVATE KEY-----`;

const ALL_SOCIAL_SECRETS: Partial<Env> = {
  GOOGLE_CLIENT_ID: 'google-client-id',
  GOOGLE_CLIENT_SECRET: 'google-client-secret',
  LINKEDIN_CLIENT_ID: 'linkedin-client-id',
  LINKEDIN_CLIENT_SECRET: 'linkedin-client-secret',
  DISCORD_CLIENT_ID: 'discord-client-id',
  DISCORD_CLIENT_SECRET: 'discord-client-secret',
  APPLE_CLIENT_ID: 'app.chatsoon.signin',
  APPLE_TEAM_ID: 'TEAMID1234',
  APPLE_KEY_ID: 'KEYID12345',
  APPLE_PRIVATE_KEY: TEST_APPLE_PRIVATE_KEY,
};

/** Calls the Worker directly with a custom env, so a per-test secret override doesn't leak elsewhere. */
async function callWithEnv(path: string, customEnv: Env, init: RequestInit = {}) {
  const ctx = createExecutionContext();
  const res = await app.fetch(new Request(`http://localhost:8787${path}`, init), customEnv, ctx);
  await waitOnExecutionContext(ctx);
  return res;
}

function decodeJwtPayload(token: string): Record<string, unknown> {
  const [, payload] = token.split('.');
  const json = atob((payload ?? '').replace(/-/g, '+').replace(/_/g, '/'));
  return JSON.parse(json);
}

afterEach(() => {
  vi.restoreAllMocks();
  resetAppleClientSecretCacheForTests();
});

describe('GET /auth-providers', () => {
  it('returns no providers when no secrets are set (default env)', async () => {
    const res = await call('/auth-providers');
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('public, max-age=300');
    expect((await res.json()) as AuthProvidersResponse).toEqual({ providers: [] });
  });

  it('returns every provider, in apple/google/linkedin/discord order, once all its secrets are set', async () => {
    const res = await callWithEnv('/auth-providers', withEnv(ALL_SOCIAL_SECRETS));
    expect((await res.json()) as AuthProvidersResponse).toEqual({
      providers: ['apple', 'google', 'linkedin', 'discord'],
    });
  });

  it('only lists a provider once every one of its secrets is set', async () => {
    const res = await callWithEnv(
      '/auth-providers',
      withEnv({ GOOGLE_CLIENT_ID: 'only-the-id-not-the-secret' }),
    );
    expect((await res.json()) as AuthProvidersResponse).toEqual({ providers: [] });
  });
});

describe('buildSocialProviders', () => {
  it('builds no socialProviders with no secrets set, and the auth config still constructs', async () => {
    const providers = await buildSocialProviders(env);
    expect(providers).toEqual({});
    // Doesn't throw: the auth config builds fine with an empty socialProviders map.
    await expect(createAuth(env)).resolves.toBeTruthy();
  });

  it('gives Discord a mapProfileToUser that copies the username onto discordUsername', async () => {
    const providers = await buildSocialProviders(withEnv(ALL_SOCIAL_SECRETS));
    const discord = providers.discord as unknown as {
      mapProfileToUser: (p: { username: string }) => { discordUsername: string };
    };
    expect(discord.mapProfileToUser({ username: 'peterbui' })).toEqual({ discordUsername: 'peterbui' });
  });
});

describe('POST /auth/sign-in/social', () => {
  it('404s with no providers configured, same as before this feature existed', async () => {
    const res = await call('/auth/sign-in/social', { method: 'POST', json: { provider: 'google' } });
    expect(res.status).toBe(404);
  });

  it('returns an authorize URL once Google is configured', async () => {
    const res = await callWithEnv('/auth/sign-in/social', withEnv(ALL_SOCIAL_SECRETS), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        provider: 'google',
        callbackURL: 'http://localhost:8081/auth-complete',
        errorCallbackURL: 'http://localhost:8081/sign-in',
      }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { url: string; redirect: boolean };
    expect(body.url).toMatch(/^https:\/\/accounts\.google\.com\//);
    const redirectUri = new URL(body.url).searchParams.get('redirect_uri');
    expect(redirectUri).toBe('http://localhost:8787/auth/callback/google');
  });
});

describe('appleClientSecret', () => {
  it('is null when Apple env vars are missing', async () => {
    expect(await appleClientSecret(env)).toBeNull();
  });

  it('signs a JWT with the right claims and a <=6 month expiry', async () => {
    const token = await appleClientSecret(withEnv(ALL_SOCIAL_SECRETS));
    expect(token).toBeTruthy();
    expect(token!.split('.')).toHaveLength(3);
    const payload = decodeJwtPayload(token!);
    expect(payload).toMatchObject({
      iss: 'TEAMID1234',
      sub: 'app.chatsoon.signin',
      aud: 'https://appleid.apple.com',
    });
    const sixMonths = 60 * 60 * 24 * 183;
    expect((payload.exp as number) - (payload.iat as number)).toBeLessThanOrEqual(sixMonths);
  });

  it('caches the token for the same config instead of re-signing every call', async () => {
    const e = withEnv(ALL_SOCIAL_SECRETS);
    const first = await appleClientSecret(e);
    const second = await appleClientSecret(e);
    expect(second).toBe(first);
  });
});

describe('social sign-in blocks the reviewer and banned emails (validateUserInfo)', () => {
  // Exercised directly against the Better Auth config's `user.validateUserInfo` hook: driving it
  // through a real OAuth round trip would mean standing up a fake Google/Discord provider, but the
  // hook itself is what this feature added, so this is what's worth covering directly.
  async function validate(customEnv: Env, email: string) {
    const auth = await createAuth(customEnv);
    // Cast to how the hook is actually written (auth.ts's `user.validateUserInfo`): it never reads
    // the second (GenericEndpointContext) parameter, so this test never needs to build a real one.
    const validateUserInfo = auth.options.user?.validateUserInfo as
      | ((data: { user: { email: string }; source: unknown }) => unknown | Promise<unknown>)
      | undefined;
    return validateUserInfo?.({ user: { email }, source: { method: 'oauth', oauth: { providerId: 'google' } } });
  }

  it('rejects the reviewer email', async () => {
    const result = (await validate(env, REVIEWER_EMAIL)) as { error: string } | undefined;
    expect(result?.error).toBe('reviewer_blocked');
  });

  it('rejects a banned email', async () => {
    const banned = 'removed.user@example.com';
    const result = (await validate(withEnv({ BANNED_EMAILS: banned }), banned)) as { error: string } | undefined;
    expect(result?.error).toBe('account_banned');
  });

  it('allows an ordinary email through', async () => {
    const result = await validate(env, 'ordinary.person@example.com');
    expect(result).toBeUndefined();
  });
});

describe('GET /me', () => {
  it('includes name and image (null for an email/OTP account with neither)', async () => {
    const user = await signIn(`social-me-${crypto.randomUUID()}@example.com`);
    const res = await call('/me', { token: user.token });
    const body = (await res.json()) as { user: { name: string | null; image: string | null }; socialPrefill?: unknown };
    expect(body.user.name).toBeNull();
    expect(body.user.image).toBeNull();
    expect(body.socialPrefill).toBeUndefined();
  });
});

describe('POST /me/avatar/from-provider', () => {
  const realFetch = globalThis.fetch.bind(globalThis);
  const TINY_JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0xff, 0xd9]);

  async function setUserImage(userId: string, url: string | null) {
    await env.DB.prepare('update users set image = ? where id = ?').bind(url, userId).run();
  }

  async function newUser() {
    return signIn(`avatar-provider-${crypto.randomUUID()}@example.com`);
  }

  const post = (token: string) => call('/me/avatar/from-provider', { method: 'POST', token, json: {} });

  it('rejects when there is no provider photo to use', async () => {
    const user = await newUser();
    const res = await post(user.token);
    expect(res.status).toBe(400);
  });

  it('rejects a host outside the allowlist, without ever fetching it', async () => {
    const user = await newUser();
    await setUserImage(user.userId, 'https://evil.example.com/photo.jpg');
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const res = await post(user.token);
    expect(res.status).toBe(400);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('rejects a non-https URL', async () => {
    const user = await newUser();
    await setUserImage(user.userId, 'http://lh3.googleusercontent.com/photo.jpg');
    const res = await post(user.token);
    expect(res.status).toBe(400);
  });

  it('rejects a redirect to another host instead of following it', async () => {
    const user = await newUser();
    await setUserImage(user.userId, 'https://lh3.googleusercontent.com/photo.jpg');
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const req = new Request(input as string, init);
      if (!req.url.startsWith('https://lh3.googleusercontent.com/')) return realFetch(input as string, init);
      expect(init?.redirect).toBe('manual');
      return new Response(null, { status: 302, headers: { Location: 'https://evil.example.com/steal.jpg' } });
    });
    const res = await post(user.token);
    expect(res.status).toBe(400);
  });

  it('rejects a non-image content type', async () => {
    const user = await newUser();
    await setUserImage(user.userId, 'https://media.licdn.com/photo.jpg');
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const req = new Request(input as string, init);
      if (!req.url.startsWith('https://media.licdn.com/')) return realFetch(input as string, init);
      return new Response('<html>not a photo</html>', { status: 200, headers: { 'content-type': 'text/html' } });
    });
    const res = await post(user.token);
    expect(res.status).toBe(400);
  });

  it('rejects a body over the size cap', async () => {
    const user = await newUser();
    await setUserImage(user.userId, 'https://cdn.discordapp.com/avatars/1/abc.png');
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const req = new Request(input as string, init);
      if (!req.url.startsWith('https://cdn.discordapp.com/')) return realFetch(input as string, init);
      return new Response(TINY_JPEG, {
        status: 200,
        headers: { 'content-type': 'image/jpeg', 'content-length': String(10 * 1024 * 1024) },
      });
    });
    const res = await post(user.token);
    expect(res.status).toBe(400);
  });

  it('stores an allowlisted image and returns its avatar key', async () => {
    const user = await newUser();
    await setUserImage(user.userId, 'https://lh3.googleusercontent.com/a/photo.jpg');
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const req = new Request(input as string, init);
      if (!req.url.startsWith('https://lh3.googleusercontent.com/')) return realFetch(input as string, init);
      return new Response(TINY_JPEG, { status: 200, headers: { 'content-type': 'image/jpeg' } });
    });
    const res = await post(user.token);
    expect(res.status).toBe(201);
    const body = (await res.json()) as { avatarKey: string };
    expect(body.avatarKey).toMatch(new RegExp(`^u/${user.userId}/avatar/`));
    const object = await env.FILES.get(body.avatarKey);
    expect(object).not.toBeNull();
  });
});
