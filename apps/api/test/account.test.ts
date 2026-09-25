import {
  DEMO_PROFILE_SLUG,
  makeSlug,
  profileUrl,
  REVIEWER_EMAIL,
  type ChatsoonEvent,
  type Contact,
  type ContactsResponse,
  type Tag,
  type UploadResponse,
} from '@chatsoon/shared';
import { env } from 'cloudflare:workers';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

import { accounts, connections, contacts, contactTags, events, profiles, tags } from '../src/db/schema';
import { CSV_COLUMNS, csvCell, toCsv } from '../src/lib/account';
import { getDb } from '../src/lib/db';
import { shortSuffix } from '../src/lib/ids';
import { DEMO_USER_ID } from '../src/lib/reviewer';
import { call, signIn, signUpWithProfile } from './helpers';

// Rows owned by other modules (profiles, contacts, tags, connections, files) are seeded straight
// into D1/R2 so these tests only exercise the account and moderation routes.

const db = getDb(env);

async function addProfile(userId: string, displayName: string, avatarKey: string | null = null) {
  const slug = makeSlug(displayName, shortSuffix());
  await db.insert(profiles).values({ userId, displayName, slug, avatarKey });
  return slug;
}

type NewContact = Omit<typeof contacts.$inferInsert, 'id' | 'userId'>;

async function addContact(userId: string, fields: NewContact, tagIds: string[] = []) {
  const id = crypto.randomUUID();
  await db.insert(contacts).values({ id, userId, ...fields });
  if (tagIds.length > 0) await db.insert(contactTags).values(tagIds.map((tagId) => ({ contactId: id, tagId, userId })));
  return id;
}

async function addTag(userId: string, name: string) {
  const id = crypto.randomUUID();
  await db.insert(tags).values({ id, userId, name });
  return id;
}

async function connect(x: string, y: string) {
  const [userA, userB] = [x, y].sort() as [string, string];
  await db.insert(connections).values({ id: crypto.randomUUID(), userA, userB });
}

async function putFile(userId: string, purpose: 'avatar' | 'card') {
  const key = `u/${userId}/${purpose}/${crypto.randomUUID()}.jpg`;
  await env.FILES.put(key, 'image-bytes', { httpMetadata: { contentType: 'image/jpeg' } });
  return key;
}

async function countFiles(prefix: string) {
  let n = 0;
  let cursor: string | undefined;
  do {
    const page = await env.FILES.list({ prefix, cursor });
    n += page.objects.length;
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);
  return n;
}

async function count(query: string, ...params: unknown[]) {
  const row = await env.DB.prepare(query)
    .bind(...params)
    .first<{ n: number }>();
  return row?.n ?? 0;
}

/** Every row that references the user, table by table. */
async function rowsFor(userId: string, email: string) {
  return {
    users: await count('SELECT count(*) n FROM users WHERE id = ? OR email = ?', userId, email),
    sessions: await count('SELECT count(*) n FROM sessions WHERE user_id = ?', userId),
    accounts: await count('SELECT count(*) n FROM accounts WHERE user_id = ?', userId),
    // Better Auth email OTP identifiers are `${type}-otp-${email}`.
    verifications: await count(
      `SELECT count(*) n FROM verifications WHERE identifier IN (?1, 'sign-in-otp-' || ?1,
         'email-verification-otp-' || ?1, 'forget-password-otp-' || ?1)`,
      email,
    ),
    profiles: await count('SELECT count(*) n FROM profiles WHERE user_id = ?', userId),
    contacts: await count('SELECT count(*) n FROM contacts WHERE user_id = ? OR linked_user_id = ?', userId, userId),
    tags: await count('SELECT count(*) n FROM tags WHERE user_id = ?', userId),
    contact_tags: await count('SELECT count(*) n FROM contact_tags WHERE user_id = ?', userId),
    connections: await count('SELECT count(*) n FROM connections WHERE user_a = ? OR user_b = ?', userId, userId),
    blocks: await count('SELECT count(*) n FROM blocks WHERE blocker_id = ? OR blocked_id = ?', userId, userId),
    reports: await count('SELECT count(*) n FROM reports WHERE reporter_id = ? OR target_user_id = ?', userId, userId),
    events: await count('SELECT count(*) n FROM events WHERE created_by = ?', userId),
  };
}

