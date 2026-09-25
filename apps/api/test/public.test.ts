import type { ApiErrorBody, ConnectFormResponse, PublicProfile } from '@chatsoon/shared';
import { createExecutionContext, waitOnExecutionContext } from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { capturedEmails } from '../src/lib/email';
import { contactFieldsFromConnectValue } from '../src/lib/profiles';
import { TURNSTILE_VERIFY_URL } from '../src/lib/turnstile';
import { CONNECT_EMAILS_PER_DAY } from '../src/routes/public';
import { call, signIn, signUpWithProfile } from './helpers';

type Session = Awaited<ReturnType<typeof signUpWithProfile>>;
type ContactDbRow = {
  user_id: string;
  name: string;
  email: string | null;
  phone: string | null;
  telegram: string | null;
  x_handle: string | null;
  linkedin_url: string | null;
  website: string | null;
  notes: string | null;
  source: string;
  linked_user_id: string | null;
};

const OWNER_EMAIL = 'owner-public@example.com';
const OWNER_LINKS = {
  x: '@olivia',
  telegram: 'olivia_tg',
  linkedin: 'https://linkedin.com/in/olivia',
  website: 'https://olivia.dev',
};
// PUT /me/profile canonicalises links on save (issue #18): the '@' is dropped and the LinkedIn URL
// gets its 'www.', so what's read back differs from what was sent in OWNER_LINKS above.
const OWNER_LINKS_STORED = {
  x: 'olivia',
  telegram: 'olivia_tg',
  linkedin: 'https://www.linkedin.com/in/olivia',
  website: 'https://olivia.dev',
};

let owner: Session;
let viewer: Session;

async function contactsOf(userId: string) {
  const { results } = await env.DB.prepare('select * from contacts where user_id = ? order by created_at')
    .bind(userId)
    .all<ContactDbRow>();
  return results;
}

async function block(blockerId: string, blockedId: string) {
  await env.DB.prepare('insert into blocks (blocker_id, blocked_id) values (?, ?)').bind(blockerId, blockedId).run();
}

async function putProfile(token: string, json: unknown) {
  const res = await call('/me/profile', { method: 'PUT', token, json });
  expect(res.status, await res.clone().text()).toBe(200);
  return res;
}

/** Flips one hex character so a signature or key stops matching, without ever landing back on itself. */
function tamper(hex: string): string {
  const last = hex.at(-1) ?? '0';
  return hex.slice(0, -1) + (last === '0' ? '1' : '0');
}

// Turnstile siteverify is stubbed so tests never depend on the network. `turnstilePasses`
// controls the verdict and `siteverifyForms` records what the Worker sent.
const realFetch = globalThis.fetch;
let turnstilePasses = true;
let siteverifyForms: FormData[] = [];

