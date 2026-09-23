import {
  SEEDED_EVENTS,
  SEEDED_TAGS,
  type ApiErrorBody,
  type ChatsoonEvent,
  type Contact,
  type EventsResponse,
  type Tag,
  type TagsResponse,
} from '@chatsoon/shared';
import { env } from 'cloudflare:workers';
import { eq } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';

import { contactTags, tags } from '../src/db/schema';
import { getDb } from '../src/lib/db';
import { seedDefaultTags } from '../src/lib/tags';
import { call, signIn, signUpWithProfile } from './helpers';

type Session = { token: string; userId: string };

let a: Session;
let b: Session;

beforeAll(async () => {
  a = await signIn('tags-a@example.com');
  b = await signIn('tags-b@example.com');
});

async function listTags(s: Session): Promise<Tag[]> {
  const res = await call('/tags', { token: s.token });
  expect(res.status).toBe(200);
  return ((await res.json()) as TagsResponse).tags;
}

async function postTag(s: Session, name: unknown) {
  const res = await call('/tags', { method: 'POST', token: s.token, json: { name } });
  return { status: res.status, body: (await res.json()) as Tag & ApiErrorBody };
}

async function listEvents(s: Session): Promise<ChatsoonEvent[]> {
  const res = await call('/events', { token: s.token });
  expect(res.status).toBe(200);
  return ((await res.json()) as EventsResponse).events;
}

async function postEvent(s: Session, name: unknown) {
  const res = await call('/events', { method: 'POST', token: s.token, json: { name } });
  return { status: res.status, body: (await res.json()) as ChatsoonEvent & ApiErrorBody };
}

const byName = new Intl.Collator('en', { sensitivity: 'base', numeric: true });

describe('auth', () => {
  it('requires a session', async () => {
    const statuses = await Promise.all([
      call('/tags'),
      call('/tags', { method: 'POST', json: { name: 'X' } }),
      call('/tags/x', { method: 'DELETE' }),
      call('/events'),
      call('/events', { method: 'POST', json: { name: 'X' } }),
    ]);
    expect(statuses.map((r) => r.status)).toEqual([401, 401, 401, 401, 401]);
  });
});

describe('seedDefaultTags', () => {
  it('creates the seeded tags once and skips names I already have in any case', async () => {
    const s = await signIn('tags-seed@example.com');
    const db = getDb(env);
    // Start from a known state whether or not sign-in already seeded.
    await db.delete(tags).where(eq(tags.userId, s.userId));
    await db.insert(tags).values({ id: crypto.randomUUID(), userId: s.userId, name: 'sponsor' });

    await seedDefaultTags(db, s.userId);
    await seedDefaultTags(db, s.userId);

    const names = (await listTags(s)).map((t) => t.name);
    expect(names).toHaveLength(SEEDED_TAGS.length);
    expect(names).toContain('sponsor');
    expect(names).not.toContain('Sponsor');
    for (const seeded of SEEDED_TAGS.filter((n) => n !== 'Sponsor')) expect(names).toContain(seeded);
  });

  it('gives a new account the default tags once onboarding creates the profile', async () => {
    const s = await signUpWithProfile('tags-onboard@example.com', 'Onboard Olly');
    const names = (await listTags(s)).map((t) => t.name);
    expect([...names].sort()).toEqual([...SEEDED_TAGS].sort());
    expect(names).toEqual([...names].sort(byName.compare));

    // Saving the profile again does not add them twice.
    await call('/me/profile', { method: 'PUT', token: s.token, json: { displayName: 'Onboard Olly' } });
    expect(await listTags(s)).toHaveLength(SEEDED_TAGS.length);
  });

  it('only touches the given user', async () => {
    const before = (await listTags(b)).length;
    const s = await signIn('tags-seed-2@example.com');
    await seedDefaultTags(getDb(env), s.userId);
    expect(await listTags(b)).toHaveLength(before);
  });
});

