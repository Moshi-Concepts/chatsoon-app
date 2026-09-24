import {
  MAX_BOOKING_LINKS,
  parseBookingUrl,
  suggestBookingLabel,
  type BookingLink,
  type ChatsoonEvent,
  type Contact,
  type ContactSource,
  type ExtractionStatus,
  type MyProfile,
  type ProfileLinks,
  type PublicProfile,
  type Tag,
} from '@chatsoon/shared';

import type { ContactRow, EventRow, ProfileRow, TagRow } from '../db/schema';
import type { Env } from '../env';
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

export async function toPublicProfile(env: Env, row: ProfileRow): Promise<PublicProfile> {
  return {
    slug: row.slug,
    displayName: row.displayName,
    headline: row.headline,
    company: row.company,
    role: row.role,
    links: parseLinks(row.links),
    // Public pages get a longer-lived URL so shared links keep their photo.
    avatarUrl: row.avatarKey ? await signedFileUrl(env, row.avatarKey, 7 * 24 * 3600) : null,
    bookingLinks: parseBookingLinks(row.bookingLinks),
  };
}

export async function toMyProfile(env: Env, row: ProfileRow): Promise<MyProfile> {
  return { ...(await toPublicProfile(env, row)), userId: row.userId, avatarKey: row.avatarKey };
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
