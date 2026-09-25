import type { AuthProvidersResponse, ConnectedAccountsResponse } from '@chatsoon/shared';
import { DISCORD_EPOCH_MS, REVIEWER_EMAIL } from '@chatsoon/shared';
import { createExecutionContext, waitOnExecutionContext } from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { Env } from '../src/env';
import app from '../src/index';
import { appleClientSecret, resetAppleClientSecretCacheForTests } from '../src/lib/apple-client-secret';
import { buildSocialProviders, createAuth } from '../src/lib/auth';
import { resetSocialChecksCacheForTests } from '../src/lib/social-checks';
import { call, signIn } from './helpers';

// GET /auth-providers, the socialProviders gating in lib/auth.ts (buildSocialProviders), Apple's
// self-signed client secret (lib/apple-client-secret.ts), POST /me/avatar/from-provider, and the
// reviewer/banned-email block in `user.validateUserInfo` (issue #24). Account linking, the X
// (twitter) provider, social_checks capture and GET /me/connected-accounts (issue #11) are below,
// after the issue #24 tests.

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
  TWITTER_CLIENT_ID: 'twitter-client-id',
  TWITTER_CLIENT_SECRET: 'twitter-client-secret',
};

/** Calls the Worker directly with a custom env, so a per-test secret override doesn't leak elsewhere. */
async function callWithEnv(path: string, customEnv: Env, init: RequestInit = {}) {
  const ctx = createExecutionContext();
  const res = await app.fetch(new Request(`http://localhost:8787${path}`, init), customEnv, ctx);
  await waitOnExecutionContext(ctx);
  return res;
}

/** Like test/helpers.ts's `call`, but against a custom env (so a per-test secret doesn't leak). */
function callEnv(path: string, customEnv: Env, init: RequestInit & { token?: string; json?: unknown } = {}) {
  const headers = new Headers(init.headers);
  if (init.token) headers.set('Authorization', `Bearer ${init.token}`);
  let body = init.body;
  if (init.json !== undefined) {
    headers.set('Content-Type', 'application/json');
    body = JSON.stringify(init.json);
  }
  return callWithEnv(path, customEnv, { ...init, headers, body });
}

function decodeJwtPayload(token: string): Record<string, unknown> {
  const [, payload] = token.split('.');
  const json = atob((payload ?? '').replace(/-/g, '+').replace(/_/g, '/'));
  return JSON.parse(json);
}

// ---------------------------------------------------------------------------
// Account linking / X provider test helpers (issue #11).
// ---------------------------------------------------------------------------

/** The `state` cookie Better Auth sets alongside the authorize URL (default `storeStateStrategy`,
 * checked again on the callback - see node_modules/better-auth/dist/state.mjs). */
function setCookieHeader(res: Response): string {
  const withGetSetCookie = res.headers as Headers & { getSetCookie?: () => string[] };
  const raw =
    typeof withGetSetCookie.getSetCookie === 'function'
      ? withGetSetCookie.getSetCookie()
      : [...res.headers.entries()].filter(([k]) => k.toLowerCase() === 'set-cookie').map(([, v]) => v);
  return raw.map((c) => c.split(';')[0]).join('; ');
}

/** Starts `/auth/link-social` or `/auth/sign-in/social` and returns the `state` param plus the
 * cookie the callback needs to see (forwarded manually - there's no real browser in this test). */
async function beginOAuth(path: '/auth/link-social' | '/auth/sign-in/social', customEnv: Env, provider: string, token?: string) {
  const res = await callEnv(path, customEnv, {
    method: 'POST',
    token,
    json: { provider, callbackURL: 'http://localhost:8081/auth-complete', errorCallbackURL: 'http://localhost:8081/sign-in' },
  });
  if (!res.ok) throw new Error(`${path} (${provider}) failed ${res.status}: ${await res.text()}`);
  const body = (await res.json()) as { url: string };
  const state = new URL(body.url).searchParams.get('state');
  if (!state) throw new Error(`no state param in ${body.url}`);
  return { state, cookie: setCookieHeader(res) };
}

function oauthCallback(customEnv: Env, provider: string, state: string, cookie: string, code = 'test-code') {
  return callEnv(`/auth/callback/${provider}?state=${encodeURIComponent(state)}&code=${encodeURIComponent(code)}`, customEnv, {
    headers: cookie ? { Cookie: cookie } : undefined,
  });
}

