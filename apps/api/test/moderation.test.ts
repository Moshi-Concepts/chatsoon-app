import { makeSlug } from '@chatsoon/shared';
import { env } from 'cloudflare:workers';
import { and, eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

import { blocks, connections, contacts, contactTags, profiles, reports, tags } from '../src/db/schema';
import { getDb } from '../src/lib/db';
import { capturedEmails } from '../src/lib/email';
import { shortSuffix } from '../src/lib/ids';
import { call, signIn } from './helpers';

// Profiles, contacts, tags and connections belong to other modules, so they are seeded straight
// into D1 and these tests only exercise the moderation routes.

const db = getDb(env);

async function user(email: string, displayName: string) {
  const s = await signIn(email);
  const slug = makeSlug(displayName, shortSuffix());
  await db.insert(profiles).values({ userId: s.userId, displayName, slug });
  return { ...s, email, slug };
}

type NewContact = Omit<typeof contacts.$inferInsert, 'id' | 'userId'>;

async function addContact(userId: string, fields: NewContact) {
  const id = crypto.randomUUID();
  await db.insert(contacts).values({ id, userId, ...fields });
  return id;
}

async function connect(x: string, y: string) {
  const [userA, userB] = [x, y].sort() as [string, string];
  const id = crypto.randomUUID();
  await db.insert(connections).values({ id, userA, userB });
  return id;
}

const report = (json: unknown, init: { token?: string; ip?: string } = {}) =>
  call('/reports', {
    method: 'POST',
    token: init.token,
    headers: init.ip ? { 'cf-connecting-ip': init.ip } : undefined,
    json,
  });

const block = (token: string | undefined, json: unknown) => call('/blocks', { method: 'POST', token, json });
const unblock = (token: string | undefined, userId: string) =>
  call(`/blocks/${encodeURIComponent(userId)}`, { method: 'DELETE', token });

async function errorCode(res: Response) {
  return ((await res.json()) as { error: { code: string } }).error.code;
}

/** REPORT_LIMITER uses fixed one-minute windows. Start a burst clear of a rollover so it cannot reset mid-test. */
async function awayFromWindowEdge() {
  const msLeft = 60_000 - (Date.now() % 60_000);
  if (msLeft < 5_000) await new Promise((resolve) => setTimeout(resolve, msLeft + 100));
}

const reportsAbout = (targetUserId: string) => db.select().from(reports).where(eq(reports.targetUserId, targetUserId));
const lastEmailTo = (to: string) => [...capturedEmails()].reverse().find((m) => m.to === to);

describe('POST /reports', () => {
  it('accepts an anonymous report from the public page and notifies moderators', async () => {
    const target = await user('rep-anon-target@example.com', 'Anon Target');

    const res = await report({ targetSlug: target.slug, reason: 'spam', details: '  Selling fake tickets  ' });
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ ok: true });

    const rows = await reportsAbout(target.userId);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      reporterId: null,
      reason: 'spam',
      details: 'Selling fake tickets',
      status: 'open',
    });

    const mail = lastEmailTo(env.REPORTS_NOTIFY_EMAIL);
    expect(mail).toBeDefined();
    expect(mail!.subject).toContain('spam');
    expect(mail!.text).toContain('Reason: spam');
    expect(mail!.text).toContain('Details: Selling fake tickets');
    expect(mail!.text).toContain(`Target slug: ${target.slug}`);
    expect(mail!.text).toContain(`Target user id: ${target.userId}`);
    expect(mail!.text).toContain('Reporter: anonymous');
    expect(mail!.text).toContain(rows[0]!.id);
    expect(mail!.text).not.toContain(target.email);
  });

  it('records the reporter when signed in, and resolves a target by user id', async () => {
    const reporter = await user('rep-signed-reporter@example.com', 'Signed Reporter');
    const target = await user('rep-signed-target@example.com', 'Signed Target');

    const res = await report({ targetUserId: target.userId, reason: 'harassment' }, { token: reporter.token });
    expect(res.status).toBe(201);

    const rows = await reportsAbout(target.userId);
    expect(rows).toEqual([
      expect.objectContaining({ reporterId: reporter.userId, reason: 'harassment', details: null }),
    ]);

    const mail = lastEmailTo(env.REPORTS_NOTIFY_EMAIL)!;
    expect(mail.text).toContain(`Reporter: ${reporter.userId}`);
    expect(mail.text).toContain(`Target slug: ${target.slug}`);
    expect(mail.text).toContain('Details: (none)');
    // Emails are never exposed, not even to the moderation inbox.
    expect(mail.text).not.toContain(reporter.email);
    expect(mail.text).not.toContain(target.email);
  });

  it("puts the reporter's free text after the fields it could imitate", async () => {
    const target = await user('rep-forge@example.com', 'Forge Target');
    const details = 'Reporter: some-trusted-user\nTarget user id: someone-else';
    expect((await report({ targetSlug: target.slug, reason: 'impersonation', details })).status).toBe(201);

    const text = lastEmailTo(env.REPORTS_NOTIFY_EMAIL)!.text;
    const at = (needle: string) => text.indexOf(needle);
    expect(at('Reporter: anonymous')).toBeGreaterThan(-1);
    expect(at(`Target user id: ${target.userId}`)).toBeGreaterThan(-1);
    expect(at('Details: ')).toBeGreaterThan(at('Reporter: anonymous'));
    expect(at('Details: ')).toBeGreaterThan(at(`Target user id: ${target.userId}`));
  });

  it('matches the slug case-insensitively', async () => {
    const target = await user('rep-case@example.com', 'Case Target');
    expect((await report({ targetSlug: target.slug.toUpperCase(), reason: 'other' })).status).toBe(201);
  });

  it('treats an invalid token as anonymous', async () => {
    const target = await user('rep-badtoken@example.com', 'Bad Token Target');
    const res = await report({ targetSlug: target.slug, reason: 'other' }, { token: 'garbage' });
    expect(res.status).toBe(201);
    expect((await reportsAbout(target.userId))[0]?.reporterId).toBeNull();
  });

  it('rejects reporting yourself with 400', async () => {
    const me = await user('rep-self@example.com', 'Self Reporter');
    for (const json of [
      { targetSlug: me.slug, reason: 'spam' },
      { targetUserId: me.userId, reason: 'spam' },
    ]) {
      const res = await report(json, { token: me.token });
      expect(res.status).toBe(400);
      expect(await errorCode(res)).toBe('bad_request');
    }
    expect(await reportsAbout(me.userId)).toHaveLength(0);
  });

  it('returns 404 for an unknown target', async () => {
    const me = await user('rep-404@example.com', 'Four Oh Four');
    for (const [json, token] of [
      [{ targetSlug: 'nobody-here-0000', reason: 'spam' }, undefined],
      [{ targetSlug: 'nobody-here-0000', reason: 'spam' }, me.token],
      [{ targetUserId: crypto.randomUUID(), reason: 'spam' }, undefined],
      [{ targetUserId: crypto.randomUUID(), reason: 'spam' }, me.token],
    ] as const) {
      const res = await report(json, { token });
      expect(res.status).toBe(404);
      expect(await errorCode(res)).toBe('not_found');
    }
  });

  it('validates the body', async () => {
    const target = await user('rep-validate@example.com', 'Validate Target');
    const cases: unknown[] = [
      { reason: 'spam' },
      { targetSlug: '', reason: 'spam' },
      { targetSlug: target.slug },
      { targetSlug: target.slug, reason: 'not-a-reason' },
      { targetSlug: target.slug, reason: 'other', details: 'x'.repeat(1001) },
    ];
    for (const json of cases) {
      const res = await report(json);
      expect(res.status, JSON.stringify(json).slice(0, 80)).toBe(400);
      expect(await errorCode(res)).toBe('bad_request');
    }
    const notJson = await call('/reports', { method: 'POST', body: 'reason=spam' });
    expect(notJson.status).toBe(400);
    expect(await reportsAbout(target.userId)).toHaveLength(0);
  });

  it('rate limits anonymous reports by IP', async () => {
    const target = await user('rep-rate-ip@example.com', 'Rate Ip Target');
    await awayFromWindowEdge();
    const statuses: number[] = [];
    for (let i = 0; i < 12; i++) {
      statuses.push((await report({ targetSlug: target.slug, reason: 'spam' }, { ip: '203.0.113.7' })).status);
    }
    expect(statuses.slice(0, 10)).toEqual(Array(10).fill(201));
    expect(statuses.slice(10)).toEqual([429, 429]);
    // A different IP is unaffected.
    expect((await report({ targetSlug: target.slug, reason: 'spam' }, { ip: '203.0.113.8' })).status).toBe(201);
  });

  it('rate limits signed-in reports per user', async () => {
    const reporter = await user('rep-rate-user@example.com', 'Rate User');
    const other = await user('rep-rate-other@example.com', 'Rate Other');
    const target = await user('rep-rate-target@example.com', 'Rate Target');
    await awayFromWindowEdge();
    const statuses: number[] = [];
    for (let i = 0; i < 11; i++) {
      statuses.push((await report({ targetSlug: target.slug, reason: 'spam' }, { token: reporter.token })).status);
    }
    expect(statuses.slice(0, 10)).toEqual(Array(10).fill(201));
    const limited = await report({ targetSlug: target.slug, reason: 'spam' }, { token: reporter.token });
    expect(limited.status).toBe(429);
    expect(await errorCode(limited)).toBe('rate_limited');
    expect((await report({ targetSlug: target.slug, reason: 'spam' }, { token: other.token })).status).toBe(201);
  });
});