/**
 * Every column with a foreign key to users.id, read from D1 itself rather than listed by hand,
 * so a table another module adds later is checked too.
 */
async function userColumns() {
  const { results: tables } = await env.DB.prepare(
    `SELECT name FROM sqlite_master WHERE type = 'table'
       AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' AND name <> 'd1_migrations'`,
  ).all<{ name: string }>();
  const columns: string[] = [];
  for (const { name } of tables) {
    const { results: fks } = await env.DB.prepare(`PRAGMA foreign_key_list("${name}")`).all<{
      table: string;
      from: string;
    }>();
    for (const fk of fks) if (fk.table === 'users') columns.push(`${name}.${fk.from}`);
  }
  return columns.sort();
}

/** Asserts that no row anywhere in the database still points at the user. */
async function expectNoRowsReferencing(userId: string) {
  const columns = await userColumns();
  // Sanity check that the schema was read: these are the references in the 1.0 schema.
  expect(columns).toEqual(
    expect.arrayContaining([
      'accounts.user_id',
      'blocks.blocked_id',
      'blocks.blocker_id',
      'connections.user_a',
      'connections.user_b',
      'contact_tags.user_id',
      'contacts.linked_user_id',
      'contacts.user_id',
      'events.created_by',
      'profiles.user_id',
      'reports.reporter_id',
      'reports.target_user_id',
      'sessions.user_id',
      'tags.user_id',
    ]),
  );
  const leftovers: Record<string, number> = {};
  for (const column of columns) {
    const [table, name] = column.split('.') as [string, string];
    const n = await count(`SELECT count(*) n FROM "${table}" WHERE "${name}" = ?`, userId);
    if (n > 0) leftovers[column] = n;
  }
  expect(leftovers).toEqual({});
  expect(await count('SELECT count(*) n FROM users WHERE id = ?', userId)).toBe(0);
}

/** A tiny but valid JPEG header: POST /files checks the magic bytes, not the content type. */
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01]);

async function upload(token: string, purpose: 'avatar' | 'card') {
  const res = await call(`/files?purpose=${purpose}`, {
    method: 'POST',
    token,
    headers: { 'Content-Type': 'image/jpeg' },
    body: JPEG,
  });
  expect(res.status, await res.clone().text()).toBe(201);
  return ((await res.json()) as UploadResponse).key;
}

async function postJson<T>(path: string, token: string, json: unknown, status = 201): Promise<T> {
  const res = await call(path, { method: 'POST', token, json });
  expect(res.status, `${path}: ${await res.clone().text()}`).toBe(status);
  return (await res.json()) as T;
}

const ZERO_ROWS = {
  users: 0,
  sessions: 0,
  accounts: 0,
  verifications: 0,
  profiles: 0,
  contacts: 0,
  tags: 0,
  contact_tags: 0,
  connections: 0,
  blocks: 0,
  reports: 0,
  events: 0,
};

/** Minimal RFC 4180 reader: quoted fields, doubled quotes, CRLF record separators only. */
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (ch === '"') {
        quoted = false;
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      quoted = true;
    } else if (ch === ',') {
      row.push(field);
      field = '';
    } else if (ch === '\r' && text[i + 1] === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
      i++;
    } else {
      field += ch;
    }
  }
  if (field !== '' || row.length > 0) rows.push([...row, field]);
  return rows;
}

async function exportCsv(token: string) {
  const res = await call('/me/export.csv', { token });
  expect(res.status).toBe(200);
  // Response.text() strips a BOM, so decode by hand to see exactly what was sent.
  const bytes = new Uint8Array(await res.arrayBuffer());
  const text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
  return { res, bytes, text, rows: parseCsv(text.replace(/^\uFEFF/, '')) };
}

/** CSV rows as objects keyed by column name. */
function records(rows: string[][]) {
  const [header, ...body] = rows;
  return body.map((r) => Object.fromEntries(header!.map((h, i) => [h, r[i]])) as Record<string, string>);
}

