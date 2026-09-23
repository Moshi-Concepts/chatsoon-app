import { SEEDED_TAGS } from '@chatsoon/shared';
import { and, eq, inArray } from 'drizzle-orm';
import type { BatchItem } from 'drizzle-orm/batch';

import { contactTags, tags, type TagRow } from '../db/schema';
import { chunk } from './contacts';
import type { DB } from './db';
import { badRequest } from './errors';
import { newId } from './ids';

/** Rows per insert for 3-column rows (contact_tags, tags): 90 bound parameters, under D1's 100. */
const ROWS_PER_INSERT = 30;

/** Tag names are unique per user, ignoring case and surrounding space. */
export const tagNameKey = (name: string) => name.trim().toLowerCase();

const collator = new Intl.Collator('en', { sensitivity: 'base', numeric: true });

/** A user's tags, sorted by name (case-insensitive). */
export async function listTags(db: DB, userId: string): Promise<TagRow[]> {
  const rows = await db.select().from(tags).where(eq(tags.userId, userId));
  return rows.sort((a, b) => collator.compare(a.name, b.name) || a.id.localeCompare(b.id));
}

/** The user's tag with this name, compared case-insensitively. */
export async function findTagByName(db: DB, userId: string, name: string): Promise<TagRow | undefined> {
  const key = tagNameKey(name);
  const rows = await db.select().from(tags).where(eq(tags.userId, userId));
  return rows.find((t) => tagNameKey(t.name) === key);
}

/** Throws 400 unless every id is one of the user's tags. */
export async function assertTagsOwned(db: DB, userId: string, tagIds: string[]): Promise<void> {
  const unique = [...new Set(tagIds)];
  if (unique.length === 0) return;
  const found = await Promise.all(
    chunk(unique).map((part) =>
      db
        .select({ id: tags.id })
        .from(tags)
        .where(and(eq(tags.userId, userId), inArray(tags.id, part))),
    ),
  );
  if (found.flat().length !== unique.length) throw badRequest('Unknown tag');
}

/**
 * Statements that set a contact's tags to exactly `tagIds`: clear the current links, then insert
 * the new ones in chunks under D1's parameter limit. Run them in one `db.batch` together with the
 * contact write, so a failure leaves neither half behind. (setContactTags in lib/contacts.ts runs
 * separate statements and a single insert, which fails past 33 tags.)
 * Check the ids with assertTagsOwned first. The caller must already know the contact is mine.
 */
export function contactTagWrites(db: DB, userId: string, contactId: string, tagIds: string[]): BatchItem<'sqlite'>[] {
  const rows = [...new Set(tagIds)].map((tagId) => ({ contactId, tagId, userId }));
  return [
    db.delete(contactTags).where(and(eq(contactTags.userId, userId), eq(contactTags.contactId, contactId))),
    ...chunk(rows, ROWS_PER_INSERT).map((part) => db.insert(contactTags).values(part)),
  ];
}

/** Creates the SEEDED_TAGS for a user. Idempotent (ignores names that already exist). */
export async function seedDefaultTags(db: DB, userId: string): Promise<void> {
  const existing = await db.select({ name: tags.name }).from(tags).where(eq(tags.userId, userId));
  const have = new Set(existing.map((t) => tagNameKey(t.name)));
  const missing = SEEDED_TAGS.filter((name) => !have.has(tagNameKey(name)));
  if (missing.length === 0) return;

  const rows = missing.map((name) => ({ id: newId(), userId, name }));
  // onConflictDoNothing covers a concurrent seed of the same user.
  for (const part of chunk(rows, ROWS_PER_INSERT)) {
    await db.insert(tags).values(part).onConflictDoNothing();
  }
}
