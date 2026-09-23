import {
  cleanText,
  emailSchema,
  isTelegramHandle,
  isValidSlug,
  isXHandle,
  normalizeHandle,
  parseSocialUrl,
  toLinkUrl,
  type LinkKey,
} from '@chatsoon/shared';
import { and, eq, or, sql } from 'drizzle-orm';

import { blocks, profiles, type ContactRow, type ProfileRow } from '../db/schema';
import type { DB } from './db';
import { parseLinks } from './serialize';
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

/** The toLinkUrl kind the app uses to make each contact field tappable. Email follows emailSchema instead. */
const LINK_KIND: Partial<Record<ContactLinkField, LinkKey>> = {
  telegram: 'telegram',
  xHandle: 'x',
  linkedinUrl: 'linkedin',
  website: 'website',
};

export type ProfileContactFields = Pick<
  ContactRow,
  'name' | 'company' | 'role' | 'telegram' | 'xHandle' | 'linkedinUrl' | 'website'
>;

/**
 * The card a user gets when they connect with this profile. Links are copied only when they make
 * a working link (the same rule the public page uses), handles without '@' or URL, and LinkedIn and
 * website as full URLs. YouTube has no contact field.
 */
export function contactFieldsFromProfile(row: ProfileRow): ProfileContactFields {
  const links = parseLinks(row.links);
  const text = (value: unknown) => (typeof value === 'string' ? value : null);
  const handle = (value: unknown, valid: (h: string) => boolean) => {
    const h = normalizeHandle(text(value) ?? '');
    return valid(h) ? h : null;
  };
  return {
    name: row.displayName,
    company: row.company,
    role: row.role,
    telegram: handle(links.telegram, isTelegramHandle),
    xHandle: handle(links.x, isXHandle),
    linkedinUrl: fits('linkedinUrl', toLinkUrl('linkedin', text(links.linkedin))),
    website: fits('website', toLinkUrl('website', text(links.website))),
  };
}

export type ConnectValueFields = Partial<Pick<ContactRow, ContactLinkField>> & {
  /** Set when the value matched nothing, so the caller can keep it in the notes. */
  unmatched?: string;
};

const PHONE = /^\+?[\d\s().-]{6,24}$/;
const HOSTNAME = /^([a-z0-9-]+\.)+[a-z]{2,}$/i;

const X_HOSTS = ['x.com', 'twitter.com'];
const LINKEDIN_HOSTS = ['linkedin.com', 'lnkd.in'];

const hostIn = (host: string, list: string[]) => list.some((h) => host === h || host.endsWith(`.${h}`));

/** http(s) URL with a real hostname and no credentials, with or without the scheme typed. */
function parseWebUrl(value: string): URL | null {
  if (/\s/.test(value)) return null;
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(value) ? value : `https://${value}`;
  try {
    const url = new URL(withScheme);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
    // 'name:pw@host' and 'mailto:me@host' parse as credentials; neither is a website.
    if (url.username || url.password) return null;
    return HOSTNAME.test(url.hostname) ? url : null;
  } catch {
    return null;
  }
}

/** URL without fragment or trailing slash. */
function cleanUrl(url: URL, keepQuery = true): string {
  const path = url.pathname.replace(/\/+$/, '');
  return `${url.origin}${path}${keepQuery ? url.search : ''}`;
}

function routeConnectValue(value: string): [ContactLinkField, string] | null {
  const email = emailSchema.safeParse(value.replace(/^mailto:/i, ''));
  if (email.success) return ['email', email.data];

  // Telegram, X and LinkedIn profile links, including tg:// and twitter:// app links.
  const social = parseSocialUrl(value);
  if (social?.network === 'linkedin') return ['linkedinUrl', social.url];
  if (social) return [social.network === 'x' ? 'xHandle' : 'telegram', social.handle];

  const url = parseWebUrl(value);
  if (url) {
    const host = url.hostname.toLowerCase();
    // Company pages and lnkd.in short links: still LinkedIn, minus tracking parameters.
    if (hostIn(host, LINKEDIN_HOSTS)) return ['linkedinUrl', cleanUrl(url, false)];
    if (hostIn(host, X_HOSTS)) {
      // x.com/<handle>/status/<id> is a post: keep its author.
      const [author, kind] = url.pathname.split('/').filter(Boolean);
      if (author && kind === 'status' && isXHandle(author)) return ['xHandle', author];
    }
    // Everything else, including Telegram invites and other X pages, stays tappable as the website.
    return ['website', cleanUrl(url)];
  }

  if (PHONE.test(value) && value.replace(/\D/g, '').length >= 6) return ['phone', value];

  const handle = value.replace(/^@/, '');
  if (isTelegramHandle(handle)) return ['telegram', handle];
  // Too short (or starting with a digit) for Telegram, but a valid X handle.
  if (isXHandle(handle)) return ['xHandle', handle];
  return null;
}

/**
 * Routes the free-text "email or handle" from the web Connect form to a contact field:
 * email, then a profile link or URL by host (LinkedIn, X, Telegram, else website), then a phone
 * number, then a bare or @handle (Telegram, or X when it can't be a Telegram username).
 * Only values that make a working link are routed. Anything else comes back as `unmatched`.
 */
export function contactFieldsFromConnectValue(raw: string): ConnectValueFields {
  const value = cleanText(raw);
  const routed = routeConnectValue(value);
  if (!routed) return { unmatched: value };
  const [field, routedValue] = routed;
  const kind = LINK_KIND[field];
  const works = !kind || toLinkUrl(kind, routedValue) !== null;
  return works && fits(field, routedValue) !== null ? { [field]: routedValue } : { unmatched: value };
}
