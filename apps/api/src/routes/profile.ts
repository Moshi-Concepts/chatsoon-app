import {
  AVATAR_WIDTHS,
  canonicalLinkValue,
  emailPrefsInputSchema,
  isDiscordDiscriminator,
  isDiscordId,
  isDiscordInvite,
  isDiscordUsername,
  LINK_KEYS,
  makeSlug,
  profileInputSchema,
  toLinkUrl,
  type EmailPrefsResponse,
  type LinkKey,
  type Me,
} from '@chatsoon/shared';
import { eq } from 'drizzle-orm';
import { Hono } from 'hono';

import { profiles, users, type ProfileRow } from '../db/schema';
import type { AppEnv } from '../env';
import { avatarVariantKey } from '../lib/avatar';
import { getDb, type DB } from '../lib/db';
import { pendingDeletionFor } from '../lib/deletion';
import { ApiError, badRequest, parseJson, unauthorized } from '../lib/errors';
import { shortSuffix } from '../lib/ids';
import { requireAuth } from '../lib/middleware';
import { hashKey16, refreshOgCard } from '../lib/og';
import { findProfileByUserId, isAvatarKey } from '../lib/profiles';
import { parseContact, parseLinks, toMyProfile } from '../lib/serialize';
import { setTipsEmailsEnabled, startTipsNudges, tipsEmailsEnabled } from '../lib/sequences';
import { seedDefaultTags } from '../lib/tags';

/** Slug suffixes are random; a collision is rare, five in a row is practically impossible. */
const SLUG_ATTEMPTS = 5;

/** Shown when a link can't be turned into a working URL (the public page would hide it). */
const LINK_HINTS: Record<LinkKey, string> = {
  x: 'Check your X handle. Enter it like @yourhandle.',
  telegram: 'Check your Telegram username. Enter it like @username.',
  discord: 'Add your Discord username (e.g. peterbui) or user ID',
  linkedin: 'Check your LinkedIn link. Enter it like linkedin.com/in/your-name.',
  website: 'Check your website. Enter it like yourcompany.com.',
  youtube: 'Check your YouTube link. Enter it like youtube.com/@yourchannel.',
};

/** Discord invites (discord.gg/..., discord.com/invite/...) get their own hint - they aren't a "bad
 * format", they're the wrong thing entirely (a server, not a person). */
const DISCORD_INVITE_HINT = 'Add your Discord username, not a server invite';

/** True when a (canonicalised) Discord link value is one of the three accepted forms. */
function isValidDiscordLink(value: string): boolean {
  return isDiscordUsername(value) || isDiscordId(value) || isDiscordDiscriminator(value);
}

type ProfileValues = Pick<
  ProfileRow,
  | 'displayName'
  | 'headline'
  | 'company'
  | 'role'
  | 'links'
  | 'avatarKey'
  | 'bookingLinks'
  | 'contact'
  | 'contactVisibility'
  | 'searchVisible'
> & { searchVisibleAt?: Date | null };

export const profileRoutes = new Hono<AppEnv>();

profileRoutes.get('/me', requireAuth, async (c) => {
  const { id } = c.get('user');
  const db = getDb(c.env);
  const [user] = await db
    .select({
      id: users.id,
      email: users.email,
      createdAt: users.createdAt,
      name: users.name,
      image: users.image,
      discordUsername: users.discordUsername,
    })
    .from(users)
    .where(eq(users.id, id))
    .limit(1);
  if (!user) throw unauthorized();

  const [profile, deleteAfter, tipsEmails] = await Promise.all([
    findProfileByUserId(db, id),
    pendingDeletionFor(db, id),
    tipsEmailsEnabled(db, id),
  ]);
  const body: Me = {
    user: {
      id: user.id,
      email: user.email,
      createdAt: user.createdAt.toISOString(),
      // '' is the column's default for an email/OTP account that never had a name set; treated the
      // same as null so onboarding's "prefill when empty" check doesn't need to know about it.
      name: user.name || null,
      image: user.image || null,
    },
    profile: profile ? await toMyProfile(c.env, db, profile) : null,
    deletionScheduledFor: deleteAfter ? deleteAfter.toISOString() : null,
    tipsEmails,
    ...(user.discordUsername ? { socialPrefill: { discord: user.discordUsername } } : {}),
  };
  c.header('Cache-Control', 'private, no-store');
  return c.json(body);
});

