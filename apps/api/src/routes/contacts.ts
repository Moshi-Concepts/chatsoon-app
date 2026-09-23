import {
  contactCreateSchema,
  contactUpdateSchema,
  type Contact,
  type ContactsResponse,
  type ExtractionStatus,
} from '@chatsoon/shared';
import { and, eq } from 'drizzle-orm';
import { Hono, type Context } from 'hono';
import { z } from 'zod';

import { contacts, tags, type ContactRow } from '../db/schema';
import type { AppEnv } from '../env';
import { getContact, loadContacts } from '../lib/contacts';
import { getDb, type DB } from '../lib/db';
import { badRequest, conflict, notFound, parseJson } from '../lib/errors';
import { newId } from '../lib/ids';
import { requireAuth } from '../lib/middleware';
import { ownsKey, userPrefix } from '../lib/signing';
import { assertTagsOwned, contactTagWrites } from '../lib/tags';
import { assertEventVisible, listVisibleEvents } from './events';

export const contactsRoutes = new Hono<AppEnv>();

// ---- Search ----

const listQuerySchema = z.object({
  q: z.string().trim().max(200).optional(),
  tag: z.string().trim().max(100).optional(),
  event: z.string().trim().max(100).optional(),
});

const SEARCH_FIELDS = [
  'name',
  'company',
  'role',
  'email',
  'phone',
  'telegram',
  'xHandle',
  'linkedinUrl',
  'website',
  'notes',
] as const satisfies readonly (keyof Contact)[];

/** Lowercases and strips accents so "jose" finds "José". */
const fold = (s: string) => s.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase();

/** Names of my tags and of the events I can see, by id. */
type SearchNames = { tags: Map<string, string>; events: Map<string, string> };

/**
 * True when every whitespace-separated term of the query appears in one of the contact's
 * searchable fields, tag names or event name (like the app's own search). "@handle" also
 * matches "handle", and phone fragments match regardless of spacing or punctuation.
 */
function matchesQuery(contact: Contact, names: SearchNames, terms: string[]): boolean {
  const parts: string[] = [];
  for (const field of SEARCH_FIELDS) {
    const value = contact[field];
    if (value) parts.push(value);
  }
  for (const id of contact.tagIds) {
    const name = names.tags.get(id);
    if (name) parts.push(name);
  }
  const eventName = contact.eventId ? names.events.get(contact.eventId) : undefined;
  if (eventName) parts.push(eventName);
  // Newline-joined so a term never matches across two fields.
  const haystack = fold(parts.join('\n'));
  const phoneDigits = contact.phone?.replace(/\D/g, '') ?? '';

  return terms.every((term) => {
    if (haystack.includes(term)) return true;
    if (term.length > 1 && term.startsWith('@') && haystack.includes(term.slice(1))) return true;
    // Leading zeros dropped so a local "0412 345" finds "+61 412 345 678".
    const digits = term.replace(/\D/g, '').replace(/^0+/, '');
    return digits.length >= 3 && /^[\d+().-]+$/.test(term) && phoneDigits.includes(digits);
  });
}

// ---- Helpers ----

/** Card photos live under u/<me>/card/ (POST /files?purpose=card). Never my avatar or anyone else's file. */
const isCardKey = (userId: string, key: string) =>
  ownsKey(userId, key) && key.startsWith(`${userPrefix(userId)}card/`);

async function findMine(db: DB, userId: string, id: string): Promise<ContactRow | undefined> {
  const [row] = await db
    .select()
    .from(contacts)
    .where(and(eq(contacts.id, id), eq(contacts.userId, userId)))
    .limit(1);
  return row;
}

async function mustGetContact(c: Context<AppEnv>, db: DB, id: string): Promise<Contact> {
  const contact = await getContact(c.env, db, c.get('user').id, id);
  if (!contact) throw notFound('Contact not found');
  return contact;
}

/**
 * Validates the references a client can set. Values unchanged from `current` are not
 * rechecked. Throws 400 before anything is written.
 */
async function assertRefs(
  db: DB,
  userId: string,
  input: { cardImageKey?: string | null; eventId?: string | null; tagIds?: string[] },
  current?: ContactRow,
) {
  const { cardImageKey, eventId, tagIds } = input;
  if (cardImageKey && cardImageKey !== current?.cardImageKey && !isCardKey(userId, cardImageKey)) {
    throw badRequest('Invalid card image');
  }
  if (eventId && eventId !== current?.eventId) await assertEventVisible(db, userId, eventId);
  if (tagIds?.length) await assertTagsOwned(db, userId, tagIds);
}

/**
 * Deletes a card image from R2 after the response, unless another of my contacts still
 * points at it. Only keys under the user's own card prefix are ever deleted.
 */
function releaseCardImage(c: Context<AppEnv>, db: DB, userId: string, key: string) {
  if (!isCardKey(userId, key)) return;
  c.executionCtx.waitUntil(
    (async () => {
      const [stillUsed] = await db
        .select({ id: contacts.id })
        .from(contacts)
        .where(and(eq(contacts.userId, userId), eq(contacts.cardImageKey, key)))
        .limit(1);
      if (!stillUsed) await c.env.FILES.delete(key);
    })().catch((err) => console.error('Failed to delete card image', key, err)),
  );
}

// ---- Routes ----