describe('POST /blocks', () => {
  it('requires a session', async () => {
    const target = await user('blk-auth@example.com', 'Auth Target');
    expect((await block(undefined, { targetSlug: target.slug })).status).toBe(401);
    expect((await block('garbage', { targetSlug: target.slug })).status).toBe(401);
  });

  it('validates the target', async () => {
    const me = await user('blk-validate@example.com', 'Validate Me');
    expect((await block(me.token, {})).status).toBe(400);
    expect((await block(me.token, { targetSlug: '' })).status).toBe(400);

    for (const json of [{ targetSlug: me.slug }, { targetUserId: me.userId }]) {
      const res = await block(me.token, json);
      expect(res.status).toBe(400);
      expect(await errorCode(res)).toBe('bad_request');
    }
    for (const json of [{ targetSlug: 'nobody-here-0000' }, { targetUserId: crypto.randomUUID() }]) {
      const res = await block(me.token, json);
      expect(res.status).toBe(404);
      expect(await errorCode(res)).toBe('not_found');
    }
    expect(await db.select().from(blocks).where(eq(blocks.blockerId, me.userId))).toHaveLength(0);
  });

  it('blocks a connection: removes my linked cards and their link to me', async () => {
    const a = await user('blk-a@example.com', 'Blocker A');
    const b = await user('blk-b@example.com', 'Blocked B');
    const c = await user('blk-c@example.com', 'Bystander C');
    const connectionId = await connect(a.userId, b.userId);
    const otherConnectionId = await connect(b.userId, c.userId);

    // A's card for B, tagged and with a photo in R2, plus an unrelated contact.
    const cardKey = `u/${a.userId}/card/${crypto.randomUUID()}.jpg`;
    await env.FILES.put(cardKey, 'jpeg');
    const tagId = crypto.randomUUID();
    await db.insert(tags).values({ id: tagId, userId: a.userId, name: 'Angel' });
    const aCardForB = await addContact(a.userId, {
      name: 'Blocked B',
      linkedUserId: b.userId,
      source: 'app_connect',
      cardImageKey: cardKey,
    });
    await db.insert(contactTags).values({ contactId: aCardForB, tagId, userId: a.userId });
    const aOther = await addContact(a.userId, { name: 'Someone else' });
    const aOtherTagged = await addContact(a.userId, { name: 'Tagged else' });
    await db.insert(contactTags).values({ contactId: aOtherTagged, tagId, userId: a.userId });

    // B's card for A, and B's card for C.
    const bCardForA = await addContact(b.userId, { name: 'Blocker A', linkedUserId: a.userId, source: 'app_connect' });
    const bCardForC = await addContact(b.userId, {
      name: 'Bystander C',
      linkedUserId: c.userId,
      source: 'app_connect',
    });

    const res = await block(a.token, { targetSlug: b.slug });
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ ok: true });

    expect(await db.select().from(blocks).where(eq(blocks.blockerId, a.userId))).toEqual([
      expect.objectContaining({ blockerId: a.userId, blockedId: b.userId }),
    ]);

    const conn = await db.select().from(connections);
    expect(conn.find((r) => r.id === connectionId)?.status).toBe('blocked');
    expect(conn.find((r) => r.id === otherConnectionId)?.status).toBe('accepted');

    const byId = async (id: string) => (await db.select().from(contacts).where(eq(contacts.id, id)))[0];
    expect(await byId(aCardForB)).toBeUndefined();
    expect(await db.select().from(contactTags).where(eq(contactTags.contactId, aCardForB))).toHaveLength(0);
    expect(await env.FILES.head(cardKey)).toBeNull();
    expect(await byId(aOther)).toBeDefined();
    expect(await db.select().from(contactTags).where(eq(contactTags.contactId, aOtherTagged))).toHaveLength(1);

    // B keeps a plain card for A, but it is no longer a Chatsoon connection.
    expect(await byId(bCardForA)).toMatchObject({ name: 'Blocker A', linkedUserId: null });
    expect(await byId(bCardForC)).toMatchObject({ linkedUserId: c.userId });
  });

  it('deletes only card photos that no remaining contact of mine still uses', async () => {
    const a = await user('blk-files-a@example.com', 'Files A');
    const b = await user('blk-files-b@example.com', 'Files B');
    const cardKey = () => `u/${a.userId}/card/${crypto.randomUUID()}.jpg`;
    const shared = cardKey();
    const unique = cardKey();
    const avatar = `u/${a.userId}/avatar/${crypto.randomUUID()}.jpg`;
    const theirs = `u/${b.userId}/card/${crypto.randomUUID()}.jpg`;
    for (const key of [shared, unique, avatar, theirs]) await env.FILES.put(key, 'jpeg');

    // Two linked cards for B (one sharing its photo with an unrelated contact), and two with keys
    // that a block must never delete: my avatar and a file under B's prefix.
    const linked = { linkedUserId: b.userId, source: 'app_connect' } as const;
    await addContact(a.userId, { name: 'Files B', ...linked, cardImageKey: shared });
    await addContact(a.userId, { name: 'Files B again', ...linked, cardImageKey: unique });
    await addContact(a.userId, { name: 'Files B odd 1', ...linked, cardImageKey: avatar });
    await addContact(a.userId, { name: 'Files B odd 2', ...linked, cardImageKey: theirs });
    const keeper = await addContact(a.userId, { name: 'Same photo', cardImageKey: shared });

    expect((await block(a.token, { targetUserId: b.userId })).status).toBe(201);

    const left = await db.select().from(contacts).where(eq(contacts.userId, a.userId));
    expect(left.map((r) => r.id)).toEqual([keeper]);
    expect(await env.FILES.head(unique)).toBeNull();
    expect(await env.FILES.head(shared)).not.toBeNull();
    expect(await env.FILES.head(avatar)).not.toBeNull();
    expect(await env.FILES.head(theirs)).not.toBeNull();
  });

  it('is idempotent and works by user id without a connection', async () => {
    const a = await user('blk-idem-a@example.com', 'Idem A');
    const b = await user('blk-idem-b@example.com', 'Idem B');

    expect((await block(a.token, { targetUserId: b.userId })).status).toBe(201);
    expect((await block(a.token, { targetUserId: b.userId })).status).toBe(201);
    expect((await block(a.token, { targetSlug: b.slug })).status).toBe(201);

    const rows = await db
      .select()
      .from(blocks)
      .where(and(eq(blocks.blockerId, a.userId), eq(blocks.blockedId, b.userId)));
    expect(rows).toHaveLength(1);
    // Blocking never creates a connection.
    const pair = [a.userId, b.userId].sort() as [string, string];
    expect(
      await db
        .select()
        .from(connections)
        .where(and(eq(connections.userA, pair[0]), eq(connections.userB, pair[1]))),
    ).toHaveLength(0);
  });
});

