import {
  CONTACT_KEYS,
  contactUrl,
  MAX_BOOKING_LINKS,
  parseBookingUrl,
  profileContactChannels,
  suggestBookingLabel,
  type BookingLink,
  type ChatsoonEvent,
  type Contact,
  type ContactSource,
  type ContactVisibility,
  type ExtractionStatus,
  type MyProfile,
  type PageProfile,
  type ProfileContact,
  type ProfileLinks,
  type PublicProfile,
  type Tag,
} from '@chatsoon/shared';

import type { ContactRow, EventRow, ProfileRow, TagRow } from '../db/schema';
import type { Env } from '../env';
import { cardsEnabled, currentOgVersion, hashKey16 } from './og';
import { signedFileUrl } from './signing';

const iso = (d: Date) => d.toISOString();

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
 * `contactChannels` and `contactVisibility` are always included. `contact` (usable values only) is
 * added only when `opts.contact` is set — the caller (routes/public.ts) decides who may see it, per
 * §2 of the plan: the owner, a 'public' profile, or an accepted connection. `vcardUrl` is added only
 * when the caller passes one in, since it's only ever offered alongside `contact`.
 */
export async function toPublicProfile(
  env: Env,
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
export async function toMyProfile(env: Env, row: ProfileRow): Promise<MyProfile> {
  const profile = await toPublicProfile(env, row);
  return { ...profile, userId: row.userId, avatarKey: row.avatarKey, contact: parseContact(row.contact) };
}

/**
 * The whitelisted DTO behind GET /_pages/profile/:slug (docs/og-plan.md §3.1, §3.3): built from
 * `toPublicProfile` with no options, so it never carries `contact` values, `avatarUrl` or `vcardUrl`.
 * `ogVersion` is null whenever a personalised card can't be produced (the kill switch, or no OG
 * binding), so the caller falls back to the default image with no extra check of its own.
 */
export async function toPageProfile(env: Env, row: ProfileRow): Promise<PageProfile> {
  const pub = await toPublicProfile(env, row);
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
    avatarVersion: row.avatarKey ? await hashKey16(row.avatarKey) : null,
    updatedAt: row.updatedAt.toISOString(),
    // False until the search-visibility setting ships (Stage D).
    indexable: false,
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
    createdAt: iso(row.createdAt),
    updatedAt: iso(row.updatedAt),
  };
}

export const toTag = (row: TagRow): Tag => ({ id: row.id, name: row.name });

export const toEvent = (row: EventRow): ChatsoonEvent => ({ id: row.id, name: row.name, isPublic: row.isPublic });
