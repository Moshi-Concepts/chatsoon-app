import {
  contactCreateSchema,
  contactUpdateSchema,
  followUpDueAt,
  followUpFirstName,
  followUpInputSchema,
  followUpTemplateBody,
  remindDueAt,
  remindFollowUpSchema,
  undoFollowUpSchema,
  type Contact,
  type ContactsResponse,
  type ExtractionStatus,
  type FollowUpDraftResponse,
} from '@chatsoon/shared';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { Hono, type Context } from 'hono';
import { z } from 'zod';

import { contacts, events, tags, type ContactRow } from '../db/schema';
import type { AppEnv } from '../env';
import { draftFollowUp, FollowUpDraftError } from '../lib/anthropic';
import { getContact, loadContacts } from '../lib/contacts';
import { getDb, type DB } from '../lib/db';
import { badRequest, conflict, limit, notFound, parseJson, userKey } from '../lib/errors';
import { newId } from '../lib/ids';
import { requireAuth } from '../lib/middleware';
import { findProfileByUserId } from '../lib/profiles';
import { isCardKey } from '../lib/signing';
import { assertTagsOwned, contactTagWrites } from '../lib/tags';
import { reserveFollowUpDraft } from '../lib/usage';
import { assertEventVisible, listVisibleEvents } from './events';

export const contactsRoutes = new Hono<AppEnv>();

/** Far more than anyone meets at events, and it keeps one account from filling the shared database. */
export const MAX_CONTACTS_PER_USER = 10_000;

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
  await limit(c.env.WRITE_LIMITER, userKey(c, 'write', userId));
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

  // After the retry check, so an offline retry of a saved contact still gets its 200.
  const [owned] = await db.select({ n: sql<number>`count(*)` }).from(contacts).where(eq(contacts.userId, userId));
  if ((owned?.n ?? 0) >= MAX_CONTACTS_PER_USER) {
    throw conflict(`You have reached the limit of ${MAX_CONTACTS_PER_USER.toLocaleString('en')} contacts`);
  }

  const cardImageKey = input.cardImageKey || null;
  const eventId = input.eventId || null;
  await assertRefs(db, userId, { cardImageKey, eventId, tagIds: input.tagIds });

  const extractionStatus: ExtractionStatus =
    input.extractionStatus ?? (input.source === 'card_photo' && cardImageKey ? 'pending' : 'none');
  const id = input.id ?? newId();
  const now = new Date();
  const priority = input.priority ?? null;

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
    priority,
    eventId,
    source: input.source,
    extractionStatus,
    // Issue #33: every creation path is due a follow-up from day one, timed by priority. Existing
    // contacts (from before this shipped) are never backfilled - only ever set here, on insert.
    followUpDueAt: followUpDueAt(priority, now),
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

  // Issue #33: a priority change before the first follow-up moves the due date, timed from the
  // contact's original createdAt (not now). Once followed up, priority no longer touches it - only
  // POST/PATCH /contacts/:id/follow-up do.
  if (fields.priority !== undefined && fields.priority !== current.priority && current.followedUpAt === null) {
    changes.followUpDueAt = followUpDueAt(fields.priority, current.createdAt);
  }

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

// ---- Follow-ups (issue #33) ----

/** Marks a contact followed up: sets followedUpAt to now, records the channel, and clears any due date. */
contactsRoutes.post('/contacts/:id/follow-up', requireAuth, async (c) => {
  const userId = c.get('user').id;
  const id = c.req.param('id');
  await limit(c.env.WRITE_LIMITER, userKey(c, 'write', userId));
  const { channel } = await parseJson(c, followUpInputSchema);
  const db = getDb(c.env);

  const [updated] = await db
    .update(contacts)
    .set({ followedUpAt: new Date(), followUpChannel: channel, followUpDueAt: null, updatedAt: new Date() })
    .where(and(eq(contacts.id, id), eq(contacts.userId, userId)))
    .returning({ id: contacts.id });
  if (!updated) throw notFound('Contact not found');

  return c.json(await mustGetContact(c, db, id));
});

/**
 * Undo (about 8s after marking followed up, or until dismissed): restores exactly the prior values
 * the client passes. The server keeps no history of its own, so this trusts the client's copy of
 * what the contact looked like just before - the same way any other edit does.
 */
