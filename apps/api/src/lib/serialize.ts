import {
  CONTACT_KEYS,
  contactUrl,
  MAX_BOOKING_LINKS,
  parseBookingUrl,
  profileContactChannels,
  suggestBookingLabel,
  type Badge,
  type BookingLink,
  type ChatsoonEvent,
  type Contact,
  type ContactSource,
  type ContactVisibility,
  type ExtractionStatus,
  type FollowUpChannel,
  type MyProfile,
  type PageProfile,
  type ProfileContact,
  type ProfileLinks,
  type PublicProfile,
  type Tag,
} from '@chatsoon/shared';
import { eq } from 'drizzle-orm';

import { badges, type ContactRow, type EventRow, type ProfileRow, type TagRow } from '../db/schema';
import type { Env } from '../env';
import type { DB } from './db';
import { cardsEnabled, currentOgVersion, hashKey16 } from './og';
import { signedFileUrl } from './signing';

const iso = (d: Date) => d.toISOString();
const isoOrNull = (d: Date | null) => (d ? d.toISOString() : null);

export function parseLinks(json: string | null | undefined): ProfileLinks {
  if (!json) return {};
  try {
    const v = JSON.parse(json);
    return v && typeof v === 'object' ? (v as ProfileLinks) : {};
  } catch {
    return {};
  }
}

/**
 * Re-parses each stored link's URL, dropping any that no longer parse (a provider dropped or the
 * rules changed) and adding the provider. Keeps the stored label, or suggests one when it's missing.
 */
export function parseBookingLinks(json: string | null | undefined): BookingLink[] {
  if (!json) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];

  const links: BookingLink[] = [];
  for (const item of parsed) {
    if (links.length >= MAX_BOOKING_LINKS) break;
    if (!item || typeof item !== 'object') continue;
    const { url, label } = item as { url?: unknown; label?: unknown };
    if (typeof url !== 'string') continue;
    const canonical = parseBookingUrl(url);
    if (!canonical) continue;
    links.push({
      label: typeof label === 'string' && label ? label : suggestBookingLabel(canonical.url),
      url: canonical.url,
      provider: canonical.provider,
    });
  }
  return links;
}

/** Keeps only CONTACT_KEYS whose stored value is a string. Drops anything else a hand-edited row might carry. */
export function parseContact(json: string | null | undefined): ProfileContact {
  if (!json) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return {};
  }
  if (!parsed || typeof parsed !== 'object') return {};
  const record = parsed as Record<string, unknown>;
  const contact: ProfileContact = {};
  for (const key of CONTACT_KEYS) {
    const value = record[key];
    if (typeof value === 'string') contact[key] = value;
  }
  return contact;
}

/**
 * Permanent milestone badges (issue #11, docs/referrals.md "API"): `[{ badge: 'founder', seq: 37 }]`,
 * `[{ badge: 'early_adopter' }]` or `[]`. Shared by every profile DTO below.
 */
export async function loadBadges(db: DB, userId: string): Promise<{ badge: Badge; seq?: number }[]> {
  const rows = await db.select({ badge: badges.badge, seq: badges.seq }).from(badges).where(eq(badges.userId, userId));
  return rows.map((r) => (r.seq != null ? { badge: r.badge as Badge, seq: r.seq } : { badge: r.badge as Badge }));
}

/**
 * `contactChannels` and `contactVisibility` are always included. `contact` (usable values only) is
 * added only when `opts.contact` is set — the caller (routes/public.ts) decides who may see it, per
 * §2 of the plan: the owner, a 'public' profile, or an accepted connection. `vcardUrl` is added only
 * when the caller passes one in, since it's only ever offered alongside `contact`.
 */
export async function toPublicProfile(
  env: Env,
  db: DB,
  row: ProfileRow,
  opts: { contact?: boolean; vcardUrl?: string } = {},
): Promise<PublicProfile> {
  const contact = parseContact(row.contact);
  // Anything other than the exact 'public' string reads back as 'connections': a bad value in the
  // column (a bug, or a row edited by hand) must never fall open.
  const contactVisibility: ContactVisibility = row.contactVisibility === 'public' ? 'public' : 'connections';

  const profile: PublicProfile = {
    slug: row.slug,
    displayName: row.displayName,
    headline: row.headline,
    company: row.company,
    role: row.role,
    links: parseLinks(row.links),
    // Public pages get a longer-lived URL so shared links keep their photo.
    avatarUrl: row.avatarKey ? await signedFileUrl(env, row.avatarKey, 7 * 24 * 3600) : null,
    bookingLinks: parseBookingLinks(row.bookingLinks),
    contactChannels: profileContactChannels(contact),
    contactVisibility,
    badges: await loadBadges(db, row.userId),
  };

  if (opts.contact) {
    const usable: ProfileContact = {};
    for (const key of CONTACT_KEYS) {
      if (contactUrl(key, contact[key])) usable[key] = contact[key];
    }
    profile.contact = usable;
  }
  if (opts.vcardUrl) profile.vcardUrl = opts.vcardUrl;

  return profile;
}

