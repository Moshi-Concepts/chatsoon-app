import { blockSchema, optionalText, profileUrl, REPORT_REASONS, reportSchema } from '@chatsoon/shared';
import { and, eq, inArray, or } from 'drizzle-orm';
import { Hono, type Context } from 'hono';
import { z } from 'zod';

import { blocks, connections, contacts, contactTags, profiles, reports, users } from '../db/schema';
import type { AppEnv, AuthedUser, Env } from '../env';
import { chunk } from '../lib/contacts';
import type { DB } from '../lib/db';
import { getDb } from '../lib/db';
import { sendEmail } from '../lib/email';
import { badRequest, ipKey, limit, notFound, parseJson, unauthorized } from '../lib/errors';
import { newId } from '../lib/ids';
import { optionalAuth, requireAuth } from '../lib/middleware';
import { ownsKey, userPrefix } from '../lib/signing';

// POST   /reports          report a profile or user (anonymous allowed, from the public web page),
//                           or, signed in, a Connect form message in my contacts (contactId)
// POST   /blocks           block a user: removes my linked contacts and their link to me
// DELETE /blocks/:userId   unblock by user id or slug (the connection stays blocked until a new scan)
//
// Middleware is attached per route so POST /reports stays reachable without a session.
export const moderationRoutes = new Hono<AppEnv>();

interface Target {
  userId: string;
  slug: string | null;
}

/** Finds the reported or blocked user by public slug (preferred) or user id. 404 when missing. */
async function resolveTarget(db: DB, input: { targetSlug?: string; targetUserId?: string }): Promise<Target> {
  if (input.targetSlug) {
    const [profile] = await db
      .select({ userId: profiles.userId, slug: profiles.slug })
      .from(profiles)
      .where(eq(profiles.slug, input.targetSlug.toLowerCase()))
      .limit(1);
    if (!profile) throw notFound('Profile not found');
    return profile;
  }
  const [user] = await db
    .select({ userId: users.id, slug: profiles.slug })
    .from(users)
    .leftJoin(profiles, eq(profiles.userId, users.id))
    .where(eq(users.id, input.targetUserId ?? ''))
    .limit(1);
  if (!user) throw notFound('User not found');
  return user;
}

interface ReportNotice {
  id: string;
  reason: string;
  details: string | null;
  reporterId: string | null;
  /** Short name of what was reported, for the subject line. */
  about: string;
  /** What was reported, one fact per line. Never text a user wrote. */
  targetLines: string[];
}

function userTargetLines(target: Target): string[] {
  return [
    `Target slug: ${target.slug ?? '(no profile)'}`,
    ...(target.slug ? [`Target profile: ${profileUrl(target.slug)}`] : []),
    `Target user id: ${target.userId}`,
  ];
}

async function notifyReport(env: Env, r: ReportNotice) {
  if (!env.REPORTS_NOTIFY_EMAIL) return;
  await sendEmail(env, {
    to: env.REPORTS_NOTIFY_EMAIL,
    subject: `Chatsoon report: ${r.reason} (${r.about})`,
    // Free text (the reporter's, a Connect form sender's) goes last, so it can't pose as the fields above it.
    text: [
      `Report ${r.id}`,
      `Reason: ${r.reason}`,
      ...r.targetLines,
      `Reporter: ${r.reporterId ?? 'anonymous'}`,
      `Received: ${new Date().toISOString()}`,
      '',
      `Details: ${r.details ?? '(none)'}`,
    ].join('\n'),
  });
}

moderationRoutes.post('/reports', optionalAuth, async (c) => {
  // optionalAuth leaves `user` unset for anonymous callers.
  const reporter = c.get('user') as AuthedUser | undefined;
  await limit(c.env.REPORT_LIMITER, reporter ? `report:user:${reporter.id}` : ipKey(c, 'report'));

  const { contactId } = await parseJson(c, z.object({ contactId: z.unknown().optional() }));
  if (contactId != null) return reportConnectMessage(c, reporter, await parseJson(c, contactReportSchema));

  const input = await parseJson(c, reportSchema);
  const db = getDb(c.env);
  const target = await resolveTarget(db, input);
  if (reporter && target.userId === reporter.id) throw badRequest("You can't report yourself");

  const notice: ReportNotice = {
    id: newId(),
    reason: input.reason,
    details: input.details ?? null,
    reporterId: reporter?.id ?? null,
    about: target.slug ?? target.userId,
    targetLines: userTargetLines(target),
  };
  await db.insert(reports).values({
    id: notice.id,
    reporterId: notice.reporterId,
    targetUserId: target.userId,
    reason: notice.reason,
    details: notice.details,
  });

  sendReportNotice(c, notice);
  return c.json({ ok: true }, 201);
});

function sendReportNotice(c: Context<AppEnv>, notice: ReportNotice) {
  c.executionCtx.waitUntil(
    notifyReport(c.env, notice).catch((err) => console.error('Report notification failed', notice.id, err)),
  );
}

/** A report about a Connect form message: a web_connect contact in the reporter's own list. */
const contactReportSchema = z.object({
  contactId: z.string().trim().min(1).max(100),
  reason: z.enum(REPORT_REASONS),
  details: optionalText(1000),
});

