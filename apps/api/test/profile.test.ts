import { SEEDED_TAGS, type ApiErrorBody, type Me, type MyProfile } from '@chatsoon/shared';
import { createExecutionContext, waitOnExecutionContext } from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import { describe, expect, it, vi } from 'vitest';

import { call, signIn, signUpWithProfile } from './helpers';

// Lets a test force slug suffixes to exercise the collision retry. Falls back to random.
// Module mocks only reach an app imported by the test (putProfileDirect), not the Worker behind call().
const { suffixes } = vi.hoisted(() => ({ suffixes: [] as string[] }));
vi.mock('../src/lib/ids', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/lib/ids')>();
  return { ...actual, shortSuffix: () => suffixes.shift() ?? actual.shortSuffix() };
});

/** PUT /me/profile through a freshly imported app, so the ids mock applies. */
async function putProfileDirect(token: string, json: unknown) {
  vi.resetModules();
  const { default: app } = await import('../src/index');
  const ctx = createExecutionContext();
  const req = new Request('http://localhost:8787/me/profile', {
    method: 'PUT',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(json),
  });
  const res = await app.fetch(req, env, ctx);
  await waitOnExecutionContext(ctx);
  return res;
}

const putProfile = (token: string, json: unknown) => call('/me/profile', { method: 'PUT', token, json });

async function saveProfile(token: string, json: unknown): Promise<MyProfile> {
  const res = await putProfile(token, json);
  expect(res.status, await res.clone().text()).toBe(200);
  return (await res.json()) as MyProfile;
}

async function getMe(token: string): Promise<Me> {
  const res = await call('/me', { token });
  expect(res.status).toBe(200);
  return (await res.json()) as Me;
}

async function userName(userId: string) {
  const row = await env.DB.prepare('select name from users where id = ?').bind(userId).first<{ name: string }>();
  return row?.name;
}

async function tagNames(userId: string) {
  const { results } = await env.DB.prepare('select name from tags where user_id = ?')
    .bind(userId)
    .all<{ name: string }>();
  return results.map((r) => r.name).sort();
}

async function putAvatar(userId: string, name = crypto.randomUUID()) {
  const key = `u/${userId}/avatar/${name}.jpg`;
  await env.FILES.put(key, new Uint8Array([1, 2, 3]), { httpMetadata: { contentType: 'image/jpeg' } });
  return key;
}

describe('GET /me', () => {
  it('requires a session', async () => {
    const res = await call('/me');
    expect(res.status).toBe(401);
    const body = (await res.json()) as ApiErrorBody;
    expect(body.error.code).toBe('unauthorized');
  });

  it('returns the user and a null profile before onboarding', async () => {
    const { token, userId } = await signIn('me-new@example.com');
    const res = await call('/me', { token });
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('private, no-store');
    const me = (await res.json()) as Me;
    expect(me.user.id).toBe(userId);
    expect(me.user.email).toBe('me-new@example.com');
    expect(new Date(me.user.createdAt).toISOString()).toBe(me.user.createdAt);
    expect(me.profile).toBeNull();
  });

  it('returns only the caller’s own profile', async () => {
    const a = await signUpWithProfile('me-a@example.com', 'Avery Adams');
    const b = await signUpWithProfile('me-b@example.com', 'Blake Brown');
    const meA = await getMe(a.token);
    const meB = await getMe(b.token);
    expect(meA.profile?.userId).toBe(a.userId);
    expect(meA.profile?.slug).toBe(a.slug);
    expect(meB.profile?.userId).toBe(b.userId);
    expect(meB.profile?.displayName).toBe('Blake Brown');
  });
});

