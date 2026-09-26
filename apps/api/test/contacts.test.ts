import type { ApiErrorBody, Contact, ContactsResponse, Tag } from '@chatsoon/shared';
import { env } from 'cloudflare:workers';
import { and, eq } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';

import { contacts, contactTags, events } from '../src/db/schema';
import { getDb } from '../src/lib/db';
import { contactTagWrites } from '../src/lib/tags';
import { MAX_CONTACTS_PER_USER } from '../src/routes/contacts';
import { call, signIn } from './helpers';

type Session = { token: string; userId: string };

let a: Session;
let b: Session;

beforeAll(async () => {
  a = await signIn('contacts-a@example.com');
  b = await signIn('contacts-b@example.com');
});

async function create(s: Session, json: Record<string, unknown>): Promise<Contact> {
  const res = await call('/contacts', { method: 'POST', token: s.token, json });
  if (res.status !== 201) throw new Error(`create failed ${res.status}: ${await res.text()}`);
  return (await res.json()) as Contact;
}

async function createTag(s: Session, name: string): Promise<Tag> {
  const res = await call('/tags', { method: 'POST', token: s.token, json: { name } });
  if (!res.ok) throw new Error(`tag failed ${res.status}: ${await res.text()}`);
  return (await res.json()) as Tag;
}

async function list(s: Session, query = ''): Promise<Contact[]> {
  const res = await call(`/contacts${query}`, { token: s.token });
  expect(res.status).toBe(200);
  return ((await res.json()) as ContactsResponse).contacts;
}

async function errorOf(res: Response) {
  return ((await res.json()) as ApiErrorBody).error;
}

/** Card images are deleted in waitUntil, after the response. */
async function eventually(check: () => Promise<boolean>): Promise<boolean> {
  for (let i = 0; i < 100; i++) {
    if (await check()) return true;
    await new Promise((r) => setTimeout(r, 20));
  }
  return false;
}

describe('auth', () => {
  it('requires a session on every contacts route', async () => {
    const id = crypto.randomUUID();
    const responses = await Promise.all([
      call('/contacts'),
      call(`/contacts/${id}`),
      call('/contacts', { method: 'POST', json: { name: 'X' } }),
      call(`/contacts/${id}`, { method: 'PUT', json: { name: 'X' } }),
      call(`/contacts/${id}`, { method: 'DELETE' }),
    ]);
    expect(responses.map((r) => r.status)).toEqual([401, 401, 401, 401, 401]);
  });
});