/**
 * Connect form messages come from people without an account, so there is no profile to report or
 * block. The owner reports the message itself. The report keeps a copy of what the sender wrote,
 * so it survives the owner deleting the contact afterwards.
 */
async function reportConnectMessage(
  c: Context<AppEnv>,
  reporter: AuthedUser | undefined,
  input: z.output<typeof contactReportSchema>,
) {
  if (!reporter) throw unauthorized();
  const db = getDb(c.env);
  const [contact] = await db
    .select()
    .from(contacts)
    .where(
      and(eq(contacts.id, input.contactId), eq(contacts.userId, reporter.id), eq(contacts.source, 'web_connect')),
    )
    .limit(1);
  if (!contact) throw notFound('Contact not found');

  const fields: [string, string | null][] = [
    ['Name', contact.name],
    ['Email', contact.email],
    ['Phone', contact.phone],
    ['Telegram', contact.telegram],
    ['X', contact.xHandle],
    ['LinkedIn', contact.linkedinUrl],
    ['Website', contact.website],
    ['Notes', contact.notes],
  ];
  const message = [
    'Connect form message:',
    ...fields.filter(([, value]) => value).map(([label, value]) => `${label}: ${value}`),
    `Sent: ${contact.createdAt.toISOString()}`,
  ].join('\n');

  const notice: ReportNotice = {
    id: newId(),
    reason: input.reason,
    details: `${message}\n\nFrom the reporter: ${input.details ?? '(none)'}`,
    reporterId: reporter.id,
    about: 'Connect form message',
    targetLines: [`Target: Connect form message, web_connect contact ${contact.id} of user ${reporter.id}`],
  };
  await db.insert(reports).values({
    id: notice.id,
    reporterId: reporter.id,
    targetUserId: null,
    contactId: contact.id,
    reason: notice.reason,
    details: notice.details,
  });

  sendReportNotice(c, notice);
  return c.json({ ok: true }, 201);
}

moderationRoutes.post('/blocks', requireAuth, async (c) => {
  const me = c.get('user').id;
  const input = await parseJson(c, blockSchema);
  const db = getDb(c.env);
  const { userId: them } = await resolveTarget(db, input);
  if (them === me) throw badRequest("You can't block yourself");

  const myLinkedContacts = and(eq(contacts.userId, me), eq(contacts.linkedUserId, them));
  const [, , , removed] = await db.batch([
    db.insert(blocks).values({ blockerId: me, blockedId: them }).onConflictDoNothing(),
    db
      .update(connections)
      .set({ status: 'blocked' })
      .where(
        or(
          and(eq(connections.userA, me), eq(connections.userB, them)),
          and(eq(connections.userA, them), eq(connections.userB, me)),
        ),
      ),
    db
      .delete(contactTags)
      .where(
        and(
          eq(contactTags.userId, me),
          inArray(contactTags.contactId, db.select({ id: contacts.id }).from(contacts).where(myLinkedContacts)),
        ),
      ),
    db.delete(contacts).where(myLinkedContacts).returning({ cardImageKey: contacts.cardImageKey }),
    // They keep the card they saved for me, but no longer see me as a Chatsoon connection. The card
    // remembers me, so a scan after an unblock links it again instead of adding a second card.
    db
      .update(contacts)
      .set({ linkedUserId: null, unlinkedUserId: me })
      .where(and(eq(contacts.userId, them), eq(contacts.linkedUserId, me))),
  ]);

  await releaseCardImages(c.env, db, me, removed.map((r) => r.cardImageKey));
  return c.json({ ok: true }, 201);
});

/**
 * Accepts a user id or a public slug, because a profile screen only knows the slug. Only ever
 * touches my own block, and answers 204 either way so it reveals nothing about other users.
 */
moderationRoutes.delete('/blocks/:userId', requireAuth, async (c) => {
  const me = c.get('user').id;
  const target = c.req.param('userId').trim();
  const db = getDb(c.env);
  const bySlug = db.select({ id: profiles.userId }).from(profiles).where(eq(profiles.slug, target.toLowerCase()));
  await db
    .delete(blocks)
    .where(and(eq(blocks.blockerId, me), or(eq(blocks.blockedId, target), inArray(blocks.blockedId, bySlug))));
  return c.body(null, 204);
});

/**
 * Deletes the card photos of contacts removed by a block, unless another of my contacts still
 * points at the same photo. The block is already saved, so a storage failure is only logged.
 */
async function releaseCardImages(env: Env, db: DB, userId: string, keys: (string | null)[]) {
  const cardPrefix = `${userPrefix(userId)}card/`;
  const candidates = [...new Set(keys)].filter(
    (key): key is string => !!key && ownsKey(userId, key) && key.startsWith(cardPrefix),
  );
  if (candidates.length === 0) return;
  try {
    const stillUsed = new Set<string | null>();
    for (const part of chunk(candidates)) {
      const rows = await db
        .select({ key: contacts.cardImageKey })
        .from(contacts)
        .where(and(eq(contacts.userId, userId), inArray(contacts.cardImageKey, part)));
      for (const row of rows) stillUsed.add(row.key);
    }
    const unused = candidates.filter((key) => !stillUsed.has(key));
    if (unused.length > 0) await env.FILES.delete(unused);
  } catch (err) {
    console.error('Deleting card photos after a block failed', err);
  }
}