/** My contacts, newest first. Optional filters: q (text search), tag (tag id), event (event id). */
contactsRoutes.get('/contacts', requireAuth, async (c) => {
  const userId = c.get('user').id;
  const { q, tag, event } = listQuerySchema.parse(c.req.query());
  const db = getDb(c.env);

  let list = await loadContacts(c.env, db, userId);
  if (tag) list = list.filter((contact) => contact.tagIds.includes(tag));
  if (event) list = list.filter((contact) => contact.eventId === event);

  const terms = q ? fold(q).split(/\s+/).filter(Boolean) : [];
  if (terms.length > 0 && list.length > 0) {
    const [tagRows, eventRows] = await Promise.all([
      db.select({ id: tags.id, name: tags.name }).from(tags).where(eq(tags.userId, userId)),
      listVisibleEvents(db, userId),
    ]);
    const names: SearchNames = {
      tags: new Map(tagRows.map((t) => [t.id, t.name])),
      events: new Map(eventRows.map((e) => [e.id, e.name])),
    };
    list = list.filter((contact) => matchesQuery(contact, names, terms));
  }

  return c.json({ contacts: list } satisfies ContactsResponse);
});

contactsRoutes.get('/contacts/:id', requireAuth, async (c) => {
  return c.json(await mustGetContact(c, getDb(c.env), c.req.param('id')));
});

/**
 * Creates a contact. A client-generated id makes offline retries idempotent: if I already
 * have a contact with that id it is returned unchanged with 200.
 */
contactsRoutes.post('/contacts', requireAuth, async (c) => {
  const userId = c.get('user').id;
  const input = await parseJson(c, contactCreateSchema);
  const db = getDb(c.env);

  /** Answer for an id that is already taken: mine is a retry, anyone else's is a conflict. */
  const existingResponse = async (id: string) => {
    const [row] = await db.select({ userId: contacts.userId }).from(contacts).where(eq(contacts.id, id)).limit(1);
    if (!row) return null;
    if (row.userId !== userId) throw conflict('This contact id is already in use');
    return c.json(await mustGetContact(c, db, id), 200);
  };

  if (input.id) {
    const retry = await existingResponse(input.id);
    if (retry) return retry;
  }

  const cardImageKey = input.cardImageKey || null;
  const eventId = input.eventId || null;
  await assertRefs(db, userId, { cardImageKey, eventId, tagIds: input.tagIds });

  const extractionStatus: ExtractionStatus =
    input.extractionStatus ?? (input.source === 'card_photo' && cardImageKey ? 'pending' : 'none');
  const id = input.id ?? newId();
  const now = new Date();

  const insertContact = db.insert(contacts).values({
    id,
    userId,
    name: input.name,
    company: input.company ?? null,
    role: input.role ?? null,
    email: input.email ?? null,
    phone: input.phone ?? null,
    telegram: input.telegram ?? null,
    xHandle: input.xHandle ?? null,
    linkedinUrl: input.linkedinUrl ?? null,
    website: input.website ?? null,
    cardImageKey,
    notes: input.notes ?? null,
    priority: input.priority ?? null,
    eventId,
    source: input.source,
    extractionStatus,
    createdAt: now,
    updatedAt: now,
  });
  const tagWrites = input.tagIds?.length ? contactTagWrites(db, userId, id, input.tagIds) : [];

  try {
    // One transaction, so a retry never finds the contact without its tags.
    await db.batch([insertContact, ...tagWrites]);
  } catch (err) {
    // A concurrent request with the same id inserted first (primary key conflict).
    const retry = await existingResponse(id);
    if (retry) return retry;
    throw err;
  }

  return c.json(await mustGetContact(c, db, id), 201);
});

/** Updates only the keys present in the body. tagIds, when present, replaces all tags. */
contactsRoutes.put('/contacts/:id', requireAuth, async (c) => {
  const userId = c.get('user').id;
  const id = c.req.param('id');
  const { tagIds, ...fields } = await parseJson(c, contactUpdateSchema);
  const db = getDb(c.env);

  const current = await findMine(db, userId, id);
  if (!current) throw notFound('Contact not found');

  if (fields.cardImageKey !== undefined) fields.cardImageKey = fields.cardImageKey || null;
  if (fields.eventId !== undefined) fields.eventId = fields.eventId || null;
  await assertRefs(db, userId, { cardImageKey: fields.cardImageKey, eventId: fields.eventId, tagIds }, current);

  const changes = Object.fromEntries(
    Object.entries(fields).filter(([, value]) => value !== undefined),
  ) as Partial<typeof contacts.$inferInsert>;

  let updated: { id: string }[];
  try {
    // Fields and tags in one transaction, so an edit is never half applied.
    [updated] = await db.batch([
      db
        .update(contacts)
        .set({ ...changes, updatedAt: new Date() })
        .where(and(eq(contacts.id, id), eq(contacts.userId, userId)))
        .returning({ id: contacts.id }),
      ...(tagIds === undefined ? [] : contactTagWrites(db, userId, id, tagIds)),
    ]);
  } catch (err) {
    // Deleted while this request ran: the new tag links fail their foreign key.
    if (!(await findMine(db, userId, id))) throw notFound('Contact not found');
    throw err;
  }
  if (updated.length === 0) throw notFound('Contact not found');

  const oldKey = current.cardImageKey;
  if (oldKey && fields.cardImageKey !== undefined && fields.cardImageKey !== oldKey) {
    releaseCardImage(c, db, userId, oldKey);
  }

  return c.json(await mustGetContact(c, db, id));
});

/** Deletes the contact (its contact_tags cascade) and, after the response, its card image. */
contactsRoutes.delete('/contacts/:id', requireAuth, async (c) => {
  const userId = c.get('user').id;
  const db = getDb(c.env);
  const [row] = await db
    .delete(contacts)
    .where(and(eq(contacts.id, c.req.param('id')), eq(contacts.userId, userId)))
    .returning({ cardImageKey: contacts.cardImageKey });
  if (!row) throw notFound('Contact not found');

  if (row.cardImageKey) releaseCardImage(c, db, userId, row.cardImageKey);
  return c.body(null, 204);
});