/** The owner's own view: raw stored values (including legacy invalid ones), so they can fix them. */
export async function toMyProfile(env: Env, db: DB, row: ProfileRow): Promise<MyProfile> {
  const profile = await toPublicProfile(env, db, row);
  return {
    ...profile,
    userId: row.userId,
    avatarKey: row.avatarKey,
    contact: parseContact(row.contact),
    searchVisible: row.searchVisible,
  };
}

/** Demo profiles seeded for App Store and Google Play review (migration 0002); never indexable. */
const DEMO_SLUGS = new Set(['alex-rivera-demo', 'maya-lindqvist-demo']);
/** The reviewer account itself (lib/reviewer.ts): never indexable, whatever it saves. */
const REVIEWER_EMAIL = 'review@chatsoon.app';
/** Any demo+*@chatsoon.app account (case-insensitive), including the seeded demo users above. */
const DEMO_EMAIL_PATTERN = /^demo\+[^@]*@chatsoon\.app$/i;

/**
 * Stage D §3.2: true only when the owner opted in, an ops kill switch hasn't blocked it, it isn't a
 * demo or reviewer account, and the profile has something worth showing. `ownerEmail` must come from
 * the same row's owner (pages.ts / lib/profiles.ts join it in one query).
 */
export function isIndexable(
  row: Pick<ProfileRow, 'slug' | 'searchVisible' | 'searchBlocked' | 'headline' | 'role' | 'company' | 'avatarKey'>,
  ownerEmail: string,
): boolean {
  if (!row.searchVisible || row.searchBlocked) return false;
  if (DEMO_SLUGS.has(row.slug)) return false;
  const email = ownerEmail.toLowerCase();
  if (email === REVIEWER_EMAIL || DEMO_EMAIL_PATTERN.test(email)) return false;
  return !!(row.headline || row.role || row.company || row.avatarKey);
}

/**
 * The whitelisted DTO behind GET /_pages/profile/:slug (docs/og-plan.md §3.1, §3.3): built from
 * `toPublicProfile` with no options, so it never carries `contact` values, `avatarUrl` or `vcardUrl`.
 * `ogVersion` is null whenever a personalised card can't be produced (the kill switch, or no OG
 * binding), so the caller falls back to the default image with no extra check of its own.
 */
export async function toPageProfile(env: Env, db: DB, row: ProfileRow, ownerEmail: string): Promise<PageProfile> {
  const pub = await toPublicProfile(env, db, row);
  return {
    slug: pub.slug,
    displayName: pub.displayName,
    headline: pub.headline,
    company: pub.company,
    role: pub.role,
    links: pub.links,
    bookingLinks: pub.bookingLinks,
    contactChannels: pub.contactChannels ?? [],
    contactVisibility: pub.contactVisibility ?? 'connections',
    badges: pub.badges,
    avatarVersion: row.avatarKey ? await hashKey16(row.avatarKey) : null,
    updatedAt: row.updatedAt.toISOString(),
    indexable: isIndexable(row, ownerEmail),
    ogVersion: cardsEnabled(env) ? await currentOgVersion(row) : null,
  };
}

export async function toContact(
  env: Env,
  row: ContactRow,
  tagIds: string[],
  linkedSlug: string | null,
): Promise<Contact> {
  return {
    id: row.id,
    linkedUserId: row.linkedUserId,
    linkedSlug,
    name: row.name,
    company: row.company,
    role: row.role,
    email: row.email,
    phone: row.phone,
    telegram: row.telegram,
    xHandle: row.xHandle,
    linkedinUrl: row.linkedinUrl,
    website: row.website,
    cardImageKey: row.cardImageKey,
    cardImageUrl: row.cardImageKey ? await signedFileUrl(env, row.cardImageKey) : null,
    notes: row.notes,
    priority: row.priority,
    eventId: row.eventId,
    source: row.source as ContactSource,
    extractionStatus: row.extractionStatus as ExtractionStatus,
    tagIds,
    followedUpAt: isoOrNull(row.followedUpAt),
    followUpChannel: row.followUpChannel as FollowUpChannel | null,
    followUpDueAt: isoOrNull(row.followUpDueAt),
    createdAt: iso(row.createdAt),
    updatedAt: iso(row.updatedAt),
  };
}

export const toTag = (row: TagRow): Tag => ({ id: row.id, name: row.name });

export const toEvent = (row: EventRow): ChatsoonEvent => ({ id: row.id, name: row.name, isPublic: row.isPublic });