/** Turns the new-account "tips" nudge emails on or off (issue #7). Works even before onboarding. */
profileRoutes.put('/me/email-prefs', requireAuth, async (c) => {
  const { id: userId } = c.get('user');
  const input = await parseJson(c, emailPrefsInputSchema);
  await setTipsEmailsEnabled(getDb(c.env), userId, input.tipsEmails);
  const body: EmailPrefsResponse = { tipsEmails: input.tipsEmails };
  return c.json(body);
});

/**
 * Creates the profile on first save, then updates it. Fields left out of the body keep
 * their current value; null (or '') clears them. The slug is set once and never changes,
 * because printed QR codes point at it.
 */
profileRoutes.put('/me/profile', requireAuth, async (c) => {
  const { id: userId, email: userEmail } = c.get('user');
  const input = await parseJson(c, profileInputSchema);
  // '' removes the photo, like null.
  const avatarKey = input.avatarKey === '' ? null : input.avatarKey;
  // Canonicalise every provided link (a pasted URL is cleaned of tracking params and reduced to a
  // handle or canonical URL where possible) so older clients that still send raw pasted URLs get the
  // same cleanup as the current form. Only keys present in the input are touched.
  for (const key of LINK_KEYS) {
    const link = input.links?.[key];
    if (link) input.links![key] = canonicalLinkValue(key, link);
  }
  for (const key of LINK_KEYS) {
    const link = input.links?.[key];
    if (!link) continue;
    // Discord validates against its own username/id/discriminator rules, not toLinkUrl: a username is
    // a perfectly valid link value with no URL at all (toLinkUrl('discord', ...) returns null for it).
    if (key === 'discord') {
      if (isDiscordInvite(link)) throw badRequest(DISCORD_INVITE_HINT);
      if (!isValidDiscordLink(link)) throw badRequest(LINK_HINTS.discord);
      continue;
    }
    if (!toLinkUrl(key, link)) throw badRequest(LINK_HINTS[key]);
  }

  const db = getDb(c.env);
  const existing = await findProfileByUserId(db, userId);

  // A new photo must be one of this user's avatar uploads (never a card photo) and exist in R2.
  if (avatarKey && avatarKey !== existing?.avatarKey) {
    const usable = isAvatarKey(userId, avatarKey) && (await c.env.FILES.head(avatarKey)) !== null;
    if (!usable) throw badRequest("That photo couldn't be used. Please choose it again.");
  }

  const keep = <T>(value: T | undefined, current: T): T => (value === undefined ? current : value);
  const searchVisible = keep(input.searchVisible, existing?.searchVisible ?? false);
  const values: ProfileValues = {
    displayName: input.displayName,
    headline: keep(input.headline, existing?.headline ?? null),
    company: keep(input.company, existing?.company ?? null),
    role: keep(input.role, existing?.role ?? null),
    links: JSON.stringify(mergeByKey(existing ? parseLinks(existing.links) : {}, input.links)),
    avatarKey: keep(avatarKey, existing?.avatarKey ?? null),
    // undefined keeps the current booking links; an array (including []) replaces the whole list.
    bookingLinks: input.bookingLinks === undefined ? (existing?.bookingLinks ?? '[]') : JSON.stringify(input.bookingLinks),
    contact: JSON.stringify(mergeByKey(existing ? parseContact(existing.contact) : {}, input.contact)),
    contactVisibility: keep(input.contactVisibility, existing?.contactVisibility ?? 'connections'),
    searchVisible,
    // The consent trail (§3.2): only stamped when the value actually changes, never on every save.
    ...(searchVisible !== (existing?.searchVisible ?? false) ? { searchVisibleAt: new Date() } : {}),
  };

  let row: ProfileRow;
  if (existing) {
    row = await updateProfile(db, userId, values);
  } else {
    const created = await insertProfile(db, userId, values);
    if (created) {
      row = created;
      try {
        await seedDefaultTags(db, userId);
      } catch (err) {
        // The profile is saved; missing starter tags must not fail onboarding.
        console.error('Seeding default tags failed', err);
      }
      // Onboarding just finished (issue #7): starts the new-account nudge sequence and converts any
      // tips-email lead row for this same address. Best effort, same as the tag seeding above.
      c.executionCtx.waitUntil(
        startTipsNudges(db, userId, userEmail).catch((err) => console.error('Starting tips nudges failed', err)),
      );
    } else {
      // A concurrent first save created the profile a moment ago.
      row = await updateProfile(db, userId, values);
    }
  }

  await db.update(users).set({ name: values.displayName, updatedAt: new Date() }).where(eq(users.id, userId));

  const previousAvatar = existing?.avatarKey;
  if (previousAvatar && previousAvatar !== row.avatarKey && isAvatarKey(userId, previousAvatar)) {
    c.executionCtx.waitUntil(
      c.env.FILES.delete(previousAvatar).catch((err) => console.error('Deleting old avatar failed', err)),
    );
    // Every resized WebP variant (Stage F, D8; every width in AVATAR_WIDTHS, issue #23) of the old
    // avatar, if any were ever built. On a change, the new avatar's next photo request would
    // eventually sweep its own width anyway (pages.ts), but a removal (avatarKey now null) never
    // makes another photo request, so it never would — the privacy policy says removed data goes
    // straight away, not "eventually" (design point 4). Deleting the keys directly (R2 accepts a
    // batch of keys) needs no `list()`: every width's key is derivable from `version` alone.
    c.executionCtx.waitUntil(
      hashKey16(previousAvatar)
        .then((version) => c.env.FILES.delete(AVATAR_WIDTHS.map((w) => avatarVariantKey(userId, version, w))))
        .catch((err) => console.error('Deleting old avatar variant failed', err)),
    );
  }
  // Pre-renders the share card for the new version (if it isn't already stored) and clears out every
  // other version, so a share right after saving never waits on a render (O9). Never fails the save.
  c.executionCtx.waitUntil(refreshOgCard(c.env, row));

  return c.json(await toMyProfile(c.env, db, row));
});

