import { Hono } from 'hono';

import type { AppEnv } from '../env';
import { deleteUserData, exportContactsCsv } from '../lib/account';
import { getDb } from '../lib/db';
import { requireAuth } from '../lib/middleware';

// DELETE /me          permanently deletes the account, its rows and its files
// GET    /me/export.csv  the user's contacts as an RFC 4180 CSV download
//
// Middleware is attached per route: a `use('*')` here would also run for every route
// mounted after this module (including the anonymous POST /reports).
export const accountRoutes = new Hono<AppEnv>();

accountRoutes.delete('/me', requireAuth, async (c) => {
  const user = c.get('user');
  await deleteUserData(c.env, getDb(c.env), user.id, user.email);
  return c.body(null, 204);
});

accountRoutes.get('/me/export.csv', requireAuth, async (c) => {
  const csv = await exportContactsCsv(getDb(c.env), c.get('user').id);
  const date = new Date().toISOString().slice(0, 10);
  return c.body(csv, 200, {
    'Content-Type': 'text/csv; charset=utf-8',
    'Content-Disposition': `attachment; filename="chatsoon-contacts-${date}.csv"`,
    'Cache-Control': 'private, no-store',
  });
});