beforeEach(() => {
  turnstilePasses = true;
  siteverifyForms = [];
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = input instanceof Request ? input.url : String(input);
    if (url === TURNSTILE_VERIFY_URL) {
      siteverifyForms.push(init?.body as FormData);
      const errorCodes = turnstilePasses ? [] : ['invalid-input-response'];
      return Response.json({ success: turnstilePasses, 'error-codes': errorCodes });
    }
    return realFetch(input, init);
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

beforeAll(async () => {
  owner = await signUpWithProfile(OWNER_EMAIL, 'Olivia Owner');
  const res = await call('/me/profile', {
    method: 'PUT',
    token: owner.token,
    json: {
      displayName: 'Olivia Owner',
      headline: 'Partnerships at Chatsoon',
      company: 'Chatsoon',
      role: 'Head of Partnerships',
      links: OWNER_LINKS,
    },
  });
  expect(res.status).toBe(200);
  viewer = await signUpWithProfile('viewer-public@example.com', 'Victor Viewer');
});

describe('GET /id/:slug', () => {
  it('tells a signed-in viewer whether they blocked this person, and nobody else', async () => {
    const blocker = await signUpWithProfile('blockedbyme-a@example.com', 'Bea Blocker');
    const other = await signUpWithProfile('blockedbyme-b@example.com', 'Otto Other');
    await block(blocker.userId, owner.userId);

    const asBlocker = (await (await call(`/id/${owner.slug}`, { token: blocker.token })).json()) as PublicProfile;
    expect(asBlocker.blockedByMe).toBe(true);
    const asOther = (await (await call(`/id/${owner.slug}`, { token: other.token })).json()) as PublicProfile;
    expect(asOther.blockedByMe).toBe(false);
    const anonymous = (await (await call(`/id/${owner.slug}`)).json()) as PublicProfile;
    expect(anonymous).not.toHaveProperty('blockedByMe');
    const self = (await (await call(`/id/${owner.slug}`, { token: owner.token })).json()) as PublicProfile;
    expect(self).not.toHaveProperty('blockedByMe');

    // Unblock by slug clears it.
    expect((await call(`/blocks/${owner.slug}`, { method: 'DELETE', token: blocker.token })).status).toBe(204);
    const after = (await (await call(`/id/${owner.slug}`, { token: blocker.token })).json()) as PublicProfile;
    expect(after.blockedByMe).toBe(false);
  });

  it('returns the public profile without the email or private fields', async () => {
    const res = await call(`/id/${owner.slug}`);
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).not.toContain(OWNER_EMAIL);
    expect(text).not.toContain('@example.com');

    const profile = JSON.parse(text) as PublicProfile & Record<string, unknown>;
    expect(profile).toEqual({
      slug: owner.slug,
      displayName: 'Olivia Owner',
      headline: 'Partnerships at Chatsoon',
      company: 'Chatsoon',
      role: 'Head of Partnerships',
      links: OWNER_LINKS_STORED,
      avatarUrl: null,
      bookingLinks: [],
      contactChannels: [],
      contactVisibility: 'connections',
      badges: [],
    });
    expect(profile).not.toHaveProperty('email');
    expect(profile).not.toHaveProperty('userId');
    expect(profile).not.toHaveProperty('avatarKey');
  });

  it('is cacheable when anonymous and private when signed in', async () => {
    const anon = await call(`/id/${owner.slug}`);
    expect(anon.headers.get('cache-control')).toBe('public, max-age=60');
    expect(anon.headers.get('vary')).toMatch(/authorization/i);
    expect(anon.headers.get('vary')).toMatch(/cookie/i);

    const authed = await call(`/id/${owner.slug}`, { token: viewer.token });
    expect(authed.status).toBe(200);
    expect(authed.headers.get('cache-control')).toBe('private, no-store');
  });

  it('matches the slug case-insensitively', async () => {
    const res = await call(`/id/${owner.slug.toUpperCase()}`);
    expect(res.status).toBe(200);
    expect(((await res.json()) as PublicProfile).slug).toBe(owner.slug);
  });

  it('returns 404 for unknown and malformed slugs', async () => {
    for (const slug of ['nobody-here-0000', 'bad_slug!', '-dash-', encodeURIComponent('a'.repeat(101))]) {
      const res = await call(`/id/${slug}`);
      expect(res.status, slug).toBe(404);
      expect(((await res.json()) as ApiErrorBody).error.code).toBe('not_found');
    }
  });

  it('rate limits lookups that find nothing per IP, never ones that find a profile', { timeout: 30_000 }, async () => {
    const intoWindow = Date.now() % 60_000;
    if (intoWindow > 45_000) await new Promise((r) => setTimeout(r, 60_000 - intoWindow + 250));
    const ip = { 'cf-connecting-ip': '203.0.113.60' };
    const base = owner.slug.replace(/-[0-9a-f]+$/, '');
    for (let i = 0; i < 60; i++) {
      const res = await call(`/id/${base}-${i.toString(16).padStart(8, '0')}`, { headers: ip });
      expect(res.status).toBe(404);
    }
    const guess = await call(`/id/${base}-ffffffff`, { headers: ip });
    expect(guess.status).toBe(429);
    expect((await call(`/id/${base}-ffffffff/vcard`, { headers: ip })).status).toBe(429);

    // A real profile still loads from that IP, and other IPs can still miss.
    expect((await call(`/id/${owner.slug}`, { headers: ip })).status).toBe(200);
    expect((await call(`/id/${base}-ffffffff`, { headers: { 'cf-connecting-ip': '203.0.113.61' } })).status).toBe(404);
  });

  it('returns a signed avatar URL but never the R2 key', async () => {
    const person = await signUpWithProfile('avatar-public@example.com', 'Ada Avatar');
    const key = `u/${person.userId}/avatar/${crypto.randomUUID()}.jpg`;
    await env.FILES.put(key, new Uint8Array([1, 2, 3]));
    const put = await call('/me/profile', {
      method: 'PUT',
      token: person.token,
      json: { displayName: 'Ada Avatar', avatarKey: key },
    });
    expect(put.status).toBe(200);

    const res = await call(`/id/${person.slug}`);
    const profile = (await res.json()) as PublicProfile & Record<string, unknown>;
    expect(profile.avatarUrl).toContain('/files/u/');
    expect(profile.avatarUrl).toMatch(/[?&]exp=\d+&sig=[0-9a-f]{64}$/);
    expect(profile).not.toHaveProperty('avatarKey');
  });

  it('returns 404 to a viewer the owner has blocked, and only to them', async () => {
    const target = await signUpWithProfile('blocker-public@example.com', 'Bea Blocker');
    const blocked = await signUpWithProfile('blocked-public@example.com', 'Bo Blocked');
    await block(target.userId, blocked.userId);

    const hidden = await call(`/id/${target.slug}`, { token: blocked.token });
    expect(hidden.status).toBe(404);
    expect(hidden.headers.get('cache-control')).toBeNull();
    expect(((await hidden.json()) as ApiErrorBody).error.code).toBe('not_found');

    const vcard = await call(`/id/${target.slug}/vcard`, { token: blocked.token });
    expect(vcard.status).toBe(404);

    // Anonymous visitors, other users and the owner still see it.
    expect((await call(`/id/${target.slug}`)).status).toBe(200);
    expect((await call(`/id/${target.slug}`, { token: viewer.token })).status).toBe(200);
    expect((await call(`/id/${target.slug}`, { token: target.token })).status).toBe(200);
    // The block is one way: the owner can still see the blocked user's profile.
    expect((await call(`/id/${blocked.slug}`, { token: target.token })).status).toBe(200);
  });

  it('treats an invalid token as anonymous', async () => {
    const res = await call(`/id/${owner.slug}`, { token: 'not-a-real-token' });
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('public, max-age=60');
  });
});

describe('contact on GET /id/:slug (§2, §3 of the plan)', () => {
  /** A fresh profile with one usable channel, at the given visibility (default 'connections'). */
  async function ownerWithPhone(email: string, name: string, visibility: 'connections' | 'public' = 'connections') {
    const person = await signUpWithProfile(email, name);
    await putProfile(person.token, {
      displayName: name,
      contact: { phone: '+61 491 570 156' },
      contactVisibility: visibility,
    });
    return person;
  }

  it('gives an anonymous viewer of a connections profile no contact or vcardUrl, and no digits anywhere', async () => {
    const person = await ownerWithPhone('contact-conn-anon@example.com', 'Cara Connections');
    const res = await call(`/id/${person.slug}`);
    expect(res.headers.get('cache-control')).toBe('public, max-age=60');
    const text = await res.text();
    expect(text).not.toContain('491570156');
    expect(text).not.toContain('491 570 156');

    const body = JSON.parse(text) as PublicProfile;
    expect(body).not.toHaveProperty('contact');
    expect(body).not.toHaveProperty('vcardUrl');
    expect(body.contactChannels).toEqual(['phone']);
    expect(body.contactVisibility).toBe('connections');
  });

  it('gives an anonymous viewer of a public profile the contact, dropping a legacy invalid value written straight to D1', async () => {
    const person = await ownerWithPhone('contact-pub-anon@example.com', 'Priya Public', 'public');
    // A hand-edited row: a bare Signal username, which never passes contactUrl.
    await env.DB.prepare('update profiles set contact = ? where user_id = ?')
      .bind(JSON.stringify({ phone: '+61 491 570 156', signal: 'peter.42' }), person.userId)
      .run();

    const body = (await (await call(`/id/${person.slug}`)).json()) as PublicProfile;
    expect(body.contact).toEqual({ phone: '+61 491 570 156' });
    expect(body.contactChannels).toEqual(['phone']);
    // vcardUrl only ever accompanies a 'connections' profile: a public one's plain vcard already has it.
    expect(body).not.toHaveProperty('vcardUrl');
  });

  it('gives a signed-in stranger no contact', async () => {
    const person = await ownerWithPhone('contact-stranger-owner@example.com', 'Sol Stranger');
    const stranger = await signUpWithProfile('contact-stranger@example.com', 'Sam Stranger');
    const body = (await (await call(`/id/${person.slug}`, { token: stranger.token })).json()) as PublicProfile;
    expect(body).not.toHaveProperty('contact');
    expect(body).not.toHaveProperty('vcardUrl');
  });

  it('gives an accepted connection the contact and a signed vcardUrl, cached private, no-store', async () => {
    const person = await ownerWithPhone('contact-friend-owner@example.com', 'Fay Owner');
    const friend = await signUpWithProfile('contact-friend@example.com', 'Fern Friend');
    expect((await call('/connections/scan', { method: 'POST', token: friend.token, json: { slug: person.slug } })).status).toBe(200);

    const res = await call(`/id/${person.slug}`, { token: friend.token });
    expect(res.headers.get('cache-control')).toBe('private, no-store');
    const body = (await res.json()) as PublicProfile;
    expect(body.contact).toEqual({ phone: '+61 491 570 156' });
    expect(body.vcardUrl).toMatch(new RegExp(`/id/${person.slug}/vcard\\?exp=\\d+&sig=[0-9a-f]{64}$`));
  });

  it('takes the contact away once the viewer blocks the owner', async () => {
    const person = await ownerWithPhone('contact-blockee-owner@example.com', 'Bo Owner');
    const friend = await signUpWithProfile('contact-blocker-friend@example.com', 'Bea Friend');
    await call('/connections/scan', { method: 'POST', token: friend.token, json: { slug: person.slug } });
    const before = (await (await call(`/id/${person.slug}`, { token: friend.token })).json()) as PublicProfile;
    expect(before.contact).toEqual({ phone: '+61 491 570 156' });

    await block(friend.userId, person.userId);
    const after = (await (await call(`/id/${person.slug}`, { token: friend.token })).json()) as PublicProfile;
    expect(after).not.toHaveProperty('contact');
    expect(after).not.toHaveProperty('vcardUrl');
  });

  it('gives the owner their own contact viewing their own profile', async () => {
    const person = await ownerWithPhone('contact-self-owner@example.com', 'Selma Self');
    const body = (await (await call(`/id/${person.slug}`, { token: person.token })).json()) as PublicProfile;
    expect(body.contact).toEqual({ phone: '+61 491 570 156' });
  });
});

describe('GET /id/:slug/vcard', () => {
  it('downloads a vCard named after the slug', async () => {
    const res = await call(`/id/${owner.slug}/vcard`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('text/vcard; charset=utf-8');
    expect(res.headers.get('content-disposition')).toBe(`attachment; filename="${owner.slug}.vcf"`);
    expect(res.headers.get('cache-control')).toBe('public, max-age=60');

    const text = await res.text();
    expect(text).toMatch(/^BEGIN:VCARD\r\n/);
    expect(text).toContain('VERSION:3.0');
    expect(text).toMatch(/END:VCARD\r\n$/);
    const lines = text.split('\r\n');
    expect(lines).toContain('FN:Olivia Owner');
    expect(lines).toContain('ORG:Chatsoon');
    expect(lines).toContain('TITLE:Head of Partnerships');
    // Points back at the public profile on the web origin (the exact URL line format is buildVCard's).
    const profileUrl = `${env.WEB_ORIGIN}/id/${owner.slug}`;
    expect(lines.some((l) => /^(?:item\d+\.)?URL[;:]/i.test(l) && l.endsWith(`:${profileUrl}`))).toBe(true);
    expect(text).not.toContain(OWNER_EMAIL);
    expect(text).not.toContain('@example.com');
  });

  it('returns 404 for an unknown slug', async () => {
    const res = await call('/id/nobody-here-0000/vcard');
    expect(res.status).toBe(404);
  });

  it('adds a labelled item pair per booking link, after the profile url', async () => {
    const pete = await signUpWithProfile('vcard-booking@example.com', 'Pete Booker');
    await call('/me/profile', {
      method: 'PUT',
      token: pete.token,
      json: {
        displayName: 'Pete Booker',
        bookingLinks: [
          { url: 'https://calendly.com/chatwithpete/crypto-chat?back=1&month=2026-09' },
          { url: 'https://calendly.com/chatwithpete/30min?back=1&month=2026-09' },
        ],
      },
    });

    const res = await call(`/id/${pete.slug}/vcard`);
    expect(res.status).toBe(200);
    const lines = (await res.text()).split('\r\n');
    // item1 is the profile url itself; the booking links follow from item2.
    expect(lines).toContain('item2.URL:https://calendly.com/chatwithpete/crypto-chat');
    expect(lines).toContain('item2.X-ABLabel:Crypto chat');
    expect(lines).toContain('item3.URL:https://calendly.com/chatwithpete/30min');
    expect(lines).toContain('item3.X-ABLabel:30 min');
  });

  it('has no TEL, wa.me or signal.me for an anonymous viewer of a connections profile, and is never indexed', async () => {
    const person = await signUpWithProfile('vcard-conn@example.com', 'Vera VcardPrivate');
    await putProfile(person.token, {
      displayName: 'Vera VcardPrivate',
      contact: { phone: '+61 491 570 156', whatsapp: '+61 491 570 156', signal: '+61 491 570 156' },
    });

    const res = await call(`/id/${person.slug}/vcard`);
    expect(res.headers.get('x-robots-tag')).toBe('noindex');
    const text = await res.text();
    expect(text).not.toMatch(/^TEL/m);
    expect(text).not.toContain('wa.me');
    expect(text).not.toContain('signal.me');
  });

  it('has TEL and the item pairs for an anonymous viewer of a public profile', async () => {
    const person = await signUpWithProfile('vcard-pub@example.com', 'Priya VcardPublic');
    await putProfile(person.token, {
      displayName: 'Priya VcardPublic',
      contact: { phone: '+61 491 570 156', whatsapp: '+61 491 570 156', signal: '+61 491 570 156' },
      contactVisibility: 'public',
    });

    const text = await (await call(`/id/${person.slug}/vcard`)).text();
    expect(text).toContain('TEL;TYPE=CELL:+61491570156');
    const lines = text.split('\r\n');
    expect(lines.some((l) => /^item\d+\.URL:https:\/\/wa\.me\/61491570156$/.test(l))).toBe(true);
    expect(lines.some((l) => /^item\d+\.URL:https:\/\/signal\.me\/#p\/\+61491570156$/.test(l))).toBe(true);
    expect(text).toContain('X-ABLabel:WhatsApp');
    expect(text).toContain('X-ABLabel:Signal');
  });

  it('has TEL and Cache-Control: private, no-store for the signed URL GET /id/:slug hands back', async () => {
    const owner = await signUpWithProfile('vcard-signed-owner@example.com', 'Sian Signed');
    await putProfile(owner.token, { displayName: 'Sian Signed', contact: { phone: '+61 491 570 156' } });
    const friend = await signUpWithProfile('vcard-signed-friend@example.com', 'Fern SignedFriend');
    await call('/connections/scan', { method: 'POST', token: friend.token, json: { slug: owner.slug } });

    const profile = (await (await call(`/id/${owner.slug}`, { token: friend.token })).json()) as PublicProfile;
    const vcardUrl = new URL(profile.vcardUrl!);
    const res = await call(vcardUrl.pathname + vcardUrl.search);
    expect(res.headers.get('cache-control')).toBe('private, no-store');
    expect(await res.text()).toContain('TEL;TYPE=CELL:+61491570156');
  });

  it('returns 200 with no TEL for a tampered signature, an expired exp, or another slug\'s signature', async () => {
    const owner = await signUpWithProfile('vcard-tamper-owner@example.com', 'Tam Tamper');
    await putProfile(owner.token, { displayName: 'Tam Tamper', contact: { phone: '+61 491 570 156' } });
    const other = await signUpWithProfile('vcard-tamper-other@example.com', 'Ossy Other');
    const friend = await signUpWithProfile('vcard-tamper-friend@example.com', 'Fin TamperFriend');
    await call('/connections/scan', { method: 'POST', token: friend.token, json: { slug: owner.slug } });

    const profile = (await (await call(`/id/${owner.slug}`, { token: friend.token })).json()) as PublicProfile;
    const vcardUrl = new URL(profile.vcardUrl!);
    const exp = vcardUrl.searchParams.get('exp')!;
    const sig = vcardUrl.searchParams.get('sig')!;

    const tampered = await call(`/id/${owner.slug}/vcard?exp=${exp}&sig=${tamper(sig)}`);
    expect(tampered.status).toBe(200);
    expect(await tampered.text()).not.toMatch(/^TEL/m);

    const expiredExp = Math.floor(Date.now() / 1000) - 10;
    const expired = await call(`/id/${owner.slug}/vcard?exp=${expiredExp}&sig=${sig}`);
    expect(expired.status).toBe(200);
    expect(await expired.text()).not.toMatch(/^TEL/m);

    const wrongSlug = await call(`/id/${other.slug}/vcard?exp=${exp}&sig=${sig}`);
    expect(wrongSlug.status).toBe(200);
    expect(await wrongSlug.text()).not.toMatch(/^TEL/m);
  });
});

describe('POST /id/:slug/connect', () => {
  const connect = (slug: string, json: unknown, init: { token?: string; ip?: string } = {}) =>
    call(`/id/${slug}/connect`, {
      method: 'POST',
      json,
      token: init.token,
      headers: init.ip ? { 'cf-connecting-ip': init.ip } : undefined,
    });
  const form = (overrides: Record<string, unknown> = {}) => ({
    name: 'Nina Newcomer',
    contact: 'nina@example.org',
    note: 'Met at the Token2049 afterparty',
    turnstileToken: 'XXXX.DUMMY.TOKEN.XXXX',
    ...overrides,
  });

  it('validates the form', async () => {
    const before = (await contactsOf(owner.userId)).length;
    for (const body of [
      form({ name: '' }),
      form({ name: undefined }),
      form({ contact: '  ' }),
      form({ turnstileToken: undefined }),
      form({ note: 'x'.repeat(1001) }),
      // Nothing left once control and bidi-override characters are removed.
      form({ name: '‮\u0000' }),
    ]) {
      const res = await connect(owner.slug, body);
      expect(res.status, JSON.stringify(body)).toBe(400);
      expect(((await res.json()) as ApiErrorBody).error.code).toBe('bad_request');
    }
    expect(siteverifyForms).toHaveLength(0);
    expect(await contactsOf(owner.userId)).toHaveLength(before);
  });

  it('rejects a failed captcha with 403 captcha_failed', async () => {
    const before = (await contactsOf(owner.userId)).length;
    turnstilePasses = false;
    const res = await connect(owner.slug, form());
    expect(res.status).toBe(403);
    expect(((await res.json()) as ApiErrorBody).error.code).toBe('captcha_failed');
    expect(await contactsOf(owner.userId)).toHaveLength(before);
  });

  it('fails closed when siteverify is unreachable', async () => {
    vi.mocked(globalThis.fetch).mockRejectedValueOnce(new TypeError('network down'));
    const res = await connect(owner.slug, form());
    expect(res.status).toBe(403);
    expect(((await res.json()) as ApiErrorBody).error.code).toBe('captcha_failed');
  });

  it('returns 404 for an unknown slug', async () => {
    const res = await connect('nobody-here-0000', form());
    expect(res.status).toBe(404);
  });

  it('adds a web_connect contact to the owner only and emails the owner', async () => {
    const person = await signUpWithProfile('connect-owner@example.com', 'Carmen Connect');
    const bystander = await signUpWithProfile('connect-bystander@example.com', 'Bystander Bee');

    const res = await connect(person.slug, form(), { ip: '203.0.113.7' });
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ ok: true });

    // Turnstile got the secret from env, the token and the caller's IP.
    expect(siteverifyForms).toHaveLength(1);
    expect(siteverifyForms[0]!.get('secret')).toBe(env.TURNSTILE_SECRET);
    expect(siteverifyForms[0]!.get('response')).toBe('XXXX.DUMMY.TOKEN.XXXX');
    expect(siteverifyForms[0]!.get('remoteip')).toBe('203.0.113.7');

    const rows = await contactsOf(person.userId);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      user_id: person.userId,
      linked_user_id: null,
      name: 'Nina Newcomer',
      email: 'nina@example.org',
      telegram: null,
      notes: 'Met at the Token2049 afterparty',
      source: 'web_connect',
    });
    expect(await contactsOf(bystander.userId)).toHaveLength(0);
    expect(await contactsOf(owner.userId)).toHaveLength(0);

    await vi.waitFor(() => {
      const mail = capturedEmails().find(
        (m) => m.to === 'connect-owner@example.com' && m.subject.includes('connected'),
      );
      expect(mail?.subject).toBe('Someone connected with you on Chatsoon');
      // Nothing the visitor typed goes out from our domain, not even the name.
      expect(mail?.subject).not.toContain('Nina');
      expect(mail?.text).not.toContain('Nina Newcomer');
      expect(mail?.text).not.toContain('nina@example.org');
      expect(mail?.text).not.toContain('afterparty');
    });
  });

  it('keeps a phishing line in the name out of the email', async () => {
    const person = await signUpWithProfile('connect-phish@example.com', 'Paula Phish');
    const name = 'Chatsoon Security: unusual sign-in, verify at chatsoon-verify.co now';
    expect((await connect(person.slug, form({ name }))).status).toBe(201);
    expect((await contactsOf(person.userId))[0]?.name).toBe(name);
    const notices = () =>
      capturedEmails().filter((m) => m.to === 'connect-phish@example.com' && m.subject.includes('connected'));
    await vi.waitFor(() => expect(notices()).toHaveLength(1));
    const [mail] = notices();
    expect(`${mail!.subject}\n${mail!.text}`).not.toMatch(/verify|Security/);
  });

  it(`emails the owner about at most ${CONNECT_EMAILS_PER_DAY} submissions a day, and saves the rest`, async () => {
    const person = await signUpWithProfile('connect-flood@example.com', 'Flo Flood');
    const total = CONNECT_EMAILS_PER_DAY + 3;
    for (let i = 0; i < total; i++) {
      expect((await connect(person.slug, form({ name: `Sender ${i}` }))).status).toBe(201);
    }
    expect(await contactsOf(person.userId)).toHaveLength(total);
    const mails = () =>
      capturedEmails().filter((m) => m.to === 'connect-flood@example.com' && m.subject.includes('connected'));
    await vi.waitFor(() => expect(mails()).toHaveLength(CONNECT_EMAILS_PER_DAY));
    // Give any stray notification time to land before checking there are no more.
    await new Promise((r) => setTimeout(r, 100));
    expect(mails()).toHaveLength(CONNECT_EMAILS_PER_DAY);
  });

  it('rejects a body larger than any real form before reading it', async () => {
    const big = form({ note: 'x'.repeat(70 * 1024) });
    const res = await connect(owner.slug, big);
    expect(res.status).toBe(413);
    expect(await res.json()).toEqual({ error: { code: 'payload_too_large', message: 'Request body is too large' } });

    // Also without a Content-Length (a streamed body).
    const bytes = new TextEncoder().encode(JSON.stringify(big));
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(bytes);
        controller.close();
      },
    });
    const streamed = await call(`/id/${owner.slug}/connect`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: stream,
      duplex: 'half',
    } as RequestInit);
    expect(streamed.status).toBe(413);
    expect(await contactsOf(owner.userId)).toHaveLength(0);
  });

  it('still succeeds when the owner notification cannot be sent', async () => {
    const person = await signUpWithProfile('connect-nomail@example.com', 'Nora Nomail');
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});

    // Same app, but the email provider has no API key, so sendEmail throws.
    const { default: app } = await import('../src/index');
    const ctx = createExecutionContext();
    const req = new Request(`http://localhost:8787/id/${person.slug}/connect`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(form()),
    });
    const res = await app.fetch(req, { ...env, EMAIL_PROVIDER: 'resend', RESEND_API_KEY: '' }, ctx);
    await waitOnExecutionContext(ctx);

    expect(res.status).toBe(201);
    expect(await contactsOf(person.userId)).toHaveLength(1);
    expect(errors).toHaveBeenCalledWith('Connect notification failed', expect.any(Error));
  });

  it('rejects a handle or other non-email contact value with 400 (issue #10: email only)', async () => {
    const person = await signUpWithProfile('connect-routing@example.com', 'Rita Routing');
    const cases = [
      'https://www.linkedin.com/in/nina-n/?utm_source=qr',
      'x.com/nina_x',
      '@nina_tg',
      '+65 9123 4567',
      'nina.dev',
      'find me at booth 12',
    ];
    for (const contact of cases) {
      const res = await connect(person.slug, form({ contact, note: null }));
      expect(res.status, contact).toBe(400);
      expect(((await res.json()) as ApiErrorBody).error.message, contact).toBe('contact: Enter a valid email address');
    }
    expect(await contactsOf(person.userId)).toHaveLength(0);
  });

  it('saves a valid email to the contact, trimmed and lowercased, and collapses whitespace in the name', async () => {
    const person = await signUpWithProfile('connect-email@example.com', 'Ed Email');
    const res = await connect(
      person.slug,
      form({ name: 'Nina\n\n‮Newcomer\u0007', contact: '  Nina@Example.ORG  ', note: 'Loved the demo' }),
    );
    expect(res.status).toBe(201);
    const [row] = await contactsOf(person.userId);
    expect(row).toMatchObject({
      name: 'Nina Newcomer',
      email: 'nina@example.org',
      telegram: null,
      notes: 'Loved the demo',
    });
  });

  it('returns 404 to a signed-in visitor the owner has blocked', async () => {
    const person = await signUpWithProfile('connect-blocker@example.com', 'Cole Blocker');
    const pest = await signIn('connect-pest@example.com');
    await block(person.userId, pest.userId);

    const res = await connect(person.slug, form(), { token: pest.token });
    expect(res.status).toBe(404);
    expect(await contactsOf(person.userId)).toHaveLength(0);
  });

  it('rate limits repeated submissions from one IP', async () => {
    const person = await signUpWithProfile('connect-limit@example.com', 'Lim Limit');
    const statuses: number[] = [];
    for (let i = 0; i < 7; i++) {
      statuses.push((await connect(person.slug, form(), { ip: '198.51.100.23' })).status);
    }
    expect(statuses.slice(0, 5)).toEqual([201, 201, 201, 201, 201]);
    expect(statuses.at(-1)).toBe(429);
    // Other visitors are unaffected.
    expect((await connect(person.slug, form(), { ip: '198.51.100.24' })).status).toBe(201);
  });

  it('rate limits one IP across many different slugs (CONNECT_ANY_LIMITER, D24), checked before the per-slug limiter', async () => {
    const ip = '198.51.100.201';
    const statuses: number[] = [];
    // Every slug is unique and unknown, so CONNECT_LIMITER (5/60s per slug) never trips; only the
    // 30/60s global CONNECT_ANY_LIMITER can explain a 429 here.
    for (let i = 0; i < 31; i++) {
      statuses.push((await connect(`connect-any-nobody-${i}`, form(), { ip })).status);
    }
    expect(statuses.slice(0, 30).every((s) => s === 404)).toBe(true);
    expect(statuses.at(-1)).toBe(429);
    // Other visitors, and this same IP against a real slug, are otherwise unaffected until they hit it too.
    expect((await connect('connect-any-nobody-999', form(), { ip: '198.51.100.202' })).status).toBe(404);
  });

  it('returns the contact and a signed vcardUrl for a connections owner with a phone', async () => {
    const person = await signUpWithProfile('connect-contact-conn@example.com', 'Connie Contact');
    await putProfile(person.token, { displayName: 'Connie Contact', contact: { phone: '+61 491 570 156' } });

    const res = await connect(person.slug, form());
    expect(res.status).toBe(201);
    const body = (await res.json()) as ConnectFormResponse;
    expect(body.contact).toEqual({ phone: '+61 491 570 156' });
    expect(body.vcardUrl).toMatch(new RegExp(`/id/${person.slug}/vcard\\?exp=\\d+&sig=[0-9a-f]{64}$`));
  });

  it('returns exactly {ok:true} for an owner with no usable channel', async () => {
    const person = await signUpWithProfile('connect-contact-none@example.com', 'Nolan None');
    const res = await connect(person.slug, form());
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ ok: true });
  });

  it('still fails a bad captcha with 403, even for an owner with a phone', async () => {
    const person = await signUpWithProfile('connect-contact-captcha@example.com', 'Cass Captcha');
    await putProfile(person.token, { displayName: 'Cass Captcha', contact: { phone: '+61 491 570 156' } });
    turnstilePasses = false;
    const res = await connect(person.slug, form());
    expect(res.status).toBe(403);
    expect(((await res.json()) as ApiErrorBody).error.code).toBe('captcha_failed');
  });
});

