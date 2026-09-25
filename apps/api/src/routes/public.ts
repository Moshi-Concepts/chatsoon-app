import {
  buildVCard,
  cleanText,
  connectFormSchema,
  profileContactChannels,
  PROFILE_PATH_PREFIX,
  type ConnectFormResponse,
  type ProfileContact,
  type PublicProfile,
} from '@chatsoon/shared';
import { and, eq, gt, sql } from 'drizzle-orm';
import { Hono, type Context } from 'hono';

import { connections, contacts, users, type ProfileRow } from '../db/schema';
import type { AppEnv, AuthedUser, Env } from '../env';
import { getDb, type DB } from '../lib/db';
import { sendEmail } from '../lib/email';
import { ApiError, badRequest, clientIp, ipKey, limit, notFound, parseJson } from '../lib/errors';
import { newId } from '../lib/ids';
import { optionalAuth } from '../lib/middleware';
import { contactFieldsFromConnectValue, findProfileBySlug, hasBlocked } from '../lib/profiles';
import { maybeCreateLead } from '../lib/sequences';
import { parseBookingLinks, parseContact, parseLinks, toPublicProfile } from '../lib/serialize';
import { signedVcardUrl, verifyVcardSignature } from '../lib/signing';
import { verifyTurnstile } from '../lib/turnstile';

export const publicRoutes = new Hono<AppEnv>();

const viewerOf = (c: Context<AppEnv>): AuthedUser | undefined => c.get('user');

/**
 * The profile behind a slug, as the viewer may see it. 404 when missing or when its owner blocked
 * the viewer. Misses are rate limited per IP (hits are not, so a venue sharing one IP is never
 * slowed down), so profiles can't be found by trying suffixes after a known name.
 */
async function visibleProfile(c: Context<AppEnv>, db: DB, slug: string): Promise<ProfileRow> {
  const viewer = viewerOf(c);
  const profile = await findProfileBySlug(db, slug);
  if (!profile) {
    await limit(c.env.PROFILE_MISS_LIMITER, ipKey(c, 'profile-miss'));
    throw notFound('Profile not found');
  }
  if (viewer && viewer.id !== profile.userId && (await hasBlocked(db, profile.userId, viewer.id))) {
    throw notFound('Profile not found');
  }
  return profile;
}

/**
 * Anonymous responses are the same for everyone; signed-in ones depend on blocks, so never share them.
 * optionalAuth reads a bearer token or a session cookie, so both are part of the cache key.
 */
function setCacheHeaders(c: Context<AppEnv>) {
  c.header('Cache-Control', viewerOf(c) ? 'private, no-store' : 'public, max-age=60');
  c.header('Vary', 'Authorization, Cookie', { append: true });
}

/**
 * Whether `viewer` may see this profile's phone and messaging details (§2 of the plan): the owner
 * always can; a 'public' profile is open to anyone; otherwise a signed-in viewer needs an accepted
 * connection row and must not have blocked the owner. The owner having blocked the viewer never
 * reaches here: visibleProfile already turns that into a 404. Anything other than the exact 'public'
 * string reads as 'connections', the same fail-closed rule toPublicProfile applies.
 */
async function canSeeContact(
  db: DB,
  viewer: AuthedUser | undefined,
  profile: ProfileRow,
  blockedByMe: boolean,
): Promise<boolean> {
  if (viewer?.id === profile.userId) return true;
  if (profile.contactVisibility === 'public') return true;
  if (!viewer || blockedByMe) return false;
  const [userA, userB] = viewer.id < profile.userId ? [viewer.id, profile.userId] : [profile.userId, viewer.id];
  const [row] = await db
    .select({ status: connections.status })
    .from(connections)
    .where(and(eq(connections.userA, userA), eq(connections.userB, userB)))
    .limit(1);
  return row?.status === 'accepted';
}

/** The owner's usable contact values, or null when they have none (whatever the visibility). */
function usableContact(contact: ProfileContact): ProfileContact | null {
  const channels = profileContactChannels(contact);
  if (channels.length === 0) return null;
  const usable: ProfileContact = {};
  for (const key of channels) usable[key] = contact[key];
  return usable;
}

publicRoutes.get('/id/:slug', optionalAuth, async (c) => {
  const db = getDb(c.env);
  const viewer = viewerOf(c);
  const profile = await visibleProfile(c, db, c.req.param('slug'));
  setCacheHeaders(c);

  const blockedByMe = viewer && viewer.id !== profile.userId ? await hasBlocked(db, viewer.id, profile.userId) : false;
  const contact = await canSeeContact(db, viewer, profile, blockedByMe);
  // vcardUrl only ever rides alongside contact, and only when it isn't already unconditionally in
  // the plain vCard (a 'public' profile's vcard route already includes it with no signature needed).
  const vcardUrl = contact && profile.contactVisibility !== 'public' ? await signedVcardUrl(c.env, profile.slug) : undefined;

  const body: PublicProfile = await toPublicProfile(c.env, db, profile, { contact, vcardUrl });
  if (viewer && viewer.id !== profile.userId) body.blockedByMe = blockedByMe;
  return c.json(body);
});