describe('POST /contacts', () => {
  it('creates a manual contact with defaults', async () => {
    const res = await call('/contacts', { method: 'POST', token: a.token, json: { name: '  Ada Lovelace  ', company: '' } });
    expect(res.status).toBe(201);
    const contact = (await res.json()) as Contact;
    expect(contact).toMatchObject({
      name: 'Ada Lovelace',
      company: null,
      source: 'manual',
      extractionStatus: 'none',
      linkedUserId: null,
      linkedSlug: null,
      cardImageKey: null,
      cardImageUrl: null,
      priority: null,
      eventId: null,
      tagIds: [],
    });
    expect(contact.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(contact.createdAt).toBe(contact.updatedAt);
  });

  it('stores every optional field', async () => {
    const contact = await create(a, {
      name: 'Grace Hopper',
      company: 'Navy',
      role: 'Rear Admiral',
      email: 'grace@example.com',
      phone: '+1 555 0100',
      telegram: '@grace',
      xHandle: 'grace',
      linkedinUrl: 'https://linkedin.com/in/grace',
      website: 'https://grace.example.com',
      notes: 'Met at the COBOL booth',
      priority: 5,
      eventId: 'evt_token2049',
      source: 'qr_scan',
    });
    expect(contact).toMatchObject({
      company: 'Navy',
      role: 'Rear Admiral',
      email: 'grace@example.com',
      phone: '+1 555 0100',
      telegram: '@grace',
      xHandle: 'grace',
      linkedinUrl: 'https://linkedin.com/in/grace',
      website: 'https://grace.example.com',
      notes: 'Met at the COBOL booth',
      priority: 5,
      eventId: 'evt_token2049',
      source: 'qr_scan',
      extractionStatus: 'none',
    });
  });

  it('rejects invalid input with 400', async () => {
    const bodies: unknown[] = [
      {},
      { name: '   ' },
      { name: 'X', priority: 6 },
      { name: 'X', priority: 2.5 },
      { name: 'X', id: 'not-a-uuid' },
      { name: 'X', source: 'web_connect' },
      { name: 'X', source: 'app_connect' },
      { name: 'X', extractionStatus: 'processing' },
      { name: 'X', tagIds: 'nope' },
      { name: 'x'.repeat(121) },
    ];
    for (const json of bodies) {
      const res = await call('/contacts', { method: 'POST', token: a.token, json });
      expect(res.status, JSON.stringify(json)).toBe(400);
      expect((await errorOf(res)).code).toBe('bad_request');
    }
    const notJson = await call('/contacts', {
      method: 'POST',
      token: a.token,
      body: 'name=X',
      headers: { 'Content-Type': 'application/json' },
    });
    expect(notJson.status).toBe(400);
  });

  it('is idempotent for a client-generated id', async () => {
    const id = crypto.randomUUID();
    const first = await call('/contacts', { method: 'POST', token: a.token, json: { id, name: 'Offline Olivia' } });
    expect(first.status).toBe(201);
    const created = (await first.json()) as Contact;
    expect(created.id).toBe(id);

    const retry = await call('/contacts', { method: 'POST', token: a.token, json: { id, name: 'Changed on retry' } });
    expect(retry.status).toBe(200);
    expect(await retry.json()).toEqual(created);

    const mine = await list(a);
    expect(mine.filter((c) => c.id === id)).toHaveLength(1);
  });

  it('answers a duplicate create arriving at the same moment with the same contact', async () => {
    const tag = await createTag(a, 'Race Tag');
    const id = crypto.randomUUID();
    const json = { id, name: 'Racing Rae', tagIds: [tag.id] };
    const responses = await Promise.all([
      call('/contacts', { method: 'POST', token: a.token, json }),
      call('/contacts', { method: 'POST', token: a.token, json }),
    ]);
    expect(responses.map((r) => r.status).sort()).toEqual([200, 201]);
    const [first, second] = (await Promise.all(responses.map((r) => r.json()))) as Contact[];
    expect(first).toEqual(second);
    expect(first!.tagIds).toEqual([tag.id]);
    expect((await list(a)).filter((c) => c.id === id)).toHaveLength(1);
  });

  it("returns 409 for someone else's id without revealing their contact", async () => {
    const id = crypto.randomUUID();
    await create(a, { id, name: 'Secret Sam', notes: 'private note' });

    const res = await call('/contacts', { method: 'POST', token: b.token, json: { id, name: 'Mallory' } });
    expect(res.status).toBe(409);
    const text = await res.text();
    expect(JSON.parse(text).error.code).toBe('conflict');
    expect(text).not.toContain('Secret Sam');
    expect(text).not.toContain('private note');

    // A's contact is untouched and B got nothing.
    const got = await call(`/contacts/${id}`, { token: a.token });
    expect(((await got.json()) as Contact).name).toBe('Secret Sam');
    expect((await list(b)).some((c) => c.id === id)).toBe(false);
  });

  it('attaches my tags and rejects anyone else’s with 400', async () => {
    const mine = await createTag(a, 'Contacts Test Tag');
    const theirs = await createTag(b, 'B Only Tag');

    const ok = await create(a, { name: 'Tagged Tom', tagIds: [mine.id, mine.id] });
    expect(ok.tagIds).toEqual([mine.id]);

    const id = crypto.randomUUID();
    const res = await call('/contacts', {
      method: 'POST',
      token: a.token,
      json: { id, name: 'Wrong Tag', tagIds: [mine.id, theirs.id] },
    });
    expect(res.status).toBe(400);
    expect((await errorOf(res)).message).toBe('Unknown tag');
    // Nothing was written.
    expect((await call(`/contacts/${id}`, { token: a.token })).status).toBe(404);

    const unknown = await call('/contacts', { method: 'POST', token: a.token, json: { name: 'X', tagIds: ['nope'] } });
    expect(unknown.status).toBe(400);
  });

  it('attaches many tags in one request', async () => {
    const created: Tag[] = [];
    for (let i = 0; i < 40; i++) created.push(await createTag(a, `Bulk ${i}`));
    const ids = created.map((t) => t.id);
    const contact = await create(a, { name: 'Many Tags', tagIds: ids });
    expect([...contact.tagIds].sort()).toEqual([...ids].sort());
  });

  it('accepts public events and my own private events only', async () => {
    const res = await call('/events', { method: 'POST', token: a.token, json: { name: 'A Private Dinner' } });
    expect(res.status).toBe(201);
    const privateEvent = (await res.json()) as { id: string; isPublic: boolean };
    expect(privateEvent.isPublic).toBe(false);

    expect((await create(a, { name: 'At Token2049', eventId: 'evt_token2049' })).eventId).toBe('evt_token2049');
    expect((await create(a, { name: 'At dinner', eventId: privateEvent.id })).eventId).toBe(privateEvent.id);

    const other = await call('/contacts', { method: 'POST', token: b.token, json: { name: 'X', eventId: privateEvent.id } });
    expect(other.status).toBe(400);
    expect((await errorOf(other)).message).toBe('Unknown event');

    const unknown = await call('/contacts', { method: 'POST', token: a.token, json: { name: 'X', eventId: 'evt_nope' } });
    expect(unknown.status).toBe(400);
  });

  it('accepts a card image under my prefix and marks extraction pending', async () => {
    const key = `u/${a.userId}/card/${crypto.randomUUID()}.jpg`;
    const contact = await create(a, { name: 'New card', source: 'card_photo', cardImageKey: key });
    expect(contact.cardImageKey).toBe(key);
    expect(contact.cardImageUrl).toContain('/files/');
    expect(contact.cardImageUrl).toContain('sig=');
    expect(contact.extractionStatus).toBe('pending');

    // Client-provided status wins; a card photo without an image is not pending.
    expect((await create(a, { name: 'Reviewed', source: 'card_photo', cardImageKey: key, extractionStatus: 'needs_review' })).extractionStatus).toBe('needs_review');
    expect((await create(a, { name: 'No image', source: 'card_photo' })).extractionStatus).toBe('none');
  });

  it('rejects card image keys outside my card prefix', async () => {
    const keys = [
      `u/${b.userId}/card/${crypto.randomUUID()}.jpg`,
      `u/${a.userId}/avatar/${crypto.randomUUID()}.jpg`,
      `u/${a.userId}/card/../../${b.userId}/card/x.jpg`,
      `u/${a.userId}x/card/x.jpg`,
      'card/x.jpg',
    ];
    for (const cardImageKey of keys) {
      const res = await call('/contacts', {
        method: 'POST',
        token: a.token,
        json: { name: 'New card', source: 'card_photo', cardImageKey },
      });
      expect(res.status, cardImageKey).toBe(400);
      expect((await errorOf(res)).message).toBe('Invalid card image');
    }
  });
});

describe('GET /contacts/:id', () => {
  it('returns my contact and 404 for anyone else', async () => {
    const contact = await create(a, { name: 'Findable Fran' });
    const mine = await call(`/contacts/${contact.id}`, { token: a.token });
    expect(mine.status).toBe(200);
    expect(await mine.json()).toEqual(contact);

    const theirs = await call(`/contacts/${contact.id}`, { token: b.token });
    expect(theirs.status).toBe(404);
    expect((await errorOf(theirs)).code).toBe('not_found');

    expect((await call(`/contacts/${crypto.randomUUID()}`, { token: a.token })).status).toBe(404);
  });
});

describe('PUT /contacts/:id', () => {
  it('updates only the provided keys and bumps updatedAt', async () => {
    const tag1 = await createTag(a, 'Put One');
    const tag2 = await createTag(a, 'Put Two');
    const before = await create(a, {
      name: 'Patch Pat',
      company: 'Acme',
      notes: 'Keep me',
      priority: 2,
      tagIds: [tag1.id],
    });
    await new Promise((r) => setTimeout(r, 5));

    const res = await call(`/contacts/${before.id}`, {
      method: 'PUT',
      token: a.token,
      json: { company: 'Globex', role: '', priority: null, extractionStatus: 'confirmed' },
    });
    expect(res.status).toBe(200);
    const after = (await res.json()) as Contact;
    expect(after).toMatchObject({
      name: 'Patch Pat',
      company: 'Globex',
      role: null,
      notes: 'Keep me',
      priority: null,
      extractionStatus: 'confirmed',
      tagIds: [tag1.id],
      createdAt: before.createdAt,
    });
    expect(after.updatedAt > before.updatedAt).toBe(true);

    const retagged = await call(`/contacts/${before.id}`, { method: 'PUT', token: a.token, json: { tagIds: [tag2.id] } });
    expect(((await retagged.json()) as Contact).tagIds).toEqual([tag2.id]);

    const cleared = await call(`/contacts/${before.id}`, { method: 'PUT', token: a.token, json: { tagIds: [] } });
    expect(((await cleared.json()) as Contact).tagIds).toEqual([]);
  });

  it('validates input and references', async () => {
    const contact = await create(a, { name: 'Valid Val', eventId: 'evt_token2049' });
    const theirTag = await createTag(b, 'B Put Tag');
    const bodies: unknown[] = [
      { name: '' },
      { priority: 0 },
      { extractionStatus: 'pending' },
      { tagIds: [theirTag.id] },
      { eventId: 'evt_nope' },
      { cardImageKey: `u/${b.userId}/card/x.jpg` },
      { cardImageKey: `u/${a.userId}/avatar/x.jpg` },
      // A bad reference fails the whole update, not just that key.
      { name: 'Renamed', notes: 'New notes', tagIds: [theirTag.id] },
      { tagIds: Array.from({ length: 51 }, () => crypto.randomUUID()) },
    ];
    for (const json of bodies) {
      const res = await call(`/contacts/${contact.id}`, { method: 'PUT', token: a.token, json });
      expect(res.status, JSON.stringify(json)).toBe(400);
    }
    const unchanged = (await (await call(`/contacts/${contact.id}`, { token: a.token })).json()) as Contact;
    expect(unchanged).toEqual(contact);

    // Clearing references is always allowed.
    const res = await call(`/contacts/${contact.id}`, { method: 'PUT', token: a.token, json: { eventId: null } });
    expect(((await res.json()) as Contact).eventId).toBeNull();
  });

  it("returns 404 when B updates A's contact and changes nothing", async () => {
    const contact = await create(a, { name: 'Protected Pia' });
    const res = await call(`/contacts/${contact.id}`, { method: 'PUT', token: b.token, json: { name: 'Hacked' } });
    expect(res.status).toBe(404);
    expect((await errorOf(res)).code).toBe('not_found');
    const got = (await (await call(`/contacts/${contact.id}`, { token: a.token })).json()) as Contact;
    expect(got).toEqual(contact);

    const missing = await call(`/contacts/${crypto.randomUUID()}`, { method: 'PUT', token: a.token, json: { name: 'X' } });
    expect(missing.status).toBe(404);
  });

  it('replaces up to 50 tags in one update', async () => {
    const created: Tag[] = [];
    for (let i = 0; i < 50; i++) created.push(await createTag(a, `Put Bulk ${i}`));
    const contact = await create(a, { name: 'Bulk Put', tagIds: created.slice(0, 3).map((t) => t.id) });

    const ids = created.map((t) => t.id);
    const res = await call(`/contacts/${contact.id}`, { method: 'PUT', token: a.token, json: { tagIds: ids } });
    expect(res.status).toBe(200);
    expect([...((await res.json()) as Contact).tagIds].sort()).toEqual([...ids].sort());

    const fewer = await call(`/contacts/${contact.id}`, { method: 'PUT', token: a.token, json: { tagIds: [ids[7]] } });
    expect(((await fewer.json()) as Contact).tagIds).toEqual([ids[7]]);
  });

  it('keeps an unchanged card image and deletes a removed one', async () => {
    const key = `u/${a.userId}/card/${crypto.randomUUID()}.jpg`;
    await env.FILES.put(key, 'card');
    const contact = await create(a, { name: 'Keep Or Clear', source: 'card_photo', cardImageKey: key });

    const same = await call(`/contacts/${contact.id}`, {
      method: 'PUT',
      token: a.token,
      json: { cardImageKey: key, notes: 'Still has the photo' },
    });
    expect(same.status).toBe(200);
    await new Promise((r) => setTimeout(r, 200));
    expect(await env.FILES.head(key)).not.toBeNull();

    const cleared = await call(`/contacts/${contact.id}`, { method: 'PUT', token: a.token, json: { cardImageKey: null } });
    expect(cleared.status).toBe(200);
    expect(((await cleared.json()) as Contact).cardImageKey).toBeNull();
    expect(await eventually(async () => (await env.FILES.head(key)) === null)).toBe(true);
  });

  it('removes a replaced card image from storage', async () => {
    const oldKey = `u/${a.userId}/card/${crypto.randomUUID()}.jpg`;
    const newKey = `u/${a.userId}/card/${crypto.randomUUID()}.jpg`;
    await env.FILES.put(oldKey, 'old');
    await env.FILES.put(newKey, 'new');
    const contact = await create(a, { name: 'Swap Card', source: 'card_photo', cardImageKey: oldKey });

    const res = await call(`/contacts/${contact.id}`, { method: 'PUT', token: a.token, json: { cardImageKey: newKey } });
    expect(res.status).toBe(200);
    expect(((await res.json()) as Contact).cardImageKey).toBe(newKey);
    expect(await eventually(async () => (await env.FILES.head(oldKey)) === null)).toBe(true);
    expect(await env.FILES.head(newKey)).not.toBeNull();
  });
});

describe('DELETE /contacts/:id', () => {
  it("returns 404 when B deletes A's contact", async () => {
    const contact = await create(a, { name: 'Keep Kim' });
    expect((await call(`/contacts/${contact.id}`, { method: 'DELETE', token: b.token })).status).toBe(404);
    expect((await call(`/contacts/${contact.id}`, { token: a.token })).status).toBe(200);
  });

  it('deletes the contact, its tags and its card image', async () => {
    const tag = await createTag(a, 'Delete Tag');
    const key = `u/${a.userId}/card/${crypto.randomUUID()}.jpg`;
    await env.FILES.put(key, 'jpeg bytes');
    const contact = await create(a, { name: 'Gone Gus', source: 'card_photo', cardImageKey: key, tagIds: [tag.id] });

    const res = await call(`/contacts/${contact.id}`, { method: 'DELETE', token: a.token });
    expect(res.status).toBe(204);
    expect(await res.text()).toBe('');

    expect((await call(`/contacts/${contact.id}`, { token: a.token })).status).toBe(404);
    expect((await call(`/contacts/${contact.id}`, { method: 'DELETE', token: a.token })).status).toBe(404);

    const links = await getDb(env)
      .select()
      .from(contactTags)
      .where(and(eq(contactTags.userId, a.userId), eq(contactTags.contactId, contact.id)));
    expect(links).toHaveLength(0);
    expect(await eventually(async () => (await env.FILES.head(key)) === null)).toBe(true);
  });

  it('keeps a card image that another of my contacts still uses', async () => {
    const key = `u/${a.userId}/card/${crypto.randomUUID()}.jpg`;
    await env.FILES.put(key, 'shared');
    const first = await create(a, { name: 'Shared One', source: 'card_photo', cardImageKey: key });
    await create(a, { name: 'Shared Two', source: 'card_photo', cardImageKey: key });

    expect((await call(`/contacts/${first.id}`, { method: 'DELETE', token: a.token })).status).toBe(204);
    // Give a pending waitUntil the chance to (wrongly) run.
    await new Promise((r) => setTimeout(r, 200));
    expect(await env.FILES.head(key)).not.toBeNull();
  });

  it('never deletes a file outside my card folder', async () => {
    // Not possible through the API, but a contact row must never be able to erase my avatar.
    const avatarKey = `u/${a.userId}/avatar/${crypto.randomUUID()}.jpg`;
    await env.FILES.put(avatarKey, 'avatar');
    const id = crypto.randomUUID();
    await getDb(env).insert(contacts).values({ id, userId: a.userId, name: 'Odd Row', cardImageKey: avatarKey });

    expect((await call(`/contacts/${id}`, { method: 'DELETE', token: a.token })).status).toBe(204);
    await new Promise((r) => setTimeout(r, 200));
    expect(await env.FILES.head(avatarKey)).not.toBeNull();
  });

  it('returns 404 for an unknown id', async () => {
    const res = await call(`/contacts/${crypto.randomUUID()}`, { method: 'DELETE', token: a.token });
    expect(res.status).toBe(404);
    expect((await errorOf(res)).code).toBe('not_found');
  });
});

describe('GET /contacts search and filters', () => {
  let s: Session;
  let investor: Tag;
  let founder: Tag;
  let eventId: string;
  const ids: Record<string, string> = {};

  beforeAll(async () => {
    s = await signIn('contacts-search@example.com');
    investor = await createTag(s, 'Angel Investor');
    founder = await createTag(s, 'Founder Friend');
    const evt = await call('/events', { method: 'POST', token: s.token, json: { name: 'Search Summit' } });
    eventId = ((await evt.json()) as { id: string }).id;

    const tick = () => new Promise((r) => setTimeout(r, 5));
    ids.maria = (await create(s, { name: 'María José', company: 'Acme Labs', tagIds: [investor.id], eventId })).id;
    await tick();
    ids.bob = (
      await create(s, {
        name: 'Bob Stone',
        role: 'CTO',
        email: 'bob@stone.dev',
        phone: '+61 412 345 678',
        telegram: '@bobstone',
        notes: 'Wants an intro to the Midnight team',
        tagIds: [founder.id],
      })
    ).id;
    await tick();
    ids.cara = (
      await create(s, { name: 'Cara Diaz', xHandle: 'caradiaz', website: 'https://cara.example.com', eventId })
    ).id;
  });

  const names = (contacts: Contact[]) => contacts.map((c) => c.name).sort();
  const q = (text: string) => `?q=${encodeURIComponent(text)}`;

  it('lists everything newest first without a query', async () => {
    const all = await list(s);
    expect(all.map((c) => c.id)).toEqual([ids.cara, ids.bob, ids.maria]);
    expect(await list(s, '?q=&tag=&event=')).toHaveLength(3);
  });

  it('matches name, company and notes case-insensitively', async () => {
    expect(names(await list(s, q('BOB')))).toEqual(['Bob Stone']);
    expect(names(await list(s, q('acme')))).toEqual(['María José']);
    expect(names(await list(s, q('midnight TEAM')))).toEqual(['Bob Stone']);
  });

  it('matches tag names', async () => {
    expect(names(await list(s, q('investor')))).toEqual(['María José']);
    expect(names(await list(s, q('founder friend')))).toEqual(['Bob Stone']);
  });

  it('matches the event name', async () => {
    expect(names(await list(s, q('summit')))).toEqual(['Cara Diaz', 'María José']);
    expect(names(await list(s, q('search summit acme')))).toEqual(['María José']);
  });

  it('matches contact fields, handles and phone fragments', async () => {
    expect(names(await list(s, q('stone.dev')))).toEqual(['Bob Stone']);
    expect(names(await list(s, q('cto')))).toEqual(['Bob Stone']);
    expect(names(await list(s, q('@bobstone')))).toEqual(['Bob Stone']);
    expect(names(await list(s, q('@caradiaz')))).toEqual(['Cara Diaz']);
    expect(names(await list(s, q('cara.example')))).toEqual(['Cara Diaz']);
    expect(names(await list(s, q('0412-345')))).toEqual(['Bob Stone']);
    expect(names(await list(s, q('412345678')))).toEqual(['Bob Stone']);
  });

  it('ignores accents and requires every term to match', async () => {
    expect(names(await list(s, q('maria jose')))).toEqual(['María José']);
    expect(names(await list(s, q('bob acme')))).toEqual([]);
    expect(await list(s, q('nobody-matches-this'))).toEqual([]);
  });

  it('filters by tag and event, combined with search', async () => {
    expect(names(await list(s, `?tag=${investor.id}`))).toEqual(['María José']);
    expect(names(await list(s, `?event=${eventId}`))).toEqual(['Cara Diaz', 'María José']);
    expect(names(await list(s, `?event=${eventId}&q=cara`))).toEqual(['Cara Diaz']);
    expect(names(await list(s, `?event=${eventId}&tag=${founder.id}`))).toEqual([]);
    expect(await list(s, '?tag=unknown')).toEqual([]);
  });

  it("never returns another user's contacts", async () => {
    expect(await list(b, q('bob'))).toEqual([]);
    expect(await list(b, `?tag=${investor.id}`)).toEqual([]);
    expect(await list(b, `?event=${eventId}`)).toEqual([]);
    const bAll = await list(b);
    expect(bAll.some((c) => Object.values(ids).includes(c.id))).toBe(false);
  });

  it('rejects an overlong query', async () => {
    const res = await call(`/contacts${q('x'.repeat(201))}`, { token: s.token });
    expect(res.status).toBe(400);
  });
});

describe('atomic tag writes', () => {
  it('rolls back the contact write when a tag link fails', async () => {
    const db = getDb(env);
    const id = crypto.randomUUID();
    // A tag id that does not exist fails its foreign key, as when a tag is deleted mid-request.
    await expect(
      db.batch([
        db.insert(contacts).values({ id, userId: a.userId, name: 'Half Written' }),
        ...contactTagWrites(db, a.userId, id, [crypto.randomUUID()]),
      ]),
    ).rejects.toThrow();
    expect((await call(`/contacts/${id}`, { token: a.token })).status).toBe(404);

    const contact = await create(a, { name: 'Edit Rollback', notes: 'Original' });
    await expect(
      db.batch([
        db.update(contacts).set({ notes: 'Changed' }).where(eq(contacts.id, contact.id)),
        ...contactTagWrites(db, a.userId, contact.id, [crypto.randomUUID()]),
      ]),
    ).rejects.toThrow();
    expect(((await (await call(`/contacts/${contact.id}`, { token: a.token })).json()) as Contact).notes).toBe('Original');
  });
});

describe('event visibility guard', () => {
  it("does not let a contact point at another user's private event via PUT", async () => {
    const [privateEvent] = await getDb(env)
      .insert(events)
      .values({ id: crypto.randomUUID(), name: 'A only', isPublic: false, createdBy: a.userId })
      .returning();
    const contact = await create(b, { name: 'B contact' });
    const res = await call(`/contacts/${contact.id}`, {
      method: 'PUT',
      token: b.token,
      json: { eventId: privateEvent!.id },
    });
    expect(res.status).toBe(400);
  });
});

describe('follow-up due dates (issue #33)', () => {
  const DAY_MS = 24 * 60 * 60 * 1000;

  it('sets follow_up_due_at from priority and created_at on POST /contacts', async () => {
    const cases: { priority?: number | null; days: number }[] = [
      { priority: 5, days: 0 },
      { priority: 4, days: 0 },
      { priority: 3, days: 1 },
      { priority: null, days: 1 },
      { days: 1 }, // no priority key at all
      { priority: 2, days: 2 },
      { priority: 1, days: 2 },
    ];
    for (const { priority, days } of cases) {
      const json: Record<string, unknown> = { name: `Due priority ${priority ?? 'none'}` };
      if (priority !== undefined) json.priority = priority;
      const contact = await create(a, json);
      expect(contact.followedUpAt, JSON.stringify(json)).toBeNull();
      expect(contact.followUpChannel, JSON.stringify(json)).toBeNull();
      const dueMs = new Date(contact.followUpDueAt!).getTime();
      const createdMs = new Date(contact.createdAt).getTime();
      expect(dueMs - createdMs, JSON.stringify(json)).toBe(days * DAY_MS);
    }
  });

  it('does not backfill a contact that predates the feature', async () => {
    const id = crypto.randomUUID();
    await getDb(env).insert(contacts).values({ id, userId: a.userId, name: 'Pre-existing Pete', priority: 5 });
    const got = await call(`/contacts/${id}`, { token: a.token });
    expect(((await got.json()) as Contact).followUpDueAt).toBeNull();
  });

  it('recomputes due from the original created_at when priority changes before following up', async () => {
    const contact = await create(a, { name: 'Recompute Rae', priority: 1 });
    const res = await call(`/contacts/${contact.id}`, { method: 'PUT', token: a.token, json: { priority: 5 } });
    expect(res.status).toBe(200);
    const updated = (await res.json()) as Contact;
    expect(updated.followUpDueAt).toBe(updated.createdAt);
    expect(updated.createdAt).toBe(contact.createdAt);
  });

  it('does not recompute due once already followed up', async () => {
    const contact = await create(a, { name: 'Settled Sam', priority: 2 });
    const followedUp = await call(`/contacts/${contact.id}/follow-up`, {
      method: 'POST',
      token: a.token,
      json: { channel: 'copy' },
    });
    expect(followedUp.status).toBe(200);

    const res = await call(`/contacts/${contact.id}`, { method: 'PUT', token: a.token, json: { priority: 5 } });
    expect(res.status).toBe(200);
    expect(((await res.json()) as Contact).followUpDueAt).toBeNull();
  });

  it('leaves due alone when the update does not touch priority', async () => {
    const contact = await create(a, { name: 'Untouched Ted', priority: 2 });
    const res = await call(`/contacts/${contact.id}`, { method: 'PUT', token: a.token, json: { notes: 'hi' } });
    expect(res.status).toBe(200);
    expect(((await res.json()) as Contact).followUpDueAt).toBe(contact.followUpDueAt);
  });
});

describe('POST /contacts/:id/follow-up', () => {
  it('marks a contact followed up, records the channel, and clears the due date', async () => {
    const contact = await create(a, { name: 'Follow Fred', priority: 3 });
    expect(contact.followUpDueAt).not.toBeNull();

    const before = Date.now();
    const res = await call(`/contacts/${contact.id}/follow-up`, {
      method: 'POST',
      token: a.token,
      json: { channel: 'whatsapp' },
    });
    expect(res.status).toBe(200);
    const updated = (await res.json()) as Contact;
    expect(updated.followUpChannel).toBe('whatsapp');
    expect(updated.followUpDueAt).toBeNull();
    expect(new Date(updated.followedUpAt!).getTime()).toBeGreaterThanOrEqual(before);
  });

  it('moves followedUpAt to the latest time when followed up again, with the newest channel', async () => {
    const contact = await create(a, { name: 'Repeat Rae' });
    const first = await call(`/contacts/${contact.id}/follow-up`, {
      method: 'POST',
      token: a.token,
      json: { channel: 'email' },
    });
    const firstContact = (await first.json()) as Contact;
    await new Promise((r) => setTimeout(r, 5));
    const second = await call(`/contacts/${contact.id}/follow-up`, {
      method: 'POST',
      token: a.token,
      json: { channel: 'sms' },
    });
    const secondContact = (await second.json()) as Contact;
    expect(secondContact.followUpChannel).toBe('sms');
    expect(secondContact.followedUpAt! > firstContact.followedUpAt!).toBe(true);
  });

  it('rejects an unknown channel', async () => {
    const contact = await create(a, { name: 'Bad Channel' });
    const res = await call(`/contacts/${contact.id}/follow-up`, {
      method: 'POST',
      token: a.token,
      json: { channel: 'fax' },
    });
    expect(res.status).toBe(400);
  });

  it("404s for another user's contact, and for an unknown one", async () => {
    const contact = await create(a, { name: 'Not Yours' });
    const theirs = await call(`/contacts/${contact.id}/follow-up`, {
      method: 'POST',
      token: b.token,
      json: { channel: 'copy' },
    });
    expect(theirs.status).toBe(404);
    const unknown = await call(`/contacts/${crypto.randomUUID()}/follow-up`, {
      method: 'POST',
      token: a.token,
      json: { channel: 'copy' },
    });
    expect(unknown.status).toBe(404);
  });
});

describe('DELETE /contacts/:id/follow-up (undo)', () => {
  it('restores exactly the prior values the client passes', async () => {
    const contact = await create(a, { name: 'Undo Uma', priority: 4 });
    const marked = await call(`/contacts/${contact.id}/follow-up`, {
      method: 'POST',
      token: a.token,
      json: { channel: 'linkedin' },
    });
    expect(marked.status).toBe(200);

    const res = await call(`/contacts/${contact.id}/follow-up`, {
      method: 'DELETE',
      token: a.token,
      json: {
        previous: {
          followedUpAt: null,
          followUpChannel: null,
          followUpDueAt: contact.followUpDueAt,
        },
      },
    });
    expect(res.status).toBe(200);
    const restored = (await res.json()) as Contact;
    expect(restored.followedUpAt).toBeNull();
    expect(restored.followUpChannel).toBeNull();
    expect(restored.followUpDueAt).toBe(contact.followUpDueAt);
  });

  it('rejects a malformed previous shape', async () => {
    const contact = await create(a, { name: 'Bad Undo' });
    const res = await call(`/contacts/${contact.id}/follow-up`, {
      method: 'DELETE',
      token: a.token,
      json: { previous: { followedUpAt: 'not-a-date', followUpChannel: null, followUpDueAt: null } },
    });
    expect(res.status).toBe(400);
  });

  it("404s for another user's contact", async () => {
    const contact = await create(a, { name: 'Undo Not Yours' });
    const res = await call(`/contacts/${contact.id}/follow-up`, {
      method: 'DELETE',
      token: b.token,
      json: { previous: { followedUpAt: null, followUpChannel: null, followUpDueAt: null } },
    });
    expect(res.status).toBe(404);
  });
});

describe('PATCH /contacts/:id/follow-up (remind me again)', () => {
  it('sets a due date 3, 7 or 14 days out', async () => {
    const contact = await create(a, { name: 'Remind Rita' });
    for (const days of [3, 7, 14] as const) {
      const before = Date.now();
      const res = await call(`/contacts/${contact.id}/follow-up`, {
        method: 'PATCH',
        token: a.token,
        json: { remindInDays: days },
      });
      expect(res.status).toBe(200);
      const updated = (await res.json()) as Contact;
      const dueMs = new Date(updated.followUpDueAt!).getTime();
      const dayMs = days * 24 * 60 * 60 * 1000;
      expect(dueMs).toBeGreaterThanOrEqual(before + dayMs);
      expect(dueMs).toBeLessThanOrEqual(Date.now() + dayMs);
    }
  });

  it('clears the due date for "Never" (null)', async () => {
    const contact = await create(a, { name: 'Never Nora' });
    const res = await call(`/contacts/${contact.id}/follow-up`, {
      method: 'PATCH',
      token: a.token,
      json: { remindInDays: null },
    });
    expect(res.status).toBe(200);
    expect(((await res.json()) as Contact).followUpDueAt).toBeNull();
  });

  it('rejects a remindInDays value that is not 3, 7, 14 or null', async () => {
    const contact = await create(a, { name: 'Bad Remind' });
    const res = await call(`/contacts/${contact.id}/follow-up`, {
      method: 'PATCH',
      token: a.token,
      json: { remindInDays: 5 },
    });
    expect(res.status).toBe(400);
  });

  it("404s for another user's contact", async () => {
    const contact = await create(a, { name: 'Remind Not Yours' });
    const res = await call(`/contacts/${contact.id}/follow-up`, {
      method: 'PATCH',
      token: b.token,
      json: { remindInDays: 3 },
    });
    expect(res.status).toBe(404);
  });
});

describe('growth limits', () => {
  it('rate limits writes that add rows per user, across contacts, tags and events', { timeout: 60_000 }, async () => {
    const intoWindow = Date.now() % 60_000;
    if (intoWindow > 40_000) await new Promise((r) => setTimeout(r, 60_000 - intoWindow + 250));
    const w = await signIn('contacts-writer@example.com');
    const ip = { 'cf-connecting-ip': '203.0.113.90' };
    const post = (path: string, json: unknown, s: Session = w) =>
      call(path, { method: 'POST', token: s.token, json, headers: ip });

    // WRITE_LIMITER allows 120 a minute: plenty for the outbox syncing a day of offline contacts.
    let firstId: string | undefined;
    for (let i = 0; i < 118; i++) {
      const res = await post('/contacts', { name: `Bulk ${i}` });
      expect(res.status).toBe(201);
      if (i === 0) firstId = ((await res.json()) as Contact).id;
    }
    expect((await post('/tags', { name: 'Late tag' })).status).toBe(201);
    expect((await post('/events', { name: 'Late event' })).status).toBe(201);
    for (const [path, json] of [
      ['/contacts', { name: 'One too many' }],
      ['/tags', { name: 'One tag too many' }],
      ['/events', { name: 'One event too many' }],
    ] as const) {
      const res = await post(path, json);
      expect(res.status, path).toBe(429);
      expect((await errorOf(res)).code).toBe('rate_limited');
    }
    // The follow-up endpoints share the same per-user WRITE_LIMITER.
    const followUp = await post(`/contacts/${firstId}/follow-up`, { channel: 'copy' });
    expect(followUp.status).toBe(429);
    // Other users are unaffected, and so are reads and edits.
    expect((await post('/contacts', { name: 'Someone else' }, b)).status).toBe(201);
    expect((await call('/contacts', { token: w.token, headers: ip })).status).toBe(200);
  });

  it(`caps a user at ${MAX_CONTACTS_PER_USER} contacts, still answering retries of saved ones`, async () => {
    const full = await signIn('contacts-full@example.com');
    const saved = await create(full, { id: crypto.randomUUID(), name: 'Saved first' });
    await env.DB.prepare(
      `WITH RECURSIVE n(x) AS (SELECT 1 UNION ALL SELECT x + 1 FROM n WHERE x < ?2)
       INSERT INTO contacts (id, user_id, name) SELECT lower(hex(randomblob(16))), ?1, 'Filler ' || x FROM n`,
    )
      .bind(full.userId, MAX_CONTACTS_PER_USER - 1)
      .run();

    const res = await call('/contacts', { method: 'POST', token: full.token, json: { name: 'Over the cap' } });
    expect(res.status).toBe(409);
    expect((await errorOf(res)).message).toBe('You have reached the limit of 10,000 contacts');

    const retry = await call('/contacts', {
      method: 'POST',
      token: full.token,
      json: { id: saved.id, name: 'Saved first' },
    });
    expect(retry.status).toBe(200);
    await env.DB.prepare('DELETE FROM contacts WHERE user_id = ?').bind(full.userId).run();
  });
});