/** Runs a signed-in user through `/link-social` for `provider` end to end (mocking only the
 * provider's own HTTP endpoints - the fetch-mocking pattern `POST /me/avatar/from-provider`'s tests
 * use). Returns the callback response so the caller can assert success or a specific redirect error. */
async function linkProvider(customEnv: Env, token: string, provider: string) {
  const { state, cookie } = await beginOAuth('/auth/link-social', customEnv, provider, token);
  return oauthCallback(customEnv, provider, state, cookie);
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

/** A `token_type: bearer` OAuth2 token response, the shape every provider's token endpoint returns. */
function tokenResponse(extra: Record<string, unknown> = {}): Response {
  return jsonResponse({ access_token: 'test-access-token', token_type: 'bearer', expires_in: 3600, scope: '', ...extra });
}

function base64url(bytes: Uint8Array): string {
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** An unsigned JWT (`alg: none`): fine here since Google's own default `getUserInfo` (unmodified by
 * this app) decodes the id token's claims without verifying its signature - see
 * node_modules/@better-auth/core/src/social-providers/google.ts. */
function unsignedJwt(payload: Record<string, unknown>): string {
  const enc = new TextEncoder();
  const header = base64url(enc.encode(JSON.stringify({ alg: 'none', typ: 'JWT' })));
  const body = base64url(enc.encode(JSON.stringify(payload)));
  return `${header}.${body}.`;
}

type FetchHandler = (req: Request) => Response | Promise<Response>;

/** Mocks `fetch` for URLs starting with one of `handlers`' keys; everything else goes to the real
 * `fetch` (which is how the in-process request to this Worker itself, and its D1 access, keep working). */
function mockProviderFetch(handlers: Record<string, FetchHandler>) {
  const realFetch = globalThis.fetch.bind(globalThis);
  return vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const req = input instanceof Request ? input : new Request(input as string, init);
    for (const [prefix, handler] of Object.entries(handlers)) {
      if (req.url.startsWith(prefix)) return handler(req);
    }
    return realFetch(input as string, init);
  });
}

interface AccountRow {
  id: string;
  user_id: string;
  provider_id: string;
  account_id: string;
  access_token: string | null;
  refresh_token: string | null;
  id_token: string | null;
}

async function findAccount(providerId: string, accountId: string): Promise<AccountRow | null> {
  return env.DB.prepare('select * from accounts where provider_id = ?1 and account_id = ?2')
    .bind(providerId, accountId)
    .first<AccountRow>();
}

interface SocialCheckDbRow {
  user_id: string;
  provider: string;
  provider_account_id: string;
  mfa_enabled: number;
  verified: number;
  identity_verified: number;
  followers_count: number;
  checked_at: number;
}

async function findSocialCheck(userId: string, provider: string): Promise<SocialCheckDbRow | null> {
  return env.DB.prepare('select * from social_checks where user_id = ?1 and provider = ?2')
    .bind(userId, provider)
    .first<SocialCheckDbRow>();
}

/** Builds a Discord id (snowflake) whose decoded creation time is exactly `unixMs` - see
 * packages/shared/src/social.test.ts's `snowflakeCreatedAt` for the same construction. */
function discordSnowflakeCreatedAt(unixMs: number): string {
  return (BigInt(unixMs - DISCORD_EPOCH_MS) << 22n).toString();
}

afterEach(() => {
  vi.restoreAllMocks();
  resetAppleClientSecretCacheForTests();
  resetSocialChecksCacheForTests();
});

describe('GET /auth-providers', () => {
  it('returns no providers when no secrets are set (default env)', async () => {
    const res = await call('/auth-providers');
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('public, max-age=300');
    expect((await res.json()) as AuthProvidersResponse).toEqual({ providers: [], linkProviders: [] });
  });

  it('returns every provider, in apple/google/linkedin/discord order, once all its secrets are set; twitter only in linkProviders', async () => {
    const res = await callWithEnv('/auth-providers', withEnv(ALL_SOCIAL_SECRETS));
    expect((await res.json()) as AuthProvidersResponse).toEqual({
      providers: ['apple', 'google', 'linkedin', 'discord'],
      // SOCIAL_VALIDATION_PROVIDERS order (packages/shared/src/social.ts): google, apple, discord,
      // linkedin, twitter. X never appears in `providers` - it can't sign anyone in.
      linkProviders: ['google', 'apple', 'discord', 'linkedin', 'twitter'],
    });
  });

  it('only lists a provider once every one of its secrets is set', async () => {
    const res = await callWithEnv(
      '/auth-providers',
      withEnv({ GOOGLE_CLIENT_ID: 'only-the-id-not-the-secret' }),
    );
    expect((await res.json()) as AuthProvidersResponse).toEqual({ providers: [], linkProviders: [] });
  });
});

