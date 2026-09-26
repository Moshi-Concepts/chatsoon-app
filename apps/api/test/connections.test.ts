import type { ApiErrorBody, ScanConnectResponse } from '@chatsoon/shared';
import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';

import { call, signIn, signUpWithProfile } from './helpers';

type ContactDbRow = {
  id: string;
  user_id: string;
  linked_user_id: string | null;
  name: string;
  company: string | null;
  role: string | null;
  telegram: string | null;
  x_handle: string | null;
  linkedin_url: string | null;
  website: string | null;
  notes: string | null;
  event_id: string | null;
  source: string;
  created_at: number;
  follow_up_due_at: number | null;
};

const scan = (token: string, json: unknown) => call('/connections/scan', { method: 'POST', token, json });

async function scanOk(token: string, slug: string, eventId?: string | null) {
  const res = await scan(token, { slug, eventId });
  expect(res.status, await res.clone().text()).toBe(200);
  return (await res.json()) as ScanConnectResponse;
}

async function contactsOf(userId: string) {
  const { results } = await env.DB.prepare('select * from contacts where user_id = ? order by created_at')
    .bind(userId)
    .all<ContactDbRow>();
  return results;
}

async function connectionBetween(a: string, b: string) {
  return env.DB.prepare('select * from connections where (user_a = ? and user_b = ?) or (user_a = ? and user_b = ?)')
    .bind(a, b, b, a)
    .all<{ user_a: string; user_b: string; status: string; event_id: string | null }>()
    .then((r) => r.results);
}

async function block(blockerId: string, blockedId: string) {
  await env.DB.prepare('insert into blocks (blocker_id, blocked_id) values (?, ?)').bind(blockerId, blockedId).run();
}

async function privateEvent(createdBy: string, name: string) {
  const id = `evt_${crypto.randomUUID()}`;
  await env.DB.prepare('insert into events (id, name, is_public, created_by) values (?, ?, 0, ?)')
    .bind(id, name, createdBy)
    .run();
  return id;
}

/** Seeds today's new-connections counter for `userId`, as if they'd already made `count` of them. */
async function seedConnectionCount(userId: string, count: number) {
  const day = new Date().toISOString().slice(0, 10);
  await env.DB.prepare(
    `insert into usage_counters (key, day, count) values (?, ?, ?)
     on conflict (key) do update set count = excluded.count`,
  )
    .bind(`connect:user:${userId}:${day}`, day, count)
    .run();
}

/** Signs up and fills in company, role and links. */
async function person(email: string, name: string, extra: Record<string, unknown> = {}) {
  const s = await signUpWithProfile(email, name);
  const res = await call('/me/profile', { method: 'PUT', token: s.token, json: { displayName: name, ...extra } });
  expect(res.status).toBe(200);
  return s;
}

