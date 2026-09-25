import { Hono } from 'hono';

import type { AppEnv } from '../env';
import { getDb } from '../lib/db';
import { ApiError, ipKey, limit } from '../lib/errors';
import { unsubscribeByToken } from '../lib/sequences';
import { verifyUnsubscribeToken } from '../lib/unsubscribe';

// One-click unsubscribe for tips emails (issue #7, RFC 8058). GET never unsubscribes - a link
// scanner or a mail client's preview fetch must not silently opt someone out - it only redirects to
// the web page that lets a person confirm with a real POST. POST is the one-click action itself,
// which a compliant mail client can fire with no page load at all (List-Unsubscribe-Post).
export const emailRoutes = new Hono<AppEnv>();

emailRoutes.get('/email/unsubscribe', (c) => {
  const token = c.req.query('token') ?? '';
  const url = new URL('/unsubscribe', c.env.WEB_ORIGIN);
  if (token) url.searchParams.set('token', token);
  return c.redirect(url.toString(), 302);
});

/**
 * Rate limited per IP like the other anonymous, no-auth POST route (POST /reports): both are
 * unauthenticated actions on someone else's behalf in the worst case, at similarly low expected
 * volume, so REPORT_LIMITER's IP bucket is reused rather than provisioning a new one.
 * The body is never parsed: RFC 8058 lets a mail client POST here with a fixed
 * `List-Unsubscribe=One-Click` form field (or nothing at all), and the token alone is enough to act.
 */
emailRoutes.post('/email/unsubscribe', async (c) => {
  await limit(c.env.REPORT_LIMITER, ipKey(c, 'email-unsubscribe'));
  const token = c.req.query('token') ?? '';
  const parsed = await verifyUnsubscribeToken(c.env, token);
  if (!parsed) throw new ApiError(400, 'invalid_token', 'Invalid or expired unsubscribe link');

  await unsubscribeByToken(getDb(c.env), parsed.kind, parsed.id);
  return c.json({ ok: true }, 200);
});