/**
 * Per key: undefined keeps the current value, null removes it, a string sets it. Used for both
 * `links` and `contact`, whose input schemas both turn '' into null before it reaches here.
 */
function mergeByKey<K extends string>(
  current: Partial<Record<K, string>>,
  patch: Partial<Record<K, string | null>> | undefined,
): Partial<Record<K, string>> {
  if (!patch) return current;
  const next: Partial<Record<K, string>> = { ...current };
  for (const [key, value] of Object.entries(patch) as [K, string | null | undefined][]) {
    if (value === undefined) continue;
    if (value === null) delete next[key];
    else next[key] = value;
  }
  return next;
}

/**
 * Inserts the profile with a fresh slug, retrying on a slug collision.
 * Returns null when the user's profile already exists (concurrent first save).
 */
async function insertProfile(db: DB, userId: string, values: ProfileValues): Promise<ProfileRow | null> {
  for (let attempt = 0; attempt < SLUG_ATTEMPTS; attempt++) {
    const [row] = await db
      .insert(profiles)
      .values({ ...values, userId, slug: makeSlug(values.displayName, shortSuffix()) })
      .onConflictDoNothing()
      .returning();
    if (row) return row;
    // Nothing inserted: either the slug is taken or this user's profile now exists.
    if (await findProfileByUserId(db, userId)) return null;
  }
  throw new ApiError(500, 'internal', 'Could not create your profile link. Please try again.');
}

async function updateProfile(db: DB, userId: string, values: ProfileValues): Promise<ProfileRow> {
  const [row] = await db
    .update(profiles)
    .set({ ...values, updatedAt: new Date() })
    .where(eq(profiles.userId, userId))
    .returning();
  if (!row) throw new ApiError(500, 'internal', 'Could not save your profile. Please try again.');
  return row;
}