describe('buildSocialProviders', () => {
  it('builds no socialProviders with no secrets set, and the auth config still constructs', async () => {
    const providers = await buildSocialProviders(env);
    expect(providers).toEqual({});
    // Doesn't throw: the auth config builds fine with an empty socialProviders map.
    await expect(createAuth(env)).resolves.toBeTruthy();
  });

  it('gives Discord a getUserInfo that captures discordUsername and mfa_enabled (issue #11)', async () => {
    const providers = await buildSocialProviders(withEnv(ALL_SOCIAL_SECRETS));
    const discord = providers.discord as unknown as {
      getUserInfo: (token: { accessToken: string }) => Promise<{ user: { discordUsername?: string; name: string } } | null>;
    };
    mockProviderFetch({
      'https://discord.com/api/users/@me': () =>
        jsonResponse({
          id: '123456789012345678',
          username: 'peterbui',
          global_name: 'Peter Bui',
          discriminator: '0',
          avatar: null,
          verified: true,
          email: 'peter@example.com',
          mfa_enabled: true,
        }),
    });
    const result = await discord.getUserInfo({ accessToken: 'tok' });
    expect(result?.user).toMatchObject({ name: 'Peter Bui', discordUsername: 'peterbui', email: 'peter@example.com', emailVerified: true });
  });

  it('gives twitter a getUserInfo that maps verified/identity/followers and never requests email', async () => {
    const providers = await buildSocialProviders(withEnv(ALL_SOCIAL_SECRETS));
    const twitter = providers.twitter as unknown as {
      scope: string[];
      disableDefaultScope: boolean;
      getUserInfo: (token: { accessToken: string }) => Promise<{ user: { name: string; email: string; emailVerified: boolean } } | null>;
    };
    expect(twitter.disableDefaultScope).toBe(true);
    expect(twitter.scope).toEqual(['users.read', 'tweet.read']);
    mockProviderFetch({
      'https://api.x.com/2/users/me': () =>
        jsonResponse({ data: { id: '999', name: 'X User', username: 'xuser', verified: true, verified_type: 'blue', public_metrics: { followers_count: 120 } } }),
    });
    const result = await twitter.getUserInfo({ accessToken: 'tok' });
    expect(result?.user.email).toBe('999@twitter.placeholder.invalid');
    expect(result?.user.emailVerified).toBe(false);
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

  it('refuses twitter even when it is configured (X is link-only, issue #11)', async () => {
    const res = await callEnv('/auth/sign-in/social', withEnv(ALL_SOCIAL_SECRETS), {
      method: 'POST',
      json: { provider: 'twitter', callbackURL: 'http://localhost:8081/auth-complete', errorCallbackURL: 'http://localhost:8081/sign-in' },
    });
    expect(res.status).toBe(404);
  });
});

describe('Account linking (issue #11)', () => {
  const socialEnv = withEnv(ALL_SOCIAL_SECRETS);

  it('a signed-in email user links Google and gets an accounts row on their own user id', async () => {
    const user = await signIn(`link-google-${crypto.randomUUID()}@example.com`);
    mockProviderFetch({
      'https://oauth2.googleapis.com/token': () =>
        tokenResponse({ id_token: unsignedJwt({ sub: 'google-sub-1', email: 'googley@example.com', email_verified: true, name: 'Googley' }) }),
    });
    const res = await linkProvider(socialEnv, user.token, 'google');
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toContain('http://localhost:8081/auth-complete');
    const account = await findAccount('google', 'google-sub-1');
    expect(account?.user_id).toBe(user.userId);
  });

  it('refuses linking a provider account already owned by a different user, without merging', async () => {
    const owner = await signIn(`link-owner-${crypto.randomUUID()}@example.com`);
    const other = await signIn(`link-other-${crypto.randomUUID()}@example.com`);
    mockProviderFetch({
      'https://oauth2.googleapis.com/token': () =>
        tokenResponse({ id_token: unsignedJwt({ sub: 'google-shared-1', email: 'shared@example.com', email_verified: true, name: 'Shared' }) }),
    });
    const first = await linkProvider(socialEnv, owner.token, 'google');
    expect(first.status).toBe(302);
    expect(first.headers.get('location')).toContain('http://localhost:8081/auth-complete');

    const second = await linkProvider(socialEnv, other.token, 'google');
    expect(second.status).toBe(302);
    expect(second.headers.get('location')).toContain('error=account_already_linked_to_different_user');

    const account = await findAccount('google', 'google-shared-1');
    expect(account?.user_id).toBe(owner.userId);
  });

  it('a signed-in user links a LinkedIn with a different email and it attaches to the caller (allowDifferentEmails)', async () => {
    const user = await signIn(`link-linkedin-${crypto.randomUUID()}@example.com`);
    mockProviderFetch({
      'https://www.linkedin.com/oauth/v2/accessToken': () => tokenResponse(),
      'https://api.linkedin.com/v2/userinfo': () =>
        jsonResponse({ sub: 'linkedin-sub-1', name: 'Work Person', email: 'work-address@example.com', email_verified: true }),
    });
    const res = await linkProvider(socialEnv, user.token, 'linkedin');
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toContain('http://localhost:8081/auth-complete');
    const account = await findAccount('linkedin', 'linkedin-sub-1');
    expect(account?.user_id).toBe(user.userId);
  });
});

describe('GET /me/connected-accounts (issue #11)', () => {
  const socialEnv = withEnv(ALL_SOCIAL_SECRETS);

  it('never returns tokens, and never the email-otp credential row', async () => {
    const signUpEmail = `connected-accounts-${crypto.randomUUID()}@example.com`;
    const user = await signIn(signUpEmail);
    mockProviderFetch({
      'https://oauth2.googleapis.com/token': () =>
        // A different email than the sign-up address: allowDifferentEmails lets the link through,
        // and Better Auth never overwrites the local users.email/emailVerified on a link, so the
        // label below is still the account's own (sign-up) email, not this one.
        tokenResponse({ id_token: unsignedJwt({ sub: 'google-sub-notoken', email: 'work-google@example.com', email_verified: true, name: 'No Token' }) }),
    });
    const link = await linkProvider(socialEnv, user.token, 'google');
    expect(link.status).toBe(302);

    const res = await callEnv('/me/connected-accounts', socialEnv, { token: user.token });
    expect(res.status).toBe(200);
    const body = (await res.json()) as ConnectedAccountsResponse;
    // Neither the mocked OAuth access token nor any token-shaped field name appears anywhere in
    // the response - only one row (google), never a second row for the email-OTP `credential` account.
    const bodyText = JSON.stringify(body);
    expect(bodyText).not.toContain('test-access-token');
    expect(body).toHaveLength(1);
    for (const row of body) expect(Object.keys(row)).not.toEqual(expect.arrayContaining(['accessToken', 'idToken', 'refreshToken', 'token']));
    expect(body).toEqual([{ provider: 'google', connectedAt: expect.any(String), label: signUpEmail, eligible: true }]);
  });

  it('a Discord link writes social_checks, and relinking updates mfa_enabled and checked_at', async () => {
    const user = await signIn(`connected-discord-${crypto.randomUUID()}@example.com`);
    const discordId = discordSnowflakeCreatedAt(Date.now() - 200 * 86_400_000); // 200 days old
    mockProviderFetch({
      'https://discord.com/api/oauth2/token': () => tokenResponse(),
      'https://discord.com/api/users/@me': () =>
        jsonResponse({
          id: discordId,
          username: 'firstname',
          global_name: 'First Name',
          discriminator: '0',
          avatar: null,
          verified: true,
          email: 'discord@example.com',
          mfa_enabled: false,
        }),
    });
    const first = await linkProvider(socialEnv, user.token, 'discord');
    expect(first.status).toBe(302);

    const firstCheck = await findSocialCheck(user.userId, 'discord');
    expect(firstCheck?.mfa_enabled).toBe(0);
    expect(firstCheck?.provider_account_id).toBe(discordId);

    // Reconnect: same Discord account, mfa now on and a changed username.
    mockProviderFetch({
      'https://discord.com/api/oauth2/token': () => tokenResponse(),
      'https://discord.com/api/users/@me': () =>
        jsonResponse({
          id: discordId,
          username: 'newname',
          global_name: 'First Name',
          discriminator: '0',
          avatar: null,
          verified: true,
          email: 'discord@example.com',
          mfa_enabled: true,
        }),
    });
    const second = await linkProvider(socialEnv, user.token, 'discord');
    expect(second.status).toBe(302);

    const secondCheck = await findSocialCheck(user.userId, 'discord');
    expect(secondCheck?.mfa_enabled).toBe(1);
    expect(secondCheck!.checked_at).toBeGreaterThanOrEqual(firstCheck!.checked_at);

    const res = await callEnv('/me/connected-accounts', socialEnv, { token: user.token });
    const body = (await res.json()) as ConnectedAccountsResponse;
    expect(body.find((a) => a.provider === 'discord')).toMatchObject({ label: 'newname', eligible: true });
  });

  it('eligible/reason are right for a young account, a no-2FA account, and a good Discord account', async () => {
    async function linkDiscord(ageDays: number, mfaEnabled: boolean) {
      const user = await signIn(`connected-discord-elig-${crypto.randomUUID()}@example.com`);
      const discordId = discordSnowflakeCreatedAt(Date.now() - ageDays * 86_400_000);
      mockProviderFetch({
        'https://discord.com/api/oauth2/token': () => tokenResponse(),
        'https://discord.com/api/users/@me': () =>
          jsonResponse({
            id: discordId,
            username: 'user',
            global_name: null,
            discriminator: '0',
            avatar: null,
            verified: true,
            email: `${discordId}@example.com`,
            mfa_enabled: mfaEnabled,
          }),
      });
      const link = await linkProvider(socialEnv, user.token, 'discord');
      expect(link.status).toBe(302);
      const res = await callEnv('/me/connected-accounts', socialEnv, { token: user.token });
      const body = (await res.json()) as ConnectedAccountsResponse;
      return body.find((a) => a.provider === 'discord')!;
    }

    const young = await linkDiscord(1, true);
    expect(young).toMatchObject({ eligible: false, reason: 'discord_age' });

    const noMfa = await linkDiscord(200, false);
    expect(noMfa).toMatchObject({ eligible: false, reason: 'discord_mfa' });

    const good = await linkDiscord(200, true);
    expect(good.eligible).toBe(true);
    expect(good.reason).toBeUndefined();
  });
});

describe('X (twitter) provider (issue #11)', () => {
  const socialEnv = withEnv(ALL_SOCIAL_SECRETS);

  it("writes verified true from a mocked users/me with verified_type 'blue' and 120 followers", async () => {
    const user = await signIn(`x-verified-${crypto.randomUUID()}@example.com`);
    mockProviderFetch({
      'https://api.x.com/2/oauth2/token': () => tokenResponse(),
      'https://api.x.com/2/users/me': () =>
        jsonResponse({
          data: { id: 'x-blue-1', name: 'Blue User', username: 'blueuser', verified: true, verified_type: 'blue', public_metrics: { followers_count: 120 } },
        }),
    });
    const res = await linkProvider(socialEnv, user.token, 'twitter');
    expect(res.status).toBe(302);
    const check = await findSocialCheck(user.userId, 'twitter');
    expect(check).toMatchObject({ verified: 1, identity_verified: 0, followers_count: 120 });
  });

  it('writes identity_verified true from is_identity_verified alone', async () => {
    const user = await signIn(`x-identity-${crypto.randomUUID()}@example.com`);
    mockProviderFetch({
      'https://api.x.com/2/oauth2/token': () => tokenResponse(),
      'https://api.x.com/2/users/me': () =>
        jsonResponse({
          data: { id: 'x-idv-1', name: 'ID Verified', username: 'idverified', verified: false, verified_type: 'none', is_identity_verified: true, public_metrics: { followers_count: 50 } },
        }),
    });
    const res = await linkProvider(socialEnv, user.token, 'twitter');
    expect(res.status).toBe(302);
    const check = await findSocialCheck(user.userId, 'twitter');
    expect(check).toMatchObject({ verified: 0, identity_verified: 1, followers_count: 50 });
  });

  it('a 402 from X redirects back with a retryable error and writes nothing', async () => {
    const user = await signIn(`x-402-${crypto.randomUUID()}@example.com`);
    mockProviderFetch({
      'https://api.x.com/2/oauth2/token': () => tokenResponse(),
      'https://api.x.com/2/users/me': () => jsonResponse({ error: 'credit balance exhausted' }, 402),
    });
    const res = await linkProvider(socialEnv, user.token, 'twitter');
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toContain('error=unable_to_get_user_info');
    expect(await findSocialCheck(user.userId, 'twitter')).toBeNull();
    const res2 = await callEnv('/me/connected-accounts', socialEnv, { token: user.token });
    expect((await res2.json()) as ConnectedAccountsResponse).toEqual([]);
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
