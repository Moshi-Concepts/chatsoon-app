import {
  BOOKING_URL_HINT,
  CONTACT_HINTS,
  SEEDED_TAGS,
  type ApiErrorBody,
  type BookingLink,
  type Me,
  type MyProfile,
  type ProfileContactKey,
} from '@chatsoon/shared';
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
    // Empty links are dropped rather than stored as ''. x is canonicalised (no leading '@').
    expect(profile.links).toEqual({ x: 'peterbui', telegram: 'peterbui', website: 'https://chatsoon.app' });
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
    // youtube is canonicalised to its https://www... form.
    expect(kept.links).toEqual({ x: 'parker', youtube: 'https://www.youtube.com/@parker' });

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
    // Canonicalised on save (issue #18): the LinkedIn URL gets its 'www.'.
    expect(updated.links).toEqual({ x: 'lee', linkedin: 'https://www.linkedin.com/in/lee' });

    const ignored = await saveProfile(token, { displayName: 'Lee Links', links: { mastodon: '@lee' } });
    expect(ignored.links).toEqual({ x: 'lee', linkedin: 'https://www.linkedin.com/in/lee' });
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

  it('accepts the usual ways of typing each link, canonicalising them on save', async () => {
    const { token } = await signIn('good-links@example.com');
    const links = {
      x: 'https://x.com/bea_x?s=21',
      telegram: 't.me/bea_tg',
      linkedin: 'linkedin.com/in/bea-links',
      website: 'bealinks.dev',
      youtube: 'youtube.com/@bea',
    };
    const profile = await saveProfile(token, { displayName: 'Bea Good', links });
    // A pasted URL is reduced to a bare handle for x/telegram, and to the canonical https://www...
    // form for linkedin/youtube. Website has no canonical reduction, so it's kept as typed.
    expect(profile.links).toEqual({
      x: 'bea_x',
      telegram: 'bea_tg',
      linkedin: 'https://www.linkedin.com/in/bea-links',
      website: 'bealinks.dev',
      youtube: 'https://www.youtube.com/@bea',
    });

    const handles = await saveProfile(token, { displayName: 'Bea Good', links: { x: '@bea_x', telegram: 'bea_tg' } });
    expect(handles.links).toMatchObject({ x: 'bea_x', telegram: 'bea_tg' });
  });

  it('cleans tracking params from a pasted link and reduces it to canonical form (issue #18)', async () => {
    const { token } = await signIn('tracked-links@example.com');
    const profile = await saveProfile(token, {
      displayName: 'Tia Tracked',
      links: {
        // A YouTube channel URL shared from the app carries a '?si=' tracking id.
        youtube: 'https://www.youtube.com/@tiatracked?si=aBcDeFgHiJ',
        // An X profile URL shared from the app carries a '?s=20' tracking param.
        x: 'https://x.com/tiatracked?s=20',
      },
    });
    expect(profile.links?.youtube).toBe('https://www.youtube.com/@tiatracked');
    expect(profile.links?.x).toBe('tiatracked');
  });

  describe('discord (issue #21)', () => {
    it('stores a username lowercased', async () => {
      const { token, slug } = await signUpWithProfile('discord-username@example.com', 'Dee User');
      const profile = await saveProfile(token, { displayName: 'Dee User', links: { discord: 'PeterBui' } });
      expect(profile.links?.discord).toBe('peterbui');

      const pub = (await (await call(`/id/${slug}`)).json()) as { links?: { discord?: string } };
      expect(pub.links?.discord).toBe('peterbui');
    });

    it('strips a leading @ from a username', async () => {
      const { token } = await signIn('discord-at@example.com');
      const profile = await saveProfile(token, { displayName: 'Dee At', links: { discord: '@peterbui' } });
      expect(profile.links?.discord).toBe('peterbui');
    });

    it('accepts a numeric user id', async () => {
      const { token } = await signIn('discord-id@example.com');
      const profile = await saveProfile(token, {
        displayName: 'Dee Id',
        links: { discord: '123456789012345678' },
      });
      expect(profile.links?.discord).toBe('123456789012345678');
    });

    it('reduces a pasted profile URL (discord.com or discordapp.com) to the bare id', async () => {
      const { token } = await signIn('discord-url@example.com');
      const profile = await saveProfile(token, {
        displayName: 'Dee Url',
        links: { discord: 'https://discordapp.com/users/123456789012345678' },
      });
      expect(profile.links?.discord).toBe('123456789012345678');
    });

    it('accepts a legacy name#1234 discriminator, stored as typed', async () => {
      const { token } = await signIn('discord-discriminator@example.com');
      const profile = await saveProfile(token, {
        displayName: 'Dee Legacy',
        links: { discord: 'PeterBui#1234' },
      });
      expect(profile.links?.discord).toBe('PeterBui#1234');
    });

    it('rejects a server invite with its own hint, and saves nothing', async () => {
      const { token } = await signUpWithProfile('discord-invite@example.com', 'Dee Invite');
      for (const invite of ['https://discord.gg/abc123', 'https://discord.com/invite/abc123']) {
        const res = await putProfile(token, { displayName: 'Dee Invite', links: { discord: invite } });
        expect(res.status, invite).toBe(400);
        const body = (await res.json()) as ApiErrorBody;
        expect(body.error.code).toBe('bad_request');
        expect(body.error.message).toBe('Add your Discord username, not a server invite');
      }
      expect((await getMe(token)).profile?.links).toEqual({});
    });

    it('rejects a value that is not a username, id or discriminator', async () => {
      const { token } = await signIn('discord-bad@example.com');
      const res = await putProfile(token, { displayName: 'Dee Bad', links: { discord: 'not a discord handle!' } });
      expect(res.status).toBe(400);
      const body = (await res.json()) as ApiErrorBody;
      expect(body.error.code).toBe('bad_request');
      expect(body.error.message).toBe('Add your Discord username (e.g. peterbui) or user ID');
    });
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

  describe('booking links', () => {
    const PETE_LINKS: BookingLink[] = [
      { url: 'https://calendly.com/chatwithpete/crypto-chat', label: 'Crypto chat', provider: 'calendly' },
      { url: 'https://calendly.com/chatwithpete/30min', label: '30 min', provider: 'calendly' },
    ];

    it('saves canonical urls, labels and provider, visible from PUT, GET /me and GET /id/:slug', async () => {
      const { token, slug } = await signUpWithProfile('booking-pete@example.com', 'Pete Booker');
      const saved = await saveProfile(token, {
        displayName: 'Pete Booker',
        bookingLinks: [
          { url: 'https://calendly.com/chatwithpete/crypto-chat?back=1&month=2026-09' },
          { url: 'https://calendly.com/chatwithpete/30min?back=1&month=2026-09' },
        ],
      });
      expect(saved.bookingLinks).toEqual(PETE_LINKS);
      expect((await getMe(token)).profile?.bookingLinks).toEqual(PETE_LINKS);

      const pub = (await (await call(`/id/${slug}`)).json()) as { bookingLinks: BookingLink[] };
      expect(pub.bookingLinks).toEqual(PETE_LINKS);
    });

    it('keeps booking links when the field is left out, and clears them with []', async () => {
      const { token } = await signUpWithProfile('booking-keep@example.com', 'Casey Keep');
      await saveProfile(token, { displayName: 'Casey Keep', bookingLinks: [{ url: PETE_LINKS[1]!.url }] });

      const kept = await saveProfile(token, { displayName: 'Casey Keep' });
      expect(kept.bookingLinks).toEqual([PETE_LINKS[1]]);

      const cleared = await saveProfile(token, { displayName: 'Casey Keep', bookingLinks: [] });
      expect(cleared.bookingLinks).toEqual([]);
    });

    it('returns [] for a new profile that never set booking links', async () => {
      const { token } = await signUpWithProfile('booking-none@example.com', 'Nora None');
      expect((await getMe(token)).profile?.bookingLinks).toEqual([]);
    });

    it('rejects an unsupported booking url with the hint message, and saves nothing', async () => {
      const { token } = await signUpWithProfile('booking-bad-url@example.com', 'Uma Unsupported');
      const res = await putProfile(token, {
        displayName: 'Uma Unsupported',
        bookingLinks: [{ url: 'https://example.com/book' }],
      });
      expect(res.status).toBe(400);
      const body = (await res.json()) as ApiErrorBody;
      expect(body.error.code).toBe('bad_request');
      expect(body.error.message).toContain(BOOKING_URL_HINT);
      expect((await getMe(token)).profile?.bookingLinks).toEqual([]);
    });

    it('rejects more than 5 booking links', async () => {
      const { token } = await signUpWithProfile('booking-max@example.com', 'Max Links');
      const bookingLinks = Array.from({ length: 6 }, (_, i) => ({ url: `https://cal.com/max/event-${i}` }));
      const res = await putProfile(token, { displayName: 'Max Links', bookingLinks });
      expect(res.status).toBe(400);
      expect(((await res.json()) as ApiErrorBody).error.message).toContain('Add up to 5 booking links');
    });

    it('rejects duplicate booking links (same canonical url)', async () => {
      const { token } = await signUpWithProfile('booking-dup@example.com', 'Dana Dup');
      const res = await putProfile(token, {
        displayName: 'Dana Dup',
        bookingLinks: [{ url: 'https://calendly.com/dana/intro' }, { url: 'https://calendly.com/dana/intro?month=2026-09' }],
      });
      expect(res.status).toBe(400);
      expect(((await res.json()) as ApiErrorBody).error.message).toContain("You've added this booking link already");
    });

    it('rejects an offensive label', async () => {
      const { token } = await signUpWithProfile('booking-offensive@example.com', 'Olive Offensive');
      const res = await putProfile(token, {
        displayName: 'Olive Offensive',
        bookingLinks: [{ url: 'https://cal.com/olive', label: 'fuck off' }],
      });
      expect(res.status).toBe(400);
      expect(((await res.json()) as ApiErrorBody).error.message).toContain('Please remove offensive language');
    });

    it('drops a stored link whose url no longer parses, on read', async () => {
      const { token, userId, slug } = await signUpWithProfile('booking-stale@example.com', 'Stan Stale');
      await saveProfile(token, { displayName: 'Stan Stale', bookingLinks: [{ url: 'https://calendly.com/stan/chat' }] });
      // A row from before a provider's rules tightened, or one edited directly: not something the API would write.
      await env.DB.prepare('update profiles set booking_links = ? where user_id = ?')
        .bind(
          JSON.stringify([
            { label: 'Chat with Stan', url: 'https://calendly.com/stan/chat' },
            { label: 'Gone', url: 'https://not-a-booking-host.example/x' },
          ]),
          userId,
        )
        .run();

      const me = await getMe(token);
      expect(me.profile?.bookingLinks).toEqual([
        { label: 'Chat with Stan', url: 'https://calendly.com/stan/chat', provider: 'calendly' },
      ]);
      const pub = (await (await call(`/id/${slug}`)).json()) as { bookingLinks: BookingLink[] };
      expect(pub.bookingLinks).toEqual([
        { label: 'Chat with Stan', url: 'https://calendly.com/stan/chat', provider: 'calendly' },
      ]);
    });
  });

  describe('contact (phone, WhatsApp, Signal)', () => {
    it('round trips through PUT and GET /me, stored as typed', async () => {
      const { token } = await signUpWithProfile('contact-roundtrip@example.com', 'Cara Roundtrip');
      const contact = { phone: '+61 491 570 156', whatsapp: 'https://wa.me/61491570156', signal: '+61 491 570 156' };
      const saved = await saveProfile(token, { displayName: 'Cara Roundtrip', contact, contactVisibility: 'public' });
      expect(saved.contact).toEqual(contact);
      expect(saved.contactVisibility).toBe('public');
      expect(saved.contactChannels).toEqual(['phone', 'whatsapp', 'signal']);

      const me = await getMe(token);
      expect(me.profile?.contact).toEqual(contact);
      expect(me.profile?.contactVisibility).toBe('public');
      expect(me.profile?.contactChannels).toEqual(['phone', 'whatsapp', 'signal']);
    });

    it('keeps contact and contactVisibility through the exact 1.0 body, and through displayName alone', async () => {
      const { token } = await signUpWithProfile('contact-1-0@example.com', 'Ivy OneZero');
      await saveProfile(token, {
        displayName: 'Ivy OneZero',
        contact: { phone: '+61 491 570 156' },
        contactVisibility: 'public',
      });

      const full1_0 = await saveProfile(token, {
        displayName: 'Ivy OneZero',
        headline: 'Hi',
        company: 'Acme',
        role: 'Founder',
        links: { x: null, telegram: 't_user', linkedin: null, website: null, youtube: null },
        avatarKey: null,
      });
      expect(full1_0.contact).toEqual({ phone: '+61 491 570 156' });
      expect(full1_0.contactVisibility).toBe('public');

      const nameOnly = await saveProfile(token, { displayName: 'Ivy OneZero' });
      expect(nameOnly.contact).toEqual({ phone: '+61 491 570 156' });
      expect(nameOnly.contactVisibility).toBe('public');
    });

    it('removes only the targeted key, with null or with an empty string', async () => {
      const { token } = await signUpWithProfile('contact-remove@example.com', 'Remy Remove');
      await saveProfile(token, {
        displayName: 'Remy Remove',
        contact: { phone: '+61 491 570 156', whatsapp: '+61 491 570 156' },
      });

      const removedByNull = await saveProfile(token, { displayName: 'Remy Remove', contact: { phone: null } });
      expect(removedByNull.contact).toEqual({ whatsapp: '+61 491 570 156' });

      await saveProfile(token, { displayName: 'Remy Remove', contact: { phone: '+61 491 570 156' } });
      const removedByEmpty = await saveProfile(token, { displayName: 'Remy Remove', contact: { phone: '' } });
      expect(removedByEmpty.contact).toEqual({ whatsapp: '+61 491 570 156' });
    });

    it('rejects each bad value with its hint, saves nothing, and leaves GET /me unchanged', async () => {
      const { token } = await signUpWithProfile('contact-bad@example.com', 'Bailey Bad');
      await saveProfile(token, { displayName: 'Bailey Bad', contact: { phone: '+61 491 570 156' } });

      const bad: [ProfileContactKey, string][] = [
        ['phone', '0491 570 156'],
        ['whatsapp', 'chat.whatsapp.com/AbC'],
        ['signal', 'peter.42'],
      ];
      for (const [key, value] of bad) {
        const res = await putProfile(token, { displayName: 'Bailey Bad', contact: { [key]: value } });
        expect(res.status, `${key}: ${value}`).toBe(400);
        const body = (await res.json()) as ApiErrorBody;
        expect(body.error.code).toBe('bad_request');
        expect(body.error.message).toContain(CONTACT_HINTS[key]);
      }

      const me = await getMe(token);
      expect(me.profile?.contact).toEqual({ phone: '+61 491 570 156' });
    });

    it('rejects an unknown contactVisibility value', async () => {
      const { token } = await signUpWithProfile('contact-visibility-bad@example.com', 'Val Visibility');
      const res = await putProfile(token, { displayName: 'Val Visibility', contactVisibility: 'everyone' });
      expect(res.status).toBe(400);
      expect(((await res.json()) as ApiErrorBody).error.code).toBe('bad_request');
    });

    it('defaults a new profile to connections visibility with no channels', async () => {
      const { token } = await signUpWithProfile('contact-new@example.com', 'Nadia New');
      const me = await getMe(token);
      expect(me.profile?.contactVisibility).toBe('connections');
      expect(me.profile?.contactChannels).toEqual([]);
      expect(me.profile?.contact).toEqual({});
    });

    it('never exposes contact digits to an anonymous viewer of a connections profile', async () => {
      const { token, slug } = await signUpWithProfile('contact-private@example.com', 'Percy Private');
      await saveProfile(token, { displayName: 'Percy Private', contact: { phone: '+61 491 570 156' } });

      const res = await call(`/id/${slug}`);
      expect(res.status).toBe(200);
      const text = await res.text();
      expect(text).not.toContain('491570156');
      expect(text).not.toContain('491 570 156');
      const body = JSON.parse(text) as Record<string, unknown>;
      expect(body).not.toHaveProperty('contact');
      expect(body.contactChannels).toEqual(['phone']);
      expect(body.contactVisibility).toBe('connections');
    });
  });

  describe('search visibility (Stage D)', () => {
    async function searchVisibleAtRow(userId: string) {
      const row = await env.DB.prepare('select search_visible_at from profiles where user_id = ?')
        .bind(userId)
        .first<{ search_visible_at: number | null }>();
      return row?.search_visible_at ?? null;
    }

    it('defaults to off, and is off by default for existing and new profiles', async () => {
      const { token } = await signUpWithProfile('search-default@example.com', 'Sasha Default');
      const me = await getMe(token);
      expect(me.profile?.searchVisible).toBe(false);
    });

    it('is kept by a PUT that leaves it out, even for a 1.0 client that never sends it', async () => {
      const { token } = await signUpWithProfile('search-keep@example.com', 'Kai Keep');
      const on = await saveProfile(token, { displayName: 'Kai Keep', searchVisible: true });
      expect(on.searchVisible).toBe(true);

      // A save with no searchVisible at all (the exact 1.0 body) must never reset it.
      const kept = await saveProfile(token, { displayName: 'Kai Keep', headline: 'Still on' });
      expect(kept.searchVisible).toBe(true);
    });

    it('sets search_visible_at only when the value actually changes', async () => {
      const { token, userId } = await signUpWithProfile('search-consent@example.com', 'Cass Consent');
      expect(await searchVisibleAtRow(userId)).toBeNull();

      const turnedOn = await saveProfile(token, { displayName: 'Cass Consent', searchVisible: true });
      expect(turnedOn.searchVisible).toBe(true);
      const stampedOn = await searchVisibleAtRow(userId);
      expect(stampedOn).not.toBeNull();

      // Same value again: the consent trail must not move.
      await saveProfile(token, { displayName: 'Cass Consent', searchVisible: true });
      expect(await searchVisibleAtRow(userId)).toBe(stampedOn);

      // A save that leaves it out entirely (keeps the current value) must not move it either.
      await saveProfile(token, { displayName: 'Cass Consent', headline: 'Unrelated edit' });
      expect(await searchVisibleAtRow(userId)).toBe(stampedOn);

      // Turning it off changes the value, so the trail moves again.
      await new Promise((r) => setTimeout(r, 5));
      const turnedOff = await saveProfile(token, { displayName: 'Cass Consent', searchVisible: false });
      expect(turnedOff.searchVisible).toBe(false);
      const stampedOff = await searchVisibleAtRow(userId);
      expect(stampedOff).not.toBeNull();
      expect(stampedOff).not.toBe(stampedOn);
    });

    it('shows searchVisible on GET /me', async () => {
      const { token } = await signUpWithProfile('search-me@example.com', 'Mia Me');
      await saveProfile(token, { displayName: 'Mia Me', searchVisible: true });
      const me = await getMe(token);
      expect(me.profile?.searchVisible).toBe(true);
    });

    it('never appears on the public GET /id/:slug response', async () => {
      const { token, slug } = await signUpWithProfile('search-public@example.com', 'Pia Public');
      await saveProfile(token, { displayName: 'Pia Public', searchVisible: true });
      const body = (await (await call(`/id/${slug}`)).json()) as Record<string, unknown>;
      expect(body).not.toHaveProperty('searchVisible');
    });
  });

});