describe('DELETE /me', () => {
  it('requires a session', async () => {
    expect((await call('/me', { method: 'DELETE' })).status).toBe(401);
    expect((await call('/me', { method: 'DELETE', token: 'not-a-real-token' })).status).toBe(401);
  });

  it('delete account wipes everything', async () => {
    const emailA = 'wipe-a@example.com';
    const a = await signIn(emailA);
    const secondSession = await signIn(emailA);
    const b = await signIn('wipe-b@example.com');
    const c = await signIn('wipe-c@example.com');

    // Profile, avatar, card and rendered share-card (og) uploads.
    const avatarKey = await putFile(a.userId, 'avatar');
    const cardKeys = [await putFile(a.userId, 'card'), await putFile(a.userId, 'card')];
    // Not produced through PUT /me/profile here (that's covered in pages.test.ts): a plain R2 object
    // is enough to prove deleteUserFiles' whole-prefix sweep (account.ts) also catches u/<id>/og/*
    // (docs/og-plan.md §4 WP-4, "Checked for this plan": the sweep already covers it, unchanged).
    const ogFileKey = `u/${a.userId}/og/deadbeefcafefeed.jpg`;
    await env.FILES.put(ogFileKey, 'rendered-og-card-bytes');
    const aSlug = await addProfile(a.userId, 'Wipe A', avatarKey);
    const bAvatar = await putFile(b.userId, 'avatar');
    await addProfile(b.userId, 'Wipe B', bAvatar);
    const cSlug = await addProfile(c.userId, 'Wipe C');

    // Private event, tags, contacts (manual with card photo, linked to B, at the event).
    const eventId = `evt_${crypto.randomUUID()}`;
    await db.insert(events).values({ id: eventId, name: 'A private meetup', isPublic: false, createdBy: a.userId });
    const angel = await addTag(a.userId, 'Angel');
    const builder = await addTag(a.userId, 'Builder');
    await addContact(a.userId, { name: 'Card person', cardImageKey: cardKeys[0], source: 'card_photo' }, [angel]);
    await addContact(a.userId, { name: 'Card person 2', cardImageKey: cardKeys[1], source: 'card_photo' });
    await addContact(a.userId, { name: 'Wipe B', linkedUserId: b.userId, source: 'app_connect', eventId }, [
      angel,
      builder,
    ]);

    // B keeps a contact card for A (and one unrelated contact).
    const bTag = await addTag(b.userId, 'Partner');
    const bCardForA = await addContact(
      b.userId,
      { name: 'Wipe A', linkedUserId: a.userId, source: 'app_connect', eventId },
      [bTag],
    );
    await addContact(b.userId, { name: 'Someone else' });
    await connect(a.userId, b.userId);

    // Email OTP sign-in creates no accounts row, so add one as a password or OAuth link would.
    await db.insert(accounts).values({
      id: crypto.randomUUID(),
      accountId: a.userId,
      providerId: 'credential',
      userId: a.userId,
    });

    // Reports and blocks in both directions, plus some that do not involve A.
    const report = (token: string, targetSlug: string) =>
      call('/reports', { method: 'POST', token, json: { targetSlug, reason: 'spam' } });
    expect((await report(a.token, cSlug)).status).toBe(201);
    expect((await report(b.token, aSlug)).status).toBe(201);
    expect((await report(b.token, cSlug)).status).toBe(201);
    const block = (token: string, targetUserId: string) =>
      call('/blocks', { method: 'POST', token, json: { targetUserId } });
    expect((await block(a.token, c.userId)).status).toBe(201);
    expect((await block(c.token, a.userId)).status).toBe(201);
    expect((await block(c.token, b.userId)).status).toBe(201);

    // A pending sign-in code for A, and codes for addresses that merely end with A's. The second
    // one's identifier ("sign-in-otp-z-otp-wipe-a@...") even ends with "-otp-" plus A's address.
    const lookAlikes = [`x${emailA}`, `z-otp-${emailA}`];
    for (const email of [emailA, ...lookAlikes]) {
      const res = await call('/auth/email-otp/send-verification-otp', {
        method: 'POST',
        json: { email, type: 'sign-in' },
      });
      expect(res.ok).toBe(true);
    }

    const before = await rowsFor(a.userId, emailA);
    for (const [table, n] of Object.entries(before)) expect(n, table).toBeGreaterThan(0);
    expect(await countFiles(`u/${a.userId}/`)).toBe(4);

    const res = await call('/me', { method: 'DELETE', token: a.token });
    expect(res.status).toBe(204);
    expect(await res.text()).toBe('');

    // Nothing left for A in any table or in R2, including the rendered og card.
    expect(await rowsFor(a.userId, emailA)).toEqual(ZERO_ROWS);
    await expectNoRowsReferencing(a.userId);
    expect(await count('SELECT count(*) n FROM verifications WHERE identifier = ?', `sign-in-otp-${emailA}`)).toBe(0);
    expect(await countFiles(`u/${a.userId}/`)).toBe(0);
    expect(await env.FILES.head(ogFileKey)).toBeNull();

    // Every old token is dead.
    for (const token of [a.token, secondSession.token]) {
      expect((await call('/me/export.csv', { token })).status).toBe(401);
      expect((await call('/me', { method: 'DELETE', token })).status).toBe(401);
    }

    // B keeps the card, no longer linked to A and no longer pointing at A's private event.
    const [bCard] = await db.select().from(contacts).where(eq(contacts.id, bCardForA));
    expect(bCard).toMatchObject({ name: 'Wipe A', linkedUserId: null, eventId: null });
    expect(await count('SELECT count(*) n FROM contacts WHERE user_id = ?', b.userId)).toBe(2);
    expect(await count('SELECT count(*) n FROM contact_tags WHERE user_id = ?', b.userId)).toBe(1);
    expect(await count('SELECT count(*) n FROM profiles WHERE user_id = ?', b.userId)).toBe(1);
    expect(await env.FILES.head(bAvatar)).not.toBeNull();

    // Moderation rows between other users survive.
    const reportsFromTo = 'SELECT count(*) n FROM reports WHERE reporter_id = ? AND target_user_id = ?';
    expect(await count(reportsFromTo, b.userId, c.userId)).toBe(1);
    const blocksFromTo = 'SELECT count(*) n FROM blocks WHERE blocker_id = ? AND blocked_id = ?';
    expect(await count(blocksFromTo, c.userId, b.userId)).toBe(1);

    // The other addresses' pending codes are untouched.
    for (const email of lookAlikes) {
      expect(await count('SELECT count(*) n FROM verifications WHERE identifier = ?', `sign-in-otp-${email}`)).toBe(1);
    }

    // Signing in again starts a brand new, empty account.
    const again = await signIn(emailA);
    expect(again.userId).not.toBe(a.userId);
    const { rows } = await exportCsv(again.token);
    expect(rows).toEqual([[...CSV_COLUMNS]]);
  });

  it('deletes every file when there are more than one page of objects', async () => {
    const u = await signIn('many-files@example.com');
    const other = await signIn('many-files-other@example.com');
    const total = 1203;
    const keys = Array.from({ length: total }, (_, i) => `u/${u.userId}/card/${String(i).padStart(5, '0')}.jpg`);
    for (let i = 0; i < keys.length; i += 100) {
      await Promise.all(keys.slice(i, i + 100).map((k) => env.FILES.put(k, 'x')));
    }
    const otherKey = await putFile(other.userId, 'card');
    expect(await countFiles(`u/${u.userId}/`)).toBe(total);

    expect((await call('/me', { method: 'DELETE', token: u.token })).status).toBe(204);
    expect(await countFiles(`u/${u.userId}/`)).toBe(0);
    expect(await env.FILES.head(otherKey)).not.toBeNull();
  }, 60_000);

  it("wipes everything created through the app's own routes", async () => {
    const a = await signUpWithProfile('e2e-a@example.com', 'E2E Alice');
    const b = await signUpWithProfile('e2e-b@example.com', 'E2E Bob');
    const c = await signUpWithProfile('e2e-c@example.com', 'E2E Carol');

    // Avatar and card photo uploads, a private event, a tag and a card-photo contact.
    const avatarKey = await upload(a.token, 'avatar');
    const put = await call('/me/profile', {
      method: 'PUT',
      token: a.token,
      json: { displayName: 'E2E Alice', avatarKey },
    });
    expect(put.status).toBe(200);
    const cardKey = await upload(a.token, 'card');
    const event = await postJson<ChatsoonEvent>('/events', a.token, { name: 'Alice private dinner' });
    const tag = await postJson<Tag>('/tags', a.token, { name: 'E2E tag' });
    await postJson<Contact>('/contacts', a.token, {
      name: 'Card from the booth',
      cardImageKey: cardKey,
      source: 'card_photo',
      eventId: event.id,
      tagIds: [tag.id],
    });

    // A scans B's QR: a connection plus a linked card in each list.
    await postJson('/connections/scan', a.token, { slug: b.slug, eventId: event.id }, 200);
    const bContacts = async () => {
      const res = await call('/contacts', { token: b.token });
      expect(res.status).toBe(200);
      return ((await res.json()) as ContactsResponse).contacts;
    };
    expect((await bContacts()).find((x) => x.linkedUserId === a.userId)).toBeDefined();

    // Reports and blocks both ways.
    await postJson('/reports', a.token, { targetSlug: c.slug, reason: 'spam' });
    await postJson('/reports', b.token, { targetSlug: a.slug, reason: 'other' });
    await postJson('/blocks', a.token, { targetSlug: c.slug });
    await postJson('/blocks', c.token, { targetSlug: a.slug });
    // Avatar, card photo, and the share card PUT /me/profile pre-rendered for the avatar change.
    expect(await countFiles(`u/${a.userId}/`)).toBe(3);

    const res = await call('/me', { method: 'DELETE', token: a.token });
    expect(res.status).toBe(204);

    await expectNoRowsReferencing(a.userId);
    expect(await count('SELECT count(*) n FROM events WHERE id = ?', event.id)).toBe(0);
    expect(await countFiles(`u/${a.userId}/`)).toBe(0);
    expect((await call('/me', { token: a.token })).status).toBe(401);

    // A's public profile is gone and can no longer be scanned.
    expect((await call(`/id/${a.slug}`)).status).toBe(404);
    expect((await call('/connections/scan', { method: 'POST', token: b.token, json: { slug: a.slug } })).status).toBe(
      404,
    );

    // B keeps a plain card for A that is no longer a Chatsoon connection.
    const kept = (await bContacts()).filter((x) => x.name === 'E2E Alice');
    expect(kept).toEqual([expect.objectContaining({ linkedUserId: null, linkedSlug: null })]);
    const bMe = await call('/me', { token: b.token });
    expect(((await bMe.json()) as { profile: { slug: string } | null }).profile?.slug).toBe(b.slug);
  });

  it('lets the reviewer delete the account and sign straight back in to fresh sample data', async () => {
    const code = env.REVIEWER_CODE;
    expect(code).toMatch(/^\d{6}$/);
    const first = await signIn(REVIEWER_EMAIL, code);
    const before = records((await exportCsv(first.token)).rows);
    expect(before.length).toBeGreaterThan(0);
    // The reviewer starts connected to Maya (the sample connection), not Alex (the profile they scan).
    expect(before).toContainEqual(expect.objectContaining({ chatsoon_profile: profileUrl('maya-lindqvist-demo') }));
    expect(before).not.toContainEqual(expect.objectContaining({ chatsoon_profile: profileUrl(DEMO_PROFILE_SLUG) }));

    expect((await call('/me', { method: 'DELETE', token: first.token })).status).toBe(204);
    await expectNoRowsReferencing(first.userId);
    // The shared demo profile the reviewer was connected to is never touched.
    expect(await count('SELECT count(*) n FROM profiles WHERE user_id = ?', DEMO_USER_ID)).toBe(1);

    const again = await signIn(REVIEWER_EMAIL, code);
    expect(again.userId).not.toBe(first.userId);
    const after = records((await exportCsv(again.token)).rows);
    expect(after.map((r) => r.name).sort()).toEqual(before.map((r) => r.name).sort());
  });

  it("leaves another user's account alone", async () => {
    const a = await signIn('solo-a@example.com');
    const b = await signIn('solo-b@example.com');
    await addProfile(b.userId, 'Solo B');
    await addContact(b.userId, { name: 'Kept' });
    const bFile = await putFile(b.userId, 'card');

    expect((await call('/me', { method: 'DELETE', token: a.token })).status).toBe(204);

    const bRows = await rowsFor(b.userId, 'solo-b@example.com');
    expect(bRows).toMatchObject({ users: 1, profiles: 1, contacts: 1 });
    expect(bRows.sessions).toBeGreaterThan(0);
    expect(await env.FILES.head(bFile)).not.toBeNull();
    const res = await call('/me/export.csv', { token: b.token });
    expect(res.status).toBe(200);
  });
});