describe('PUT /me/profile', () => {
  it('requires a session', async () => {
    const res = await call('/me/profile', { method: 'PUT', json: { displayName: 'Nobody' } });
    expect(res.status).toBe(401);
  });

  it('validates the body', async () => {
    const { token } = await signIn('validate@example.com');

    const missing = await putProfile(token, { headline: 'Hi' });
    expect(missing.status).toBe(400);
    expect(((await missing.json()) as ApiErrorBody).error.code).toBe('bad_request');

    const blank = await putProfile(token, { displayName: '   ' });
    expect(blank.status).toBe(400);

    const long = await putProfile(token, { displayName: 'x'.repeat(81) });
    expect(long.status).toBe(400);

    const notJson = await call('/me/profile', {
      method: 'PUT',
      token,
      body: 'nope',
      headers: { 'Content-Type': 'application/json' },
    });
    expect(notJson.status).toBe(400);

    // Nothing was created by the failed attempts.
    expect((await getMe(token)).profile).toBeNull();
  });

  it('creates the profile with a slug from the name and syncs users.name', async () => {
    const { token, userId } = await signIn('create@example.com');
    const profile = await saveProfile(token, {
      displayName: '  Péter Bùi ',
      headline: 'Building Chatsoon',
      company: 'Moshi Concepts',
      role: 'Founder',
      links: { x: '@peterbui', telegram: 'peterbui', linkedin: '', website: 'https://chatsoon.app' },
    });
    expect(profile.userId).toBe(userId);
    expect(profile.slug).toMatch(/^peter-bui-[0-9a-f]{8}$/);
    expect(profile.displayName).toBe('Péter Bùi');
    expect(profile.headline).toBe('Building Chatsoon');
    expect(profile.company).toBe('Moshi Concepts');
    expect(profile.role).toBe('Founder');
    // Empty links are dropped rather than stored as ''.
    expect(profile.links).toEqual({ x: '@peterbui', telegram: 'peterbui', website: 'https://chatsoon.app' });
    expect(profile.avatarKey).toBeNull();
    expect(profile.avatarUrl).toBeNull();
    expect(await userName(userId)).toBe('Péter Bùi');

    const me = await getMe(token);
    expect(me.profile).toEqual(profile);
  });

  it('seeds the starter tags on the first save only', async () => {
    const { token, userId } = await signIn('seed-tags@example.com');
    expect(await tagNames(userId)).toEqual([]);

    await saveProfile(token, { displayName: 'Sid Seed' });
    expect(await tagNames(userId)).toEqual([...SEEDED_TAGS].sort());

    // A tag the user deleted stays deleted when they edit their profile later.
    await env.DB.prepare("delete from tags where user_id = ? and name = 'Media'").bind(userId).run();
    await saveProfile(token, { displayName: 'Sid Seedling' });
    expect(await tagNames(userId)).toEqual(SEEDED_TAGS.filter((t) => t !== 'Media').sort());
  });

  it('keeps the slug when the name changes', async () => {
    const { token, userId, slug } = await signUpWithProfile('rename@example.com', 'Riley Reed');
    expect(slug).toMatch(/^riley-reed-[0-9a-f]{8}$/);

    const renamed = await saveProfile(token, { displayName: 'Riley Reed-Smith' });
    expect(renamed.slug).toBe(slug);
    expect(renamed.displayName).toBe('Riley Reed-Smith');
    expect(await userName(userId)).toBe('Riley Reed-Smith');

    const again = await saveProfile(token, { displayName: 'Someone Else Entirely' });
    expect(again.slug).toBe(slug);

    const pub = await call(`/id/${slug}`);
    expect(pub.status).toBe(200);
    expect(((await pub.json()) as { displayName: string }).displayName).toBe('Someone Else Entirely');
  });

  it('keeps fields that are left out and clears fields sent as null or empty', async () => {
    const { token } = await signIn('partial@example.com');
    await saveProfile(token, {
      displayName: 'Parker Page',
      headline: 'Investor',
      company: 'Page Capital',
      role: 'Partner',
      links: { x: 'parker', youtube: 'https://youtube.com/@parker' },
    });

    const kept = await saveProfile(token, { displayName: 'Parker Page' });
    expect(kept.headline).toBe('Investor');
    expect(kept.company).toBe('Page Capital');
    expect(kept.role).toBe('Partner');
    expect(kept.links).toEqual({ x: 'parker', youtube: 'https://youtube.com/@parker' });

    const cleared = await saveProfile(token, { displayName: 'Parker Page', headline: '', company: null });
    expect(cleared.headline).toBeNull();
    expect(cleared.company).toBeNull();
    expect(cleared.role).toBe('Partner');
  });

  it('merges links per key', async () => {
    const { token } = await signIn('links@example.com');
    await saveProfile(token, { displayName: 'Lee Links', links: { x: 'lee', telegram: 'leetg' } });

    const updated = await saveProfile(token, {
      displayName: 'Lee Links',
      links: { telegram: null, linkedin: 'https://linkedin.com/in/lee' },
    });
    expect(updated.links).toEqual({ x: 'lee', linkedin: 'https://linkedin.com/in/lee' });

    const ignored = await saveProfile(token, { displayName: 'Lee Links', links: { mastodon: '@lee' } });
    expect(ignored.links).toEqual({ x: 'lee', linkedin: 'https://linkedin.com/in/lee' });
  });

  it('rejects links that would not open, and saves nothing', async () => {
    const { token } = await signUpWithProfile('bad-links@example.com', 'Bea Links');
    const bad = [
      { x: '@not a handle' },
      { telegram: '+61 400 000 000' },
      { linkedin: 'Bea Links' },
      { website: 'javascript:alert(1)' },
      { youtube: '@My Channel' },
    ];
    for (const links of bad) {
      const res = await putProfile(token, { displayName: 'Renamed', headline: 'Changed', links });
      expect(res.status, JSON.stringify(links)).toBe(400);
      const body = (await res.json()) as ApiErrorBody;
      expect(body.error.code).toBe('bad_request');
      expect(body.error.message).toMatch(/^Check your /);
    }
    const me = await getMe(token);
    expect(me.profile?.displayName).toBe('Bea Links');
    expect(me.profile?.headline).toBeNull();
    expect(me.profile?.links).toEqual({});
  });

  it('accepts the usual ways of typing each link and stores them as typed', async () => {
    const { token } = await signIn('good-links@example.com');
    const links = {
      x: 'https://x.com/bea_x?s=21',
      telegram: 't.me/bea_tg',
      linkedin: 'linkedin.com/in/bea-links',
      website: 'bealinks.dev',
      youtube: 'youtube.com/@bea',
    };
    const profile = await saveProfile(token, { displayName: 'Bea Good', links });
    expect(profile.links).toEqual(links);

    const handles = await saveProfile(token, { displayName: 'Bea Good', links: { x: '@bea_x', telegram: 'bea_tg' } });
    expect(handles.links).toMatchObject({ x: '@bea_x', telegram: 'bea_tg' });
  });

  it('retries with a new suffix when the slug is taken', async () => {
    const first = await signIn('collide-1@example.com');
    suffixes.push('aaaa');
    const firstRes = await putProfileDirect(first.token, { displayName: 'Sam Lee' });
    expect(((await firstRes.json()) as MyProfile).slug).toBe('sam-lee-aaaa');

    const second = await signIn('collide-2@example.com');
    suffixes.push('aaaa', 'aaaa', 'bbbb');
    const secondRes = await putProfileDirect(second.token, { displayName: 'Sam Lee' });
    expect(secondRes.status).toBe(200);
    const profile = (await secondRes.json()) as MyProfile;
    expect(profile.slug).toBe('sam-lee-bbbb');
    expect(profile.userId).toBe(second.userId);
    expect(suffixes).toHaveLength(0);
  });

  it('gives up after five slug collisions', async () => {
    const first = await signIn('collide-3@example.com');
    suffixes.push('cccc');
    expect((await putProfileDirect(first.token, { displayName: 'Casey Cole' })).status).toBe(200);

    const { token } = await signIn('collide-4@example.com');
    suffixes.push('cccc', 'cccc', 'cccc', 'cccc', 'cccc');
    const res = await putProfileDirect(token, { displayName: 'Casey Cole' });
    expect(res.status).toBe(500);
    expect(((await res.json()) as ApiErrorBody).error.code).toBe('internal');
    expect(suffixes).toHaveLength(0);
    expect((await getMe(token)).profile).toBeNull();
  });

  it('rejects an avatar key that belongs to another user', async () => {
    const owner = await signUpWithProfile('avatar-owner@example.com', 'Olive Owner');
    const theirKey = await putAvatar(owner.userId);
    const thief = await signUpWithProfile('avatar-thief@example.com', 'Theo Thief');

    const res = await putProfile(thief.token, { displayName: 'Theo Thief', avatarKey: theirKey });
    expect(res.status).toBe(400);
    expect(((await res.json()) as ApiErrorBody).error.code).toBe('bad_request');
    expect((await getMe(thief.token)).profile?.avatarKey).toBeNull();

    // Also rejected on the very first save.
    const fresh = await signIn('avatar-fresh@example.com');
    const first = await putProfile(fresh.token, { displayName: 'Fresh Face', avatarKey: theirKey });
    expect(first.status).toBe(400);
    expect((await getMe(fresh.token)).profile).toBeNull();
  });

  it('rejects path tricks, card photos and keys that were never uploaded', async () => {
    const { token, userId } = await signUpWithProfile('avatar-rules@example.com', 'Rae Rules');
    const tricks = [
      `u/${userId}/avatar/../../other/avatar/x.jpg`,
      `u/${userId}/card/${crypto.randomUUID()}.jpg`,
      `u/${userId}/avatar/${crypto.randomUUID()}.jpg`,
    ];
    await env.FILES.put(tricks[1]!, new Uint8Array([1]));
    for (const avatarKey of tricks) {
      const res = await putProfile(token, { displayName: 'Rae Rules', avatarKey });
      expect(res.status, avatarKey).toBe(400);
    }
  });

  it('sets, replaces and removes the avatar, deleting old files', async () => {
    const { token, userId, slug } = await signUpWithProfile('avatar@example.com', 'Ava Tar');
    const firstKey = await putAvatar(userId);

    const withAvatar = await saveProfile(token, { displayName: 'Ava Tar', avatarKey: firstKey });
    expect(withAvatar.avatarKey).toBe(firstKey);
    expect(withAvatar.avatarUrl).toContain('/files/u/');
    expect(withAvatar.avatarUrl).toMatch(/[?&]sig=[0-9a-f]{64}/);

    // Saving without avatarKey keeps it.
    const kept = await saveProfile(token, { displayName: 'Ava Tar', headline: 'Hello' });
    expect(kept.avatarKey).toBe(firstKey);
    expect(await env.FILES.head(firstKey)).not.toBeNull();

    const secondKey = await putAvatar(userId);
    const replaced = await saveProfile(token, { displayName: 'Ava Tar', avatarKey: secondKey });
    expect(replaced.avatarKey).toBe(secondKey);
    expect(replaced.slug).toBe(slug);
    await vi.waitFor(async () => expect(await env.FILES.head(firstKey)).toBeNull());

    const removed = await saveProfile(token, { displayName: 'Ava Tar', avatarKey: null });
    expect(removed.avatarKey).toBeNull();
    expect(removed.avatarUrl).toBeNull();
    await vi.waitFor(async () => expect(await env.FILES.head(secondKey)).toBeNull());
  });

  it('treats an empty avatarKey as removing the photo', async () => {
    const { token, userId } = await signUpWithProfile('avatar-empty@example.com', 'Eve Empty');
    const key = await putAvatar(userId);
    await saveProfile(token, { displayName: 'Eve Empty', avatarKey: key });

    const removed = await saveProfile(token, { displayName: 'Eve Empty', avatarKey: '' });
    expect(removed.avatarKey).toBeNull();
    expect(removed.avatarUrl).toBeNull();
    await vi.waitFor(async () => expect(await env.FILES.head(key)).toBeNull());
    const row = await env.DB.prepare('select avatar_key from profiles where user_id = ?')
      .bind(userId)
      .first<{ avatar_key: string | null }>();
    expect(row?.avatar_key).toBeNull();
  });
});
