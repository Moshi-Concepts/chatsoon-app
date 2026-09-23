import { tagInputSchema, type TagsResponse } from '@chatsoon/shared';
import { and, eq } from 'drizzle-orm';
import { Hono } from 'hono';

import { tags } from '../db/schema';
import type { AppEnv } from '../env';
import { getDb } from '../lib/db';
import { ApiError, notFound, parseJson } from '../lib/errors';
import { newId } from '../lib/ids';
import { requireAuth } from '../lib/middleware';
import { toTag } from '../lib/serialize';
import { findTagByName, listTags } from '../lib/tags';

export const tagsRoutes = new Hono<AppEnv>();

tagsRoutes.get('/tags', requireAuth, async (c) => {
  const rows = await listTags(getDb(c.env), c.get('user').id);
  return c.json({ tags: rows.map(toTag) } satisfies TagsResponse);
});

/** Creates a tag. A name I already have (any case) returns that tag with 200. */
tagsRoutes.post('/tags', requireAuth, async (c) => {
  const userId = c.get('user').id;
  const { name } = await parseJson(c, tagInputSchema);
  const db = getDb(c.env);

  const existing = await findTagByName(db, userId, name);
  if (existing) return c.json(toTag(existing), 200);

  const [row] = await db.insert(tags).values({ id: newId(), userId, name }).onConflictDoNothing().returning();
  if (row) return c.json(toTag(row), 201);

  // A concurrent request created the same name between the lookup and the insert.
  const raced = await findTagByName(db, userId, name);
  if (!raced) throw new ApiError(500, 'internal', 'Could not create the tag');
  return c.json(toTag(raced), 200);
});

/** Deletes one of my tags. contact_tags rows go with it (FK cascade). */
tagsRoutes.delete('/tags/:id', requireAuth, async (c) => {
  const userId = c.get('user').id;
  const [row] = await getDb(c.env)
    .delete(tags)
    .where(and(eq(tags.id, c.req.param('id')), eq(tags.userId, userId)))
    .returning({ id: tags.id });
  if (!row) throw notFound('Tag not found');
  return c.body(null, 204);
});
