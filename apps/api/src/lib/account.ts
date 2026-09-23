import { profileUrl } from '@chatsoon/shared';
import { and, asc, eq, inArray, or } from 'drizzle-orm';

import {
  accounts,
  blocks,
  connections,
  contacts,
  contactTags,
  events,
  profiles,
  reports,
  sessions,
  tags,
  users,
  verifications,
} from '../db/schema';
import type { Env } from '../env';
import { chunk } from './contacts';
import type { DB } from './db';
import { userPrefix } from './signing';

/** R2 lists at most 1000 keys per page and deletes at most 1000 keys per call. */
const R2_BATCH = 1000;

/** Better Auth email OTP types that store a pending code as `${type}-otp-${email}`. */
const OTP_TYPES = ['sign-in', 'email-verification', 'forget-password'] as const;

/** Deletes every R2 object under the user's prefix (avatars, card photos). Returns the number deleted. */
export async function deleteUserFiles(env: Env, userId: string): Promise<number> {
  const prefix = userPrefix(userId);
  const keys: string[] = [];
  let cursor: string | undefined;
  do {
    const page = await env.FILES.list({ prefix, cursor, limit: R2_BATCH });
    for (const obj of page.objects) keys.push(obj.key);
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);

  for (const part of chunk(keys, R2_BATCH)) await env.FILES.delete(part);
  return keys.length;
}

/**
 * Permanently deletes an account: files first, then every row in one atomic D1 batch.
 * Rows are removed explicitly rather than trusting FK cascades, leaf tables first.
 */
export async function deleteUserData(env: Env, db: DB, userId: string, email: string): Promise<void> {
  await deleteUserFiles(env, userId);

  const myContactIds = () => db.select({ id: contacts.id }).from(contacts).where(eq(contacts.userId, userId));
  const myTagIds = () => db.select({ id: tags.id }).from(tags).where(eq(tags.userId, userId));
  const myEventIds = () => db.select({ id: events.id }).from(events).where(eq(events.createdBy, userId));
  // Exact identifiers only: a suffix match would also hit another address that ends with this
  // one (the code for z-otp-bob@x.com is stored as "sign-in-otp-z-otp-bob@x.com").
  const normalized = email.toLowerCase();
  const identifiers = [normalized, ...OTP_TYPES.map((type) => `${type}-otp-${normalized}`)];

  await db.batch([
    // Other people keep the card they saved for me, but it is no longer a Chatsoon connection.
    db.update(contacts).set({ linkedUserId: null }).where(eq(contacts.linkedUserId, userId)),
    db.update(contacts).set({ eventId: null }).where(inArray(contacts.eventId, myEventIds())),
    db.update(connections).set({ eventId: null }).where(inArray(connections.eventId, myEventIds())),
    db
      .delete(contactTags)
      .where(
        or(
          eq(contactTags.userId, userId),
          inArray(contactTags.contactId, myContactIds()),
          inArray(contactTags.tagId, myTagIds()),
        ),
      ),
    db.delete(contacts).where(eq(contacts.userId, userId)),
    db.delete(tags).where(eq(tags.userId, userId)),
    db.delete(connections).where(or(eq(connections.userA, userId), eq(connections.userB, userId))),
    db.delete(blocks).where(or(eq(blocks.blockerId, userId), eq(blocks.blockedId, userId))),
    db.delete(reports).where(or(eq(reports.reporterId, userId), eq(reports.targetUserId, userId))),
    db.delete(events).where(eq(events.createdBy, userId)),
    db.delete(profiles).where(eq(profiles.userId, userId)),
    db.delete(sessions).where(eq(sessions.userId, userId)),
    db.delete(accounts).where(eq(accounts.userId, userId)),
    db.delete(verifications).where(inArray(verifications.identifier, identifiers)),
    db.delete(users).where(eq(users.id, userId)),
  ]);

  // Sweep again for an upload that was in flight while the rows were removed. The account is
  // already gone at this point, so a failure here is logged rather than reported to the client.
  await deleteUserFiles(env, userId).catch((err) => console.error('Post-delete file sweep failed', err));
}

// ---------------------------------------------------------------------------
// CSV export (RFC 4180)
// ---------------------------------------------------------------------------

export const CSV_COLUMNS = [
  'name',
  'company',
  'role',
  'email',
  'phone',
  'telegram',
  'x',
  'linkedin',
  'website',
  'tags',
  'event',
  'priority',
  'notes',
  'source',
  'chatsoon_profile',
  'created_at',
  'updated_at',
] as const;

type CsvValue = string | number | null | undefined;

/** Spreadsheets run cells that start with these as formulas (CSV injection). */
const FORMULA_START = /^[=+\-@\t\r]/;
const NEEDS_QUOTES = /[",\r\n]/;

/** One CSV field: neutralises formula triggers with a leading quote, then quotes per RFC 4180. */
export function csvCell(value: CsvValue): string {
  if (value === null || value === undefined) return '';
  let s = String(value);
  if (FORMULA_START.test(s)) s = `'${s}`;
  return NEEDS_QUOTES.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** A complete CSV document: UTF-8 BOM (so Excel reads the encoding), CRLF line endings. */
export function toCsv(rows: readonly (readonly CsvValue[])[]): string {
  return `\uFEFF${rows.map((row) => row.map(csvCell).join(',')).join('\r\n')}\r\n`;
}

/** The user's contacts as CSV, oldest first. Scoped to `userId` throughout. */
export async function exportContactsCsv(db: DB, userId: string): Promise<string> {
  const rows = await db
    .select({ c: contacts, linkedSlug: profiles.slug, eventName: events.name })
    .from(contacts)
    .leftJoin(profiles, eq(profiles.userId, contacts.linkedUserId))
    // Only events this user can see, so a stray event id never leaks someone else's private event name.
    .leftJoin(
      events,
      and(eq(events.id, contacts.eventId), or(eq(events.isPublic, true), eq(events.createdBy, userId))),
    )
    .where(eq(contacts.userId, userId))
    .orderBy(asc(contacts.createdAt), asc(contacts.id));

  const tagRows = await db
    .select({ contactId: contactTags.contactId, name: tags.name })
    .from(contactTags)
    .innerJoin(tags, and(eq(tags.id, contactTags.tagId), eq(tags.userId, userId)))
    .where(eq(contactTags.userId, userId))
    .orderBy(asc(tags.name));

  const tagsByContact = new Map<string, string[]>();
  for (const t of tagRows) {
    const list = tagsByContact.get(t.contactId) ?? [];
    list.push(t.name);
    tagsByContact.set(t.contactId, list);
  }

  const lines: CsvValue[][] = rows.map(({ c, linkedSlug, eventName }) => [
    c.name,
    c.company,
    c.role,
    c.email,
    c.phone,
    c.telegram,
    c.xHandle,
    c.linkedinUrl,
    c.website,
    (tagsByContact.get(c.id) ?? []).join('; '),
    eventName,
    c.priority,
    c.notes,
    c.source,
    c.linkedUserId && linkedSlug ? profileUrl(linkedSlug) : null,
    c.createdAt.toISOString(),
    c.updatedAt.toISOString(),
  ]);

  return toCsv([CSV_COLUMNS, ...lines]);
}