describe('tags', () => {
  it('creates a tag with 201 and returns it', async () => {
    const { status, body } = await postTag(a, '  Speaker  ');
    expect(status).toBe(201);
    expect(body).toEqual({ id: expect.any(String), name: 'Speaker' });
  });

  it('returns the existing tag with 200 for a case-insensitive duplicate', async () => {
    const first = await postTag(a, 'Podcast Guest');
    expect(first.status).toBe(201);
    const again = await postTag(a, 'podcast GUEST');
    expect(again.status).toBe(200);
    expect(again.body).toEqual(first.body);
    expect((await listTags(a)).filter((t) => t.name.toLowerCase() === 'podcast guest')).toHaveLength(1);
  });

  it('lets two users have the same tag name', async () => {
    const mine = await postTag(a, 'Shared Name');
    const theirs = await postTag(b, 'Shared Name');
    expect(mine.status).toBe(201);
    expect(theirs.status).toBe(201);
    expect(theirs.body.id).not.toBe(mine.body.id);
  });

  it('rejects invalid names with 400', async () => {
    for (const name of ['', '   ', 'x'.repeat(41), 42, null]) {
      const { status, body } = await postTag(a, name);
      expect(status, String(name)).toBe(400);
      expect(body.error.code).toBe('bad_request');
    }
  });

  it('lists only my tags, sorted by name ignoring case', async () => {
    await postTag(a, 'zeta');
    await postTag(a, 'Alpha');
    await postTag(a, 'beta');
    const secret = await postTag(b, 'B Secret Tag');

    const mine = await listTags(a);
    const names = mine.map((t) => t.name);
    expect(names).toEqual([...names].sort(byName.compare));
    expect(names.indexOf('Alpha')).toBeLessThan(names.indexOf('beta'));
    expect(names.indexOf('beta')).toBeLessThan(names.indexOf('zeta'));
    expect(mine.some((t) => t.id === secret.body.id)).toBe(false);
  });

  it("returns 404 when deleting someone else's tag", async () => {
    const { body: tag } = await postTag(a, 'Not Yours');
    const res = await call(`/tags/${tag.id}`, { method: 'DELETE', token: b.token });
    expect(res.status).toBe(404);
    expect(((await res.json()) as ApiErrorBody).error.code).toBe('not_found');
    expect((await listTags(a)).some((t) => t.id === tag.id)).toBe(true);
  });

  it('deletes my tag and removes it from my contacts', async () => {
    const { body: tag } = await postTag(a, 'Short Lived');
    const { body: keep } = await postTag(a, 'Long Lived');
    const created = await call('/contacts', {
      method: 'POST',
      token: a.token,
      json: { name: 'Tagged', tagIds: [tag.id, keep.id] },
    });
    const contact = (await created.json()) as Contact;
    expect(contact.tagIds).toHaveLength(2);

    const res = await call(`/tags/${tag.id}`, { method: 'DELETE', token: a.token });
    expect(res.status).toBe(204);
    expect((await listTags(a)).some((t) => t.id === tag.id)).toBe(false);
    expect((await call(`/tags/${tag.id}`, { method: 'DELETE', token: a.token })).status).toBe(404);

    const after = (await (await call(`/contacts/${contact.id}`, { token: a.token })).json()) as Contact;
    expect(after.tagIds).toEqual([keep.id]);
    const links = await getDb(env).select().from(contactTags).where(eq(contactTags.tagId, tag.id));
    expect(links).toHaveLength(0);

    const filtered = await call(`/contacts?tag=${tag.id}`, { token: a.token });
    expect(((await filtered.json()) as { contacts: Contact[] }).contacts).toEqual([]);
    // A deleted tag can no longer be attached.
    const reuse = await call(`/contacts/${contact.id}`, { method: 'PUT', token: a.token, json: { tagIds: [tag.id] } });
    expect(reuse.status).toBe(400);
  });
});

describe('events', () => {
  const [token2049] = SEEDED_EVENTS;

  it('lists the seeded public event', async () => {
    const list = await listEvents(a);
    expect(list).toContainEqual({ id: token2049.id, name: token2049.name, isPublic: true });
  });

  it('reuses a public event by name, ignoring case', async () => {
    const { status, body } = await postEvent(a, '  token2049 ');
    expect(status).toBe(200);
    expect(body).toEqual({ id: token2049.id, name: token2049.name, isPublic: true });
  });

  it('creates a private event once and reuses it', async () => {
    const first = await postEvent(a, 'Founders Breakfast');
    expect(first.status).toBe(201);
    expect(first.body).toEqual({ id: expect.any(String), name: 'Founders Breakfast', isPublic: false });

    const again = await postEvent(a, 'founders breakfast');
    expect(again.status).toBe(200);
    expect(again.body).toEqual(first.body);
  });

  it("keeps private events invisible to other users", async () => {
    const { body: mine } = await postEvent(a, 'A Secret Afterparty');
    expect((await listEvents(a)).some((e) => e.id === mine.id)).toBe(true);
    expect((await listEvents(b)).some((e) => e.id === mine.id)).toBe(false);

    // B asking for the same name gets their own private event, not A's.
    const theirs = await postEvent(b, 'a secret afterparty');
    expect(theirs.status).toBe(201);
    expect(theirs.body.id).not.toBe(mine.id);
    expect(theirs.body.isPublic).toBe(false);
  });

  it('lists public events first, then by name', async () => {
    await postEvent(a, 'zzz Meetup');
    await postEvent(a, 'AAA Meetup');
    const list = await listEvents(a);
    const firstPrivate = list.findIndex((e) => !e.isPublic);
    expect(list.slice(0, firstPrivate).every((e) => e.isPublic)).toBe(true);
    expect(list.slice(firstPrivate).every((e) => !e.isPublic)).toBe(true);
    const privateNames = list.slice(firstPrivate).map((e) => e.name);
    expect(privateNames).toEqual([...privateNames].sort(byName.compare));
    expect(privateNames.indexOf('AAA Meetup')).toBeLessThan(privateNames.indexOf('zzz Meetup'));
  });

  it('rejects invalid names with 400', async () => {
    for (const name of ['', '  ', 'x'.repeat(81), 7]) {
      const { status, body } = await postEvent(a, name);
      expect(status, String(name)).toBe(400);
      expect(body.error.code).toBe('bad_request');
    }
  });
});
