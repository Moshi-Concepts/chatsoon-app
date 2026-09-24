import { buildVCard, cleanText, connectFormSchema, PROFILE_PATH_PREFIX, type PublicProfile } from '@chatsoon/shared';
import { and, eq, gt, sql } from 'drizzle-orm';
import { Hono, type Context } from 'hono';

import { contacts, users, type ProfileRow } from '../db/schema';
import type { AppEnv, AuthedUser, Env } from '../env';
import { getDb, type DB } from '../lib/db';
import { sendEmail } from '../lib/email';
import { ApiError, badRequest, clientIp, ipKey, limit, notFound, parseJson } from '../lib/errors';
import { newId } from '../lib/ids';
import { optionalAuth } from '../lib/middleware';
import { contactFieldsFromConnectValue, findProfileBySlug, hasBlocked } from '../lib/profiles';
import { parseBookingLinks, parseLinks, toPublicProfile } from '../lib/serialize';
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

publicRoutes.get('/id/:slug', optionalAuth, async (c) => {
  const db = getDb(c.env);
  const viewer = viewerOf(c);
  const profile = await visibleProfile(c, db, c.req.param('slug'));
  setCacheHeaders(c);
  const body: PublicProfile = await toPublicProfile(c.env, profile);
  if (viewer && viewer.id !== profile.userId) body.blockedByMe = await hasBlocked(db, viewer.id, profile.userId);
  return c.json(body);
});

publicRoutes.get('/id/:slug/vcard', optionalAuth, async (c) => {
  const profile = await visibleProfile(c, getDb(c.env), c.req.param('slug'));
  const vcard = buildVCard({
    displayName: profile.displayName,
    headline: profile.headline,
    company: profile.company,
    role: profile.role,
    links: parseLinks(profile.links),
    profileUrl: `${c.env.WEB_ORIGIN}${PROFILE_PATH_PREFIX}${profile.slug}`,
    bookingLinks: parseBookingLinks(profile.bookingLinks),
  });
  setCacheHeaders(c);
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
  return c.json({ ok: true as const }, 201);
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
