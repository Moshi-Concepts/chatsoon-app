import {
  attributeReferralSchema,
  claimReferralSchema,
  inviteEmailsSchema,
  type AttributeReferralResponse,
  type GetReferralResponse,
  type ReferralPageResult,
  type RedeemClaimResponse,
  type VerifyClaimResponse,
} from '@chatsoon/shared';
import { eq } from 'drizzle-orm';
import { Hono, type Context } from 'hono';
import { z } from 'zod';

import { users } from '../db/schema';
import type { AppEnv, Env } from '../env';
import { getDb, type DB } from '../lib/db';
import { ApiError, clientIp, ipKey, limit, notFound, parseJson } from '../lib/errors';
import { requireAuth } from '../lib/middleware';
import {
  attributeReferral,
  claimReferral,
  findPublicReferralProfile,
  getReferralSummary,
  redeemReferralClaim,
  sendReferralInvites,
  verifyReferralClaim,
} from '../lib/referrals';
import { timingSafeEqual } from '../lib/signing';

// Signed-in, under /me/referral: GET /me/referral, POST /me/referral/attribute,
//   POST /me/referral/invites, POST /me/referral/claims.
// Anonymous: GET /referral/:code (the mobile /r/[code] route and, later, the web landing page).
// Partner (bearer REFERRAL_PARTNER_SECRET): GET /referral/claims/verify, POST /referral/claims/redeem.
// GET /_pages/referral/:code lives in routes/pages.ts, alongside the other secret-gated /_pages/* routes.
export const referralsRoutes = new Hono<AppEnv>();

/** X-Chatsoon-Device, read only by POST /me/referral/attribute. Malformed (too long) is ignored, not rejected. */
function deviceIdFromHeader(c: Context<AppEnv>): string | null {
  const value = c.req.header('x-chatsoon-device');
  return value && value.length > 0 && value.length <= 100 ? value : null;
}

referralsRoutes.get('/me/referral', requireAuth, async (c) => {
  const body: GetReferralResponse = await getReferralSummary(c.env, getDb(c.env), c.get('user').id);
  c.header('Cache-Control', 'private, no-store');
  return c.json(body);
});

/** Rate limited per IP (REFERRAL_ATTRIBUTE_LIMITER, 10/60s): code guessing. */
referralsRoutes.post('/me/referral/attribute', requireAuth, async (c) => {
  await limit(c.env.REFERRAL_ATTRIBUTE_LIMITER, ipKey(c, 'referral-attribute'));
  const user = c.get('user');
  const input = await parseJson(c, attributeReferralSchema);
  const db = getDb(c.env);

  const [row] = await db.select({ createdAt: users.createdAt }).from(users).where(eq(users.id, user.id)).limit(1);
  if (!row) throw notFound('Account not found');

  const body: AttributeReferralResponse = await attributeReferral(c.env, db, { id: user.id, email: user.email, createdAt: row.createdAt }, input, {
    ip: clientIp(c),
    userAgent: c.req.header('user-agent') ?? null,
    deviceId: deviceIdFromHeader(c),
  });
  return c.json(body);
});

referralsRoutes.post('/me/referral/invites', requireAuth, async (c) => {
  await limit(c.env.WRITE_LIMITER, ipKey(c, 'referral-invites'));
  const input = await parseJson(c, inviteEmailsSchema);
  const body = await sendReferralInvites(c.env, getDb(c.env), c.executionCtx, c.get('user').id, input.emails);
  return c.json(body);
});

referralsRoutes.post('/me/referral/claims', requireAuth, async (c) => {
  await limit(c.env.WRITE_LIMITER, ipKey(c, 'referral-claims'));
  const input = await parseJson(c, claimReferralSchema);
  const user = c.get('user');
  const body = await claimReferral(c.env, getDb(c.env), user.id, user.email, input);
  return c.json(body);
});

/** GET /referral/:code: the code owner's public card, for the mobile /r/[code] route. Same not-found
 * handling and shared PROFILE_MISS_LIMITER bucket as GET /id/:slug (routes/public.ts). */
referralsRoutes.get('/referral/:code', async (c) => {
  const code = c.req.param('code').trim().toUpperCase();
  const referral = await findPublicReferralProfile(c.env, getDb(c.env), code);
  if (!referral) {
    await limit(c.env.PROFILE_MISS_LIMITER, ipKey(c, 'profile-miss'));
    throw notFound('Referral code not found');
  }
  c.header('Cache-Control', 'public, max-age=60');
  return c.json(referral);
});

// ---------------------------------------------------------------------------
// Partner endpoints (docs/referrals.md "API"): bearer REFERRAL_PARTNER_SECRET, timingSafeEqual, 401
// otherwise (never open with no secret configured). Rate limited the same way as the other
// unauthenticated, on-someone-else's-behalf POST route (routes/email.ts's REPORT_LIMITER reuse) -
// docs/referrals.md asks for a dedicated 20/min bucket, but the task deliberately provisions only one
// new limiter (REFERRAL_ATTRIBUTE_LIMITER); see the PR notes.
// ---------------------------------------------------------------------------

function partnerAuthorized(c: Context<AppEnv>): boolean {
  const secret = c.env.REFERRAL_PARTNER_SECRET;
  if (!secret) return false;
  const header = c.req.header('authorization') ?? '';
  const provided = header.startsWith('Bearer ') ? header.slice(7) : '';
  return !!provided && timingSafeEqual(provided, secret);
}

const redeemSchema = z.object({ token: z.string().min(1).max(512) });

referralsRoutes.get('/referral/claims/verify', async (c) => {
  await limit(c.env.REPORT_LIMITER, ipKey(c, 'referral-partner'));
  if (!partnerAuthorized(c)) throw new ApiError(401, 'unauthorized', 'Invalid partner credentials');
  const token = c.req.query('token') ?? '';
  const body: VerifyClaimResponse = await verifyReferralClaim(getDb(c.env), token);
  return c.json(body);
});

referralsRoutes.post('/referral/claims/redeem', async (c) => {
  await limit(c.env.REPORT_LIMITER, ipKey(c, 'referral-partner'));
  if (!partnerAuthorized(c)) throw new ApiError(401, 'unauthorized', 'Invalid partner credentials');
  const { token } = await parseJson(c, redeemSchema);
  const body: RedeemClaimResponse = await redeemReferralClaim(getDb(c.env), token);
  return c.json(body);
});

/** GET /_pages/referral/:code's core logic (mirrors GET /_pages/profile/:slug), used by routes/pages.ts. */
export async function referralPageLookup(env: Env, db: DB, code: string): Promise<ReferralPageResult> {
  const referral = await findPublicReferralProfile(env, db, code.trim().toUpperCase());
  return referral ? { status: 'ok', referral } : { status: 'not_found' };
}
