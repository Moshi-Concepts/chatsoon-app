import { CARD_PLACEHOLDER_NAME, type ExtractCardResponse, type ExtractedCard, extractCardSchema } from '@chatsoon/shared';
import { and, eq, sql } from 'drizzle-orm';
import type { SQLiteUpdateSetSource } from 'drizzle-orm/sqlite-core';
import { type Context, Hono } from 'hono';

import { contacts } from '../db/schema';
import type { AppEnv } from '../env';
import { EXTRACT_FAILED_MESSAGE, ExtractError, extractCard } from '../lib/anthropic';
import { getContact } from '../lib/contacts';
import { type DB, getDb } from '../lib/db';
import { ApiError, badRequest, limit, notFound, parseJson } from '../lib/errors';
import { requireAuth } from '../lib/middleware';
import { ownsKey, userPrefix } from '../lib/signing';

/** Contact fields the extractor may fill, besides the name. */
const FILLABLE = [
  'company',
  'role',
  'email',
  'phone',
  'telegram',
  'xHandle',
  'linkedinUrl',
  'website',
] as const satisfies readonly (keyof ExtractedCard)[];

const isCardKey = (userId: string, key: string) =>
  ownsKey(userId, key) && key.startsWith(`${userPrefix(userId)}card/`);

/** Deletes a replaced card photo after the response, unless another of my contacts still uses it. */
function releaseCardImage(c: Context<AppEnv>, db: DB, userId: string, key: string) {
  if (!isCardKey(userId, key)) return;
  c.executionCtx.waitUntil(
    (async () => {
      const [stillUsed] = await db
        .select({ id: contacts.id })
        .from(contacts)
        .where(and(eq(contacts.userId, userId), eq(contacts.cardImageKey, key)))
        .limit(1);
      if (!stillUsed) await c.env.FILES.delete(key);
    })().catch((err) => console.error('Failed to delete card image', key, err)),
  );
}

export const extractRoutes = new Hono<AppEnv>();

extractRoutes.post('/extract/card', requireAuth, async (c) => {
  const userId = c.var.user.id;
  const { contactId, imageKey } = await parseJson(c, extractCardSchema);
  const db = getDb(c.env);
  const mine = and(eq(contacts.id, contactId), eq(contacts.userId, userId));

  const [row] = await db.select({ cardImageKey: contacts.cardImageKey }).from(contacts).where(mine).limit(1);
  if (!row) throw notFound('Contact not found');
  // Card photos only, so a contact can never point at the profile avatar.
  if (!isCardKey(userId, imageKey)) throw badRequest('Unknown image');
  await limit(c.env.EXTRACT_LIMITER, `extract:${userId}`);

  const object = await c.env.FILES.get(imageKey);
  if (!object) {
    // Nothing to read. Fail the extraction so the app asks for the details instead of waiting.
    await db.update(contacts).set({ extractionStatus: 'failed', updatedAt: new Date() }).where(mine);
    throw new ApiError(502, 'extraction_failed', "The card photo couldn't be found. Fill in the details yourself.");
  }

  await db
    .update(contacts)
    .set({ extractionStatus: 'processing', cardImageKey: imageKey, updatedAt: new Date() })
    .where(mine);
  if (row.cardImageKey && row.cardImageKey !== imageKey) releaseCardImage(c, db, userId, row.cardImageKey);

  let extracted: ExtractedCard;
  try {
    extracted = await extractCard(c.env, await object.arrayBuffer(), object.httpMetadata?.contentType ?? '');
  } catch (err) {
    if (!(err instanceof ExtractError)) console.error('Card extraction failed', err);
    await db.update(contacts).set({ extractionStatus: 'failed', updatedAt: new Date() }).where(mine);
    // The app keeps the photo and shows an empty review form.
    throw new ApiError(502, 'extraction_failed', err instanceof ExtractError ? err.message : EXTRACT_FAILED_MESSAGE);
  }

  // Fill only what is still empty, decided in SQL so edits made during extraction are kept.
  const set: SQLiteUpdateSetSource<typeof contacts> = { extractionStatus: 'needs_review', updatedAt: new Date() };
  for (const field of FILLABLE) {
    const value = extracted[field];
    if (value) set[field] = sql`case when coalesce(trim(${contacts[field]}), '') = '' then ${value} else ${contacts[field]} end`;
  }
  if (extracted.name) {
    set.name = sql`case when trim(${contacts.name}) in ('', ${CARD_PLACEHOLDER_NAME}) then ${extracted.name} else ${contacts.name} end`;
  }
  await db.update(contacts).set(set).where(mine);

  const contact = await getContact(c.env, db, userId, contactId);
  if (!contact) throw notFound('Contact not found');
  const body: ExtractCardResponse = { contact, extracted };
  return c.json(body);
});
