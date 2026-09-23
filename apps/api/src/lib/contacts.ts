import type { Contact } from '@chatsoon/shared';
import { and, desc, eq, inArray } from 'drizzle-orm';

import { contacts, contactTags, profiles } from '../db/schema';
import type { Env } from '../env';
import type { DB } from './db';
import { toContact } from './serialize';

/** D1 allows at most 100 bound parameters per statement. */
export const D1_MAX_PARAMS = 100;

export function chunk<T>(items: T[], size = 90): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/**
 * Loads a user's contacts as API DTOs (tags and linked slug included), newest first.
 * Pass `ids` to load specific contacts. Always scoped to `userId`.
 */
export async function loadContacts(env: Env, db: DB, userId: string, ids?: string[]): Promise<Contact[]> {
  if (ids && ids.length === 0) return [];

  const rowSets = ids
    ? await Promise.all(
        chunk(ids).map((part) =>
          db
            .select({ c: contacts, slug: profiles.slug })
            .from(contacts)
            .leftJoin(profiles, eq(profiles.userId, contacts.linkedUserId))
            .where(and(eq(contacts.userId, userId), inArray(contacts.id, part))),
        ),
      )
    : [
        await db
          .select({ c: contacts, slug: profiles.slug })
          .from(contacts)
          .leftJoin(profiles, eq(profiles.userId, contacts.linkedUserId))
          .where(eq(contacts.userId, userId))
          .orderBy(desc(contacts.updatedAt)),
      ];
  const rows = rowSets.flat();
  if (rows.length === 0) return [];

  const tagRowSets = ids
    ? await Promise.all(
        chunk(ids).map((part) =>
          db
            .select({ contactId: contactTags.contactId, tagId: contactTags.tagId })
            .from(contactTags)
            .where(and(eq(contactTags.userId, userId), inArray(contactTags.contactId, part))),
        ),
      )
    : [
        await db
          .select({ contactId: contactTags.contactId, tagId: contactTags.tagId })
          .from(contactTags)
          .where(eq(contactTags.userId, userId)),
      ];

  const tagsByContact = new Map<string, string[]>();
  for (const t of tagRowSets.flat()) {
    const list = tagsByContact.get(t.contactId) ?? [];
    list.push(t.tagId);
    tagsByContact.set(t.contactId, list);
  }

  const result = await Promise.all(
    rows.map((r) => toContact(env, r.c, tagsByContact.get(r.c.id) ?? [], r.slug ?? null)),
  );
  if (!ids) return result;
  // Keep newest first for id lookups too.
  return result.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export async function getContact(env: Env, db: DB, userId: string, id: string): Promise<Contact | null> {
  const [contact] = await loadContacts(env, db, userId, [id]);
  return contact ?? null;
}