describe('DELETE /blocks/:userId', () => {
  it('requires a session', async () => {
    expect((await unblock(undefined, crypto.randomUUID())).status).toBe(401);
  });

  it('removes only my block; the connection stays blocked', async () => {
    const a = await user('unblk-a@example.com', 'Unblock A');
    const b = await user('unblk-b@example.com', 'Unblock B');
    const connectionId = await connect(a.userId, b.userId);

    expect((await block(a.token, { targetUserId: b.userId })).status).toBe(201);
    expect((await block(b.token, { targetUserId: a.userId })).status).toBe(201);

    // A unblocking B lifts only A's block. B's block of A stays.
    const res = await unblock(a.token, b.userId);
    expect(res.status).toBe(204);
    expect(await res.text()).toBe('');

    const remaining = await db
      .select()
      .from(blocks)
      .where(and(eq(blocks.blockedId, a.userId), eq(blocks.blockerId, b.userId)));
    expect(remaining).toHaveLength(1);
    expect(await db.select().from(blocks).where(eq(blocks.blockerId, a.userId))).toHaveLength(0);

    const [conn] = await db.select().from(connections).where(eq(connections.id, connectionId));
    expect(conn?.status).toBe('blocked');

    // Unblocking someone who is not blocked is a no-op.
    expect((await unblock(a.token, b.userId)).status).toBe(204);
    expect((await unblock(a.token, crypto.randomUUID())).status).toBe(204);
  });

  it('also accepts the public slug, since a profile screen only knows that', async () => {
    const a = await user('unblk-slug-a@example.com', 'Slug A');
    const b = await user('unblk-slug-b@example.com', 'Slug B');
    const c = await user('unblk-slug-c@example.com', 'Slug C');
    expect((await block(a.token, { targetSlug: b.slug })).status).toBe(201);
    expect((await block(c.token, { targetSlug: b.slug })).status).toBe(201);

    expect((await unblock(a.token, b.slug.toUpperCase())).status).toBe(204);
    const blockers = await db.select({ id: blocks.blockerId }).from(blocks).where(eq(blocks.blockedId, b.userId));
    expect(blockers).toEqual([{ id: c.userId }]);

    // An unknown slug is a quiet no-op, like an unknown id.
    expect((await unblock(a.token, 'nobody-here-0000')).status).toBe(204);
  });

  it("cannot remove another user's block", async () => {
    const a = await user('unblk-x-a@example.com', 'Cross A');
    const b = await user('unblk-x-b@example.com', 'Cross B');
    const c = await user('unblk-x-c@example.com', 'Cross C');
    expect((await block(b.token, { targetUserId: c.userId })).status).toBe(201);

    // A tries to unblock C: only A's (non-existent) block is in scope.
    expect((await unblock(a.token, c.userId)).status).toBe(204);
    expect(
      await db
        .select()
        .from(blocks)
        .where(and(eq(blocks.blockerId, b.userId), eq(blocks.blockedId, c.userId))),
    ).toHaveLength(1);
  });
});
