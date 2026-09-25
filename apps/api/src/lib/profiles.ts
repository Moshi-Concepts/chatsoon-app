import {
  cleanText,
  emailSchema,
  isTelegramHandle,
  isValidSlug,
  isXHandle,
  normalizeHandle,
  parseIntlPhone,
  toLinkUrl,
} from '@chatsoon/shared';
import { and, eq, or, sql } from 'drizzle-orm';

import { blocks, profiles, users, type ContactRow, type ProfileRow } from '../db/schema';
import type { DB } from './db';
import { parseContact, parseLinks } from './serialize';
import { ownsKey, userPrefix } from './signing';

// ---------------------------------------------------------------------------
// Lookups
// ---------------------------------------------------------------------------

/** Profile for a public slug. Null for unknown or malformed slugs. */
export async function findProfileBySlug(db: DB, slug: string): Promise<ProfileRow | null> {
  const normalized = slug.trim().toLowerCase();
  if (!isValidSlug(normalized)) return null;
  const [row] = await db.select().from(profiles).where(eq(profiles.slug, normalized)).limit(1);
  return row ?? null;
}

export async function findProfileByUserId(db: DB, userId: string): Promise<ProfileRow | null> {
  const [row] = await db.select().from(profiles).where(eq(profiles.userId, userId)).limit(1);
  return row ?? null;
}

/**
 * Same lookup as `findProfileBySlug`, plus the owner's email in the same query (one D1 round trip,
 * not two) — `isIndexable` needs it, and page/photo lookups are on the hot path.
 */
export async function findProfileBySlugWithEmail(
  db: DB,
  slug: string,
): Promise<{ row: ProfileRow; email: string } | null> {
  const normalized = slug.trim().toLowerCase();
  if (!isValidSlug(normalized)) return null;
  const [found] = await db
    .select({ row: profiles, email: users.email })
    .from(profiles)
    .innerJoin(users, eq(users.id, profiles.userId))
    .where(eq(profiles.slug, normalized))
    .limit(1);
  return found ?? null;
}

// ---------------------------------------------------------------------------
// Blocks. Rows are written by routes/moderation.ts and enforced here.
// ---------------------------------------------------------------------------

/** True when `blockerId` has blocked `blockedId`. */
export async function hasBlocked(db: DB, blockerId: string, blockedId: string): Promise<boolean> {
  const [row] = await db
    .select({ one: sql<number>`1` })
    .from(blocks)
    .where(and(eq(blocks.blockerId, blockerId), eq(blocks.blockedId, blockedId)))
    .limit(1);
  return row !== undefined;
}

/** True when either user has blocked the other. */
export async function isBlockedEitherWay(db: DB, a: string, b: string): Promise<boolean> {
  const [row] = await db
    .select({ one: sql<number>`1` })
    .from(blocks)
    .where(
      or(
        and(eq(blocks.blockerId, a), eq(blocks.blockedId, b)),
        and(eq(blocks.blockerId, b), eq(blocks.blockedId, a)),
      ),
    )
    .limit(1);
  return row !== undefined;
}

// ---------------------------------------------------------------------------
// Avatars
// ---------------------------------------------------------------------------

/**
 * True when `key` is one of this user's avatar uploads (u/<userId>/avatar/...).
 * Card photos are rejected too, so replacing an avatar can never delete a contact's card image.
 */
export function isAvatarKey(userId: string, key: string): boolean {
  return ownsKey(userId, key) && key.startsWith(`${userPrefix(userId)}avatar/`);
}

// ---------------------------------------------------------------------------
// Contact fields
// ---------------------------------------------------------------------------

type ContactLinkField = 'email' | 'phone' | 'telegram' | 'xHandle' | 'linkedinUrl' | 'website';

/**
 * Longest value each field accepts in contactUpdateSchema. Server-written values must fit,
 * or the owner could never save an edit to that contact.
 */
const CONTACT_FIELD_MAX: Record<ContactLinkField, number> = {
  email: 254,
  phone: 40,
  telegram: 100,
  xHandle: 100,
  linkedinUrl: 300,
  website: 300,
};

const fits = (field: ContactLinkField, value: string | null) =>
  value !== null && value.length <= CONTACT_FIELD_MAX[field] ? value : null;

export type ProfileContactFields = Pick<
  ContactRow,
  'name' | 'company' | 'role' | 'telegram' | 'xHandle' | 'linkedinUrl' | 'website' | 'phone'
>;

/**
 * The card a user gets when they connect with this profile. Links are copied only when they make
 * a working link (the same rule the public page uses), handles without '@' or URL, and LinkedIn and
 * website as full URLs. The phone is copied only when it's a valid international number, whatever
 * the profile's contact visibility (issue #3 D11): the recipient gets a working Call button with no
 * update, while WhatsApp and Signal are read live from the linked profile instead. YouTube has no
 * contact field.
 */
export function contactFieldsFromProfile(row: ProfileRow): ProfileContactFields {
  const links = parseLinks(row.links);
  const text = (value: unknown) => (typeof value === 'string' ? value : null);
  const handle = (value: unknown, valid: (h: string) => boolean) => {
    const h = normalizeHandle(text(value) ?? '');
    return valid(h) ? h : null;
  };
  const raw = parseContact(row.contact).phone ?? '';
  return {
    name: row.displayName,
    company: row.company,
    role: row.role,
    telegram: handle(links.telegram, isTelegramHandle),
    xHandle: handle(links.x, isXHandle),
    linkedinUrl: fits('linkedinUrl', toLinkUrl('linkedin', text(links.linkedin))),
    website: fits('website', toLinkUrl('website', text(links.website))),
    phone: parseIntlPhone(raw) ? fits('phone', cleanText(raw)) : null,
  };
}

export type ConnectValueFields = Partial<Pick<ContactRow, ContactLinkField>> & {
  /** Set when the value matched nothing, so the caller can keep it in the notes. */
  unmatched?: string;
};

/**
 * Puts the web Connect form's `contact` value in the new contact's `email` field. Issue #10 made
 * `connectFormSchema.contact` an email address only, so the LinkedIn/X/Telegram/phone/handle routing
 * this used to do (matching the old "email or handle" field) is gone — the schema already guarantees
 * a valid email by the time this runs. `unmatched` is kept for a caller that bypasses the schema, or
 * a value the schema accepts but that's too long for the contact's `email` column.
 */
export function contactFieldsFromConnectValue(raw: string): ConnectValueFields {
  const value = cleanText(raw);
  const email = emailSchema.safeParse(value);
  return email.success && fits('email', email.data) !== null ? { email: email.data } : { unmatched: value };
}