publicRoutes.get('/id/:slug/vcard', optionalAuth, async (c) => {
  const profile = await visibleProfile(c, getDb(c.env), c.req.param('slug'));

  const exp = c.req.query('exp');
  const sig = c.req.query('sig');
  const signed = !!exp && !!sig && (await verifyVcardSignature(c.env, profile.slug, exp, sig));
  const includeContact = signed || profile.contactVisibility === 'public';

  const vcard = buildVCard({
    displayName: profile.displayName,
    headline: profile.headline,
    company: profile.company,
    role: profile.role,
    links: parseLinks(profile.links),
    profileUrl: `${c.env.WEB_ORIGIN}${PROFILE_PATH_PREFIX}${profile.slug}`,
    bookingLinks: parseBookingLinks(profile.bookingLinks),
    contact: includeContact ? parseContact(profile.contact) : undefined,
  });

  // A verified signature proves this exact request may carry the number, so it's never cached or
  // shared; otherwise the usual anonymous/signed-in cache rule applies (setCacheHeaders).
  if (signed) c.header('Cache-Control', 'private, no-store');
  else setCacheHeaders(c);
  // #1 will make /id/* pages crawlable. This URL (and any Save contact link to it) must never be
  // indexed, since a signed one carries the owner's number.
  c.header('X-Robots-Tag', 'noindex');
  // Slugs are [a-z0-9-] only, so the filename needs no escaping.
  return c.body(vcard, 200, {
    'Content-Type': 'text/vcard; charset=utf-8',
    'Content-Disposition': `attachment; filename="${profile.slug}.vcf"`,
  });
});

const DAY_MS = 24 * 60 * 60 * 1000;
/** Connect notification emails per owner per rolling day. */
export const CONNECT_EMAILS_PER_DAY = 10;

/** Web Connect form for people without the app. Lands in the owner's contacts as 'web_connect'. */
publicRoutes.post('/id/:slug/connect', optionalAuth, async (c) => {
  const slug = c.req.param('slug').trim().toLowerCase();
  // Global per-IP cap first (D24): catches a burst spread across many slugs that the per-slug
  // limiter below would never see.
  await limit(c.env.CONNECT_ANY_LIMITER, ipKey(c, 'connect-any'));
  await limit(c.env.CONNECT_LIMITER, ipKey(c, `connect:${slug}`));
  const input = await parseJson(c, connectFormSchema);
  const name = cleanName(input.name);
  if (!name) throw badRequest('name: Name is required');

  if (!(await verifyTurnstile(c.env, input.turnstileToken, clientIp(c)))) {
    throw new ApiError(403, 'captcha_failed', 'Captcha check failed. Please try again.');
  }

  const db = getDb(c.env);
  const owner = await visibleProfile(c, db, slug);

  const { unmatched, ...fields } = contactFieldsFromConnectValue(input.contact);
  const notes = [input.note, unmatched ? `Contact: ${unmatched}` : null].filter(Boolean).join('\n\n') || null;

  await db.insert(contacts).values({
    id: newId(),
    userId: owner.userId,
    name,
    ...fields,
    notes,
    source: 'web_connect',
  });

  // The form is anonymous, so even someone the owner blocked can send it. Capping the emails per
  // owner keeps a flood of submissions out of the owner's inbox (each still lands in contacts).
  const since = new Date(Date.now() - DAY_MS);
  const [recent] = await db
    .select({ n: sql<number>`count(*)` })
    .from(contacts)
    .where(and(eq(contacts.userId, owner.userId), eq(contacts.source, 'web_connect'), gt(contacts.createdAt, since)));
  if ((recent?.n ?? 0) <= CONNECT_EMAILS_PER_DAY) c.executionCtx.waitUntil(notifyOwner(c.env, db, owner.userId));

  // Marketing consent (issue #7): only for a visitor who ticked the box, and only ever the sender's
  // own address (input.contact), never anything about the profile owner they're connecting with.
  if (input.tipsOptIn) {
    c.executionCtx.waitUntil(
      maybeCreateLead(c.env, db, input.contact).catch((err) => console.error('Tips lead signup failed', err)),
    );
  }

  const body: ConnectFormResponse = { ok: true };
  const usable = usableContact(parseContact(owner.contact));
  if (usable) {
    body.contact = usable;
    // A 'public' profile's plain vcard already carries the number with no signature needed.
    if (owner.contactVisibility !== 'public') body.vcardUrl = await signedVcardUrl(c.env, owner.slug);
  }
  return c.json(body, 201);
});

/** Control characters and bidi overrides, which could garble or disguise a name in the owner's contacts. */
const UNSAFE_NAME_CHARS = /[\u0000-\u001F\u007F-\u009F‪-‮⁦-⁩]/g;

/** One line of plain text: whitespace runs collapsed (the name is a contact name), unsafe characters removed. */
function cleanName(value: string): string {
  return cleanText(value.replace(/\s+/g, ' ').replace(UNSAFE_NAME_CHARS, '')).replace(/ {2,}/g, ' ');
}

/**
 * Best effort: a failed notification never fails the Connect request. Nothing the visitor typed
 * goes into the email, not even their name: it would go out from our domain and could pose as a
 * message from Chatsoon (a phishing line in the subject).
 */
async function notifyOwner(env: Env, db: DB, ownerId: string) {
  try {
    const [owner] = await db.select({ email: users.email }).from(users).where(eq(users.id, ownerId)).limit(1);
    if (!owner) return;
    await sendEmail(env, {
      to: owner.email,
      subject: 'Someone connected with you on Chatsoon',
      text: [
        'Someone connected with you from your Chatsoon profile page and is now in your contacts.',
        'Open Chatsoon to see their details and follow up.',
        '',
        'Chatsoon',
        env.WEB_ORIGIN,
      ].join('\n'),
    });
  } catch (err) {
    console.error('Connect notification failed', err);
  }
}