// Issue #10: connectFormSchema.contact is now an email address only, so this only ever sees a
// value the schema already validated as an email — its old LinkedIn/X/Telegram/phone/handle
// routing is gone. These cases exercise the function directly (bypassing the schema) to check it
// still does the right thing with a non-email value, and with an email too long for the column.
describe('contactFieldsFromConnectValue', () => {
  it.each([
    ['Nina@Example.org', { email: 'nina@example.org' }],
    ['  nina@example.org  ', { email: 'nina@example.org' }],
    ['mailto:nina@example.org', { unmatched: 'mailto:nina@example.org' }],
    ['linkedin.com/in/nina', { unmatched: 'linkedin.com/in/nina' }],
    ['@nina_tg', { unmatched: '@nina_tg' }],
    ['+1 (415) 555-0100', { unmatched: '+1 (415) 555-0100' }],
    ['Nina at booth 4', { unmatched: 'Nina at booth 4' }],
  ])('%s', (value, expected) => {
    expect(contactFieldsFromConnectValue(value)).toEqual(expected);
  });

  it('keeps an email that is too long for the contact field in the notes', () => {
    // Over CONTACT_FIELD_MAX.email (254), even though it's a perfectly valid email address.
    const value = `${'a'.repeat(250)}@example.org`;
    expect(contactFieldsFromConnectValue(value)).toEqual({ unmatched: value });
  });
});