describe('GET /me/export.csv', () => {
  it('requires a session', async () => {
    expect((await call('/me/export.csv')).status).toBe(401);
  });

  it('is an RFC 4180 download with a BOM, CRLF line endings and a dated filename', async () => {
    const u = await signIn('csv-format@example.com');
    await addContact(u.userId, { name: 'Plain Person', company: 'Acme' });

    const { res, bytes, text, rows } = await exportCsv(u.token);
    expect(res.headers.get('content-type')).toBe('text/csv; charset=utf-8');
    expect([...bytes.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    const today = new Date().toISOString().slice(0, 10);
    expect(res.headers.get('content-disposition')).toBe(`attachment; filename="chatsoon-contacts-${today}.csv"`);
    expect(res.headers.get('cache-control')).toContain('no-store');

    expect(text.charCodeAt(0)).toBe(0xfeff);
    expect(text.endsWith('\r\n')).toBe(true);
    expect(text.replace(/\r\n/g, '')).not.toMatch(/[\r\n]/);
    expect(text.slice(1).split('\r\n')[0]).toBe(
      'name,company,role,email,phone,telegram,x,linkedin,website,tags,event,priority,notes,source,' +
        'chatsoon_profile,created_at,updated_at',
    );
    expect(rows).toHaveLength(2);
    expect(rows[1]!.slice(0, 2)).toEqual(['Plain Person', 'Acme']);
  });

  it('exports only a header row when there are no contacts', async () => {
    const u = await signIn('csv-empty@example.com');
    const { text } = await exportCsv(u.token);
    expect(text).toBe(`\uFEFF${CSV_COLUMNS.join(',')}\r\n`);
  });

  it('fills every column, including tags, event and the linked Chatsoon profile', async () => {
    const u = await signIn('csv-full@example.com');
    const friend = await signIn('csv-full-friend@example.com');
    const friendSlug = await addProfile(friend.userId, 'Friend Person');
    const zeta = await addTag(u.userId, 'Zeta');
    const alpha = await addTag(u.userId, 'Alpha');
    await addTag(u.userId, 'Unused');

    await addContact(
      u.userId,
      {
        name: 'Friend Person',
        company: 'Friends Inc',
        role: 'CTO',
        email: 'friend@example.com',
        phone: '0400 000 000',
        telegram: 'friendtg',
        xHandle: 'friendx',
        linkedinUrl: 'https://www.linkedin.com/in/friend',
        website: 'https://friend.example.com',
        notes: 'Met at the booth',
        priority: 4,
        eventId: 'evt_token2049',
        source: 'app_connect',
        linkedUserId: friend.userId,
        createdAt: new Date('2026-09-20T10:00:00.000Z'),
        updatedAt: new Date('2026-09-21T11:30:00.000Z'),
      },
      [zeta, alpha],
    );
    await addContact(u.userId, { name: 'Later Person', createdAt: new Date('2026-09-22T09:00:00.000Z') });

    const { rows } = await exportCsv(u.token);
    const [first, second] = records(rows);
    expect(first).toEqual({
      name: 'Friend Person',
      company: 'Friends Inc',
      role: 'CTO',
      email: 'friend@example.com',
      phone: '0400 000 000',
      telegram: 'friendtg',
      x: 'friendx',
      linkedin: 'https://www.linkedin.com/in/friend',
      website: 'https://friend.example.com',
      tags: 'Alpha; Zeta',
      event: 'Token2049',
      priority: '4',
      notes: 'Met at the booth',
      source: 'app_connect',
      chatsoon_profile: profileUrl(friendSlug),
      created_at: '2026-09-20T10:00:00.000Z',
      updated_at: '2026-09-21T11:30:00.000Z',
    });
    expect(second).toMatchObject({ name: 'Later Person', tags: '', event: '', priority: '', chatsoon_profile: '' });
    expect(rows.every((r) => r.length === CSV_COLUMNS.length)).toBe(true);
  });

  it('quotes special characters and neutralises spreadsheet formulas', async () => {
    const u = await signIn('csv-escape@example.com');
    const tag = await addTag(u.userId, '=cmd|tag');
    await addContact(
      u.userId,
      {
        name: '=HYPERLINK("https://evil.example","click")',
        company: 'Acme, Inc.',
        role: '-2+3',
        email: '@SUM(A1:A2)',
        phone: '+61 400 000 000',
        telegram: '\tTAB',
        xHandle: '\rCR',
        notes: 'Line one\nLine two, with "quotes"\r\nLine three',
        website: 'https://ok.example/a-b=c',
      },
      [tag],
    );

    const { text, rows } = await exportCsv(u.token);
    const [r] = records(rows);
    expect(r).toMatchObject({
      name: `'=HYPERLINK("https://evil.example","click")`,
      company: 'Acme, Inc.',
      role: "'-2+3",
      email: "'@SUM(A1:A2)",
      phone: "'+61 400 000 000",
      telegram: "'\tTAB",
      x: "'\rCR",
      notes: 'Line one\nLine two, with "quotes"\r\nLine three',
      website: 'https://ok.example/a-b=c',
      tags: "'=cmd|tag",
    });
    // Raw encoding: quoted where needed, inner quotes doubled.
    expect(text).toContain(
      `"'=HYPERLINK(""https://evil.example"",""click"")","Acme, Inc.",'-2+3,'@SUM(A1:A2),` +
        `'+61 400 000 000,'\tTAB,"'\rCR"`,
    );
    expect(text).toContain('"Line one\nLine two, with ""quotes""\r\nLine three"');
    expect(rows).toHaveLength(2);
  });

  it("user A cannot see user B's data", async () => {
    const a = await signIn('iso-a@example.com');
    const b = await signIn('iso-b@example.com');
    const bSecretTag = await addTag(b.userId, 'B secret tag');
    const bEvent = `evt_${crypto.randomUUID()}`;
    await db.insert(events).values({ id: bEvent, name: 'B private event', isPublic: false, createdBy: b.userId });
    await addContact(b.userId, { name: 'B contact', notes: 'B private note', eventId: bEvent }, [bSecretTag]);
    // A's contact points at B's private event (should never happen, but must not leak its name).
    await addContact(a.userId, { name: 'A contact', eventId: bEvent });

    const aExport = await exportCsv(a.token);
    expect(records(aExport.rows)).toEqual([expect.objectContaining({ name: 'A contact', event: '' })]);
    expect(aExport.text).not.toContain('B contact');
    expect(aExport.text).not.toContain('B private');
    expect(aExport.text).not.toContain('B secret tag');

    const bExport = await exportCsv(b.token);
    expect(records(bExport.rows)).toEqual([
      expect.objectContaining({ name: 'B contact', event: 'B private event', tags: 'B secret tag' }),
    ]);
    expect(bExport.text).not.toContain('A contact');
  });
});

describe('csv helpers', () => {
  it('escapes single cells', () => {
    expect(csvCell(null)).toBe('');
    expect(csvCell(undefined)).toBe('');
    expect(csvCell(3)).toBe('3');
    expect(csvCell('plain text')).toBe('plain text');
    expect(csvCell('a,b')).toBe('"a,b"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell('two\nlines')).toBe('"two\nlines"');
    expect(csvCell('=1+1')).toBe("'=1+1");
    expect(csvCell('+1')).toBe("'+1");
    expect(csvCell('-1')).toBe("'-1");
    expect(csvCell('@x')).toBe("'@x");
    expect(csvCell('\tx')).toBe("'\tx");
    expect(csvCell('\rx')).toBe(`"'\rx"`);
    expect(csvCell('=A1,"x"')).toBe(`"'=A1,""x"""`);
    expect(csvCell('mid=dle')).toBe('mid=dle');
  });

  it('joins rows with CRLF behind a BOM', () => {
    expect(toCsv([['a', 'b'], ['c', null]])).toBe('\uFEFFa,b\r\nc,\r\n');
  });
});