contactsRoutes.delete('/contacts/:id/follow-up', requireAuth, async (c) => {
  const userId = c.get('user').id;
  const id = c.req.param('id');
  await limit(c.env.WRITE_LIMITER, userKey(c, 'write', userId));
  const { previous } = await parseJson(c, undoFollowUpSchema);
  const db = getDb(c.env);

  const [updated] = await db
    .update(contacts)
    .set({
      followedUpAt: previous.followedUpAt ? new Date(previous.followedUpAt) : null,
      followUpChannel: previous.followUpChannel,
      followUpDueAt: previous.followUpDueAt ? new Date(previous.followUpDueAt) : null,
      updatedAt: new Date(),
    })
    .where(and(eq(contacts.id, id), eq(contacts.userId, userId)))
    .returning({ id: contacts.id });
  if (!updated) throw notFound('Contact not found');

  return c.json(await mustGetContact(c, db, id));
});

/** "Remind me again": sets the next due date `remindInDays` from now, or clears it for "Never". */
contactsRoutes.patch('/contacts/:id/follow-up', requireAuth, async (c) => {
  const userId = c.get('user').id;
  const id = c.req.param('id');
  await limit(c.env.WRITE_LIMITER, userKey(c, 'write', userId));
  const { remindInDays } = await parseJson(c, remindFollowUpSchema);
  const db = getDb(c.env);
  const now = new Date();

  const [updated] = await db
    .update(contacts)
    .set({ followUpDueAt: remindDueAt(remindInDays, now), updatedAt: now })
    .where(and(eq(contacts.id, id), eq(contacts.userId, userId)))
    .returning({ id: contacts.id });
  if (!updated) throw notFound('Contact not found');

  return c.json(await mustGetContact(c, db, id));
});

/**
 * Drafts a follow-up message body with Claude, from the caller's own profile and their notes about
 * this contact (issue #33 PR B). Always answers 200 with a usable body: the fixed template whenever
 * the AI draft is switched off, over its daily spend cap, or the model call itself fails - so the
 * app never has to show an error for this, only the per-minute rate limiter still answers 429.
 */
contactsRoutes.post('/contacts/:id/follow-up/draft', requireAuth, async (c) => {
  const userId = c.get('user').id;
  const id = c.req.param('id');
  const db = getDb(c.env);

  // 404 before anything else: never spend a model call, or even reveal whether the id exists, for a
  // contact that isn't mine.
  const contact = await mustGetContact(c, db, id);
  await limit(c.env.FOLLOWUP_LIMITER, userKey(c, 'followup-draft', userId));

  const eventName = contact.eventId
    ? ((await db.select({ name: events.name }).from(events).where(eq(events.id, contact.eventId)).limit(1))[0]?.name ??
      null)
    : null;

  // Filled in immediately either way, so the sheet is never left with an empty draft.
  const templateBody = followUpTemplateBody(followUpFirstName(contact.name), eventName);
  const respondTemplate = (limited?: boolean) => {
    const body: FollowUpDraftResponse = { body: templateBody, source: 'template' };
    if (limited) body.limited = true;
    return c.json(body);
  };

  const budget = await reserveFollowUpDraft(c.env, userId);
  if (!budget.ok) return respondTemplate(budget.reason === 'user_limit');

  const [profile, tagRows] = await Promise.all([
    findProfileByUserId(db, userId),
    contact.tagIds.length
      ? db
          .select({ name: tags.name })
          .from(tags)
          .where(and(eq(tags.userId, userId), inArray(tags.id, contact.tagIds)))
      : Promise.resolve([]),
  ]);

  try {
    const body = await draftFollowUp(c.env, {
      sender: {
        displayName: profile?.displayName ?? '',
        role: profile?.role ?? null,
        company: profile?.company ?? null,
        headline: profile?.headline ?? null,
      },
      contact: {
        name: contact.name,
        company: contact.company,
        role: contact.role,
        // Untrusted: draftFollowUp's prompt treats every one of these contact fields as data, never
        // instructions (issue #33 PR B prompt-injection safety) - notes most of all, since they're
        // free text the user themselves wrote about someone else.
        notes: contact.notes,
        tagNames: tagRows.map((t) => t.name),
        priority: contact.priority,
        eventName,
        source: contact.source,
      },
    });
    return c.json({ body, source: 'ai' } satisfies FollowUpDraftResponse);
  } catch (err) {
    if (!(err instanceof FollowUpDraftError)) console.error('Follow-up draft failed', err);
    return respondTemplate();
  }
});
