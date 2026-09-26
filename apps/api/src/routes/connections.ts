import { followUpDueAt, scanConnectSchema, type ScanConnectResponse } from '@chatsoon/shared';
import { and, desc, eq, or } from 'drizzle-orm';
import { Hono } from 'hono';

import { connections, contacts, events, type ProfileRow } from '../db/schema';
import type { AppEnv } from '../env';
import { getContact } from '../lib/contacts';
import { getDb, type DB } from '../lib/db';
import { ApiError, badRequest, forbidden, limit, notFound, parseJson, rateLimited } from '../lib/errors';
import { newId } from '../lib/ids';
import { requireAuth } from '../lib/middleware';
import { contactFieldsFromProfile, findProfileBySlug, findProfileByUserId, hasBlocked } from '../lib/profiles';
import { reserveNewConnection } from '../lib/usage';

export const connectionsRoutes = new Hono<AppEnv>();

/**
 * App user scanned another user's Chatsoon QR. Auto-accepts: both users get each
 * other's card, and scanning again refreshes the cards without duplicating them.
 */
connectionsRoutes.post('/connections/scan', requireAuth, async (c) => {
  const me = c.get('user').id;
  const input = await parseJson(c, scanConnectSchema);
  // Generous: the outbox sends every connect queued offline in one burst.
  await limit(c.env.SCAN_LIMITER, `scan:${me}`);
  const db = getDb(c.env);

  const them = await findProfileBySlug(db, input.slug);
  if (!them) throw notFound('Profile not found');
  if (them.userId === me) throw badRequest("That's your own code. Scan someone else's to connect.");
  // Someone who blocked me looks like a missing profile, same as GET /id/:slug.
  if (await hasBlocked(db, them.userId, me)) throw notFound('Profile not found');
  if (await hasBlocked(db, me, them.userId)) throw forbidden('You blocked this person. Unblock them to connect.');
  const mine = await findProfileByUserId(db, me);
  if (!mine) throw forbidden('Create your profile first');

  const event = input.eventId ? await findUsableEvent(db, me, input.eventId) : null;
  const eventId = event?.id ?? null;
  // The connection row and the other person's card are shared facts, so a private event stays off them.
  const sharedEventId = event?.isPublic ? eventId : null;

  const [userA, userB] = me < them.userId ? [me, them.userId] : [them.userId, me];
  const [existing] = await db
    .select({ status: connections.status })
    .from(connections)
    .where(and(eq(connections.userA, userA), eq(connections.userB, userB)))
    .limit(1);
  const alreadyConnected = existing?.status === 'accepted';

  // Connecting auto-accepts, so this cap is what stands between a throwaway account and scanning
  // (or being scanned by) an unlimited number of profiles in a day. Re-scanning someone already
  // connected never counts against it.
  if (!alreadyConnected && !(await reserveNewConnection(c.env, me))) {
    throw rateLimited("You've connected with a lot of people today. Try again tomorrow.");
  }

  // One transaction: the connection row plus a card in each list. Plain D1 statements,
  // because drizzle's batch cannot run the raw insert-if-missing below.
  await c.env.DB.batch([
    c.env.DB.prepare(
      `insert into connections (id, user_a, user_b, status, event_id) values (?1, ?2, ?3, 'accepted', ?4)
       on conflict (user_a, user_b) do update
         set status = 'accepted', event_id = coalesce(connections.event_id, excluded.event_id)`,
    ).bind(newId(), userA, userB, sharedEventId),
    ...linkedContactStatements(c.env.DB, me, them, eventId),
    ...linkedContactStatements(c.env.DB, them.userId, mine, sharedEventId),
  ]);

  const [myCopy] = await db
    .select({ id: contacts.id })
    .from(contacts)
    .where(and(eq(contacts.userId, me), eq(contacts.linkedUserId, them.userId)))
    .orderBy(desc(contacts.updatedAt))
    .limit(1);
  const contact = myCopy ? await getContact(c.env, db, me, myCopy.id) : null;
  if (!contact) throw new ApiError(500, 'internal', 'Could not save the contact. Please try again.');

  const body: ScanConnectResponse = { contact, alreadyConnected };
  return c.json(body);
});

/** A public event, or a private one the caller created. Anything else is dropped. */
async function findUsableEvent(db: DB, userId: string, eventId: string) {
  const [event] = await db
    .select({ id: events.id, isPublic: events.isPublic })
    .from(events)
    .where(and(eq(events.id, eventId), or(eq(events.isPublic, true), eq(events.createdBy, userId))))
    .limit(1);
  return event ?? null;
}

/**
 * Links `ownerId`'s card that a block unlinked (POST /blocks), or creates a card for `other` if
 * there is none (a single statement, so two people scanning each other at the same moment still
 * get one card each), then fills only the fields the owner has left empty. Fields the owner
 * edited, and their notes and tags, are never overwritten.
 */
function linkedContactStatements(
  DB: D1Database,
  ownerId: string,
  other: ProfileRow,
  eventId: string | null,
): D1PreparedStatement[] {
  const f = contactFieldsFromProfile(other);
  const relink = DB.prepare(
    `update contacts set linked_user_id = ?2, unlinked_user_id = null
     where id = (select id from contacts where user_id = ?1 and unlinked_user_id = ?2 order by updated_at desc limit 1)
       and not exists (select 1 from contacts where user_id = ?1 and linked_user_id = ?2)`,
  ).bind(ownerId, other.userId);
  // Issue #33: this card has no priority (app connections never set one), so it's due the next day
  // like any other priority-3-or-none contact. created_at/updated_at are set explicitly (rather than
  // left to the column default) so follow_up_due_at is timed from the exact same instant.
  const now = Date.now();
  const dueAt = followUpDueAt(null, new Date(now)).getTime();
  const insertIfMissing = DB.prepare(
    `insert into contacts
       (id, user_id, linked_user_id, name, company, role, telegram, x_handle, linkedin_url, website, event_id, source, phone, created_at, updated_at, follow_up_due_at)
     select ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, 'app_connect', ?12, ?13, ?13, ?14
     where not exists (select 1 from contacts where user_id = ?2 and linked_user_id = ?3)`,
  ).bind(
    newId(),
    ownerId,
    other.userId,
    f.name,
    f.company,
    f.role,
    f.telegram,
    f.xHandle,
    f.linkedinUrl,
    f.website,
    eventId,
    f.phone,
    now,
    dueAt,
  );
  const refresh = DB.prepare(
    `update contacts set
       company = coalesce(nullif(company, ''), ?3),
       role = coalesce(nullif(role, ''), ?4),
       telegram = coalesce(nullif(telegram, ''), ?5),
       x_handle = coalesce(nullif(x_handle, ''), ?6),
       linkedin_url = coalesce(nullif(linkedin_url, ''), ?7),
       website = coalesce(nullif(website, ''), ?8),
       phone = coalesce(nullif(phone, ''), ?11),
       event_id = coalesce(event_id, ?9),
       updated_at = ?10
     where user_id = ?1 and linked_user_id = ?2`,
  ).bind(
    ownerId,
    other.userId,
    f.company,
    f.role,
    f.telegram,
    f.xHandle,
    f.linkedinUrl,
    f.website,
    eventId,
    Date.now(),
    f.phone,
  );
  return [relink, insertIfMissing, refresh];
}
