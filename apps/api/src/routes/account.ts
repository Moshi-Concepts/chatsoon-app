import { cancelDeletionSchema, deleteAccountSchema } from '@chatsoon/shared';
import { Hono } from 'hono';

import type { AppEnv } from '../env';
import { deleteUserData, exportContactsCsv } from '../lib/account';
import { getDb } from '../lib/db';
import { cancelAccountDeletion, cancelAccountDeletionByToken, maskEmail, scheduleAccountDeletion } from '../lib/deletion';
import { ApiError, ipKey, limit, notFound, parseJson } from '../lib/errors';
import { requireAuth } from '../lib/middleware';
import { isActiveReviewer } from '../lib/reviewer';

// DELETE /me              permanently, immediately deletes the account, its rows and its files
// POST   /me/deletion     schedules a delayed deletion (issue #8), or runs it immediately for the reviewer
// DELETE /me/deletion     cancels a pending scheduled deletion
// POST   /account-deletion/cancel   cancels by the token from the "scheduled" email (no auth)
// GET    /me/export.csv   the user's contacts as an RFC 4180 CSV download
//
// Middleware is attached per route: a `use('*')` here would also run for every route
// mounted after this module (including the anonymous POST /reports and POST /account-deletion/cancel).
export const accountRoutes = new Hono<AppEnv>();

/**
 * Immediate, unconditional deletion. Kept exactly as it was before issue #8: the 1.0 native app
 * calls this and tells the user their data has been removed on the spot, so it must never become a
 * delayed/cancellable schedule. `POST /me/deletion` below is the new, safer, delayed path; this one
 * stays for that older client and for anything that genuinely wants deletion right now (the reviewer
 * account uses this same function, just called from the other route).
 */
accountRoutes.delete('/me', requireAuth, async (c) => {
  const user = c.get('user');
  await deleteUserData(c.env, getDb(c.env), user.id, user.email);
  return c.body(null, 204);
});

/**
 * Schedules account deletion `DELETION_GRACE_MS` from now (issue #8). Idempotent while a deletion is
 * already pending: returns the existing schedule, sends no second email, and does not extend the
 * time. The reviewer account (App Store / Play review notes: deleting it resets it) is deleted
 * immediately instead, exactly like `DELETE /me`.
 */
accountRoutes.post('/me/deletion', requireAuth, async (c) => {
  const user = c.get('user');
  await parseJson(c, deleteAccountSchema);
  const db = getDb(c.env);

  if (isActiveReviewer(c.env, user.email)) {
    await deleteUserData(c.env, db, user.id, user.email);
    return c.json({ status: 'deleted' as const });
  }

  const { deleteAfter } = await scheduleAccountDeletion(c.env, db, c.executionCtx, user.id, user.email);
  return c.json({ status: 'scheduled' as const, deleteAfter: deleteAfter.toISOString() });
});

/** Cancels a pending scheduled deletion. The account (and its public profile) is unaffected either way. */
accountRoutes.delete('/me/deletion', requireAuth, async (c) => {
  const user = c.get('user');
  const cancelled = await cancelAccountDeletion(getDb(c.env), user.id);
  if (!cancelled) throw notFound('No deletion is pending for this account');
  return c.json({ status: 'cancelled' as const });
});

/**
 * Cancels by the token from the "scheduled" email's link. No auth: the email itself is the proof of
 * ownership, same as any other emailed-link flow. POST only (never GET) so link scanners and preview
 * bots can't trigger it by prefetching the URL. Rate limited per IP: the token is an unguessable 32
 * byte random value, but this is cheap defence in depth against a flood of guesses.
 */
accountRoutes.post('/account-deletion/cancel', async (c) => {
  await limit(c.env.REPORT_LIMITER, ipKey(c, 'cancel-deletion'));
  const { token } = await parseJson(c, cancelDeletionSchema);
  const email = await cancelAccountDeletionByToken(getDb(c.env), token);
  if (!email) throw new ApiError(400, 'invalid_token', 'This cancellation link is invalid or has expired.');
  return c.json({ status: 'cancelled' as const, email: maskEmail(email) });
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
