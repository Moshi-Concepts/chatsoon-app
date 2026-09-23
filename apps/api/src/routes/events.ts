import { eventInputSchema, type EventsResponse } from '@chatsoon/shared';
import { and, eq, or } from 'drizzle-orm';
import { Hono } from 'hono';

import { events, type EventRow } from '../db/schema';
import type { AppEnv } from '../env';
import { getDb, type DB } from '../lib/db';
import { ApiError, badRequest, parseJson } from '../lib/errors';
import { newId } from '../lib/ids';
import { requireAuth } from '../lib/middleware';
import { toEvent } from '../lib/serialize';

export const eventsRoutes = new Hono<AppEnv>();

/** Public events plus the private events this user created. */
const visibleTo = (userId: string) => or(eq(events.isPublic, true), eq(events.createdBy, userId));

const collator = new Intl.Collator('en', { sensitivity: 'base', numeric: true });
const nameKey = (name: string) => name.trim().toLowerCase();

/** Events the user can see: public first, then by name. */
export async function listVisibleEvents(db: DB, userId: string): Promise<EventRow[]> {
  const rows = await db.select().from(events).where(visibleTo(userId));
  return rows.sort(
    (a, b) => Number(b.isPublic) - Number(a.isPublic) || collator.compare(a.name, b.name) || a.id.localeCompare(b.id),
  );
}

/** Throws 400 unless the event is public or was created by the user. */
export async function assertEventVisible(db: DB, userId: string, eventId: string): Promise<void> {
  const [row] = await db
    .select({ id: events.id })
    .from(events)
    .where(and(eq(events.id, eventId), visibleTo(userId)))
    .limit(1);
  if (!row) throw badRequest('Unknown event');
}

eventsRoutes.get('/events', requireAuth, async (c) => {
  const rows = await listVisibleEvents(getDb(c.env), c.get('user').id);
  return c.json({ events: rows.map(toEvent) } satisfies EventsResponse);
});

/**
 * Finds or creates an event by name. A public event (or one of mine) with the same name,
 * ignoring case, is reused with 200. Otherwise a private event is created with 201.
 */
eventsRoutes.post('/events', requireAuth, async (c) => {
  const userId = c.get('user').id;
  const { name } = await parseJson(c, eventInputSchema);
  const db = getDb(c.env);

  // Sorted public first, so a public event wins over a private one with the same name.
  const key = nameKey(name);
  const existing = (await listVisibleEvents(db, userId)).find((e) => nameKey(e.name) === key);
  if (existing) return c.json(toEvent(existing), 200);

  const [row] = await db.insert(events).values({ id: newId(), name, isPublic: false, createdBy: userId }).returning();
  if (!row) throw new ApiError(500, 'internal', 'Could not create the event');
  return c.json(toEvent(row), 201);
});