describe('POST /connections/scan', () => {
  it('requires a session', async () => {
    const res = await call('/connections/scan', { method: 'POST', json: { slug: 'someone-1234' } });
    expect(res.status).toBe(401);
  });

  it('validates the body', async () => {
    const me = await signUpWithProfile('scan-validate@example.com', 'Val Idate');
    for (const body of [{}, { slug: '' }, { slug: 'x'.repeat(101) }, { slug: 42 }]) {
      const res = await scan(me.token, body);
      expect(res.status, JSON.stringify(body)).toBe(400);
      expect(((await res.json()) as ApiErrorBody).error.code).toBe('bad_request');
    }
  });

  it('returns 404 for an unknown slug', async () => {
    const me = await signUpWithProfile('scan-unknown@example.com', 'Una Known');
    const res = await scan(me.token, { slug: 'nobody-here-0000' });
    expect(res.status).toBe(404);
    expect(((await res.json()) as ApiErrorBody).error.code).toBe('not_found');
  });

  it('rejects scanning your own code', async () => {
    const me = await signUpWithProfile('scan-self@example.com', 'Selma Self');
    const res = await scan(me.token, { slug: me.slug });
    expect(res.status).toBe(400);
    expect(await contactsOf(me.userId)).toHaveLength(0);
  });

  it('asks for a profile first', async () => {
    const target = await signUpWithProfile('scan-target-np@example.com', 'Tara Target');
    const noProfile = await signIn('scan-noprofile@example.com');
    const res = await scan(noProfile.token, { slug: target.slug });
    expect(res.status).toBe(403);
    const body = (await res.json()) as ApiErrorBody;
    expect(body.error).toEqual({ code: 'forbidden', message: 'Create your profile first' });
    expect(await contactsOf(target.userId)).toHaveLength(0);
  });

  it('gives both users each other’s card, and nobody else', async () => {
    const alice = await person('scan-alice@example.com', 'Alice Anders', {
      company: 'Anders Labs',
      role: 'CEO',
      links: {
        x: '@alice_x',
        telegram: '@alice_tg',
        linkedin: 'https://linkedin.com/in/alice',
        website: 'https://alice.dev',
        youtube: 'https://youtube.com/@alice',
      },
    });
    const bob = await person('scan-bob@example.com', 'Bob Baker', {
      company: 'Baker Ventures',
      role: 'Partner',
      headline: 'Seed investor',
      links: { x: 'bob_x', telegram: 'bob_tg', linkedin: 'https://linkedin.com/in/bob', website: 'https://bob.vc' },
    });
    const carol = await person('scan-carol@example.com', 'Carol Clark');

    const { contact, alreadyConnected } = await scanOk(alice.token, bob.slug);
    expect(alreadyConnected).toBe(false);
    expect(contact).toMatchObject({
      linkedUserId: bob.userId,
      linkedSlug: bob.slug,
      name: 'Bob Baker',
      company: 'Baker Ventures',
      role: 'Partner',
      xHandle: 'bob_x',
      telegram: 'bob_tg',
      linkedinUrl: 'https://www.linkedin.com/in/bob',
      website: 'https://bob.vc',
      email: null,
      eventId: null,
      source: 'app_connect',
      extractionStatus: 'none',
      tagIds: [],
    });
    // Never leak the other user's email onto the card.
    expect(JSON.stringify(contact)).not.toContain('scan-bob@example.com');
    // Issue #33: an app connection has no priority, so it's due the next day like any other.
    expect(new Date(contact.followUpDueAt!).getTime() - new Date(contact.createdAt).getTime()).toBe(
      24 * 60 * 60 * 1000,
    );
    expect(contact.followedUpAt).toBeNull();

    const alicesList = await contactsOf(alice.userId);
    expect(alicesList).toHaveLength(1);
    expect(alicesList[0]!.id).toBe(contact.id);

    const bobsList = await contactsOf(bob.userId);
    expect(bobsList).toHaveLength(1);
    expect(bobsList[0]).toMatchObject({
      user_id: bob.userId,
      linked_user_id: alice.userId,
      name: 'Alice Anders',
      company: 'Anders Labs',
      role: 'CEO',
      x_handle: 'alice_x',
      telegram: 'alice_tg',
      linkedin_url: 'https://www.linkedin.com/in/alice',
      website: 'https://alice.dev',
      source: 'app_connect',
    });
    expect(bobsList[0]!.follow_up_due_at! - bobsList[0]!.created_at).toBe(24 * 60 * 60 * 1000);

    expect(await contactsOf(carol.userId)).toHaveLength(0);

    // Each card is private to its owner: neither the other party nor a bystander can open it.
    for (const outsider of [bob, carol]) {
      expect((await call(`/contacts/${contact.id}`, { token: outsider.token })).status).toBe(404);
    }
    expect((await call(`/contacts/${bobsList[0]!.id}`, { token: alice.token })).status).toBe(404);
    expect((await call(`/contacts/${contact.id}`, { token: alice.token })).status).toBe(200);

    const [row, ...rest] = await connectionBetween(alice.userId, bob.userId);
    expect(rest).toHaveLength(0);
    expect(row!.status).toBe('accepted');
    expect(row!.user_a < row!.user_b).toBe(true);
  });

  it('reports alreadyConnected on a second scan from either side without duplicating cards', async () => {
    const dana = await person('scan-dana@example.com', 'Dana Diaz');
    const eli = await person('scan-eli@example.com', 'Eli Evans');

    const first = await scanOk(dana.token, eli.slug);
    expect(first.alreadyConnected).toBe(false);

    const second = await scanOk(dana.token, eli.slug);
    expect(second.alreadyConnected).toBe(true);
    expect(second.contact.id).toBe(first.contact.id);

    const reverse = await scanOk(eli.token, dana.slug);
    expect(reverse.alreadyConnected).toBe(true);
    expect(reverse.contact.linkedUserId).toBe(dana.userId);

    expect(await contactsOf(dana.userId)).toHaveLength(1);
    expect(await contactsOf(eli.userId)).toHaveLength(1);
    expect(await connectionBetween(dana.userId, eli.userId)).toHaveLength(1);
  });

  it('only fills empty fields when refreshing an existing card', async () => {
    const fay = await person('scan-fay@example.com', 'Fay Fox');
    const gus = await person('scan-gus@example.com', 'Gus Grant', { company: 'Grant & Co' });

    const { contact } = await scanOk(fay.token, gus.slug);
    // Gus has no phone yet: the card is created with an empty one.
    expect(contact.phone).toBeNull();
    // Fay edits her copy: renames Gus, changes the company, adds a note.
    await env.DB.prepare('update contacts set name = ?, company = ?, notes = ? where id = ?')
      .bind('Gus (sponsor)', 'Grant Holdings', 'Wants a booth', contact.id)
      .run();

    // Gus later fills in more of his profile, changes his company, and adds a phone number.
    const put = await call('/me/profile', {
      method: 'PUT',
      token: gus.token,
      json: {
        displayName: 'Gus Grant',
        company: 'New Co',
        role: 'CMO',
        links: { telegram: 'gus_tg' },
        contact: { phone: '+61 491 570 100' },
      },
    });
    expect(put.status).toBe(200);

    const again = await scanOk(fay.token, gus.slug);
    expect(again.alreadyConnected).toBe(true);
    expect(again.contact).toMatchObject({
      id: contact.id,
      name: 'Gus (sponsor)',
      company: 'Grant Holdings',
      notes: 'Wants a booth',
      role: 'CMO',
      telegram: 'gus_tg',
      // The card's phone was empty, so the refresh filled it in.
      phone: '+61 491 570 100',
    });

    // Fay now edits her copy's phone by hand.
    await env.DB.prepare('update contacts set phone = ? where id = ?').bind('+61 400 000 000', contact.id).run();
    // Gus changes his number again.
    const putAgain = await call('/me/profile', {
      method: 'PUT',
      token: gus.token,
      json: { displayName: 'Gus Grant', contact: { phone: '+61 491 570 200' } },
    });
    expect(putAgain.status).toBe(200);

    const third = await scanOk(fay.token, gus.slug);
    // Fay's edited phone is not empty, so the refresh leaves it alone.
    expect(third.contact.phone).toBe('+61 400 000 000');
    expect(await contactsOf(fay.userId)).toHaveLength(1);
  });

  it('recreates a card the user deleted', async () => {
    const hal = await person('scan-hal@example.com', 'Hal Hughes');
    const ivy = await person('scan-ivy@example.com', 'Ivy Ingram');
    const { contact } = await scanOk(hal.token, ivy.slug);
    await env.DB.prepare('delete from contacts where id = ?').bind(contact.id).run();

    const again = await scanOk(hal.token, ivy.slug);
    expect(again.alreadyConnected).toBe(true);
    expect(again.contact.id).not.toBe(contact.id);
    expect(again.contact.name).toBe('Ivy Ingram');
    expect(await contactsOf(hal.userId)).toHaveLength(1);
  });

  it('puts a public event on both cards', async () => {
    const jo = await person('scan-jo@example.com', 'Jo Jones');
    const kim = await person('scan-kim@example.com', 'Kim Kent');

    const { contact } = await scanOk(jo.token, kim.slug, 'evt_token2049');
    expect(contact.eventId).toBe('evt_token2049');
    const [kimsCopy] = await contactsOf(kim.userId);
    expect(kimsCopy!.event_id).toBe('evt_token2049');
    const [row] = await connectionBetween(jo.userId, kim.userId);
    expect(row!.event_id).toBe('evt_token2049');
  });

  it('puts the scanner’s private event on their card only', async () => {
    const lou = await person('scan-lou@example.com', 'Lou Lane');
    const max = await person('scan-max@example.com', 'Max Moore');
    const dinner = await privateEvent(lou.userId, 'Founders dinner');

    const { contact } = await scanOk(lou.token, max.slug, dinner);
    expect(contact.eventId).toBe(dinner);
    const [maxsCopy] = await contactsOf(max.userId);
    expect(maxsCopy!.event_id).toBeNull();
    // The shared connection row doesn't carry it either.
    const [row] = await connectionBetween(lou.userId, max.userId);
    expect(row!.event_id).toBeNull();
  });

  it('drops an event the scanner cannot see', async () => {
    const ned = await person('scan-ned@example.com', 'Ned Nash');
    const ola = await person('scan-ola@example.com', 'Ola Olsen');
    const stranger = await signIn('scan-stranger@example.com');
    const theirs = await privateEvent(stranger.userId, 'Private offsite');

    const { contact } = await scanOk(ned.token, ola.slug, theirs);
    expect(contact.eventId).toBeNull();
    const [olasCopy] = await contactsOf(ola.userId);
    expect(olasCopy!.event_id).toBeNull();
    const [row] = await connectionBetween(ned.userId, ola.userId);
    expect(row!.event_id).toBeNull();

    const unknown = await scanOk(ola.token, ned.slug, 'evt_does_not_exist');
    expect(unknown.contact.eventId).toBeNull();
  });

  it('refuses to connect when either user blocked the other, without telling the blocked user', async () => {
    const pia = await person('scan-pia@example.com', 'Pia Park');
    const quin = await person('scan-quin@example.com', 'Quin Quick');
    await block(pia.userId, quin.userId);

    // Quin was blocked by Pia: Pia's profile looks like it doesn't exist.
    const blocked = await scan(quin.token, { slug: pia.slug });
    expect(blocked.status).toBe(404);
    expect(((await blocked.json()) as ApiErrorBody).error).toEqual({ code: 'not_found', message: 'Profile not found' });

    // Pia did the blocking: she is told why.
    const blocker = await scan(pia.token, { slug: quin.slug });
    expect(blocker.status).toBe(403);
    expect(((await blocker.json()) as ApiErrorBody).error.code).toBe('forbidden');
    expect(await contactsOf(pia.userId)).toHaveLength(0);
    expect(await contactsOf(quin.userId)).toHaveLength(0);
    expect(await connectionBetween(pia.userId, quin.userId)).toHaveLength(0);
  });

  it('connects again after an unblock, relinking the card the blocked person kept', async () => {
    const tia = await person('scan-tia@example.com', 'Tia Tran');
    const uri = await person('scan-uri@example.com', 'Uri Upton');
    await scanOk(tia.token, uri.slug);
    // Uri makes the card of Tia his own.
    const [uriCard] = await contactsOf(uri.userId);
    const edited = await call(`/contacts/${uriCard!.id}`, {
      method: 'PUT',
      token: uri.token,
      json: { notes: 'Met at the booth' },
    });
    expect(edited.status).toBe(200);

    const blocked = await call('/blocks', { method: 'POST', token: tia.token, json: { targetUserId: uri.userId } });
    expect(blocked.status).toBe(201);
    expect(await contactsOf(tia.userId)).toHaveLength(0);
    expect(await contactsOf(uri.userId)).toMatchObject([{ id: uriCard!.id, linked_user_id: null }]);
    expect((await scan(uri.token, { slug: tia.slug })).status).toBe(404);

    expect((await call(`/blocks/${uri.userId}`, { method: 'DELETE', token: tia.token })).status).toBe(204);
    const again = await scanOk(tia.token, uri.slug);
    expect(again.alreadyConnected).toBe(false);
    expect(again.contact.linkedUserId).toBe(uri.userId);
    const [row, ...rest] = await connectionBetween(tia.userId, uri.userId);
    expect(rest).toHaveLength(0);
    expect(row!.status).toBe('accepted');

    // Uri still has one card of Tia: the same one, linked again, with his notes.
    expect(await contactsOf(uri.userId)).toMatchObject([
      { id: uriCard!.id, linked_user_id: tia.userId, notes: 'Met at the booth' },
    ]);
    expect(await contactsOf(tia.userId)).toHaveLength(1);

    // Scanning from his side after that changes nothing.
    await scanOk(uri.token, tia.slug);
    expect(await contactsOf(uri.userId)).toHaveLength(1);
    expect(await contactsOf(tia.userId)).toHaveLength(1);
  });

  it('matches the slug case-insensitively', async () => {
    const vic = await person('scan-vic@example.com', 'Vic Vance');
    const wes = await person('scan-wes@example.com', 'Wes West');
    const { contact } = await scanOk(vic.token, ` ${wes.slug.toUpperCase()} `);
    expect(contact.linkedUserId).toBe(wes.userId);
  });

  it('copies only links that work onto the card, normalised', async () => {
    const yan = await person('scan-yan@example.com', 'Yan Young');
    const zed = await person('scan-zed@example.com', 'Zed Zane');
    // Stored before link validation existed (PUT /me/profile now rejects most of these).
    await env.DB.prepare('update profiles set links = ? where user_id = ?')
      .bind(
        JSON.stringify({
          x: 'not a handle!',
          telegram: 'https://t.me/zed_tg?start=1',
          linkedin: 'zed-zane',
          website: 'javascript:alert(1)',
          youtube: '@zed',
        }),
        zed.userId,
      )
      .run();

    const { contact } = await scanOk(yan.token, zed.slug);
    expect(contact).toMatchObject({
      xHandle: null,
      telegram: 'zed_tg',
      linkedinUrl: 'https://www.linkedin.com/in/zed-zane',
      website: null,
    });
  });

  it('copies the phone as typed, even when the profile keeps it to connections only', async () => {
    const amy = await person('scan-amy@example.com', 'Amy Archer');
    const ben = await person('scan-ben@example.com', 'Ben Bell', {
      contact: { phone: '+61 491 570 156' },
      // Default visibility, spelled out: the phone is copied on connect whatever this is set to.
      contactVisibility: 'connections',
    });

    const { contact } = await scanOk(amy.token, ben.slug);
    expect(contact.phone).toBe('+61 491 570 156');
  });

  it('gives a legacy invalid phone as null', async () => {
    const cai = await person('scan-cai@example.com', 'Cai Chen');
    const dot = await person('scan-dot@example.com', 'Dot Diaz');
    // Stored before contact validation existed.
    await env.DB.prepare('update profiles set contact = ? where user_id = ?')
      .bind(JSON.stringify({ phone: '000' }), dot.userId)
      .run();

    const { contact } = await scanOk(cai.token, dot.slug);
    expect(contact.phone).toBeNull();
  });

  it('never lets WhatsApp or Signal values onto the card as website or notes', async () => {
    const eve = await person('scan-eve@example.com', 'Eve Ellis', {
      contact: { whatsapp: 'https://wa.me/61491570156', signal: '+61 491 570 156' },
    });
    const flo = await person('scan-flo@example.com', 'Flo Ford');

    const { contact } = await scanOk(flo.token, eve.slug);
    expect(contact.website).toBeNull();
    expect(contact.notes).toBeNull();
    expect(contact.phone).toBeNull();
    expect(JSON.stringify(contact)).not.toContain('wa.me');
    expect(JSON.stringify(contact)).not.toContain('signal.me');
  });

  it('caps new connections at 100 a day, but never for re-scanning an existing connection', async () => {
    const gia = await person('scan-gia@example.com', 'Gia Grey');
    const hank = await person('scan-hank@example.com', 'Hank Hale');
    // An existing connection, made before the cap is hit.
    await scanOk(gia.token, hank.slug);
    await seedConnectionCount(gia.userId, 100);

    const ivo = await person('scan-ivo@example.com', 'Ivo Ibsen');
    const capped = await scan(gia.token, { slug: ivo.slug });
    expect(capped.status).toBe(429);
    expect(((await capped.json()) as ApiErrorBody).error.code).toBe('rate_limited');
    expect(await contactsOf(ivo.userId)).toHaveLength(0);

    const again = await scanOk(gia.token, hank.slug);
    expect(again.alreadyConnected).toBe(true);
  });

  it('creates one card each when two people scan each other at the same time', async () => {
    const rae = await person('scan-rae@example.com', 'Rae Ross');
    const sol = await person('scan-sol@example.com', 'Sol Stone');

    const [a, b] = await Promise.all([scanOk(rae.token, sol.slug), scanOk(sol.token, rae.slug)]);
    expect(a.contact.linkedUserId).toBe(sol.userId);
    expect(b.contact.linkedUserId).toBe(rae.userId);
    expect(await contactsOf(rae.userId)).toHaveLength(1);
    expect(await contactsOf(sol.userId)).toHaveLength(1);
    expect(await connectionBetween(rae.userId, sol.userId)).toHaveLength(1);
  });
});
