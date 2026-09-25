import {
  BADGES,
  REFERRAL_CODE_ALPHABET,
  REFERRAL_CODE_LENGTH,
  referralLink,
  SOCIAL_VALIDATION_PROVIDERS,
  type Badge,
  type ClaimReferralResponse,
  type GetReferralResponse,
  type MilestoneBadge,
  type PublicReferralProfile,
  type ReferralAttribution,
  type ReferralChecklist,
  type ReferralClaimInfo,
  type ReferralListItem,
  type ReferralStatus,
  type RedeemClaimResponse,
  type SendInvitesResponse,
  type VerifyClaimResponse,
} from '@chatsoon/shared';
import { and, desc, eq, inArray, isNotNull, isNull, lte, notExists, or, sql } from 'drizzle-orm';

import {
  accountDeletions,
  accounts,
  badges as badgesTable,
  emailPrefs,
  pointsLedger,
  profiles,
  referralClaims,
  referralInvites,
  referrals,
  socialChecks,
  users,
  type ReferralRow,
} from '../db/schema';
import type { Env } from '../env';
import { isBannedEmail } from './auth';
import { isDiscordEligible, isXEligible } from './connected-accounts';
import type { DB } from './db';
import { referralInviteEmail, referralClaimReadyEmail, referralMilestoneEmail, referralQualifiedEmail, sendEmail } from './email';
import { ApiError, badRequest, forbidden, notFound } from './errors';
import { newId } from './ids';
import { cardsEnabled, currentOgVersion, hashKey16 } from './og';
import { findProfileByUserId, findVisibleProfileByUserId } from './profiles';
import {
  referralAttributionDays,
  referralClaimThreshold,
  referralClaimUrl,
  referralDiscordMinAgeDays,
  referralEnabled,
  referralFounderCap,
  referralFounderThreshold,
  referralHoldDays,
  referralInviteDailyPerUser,
  referralMaxPendingDays,
  referralPointsForJoining,
  referralPointsPerReferral,
  referralXMinFollowers,
} from './referral-config';
import { hmacHex } from './signing';
import { signedFileUrl } from './signing';
import { bumpBy, today } from './usage';
import { listUnsubscribeHeaders, unsubscribeToken, unsubscribeUrl } from './unsubscribe';

// Referrals (issue #11, PR 2, docs/referrals.md). Everything but the HTTP wiring (routes/referrals.ts,
// the extra GET /_pages/referral/:code route in routes/pages.ts) and the cron hookup (index.ts) lives
// here: the referral code, attribution, the qualification sweep, badges, the points ledger, invites,
// claims and the two partner endpoints' logic.

const DAY_MS = 24 * 60 * 60 * 1000;

// ---------------------------------------------------------------------------
// Small local helpers kept free of lib/sequences.ts and lib/profiles.ts's own exports, to avoid a
// module cycle (lib/sequences.ts imports `suppressInviteEmail` from this file).
// ---------------------------------------------------------------------------

/** NOT EXISTS a pending scheduled deletion, same rule as lib/profiles.ts's own `notPendingDeletion`
 * (kept local here rather than exported from there, since it's queried against `profiles` directly). */
const notPendingDeletion = (db: DB) =>
  notExists(db.select({ one: sql`1` }).from(accountDeletions).where(eq(accountDeletions.userId, profiles.userId)));

async function hasPendingDeletion(db: DB, userId: string): Promise<boolean> {
  const [row] = await db.select({ one: sql`1` }).from(accountDeletions).where(eq(accountDeletions.userId, userId)).limit(1);
  return !!row;
}

/** Same check as lib/sequences.ts's `tipsEmailsEnabled`, duplicated (it's three lines) rather than
 * imported, since that module imports this one (`suppressInviteEmail`) and a cycle either way is
 * fragile even where it happens to work. */
async function isTipsEmailEnabled(db: DB, userId: string): Promise<boolean> {
  const [row] = await db.select({ optOutAt: emailPrefs.tipsOptOutAt }).from(emailPrefs).where(eq(emailPrefs.userId, userId)).limit(1);
  return !row?.optOutAt;
}

function toWireStatus(status: string): ReferralStatus {
  if (status === 'qualified') return 'qualified';
  if (status === 'void') return 'didnt_qualify';
  return 'pending'; // 'pending' | 'rejected' | 'flagged': never leak the fraud signal to the referrer.
}

async function countQualified(db: DB, referrerId: string): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`count(*)` })
    .from(referrals)
    .where(and(eq(referrals.referrerId, referrerId), eq(referrals.status, 'qualified')));
  return row?.n ?? 0;
}

async function countFounders(db: DB): Promise<number> {
  const [row] = await db.select({ n: sql<number>`count(*)` }).from(badgesTable).where(eq(badgesTable.badge, 'founder'));
  return row?.n ?? 0;
}

function buildProgressLine(qualifiedCount: number, founderSpotsLeft: number, founderThreshold: number, claimThreshold: number): string {
  if (qualifiedCount < founderThreshold) {
    const label = founderSpotsLeft > 0 ? 'Founding member' : 'Early adopter';
    return `${qualifiedCount} of ${founderThreshold} to ${label}`;
  }
  return `${qualifiedCount} of ${claimThreshold} to your reward`;
}

// ---------------------------------------------------------------------------
// hasEligibleSocial (docs/referrals.md "Qualification and fraud rules"). Built on top of PR 1's
// lib/connected-accounts.ts rather than re-implementing the eligibility rules: google/apple/linkedin
// count as soon as they're linked; discord/twitter reuse the exact same `isDiscordEligible`/
// `isXEligible` helpers GET /me/connected-accounts calls.
// ---------------------------------------------------------------------------

export async function hasEligibleSocial(db: DB, env: Env, userId: string): Promise<boolean> {
  const linked = await db
    .select({ provider: accounts.providerId })
    .from(accounts)
    .where(and(eq(accounts.userId, userId), inArray(accounts.providerId, SOCIAL_VALIDATION_PROVIDERS)));
  if (linked.length === 0) return false;
  if (linked.some((r) => r.provider === 'google' || r.provider === 'apple' || r.provider === 'linkedin')) return true;

  const hasDiscord = linked.some((r) => r.provider === 'discord');
  const hasTwitter = linked.some((r) => r.provider === 'twitter');
  if (!hasDiscord && !hasTwitter) return false;

  const checks = await db.select().from(socialChecks).where(eq(socialChecks.userId, userId));
  if (hasDiscord && isDiscordEligible(checks.find((c) => c.provider === 'discord'), referralDiscordMinAgeDays(env))) return true;
  if (hasTwitter && isXEligible(checks.find((c) => c.provider === 'twitter'), referralXMinFollowers(env))) return true;
  return false;
}

// ---------------------------------------------------------------------------
// Referral code (docs/referrals.md "Specifics and decisions"). Lives on `profiles`, so it needs a
// profile row to exist - lazily created the first time GET /me/referral (or an invite send, which
// needs its own code to build the link) is called after onboarding.
// ---------------------------------------------------------------------------

function generateReferralCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(REFERRAL_CODE_LENGTH));
  let code = '';
  for (const b of bytes) code += REFERRAL_CODE_ALPHABET[b % REFERRAL_CODE_ALPHABET.length];
  return code;
}

const CODE_ATTEMPTS = 5;

/** Creates `profiles.referral_code` on first use, retrying on a collision (the unique index is the backstop). */
export async function getOrCreateReferralCode(db: DB, userId: string): Promise<string> {
  const [existing] = await db.select({ referralCode: profiles.referralCode }).from(profiles).where(eq(profiles.userId, userId)).limit(1);
  // The doc puts the code on `profiles`; PR 2 requires a profile to exist before the referrals hub
  // (GET /me/referral, invites, claims) can do anything at all, since there's nowhere else to store it.
  if (!existing) throw badRequest('Create your profile before using referrals');
  if (existing.referralCode) return existing.referralCode;

  for (let attempt = 0; attempt < CODE_ATTEMPTS; attempt++) {
    const code = generateReferralCode();
    try {
      const [row] = await db
        .update(profiles)
        .set({ referralCode: code })
        .where(eq(profiles.userId, userId))
        .returning({ referralCode: profiles.referralCode });
      if (row?.referralCode) return row.referralCode;
    } catch {
      continue; // Collided with another user's code (unique index) - try another.
    }
  }
  throw new ApiError(500, 'internal', 'Could not create your referral code. Please try again.');
}

/** The code's owner, or null for an unknown code or one whose owner has a pending account deletion. */
async function findReferralOwner(db: DB, code: string): Promise<{ userId: string; email: string } | null> {
  const [row] = await db
    .select({ userId: profiles.userId, email: users.email })
    .from(profiles)
    .innerJoin(users, eq(users.id, profiles.userId))
    .where(and(eq(profiles.referralCode, code), notPendingDeletion(db)))
    .limit(1);
  return row ?? null;
}

/** GET /referral/:code and GET /_pages/referral/:code (docs/referrals.md "API"). `code` must already
 * be trimmed/uppercased by the caller. */
export async function findPublicReferralProfile(env: Env, db: DB, code: string): Promise<PublicReferralProfile | null> {
  const [row] = await db
    .select({
      slug: profiles.slug,
      displayName: profiles.displayName,
      headline: profiles.headline,
      role: profiles.role,
      company: profiles.company,
      avatarKey: profiles.avatarKey,
    })
    .from(profiles)
    .where(and(eq(profiles.referralCode, code), notPendingDeletion(db)))
    .limit(1);
  if (!row) return null;
  return {
    displayName: row.displayName,
    slug: row.slug,
    // avatarVersion/ogVersion, not a signed avatarUrl (PR 3): mirrors toPageProfile's PageProfile
    // fields exactly, so the web landing page builds `/id/<slug>/photo?v=` and `/id/<slug>/og.jpg?v=`
    // itself instead of being handed a signed, time-limited R2 URL for a page anyone can request by
    // guessing a code.
    avatarVersion: row.avatarKey ? await hashKey16(row.avatarKey) : null,
    headline: row.headline,
    ogVersion: cardsEnabled(env) ? await currentOgVersion(row) : null,
  };
}

// ---------------------------------------------------------------------------
// Attribution: POST /me/referral/attribute (docs/referrals.md "How attribution works")
// ---------------------------------------------------------------------------

export interface AttributionContext {
  ip: string | null;
  userAgent: string | null;
  /** From X-Chatsoon-Device, already length-checked by the caller. Null if absent/invalid. */
  deviceId: string | null;
}

export async function attributeReferral(
  env: Env,
  db: DB,
  caller: { id: string; email: string; createdAt: Date },
  input: { code: string; source?: string },
  ctx: AttributionContext,
): Promise<{ attributed: true }> {
  if (!referralEnabled(env)) throw new ApiError(403, 'referral_disabled', 'Referrals are turned off right now');

  const [existing] = await db.select({ id: referrals.id }).from(referrals).where(eq(referrals.referredUserId, caller.id)).limit(1);
  if (existing) throw new ApiError(409, 'referral_already_attributed', 'You already used a referral code');

  const windowMs = referralAttributionDays(env) * DAY_MS;
  if (Date.now() - caller.createdAt.getTime() > windowMs) {
    throw new ApiError(400, 'referral_window_closed', 'Referral codes can only be entered within the first two weeks of an account');
  }

  const owner = await findReferralOwner(db, input.code);
  if (!owner) throw notFound('Referral code not found');
  if (owner.userId === caller.id) throw new ApiError(400, 'referral_self', "You can't use your own referral code");
  if (isBannedEmail(env, owner.email)) throw notFound('Referral code not found');

  const deviceId = ctx.deviceId;
  let status: 'pending' | 'rejected' = 'pending';
  let reason: string | null = null;
  if (deviceId) {
    const [dup] = await db.select({ id: referrals.id }).from(referrals).where(eq(referrals.deviceId, deviceId)).limit(1);
    if (dup) {
      status = 'rejected';
      reason = 'device_dup';
    }
  }

  const ipHash = env.REFERRAL_HASH_SECRET && ctx.ip ? await hmacHex(env.REFERRAL_HASH_SECRET, ctx.ip) : null;
  const uaHash = env.REFERRAL_HASH_SECRET && ctx.userAgent ? await hmacHex(env.REFERRAL_HASH_SECRET, ctx.userAgent) : null;

  const id = newId();
  const now = Date.now();
  const qualifiesAfter = status === 'pending' ? new Date(now + referralHoldDays(env) * DAY_MS) : null;

  await db.insert(referrals).values({
    id,
    referrerId: owner.userId,
    referredUserId: caller.id,
    status,
    reason,
    source: input.source ?? 'typed',
    deviceId,
    ipHash,
    uaHash,
    qualifiesAfter,
  });

  // Any accepted attribution (pending or rejected/device_dup) credits the referred person one point,
  // never reversed (docs/referrals.md "How attribution works"). onConflictDoNothing is belt and
  // braces: `id` is a fresh uuid, so this can only ever conflict on the (event, ref_id) unique index,
  // which a brand new referral id can never already hold.
  await db
    .insert(pointsLedger)
    .values({ id: newId(), userId: caller.id, amount: referralPointsForJoining(env), event: 'referral_joined', refId: id })
    .onConflictDoNothing();

  return { attributed: true };
}

// ---------------------------------------------------------------------------
// Qualification sweep (docs/referrals.md "Qualification and fraud rules"): runReferralQualification,
// called from index.ts's `scheduled` after runEmailSequences, in its own waitUntil/catch.
// ---------------------------------------------------------------------------

const SWEEP_BATCH_LIMIT = 200;

/**
 * Awards the permanent milestone badge, atomically (docs/referrals.md "Qualification and fraud
 * rules"): the founder insert is one statement gated by `COUNT(*) < cap`, with the unique index on
 * (badge, seq) as the backstop against a genuine race between two isolates. If that insert wrote
 * nothing (cap reached) or the unique index rejected it (the race), falls through to `early_adopter`
 * with `seq` null. Skips (returns null) if the user already has either badge.
 */
export async function awardMilestoneBadge(db: DB, env: Env, userId: string, referralId: string): Promise<{ badge: Badge; seq: number | null } | null> {
  const already = await db
    .select({ badge: badgesTable.badge })
    .from(badgesTable)
    .where(and(eq(badgesTable.userId, userId), inArray(badgesTable.badge, BADGES)))
    .limit(1);
  if (already.length > 0) return null;

  const cap = referralFounderCap(env);
  const now = Date.now();
  try {
    const row = await env.DB.prepare(
      `INSERT INTO badges (user_id, badge, seq, ref_id, awarded_at)
       SELECT ?1, 'founder', (SELECT COUNT(*) + 1 FROM badges WHERE badge = 'founder'), ?2, ?3
       WHERE (SELECT COUNT(*) FROM badges WHERE badge = 'founder') < ?4
       RETURNING seq`,
    )
      .bind(userId, referralId, now, cap)
      .first<{ seq: number }>();
    if (row) return { badge: 'founder', seq: row.seq };
  } catch {
    // Unique violation on badges_badge_seq_idx: two isolates raced for the same seq. Same outcome as
    // the WHERE clause missing above - fall through to early_adopter.
  }

  await db
    .insert(badgesTable)
    .values({ userId, badge: 'early_adopter', seq: null, refId: referralId, awardedAt: new Date(now) })
    .onConflictDoNothing();
  return { badge: 'early_adopter', seq: null };
}

async function processReferralRow(env: Env, db: DB, row: ReferralRow, now: number): Promise<void> {
  const maxPendingMs = referralMaxPendingDays(env) * DAY_MS;

  if (row.status === 'rejected') {
    if (now - row.createdAt.getTime() > maxPendingMs) {
      await db.update(referrals).set({ status: 'void' }).where(eq(referrals.id, row.id));
    }
    return;
  }

  // row.status === 'pending' here (the sweep's own WHERE clause guarantees it).
  const [referred] = await db
    .select({ id: users.id, email: users.email, emailVerified: users.emailVerified })
    .from(users)
    .where(eq(users.id, row.referredUserId))
    .limit(1);

  if (!referred || (await hasPendingDeletion(db, referred.id)) || isBannedEmail(env, referred.email)) {
    await db.update(referrals).set({ status: 'void', reason: 'account_gone' }).where(eq(referrals.id, row.id));
    return;
  }

  // Set once an account with this email is attributed to this referrer (docs/referrals.md
  // referral_invites.convertedAt). Idempotent: only ever flips a still-null column.
  await db
    .update(referralInvites)
    .set({ convertedAt: new Date(now) })
    .where(
      and(
        eq(referralInvites.referrerId, row.referrerId),
        eq(referralInvites.email, referred.email.toLowerCase()),
        isNull(referralInvites.convertedAt),
      ),
    );

  const profile = await findProfileByUserId(db, referred.id);
  const social = await hasEligibleSocial(db, env, referred.id);

  if (!referred.emailVerified || !profile || !social) {
    if (now - row.createdAt.getTime() > maxPendingMs) {
      await db.update(referrals).set({ status: 'void', reason: 'never_qualified' }).where(eq(referrals.id, row.id));
    } else {
      await db.update(referrals).set({ qualifiesAfter: new Date(now + DAY_MS) }).where(eq(referrals.id, row.id));
    }
    return;
  }

  await db.update(referrals).set({ status: 'qualified', qualifiedAt: new Date(now) }).where(eq(referrals.id, row.id));

  const insertedPoints = await db
    .insert(pointsLedger)
    .values({ id: newId(), userId: row.referrerId, amount: referralPointsPerReferral(env), event: 'referral_qualified', refId: row.id })
    .onConflictDoNothing()
    .returning({ id: pointsLedger.id });
  // Someone else's concurrent sweep run already credited (and emailed) this exact referral.
  if (insertedPoints.length === 0) return;

  const qualifiedCount = await countQualified(db, row.referrerId);
  const founderThreshold = referralFounderThreshold(env);
  const claimThreshold = referralClaimThreshold(env);
  const [referrer] = await db.select({ email: users.email }).from(users).where(eq(users.id, row.referrerId)).limit(1);
  if (!referrer) return; // The referrer's own account is somehow gone; nothing left to email.

  if (qualifiedCount === founderThreshold) {
    const award = await awardMilestoneBadge(db, env, row.referrerId, row.id);
    if (award) {
      const msg = referralMilestoneEmail(award.badge, award.seq, new Date(now));
      await sendEmail(env, { to: referrer.email, subject: msg.subject, text: msg.text, html: msg.html });
    }
    return;
  }

  if (qualifiedCount === claimThreshold) {
    const msg = referralClaimReadyEmail();
    await sendEmail(env, { to: referrer.email, subject: msg.subject, text: msg.text, html: msg.html });
    return;
  }

  if (await isTipsEmailEnabled(db, row.referrerId)) {
    const founderSpotsLeft = Math.max(referralFounderCap(env) - (await countFounders(db)), 0);
    const line = buildProgressLine(qualifiedCount, founderSpotsLeft, founderThreshold, claimThreshold);
    const token = await unsubscribeToken(env, 'user', row.referrerId);
    const unsubUrl = unsubscribeUrl(env, token);
    const msg = referralQualifiedEmail(profile.displayName, line, unsubUrl);
    await sendEmail(env, { to: referrer.email, subject: msg.subject, text: msg.text, html: msg.html, headers: listUnsubscribeHeaders(unsubUrl) });
  }
}

export interface QualificationRunResult {
  processed: number;
  failed: number;
}

/**
 * The scheduled job (index.ts's `scheduled`, its own waitUntil/catch after runEmailSequences). Up to
 * 200 rows per run where status is 'pending' (due) or 'rejected' (docs/referrals.md "Qualification
 * and fraud rules"). `flagged` rows are never selected - they only qualify again once ops clears
 * `flag_cleared_at` and sets the status back to 'pending' by hand.
 */
export async function runReferralQualification(env: Env, db: DB, now = Date.now()): Promise<QualificationRunResult> {
  const due = await db
    .select()
    .from(referrals)
    .where(or(and(eq(referrals.status, 'pending'), lte(referrals.qualifiesAfter, new Date(now))), eq(referrals.status, 'rejected')))
    .limit(SWEEP_BATCH_LIMIT);

  let processed = 0;
  let failed = 0;
  for (const row of due) {
    try {
      await processReferralRow(env, db, row, now);
      processed++;
    } catch (err) {
      failed++;
      console.error(`runReferralQualification: referral ${row.id} failed`, err);
    }
  }
  return { processed, failed };
}

// ---------------------------------------------------------------------------
// Invite retention/suppression (docs/referrals.md "Compliance"): held up to 12 months, or until
// unsubscribed or converted. An unsubscribed row is kept forever - see sweepReferralInvites below.
// ---------------------------------------------------------------------------

/** POST /email/unsubscribe, kind 'invite' (lib/sequences.ts's unsubscribeByToken). Suppresses every
 * future invite to this address from anyone, permanently: the row itself is never swept away once
 * this is set (see sweepReferralInvites), since it's the only durable record of the suppression. */
export async function suppressInviteEmail(db: DB, email: string, now = Date.now()): Promise<void> {
  const normalized = email.toLowerCase();
  await db
    .update(referralInvites)
    .set({ unsubscribedAt: new Date(now) })
    .where(and(eq(referralInvites.email, normalized), isNull(referralInvites.unsubscribedAt)));
}

const INVITE_RETENTION_MS = 365 * DAY_MS; // ~12 months (docs/referrals.md "Compliance")

/**
 * The cron cleanup (index.ts's `scheduled`, its own waitUntil/catch): deletes an un-actioned invite
 * once it's 12 months old, and a converted one on the next run after conversion (no reason to keep
 * it once the person has joined). Deliberately never deletes an unsubscribed row - the doc says to
 * delete unsubscribed invites too, but that would also destroy the only record that the address must
 * never be invited again by anyone else; keeping that tiny row (an email address and two timestamps,
 * no invite content) is the "minimal suppression record" the task calls for, chosen over a second
 * table since the existing row already carries exactly what's needed and nothing more. See the PR
 * notes for the full rationale.
 */
export async function sweepReferralInvites(db: DB, now = Date.now()): Promise<{ deleted: number }> {
  const cutoff = new Date(now - INVITE_RETENTION_MS);
  const stale = await db
    .delete(referralInvites)
    .where(and(isNull(referralInvites.unsubscribedAt), isNull(referralInvites.convertedAt), lte(referralInvites.sentAt, cutoff)))
    .returning({ id: referralInvites.id });
  const converted = await db.delete(referralInvites).where(isNotNull(referralInvites.convertedAt)).returning({ id: referralInvites.id });
  return { deleted: stale.length + converted.length };
}

// ---------------------------------------------------------------------------
// Invites: POST /me/referral/invites (docs/referrals.md "API")
// ---------------------------------------------------------------------------

export interface InviteSendCtx {
  waitUntil(promise: Promise<unknown>): void;
}

export async function sendReferralInvites(env: Env, db: DB, ctx: InviteSendCtx, referrerId: string, rawEmails: string[]): Promise<SendInvitesResponse> {
  if (!referralEnabled(env)) throw new ApiError(403, 'referral_disabled', 'Referrals are turned off right now');

  const code = await getOrCreateReferralCode(db, referrerId);
  const [inviter] = await db
    .select({ displayName: profiles.displayName, headline: profiles.headline, company: profiles.company })
    .from(profiles)
    .where(eq(profiles.userId, referrerId))
    .limit(1);
  if (!inviter) throw badRequest('Create your profile before using referrals');

  const now = Date.now();
  const cutoff90 = new Date(now - 90 * DAY_MS);
  const toSend: string[] = [];
  let skipped = 0;

  for (const raw of rawEmails) {
    const email = raw.trim().toLowerCase();
    const rows = await db
      .select({ referrerId: referralInvites.referrerId, unsubscribedAt: referralInvites.unsubscribedAt, sentAt: referralInvites.sentAt })
      .from(referralInvites)
      .where(eq(referralInvites.email, email));
    if (rows.some((r) => r.unsubscribedAt)) {
      skipped++;
      continue;
    }
    // Also catches an in-array duplicate: its first occurrence's row (inserted below) already shows
    // up here for the second occurrence, since each address is fully processed before the next.
    if (rows.some((r) => r.referrerId === referrerId)) {
      skipped++;
      continue;
    }
    const [existingUser] = await db.select({ id: users.id }).from(users).where(sql`lower(${users.email}) = ${email}`).limit(1);
    if (existingUser) {
      skipped++;
      continue;
    }
    if (rows.filter((r) => r.sentAt.getTime() >= cutoff90.getTime()).length >= 3) {
      skipped++;
      continue;
    }
    await db.insert(referralInvites).values({ id: newId(), referrerId, email, sentAt: new Date(now) }).onConflictDoNothing();
    toSend.push(email);
  }

  if (toSend.length === 0) return { sent: 0, skipped };

  const day = today();
  const newCount = await bumpBy(env, `refinvite:user:${referrerId}:${day}`, day, toSend.length);
  if (newCount > referralInviteDailyPerUser(env)) {
    // Refuse the whole batch, and undo the rows just inserted so a refused send doesn't occupy the
    // (referrer, email) unique slot or show up in the referrer's invite history as having gone out.
    await db.delete(referralInvites).where(and(eq(referralInvites.referrerId, referrerId), inArray(referralInvites.email, toSend)));
    throw new ApiError(429, 'referral_invite_limit', "You've reached today's invite limit");
  }

  const link = referralLink(code);
  for (const email of toSend) {
    const token = await unsubscribeToken(env, 'invite', email);
    const unsubUrl = unsubscribeUrl(env, token);
    const msg = referralInviteEmail({
      inviterName: inviter.displayName,
      inviterHeadline: inviter.headline,
      inviterCompany: inviter.company,
      link,
      unsubscribeUrl: unsubUrl,
    });
    ctx.waitUntil(
      sendEmail(env, { to: email, subject: msg.subject, text: msg.text, html: msg.html, headers: listUnsubscribeHeaders(unsubUrl) }).catch((err) =>
        console.error(`Referral invite email to ${email} failed`, err),
      ),
    );
  }

  return { sent: toSend.length, skipped };
}

// ---------------------------------------------------------------------------
// Claims: POST /me/referral/claims, plus the two partner endpoints
// ---------------------------------------------------------------------------

const CLAIM_TOKEN_TTL_MS = 30 * DAY_MS;

/**
 * Claim tokens are derived, not random: HMAC-SHA256(FILE_SIGNING_SECRET, "referral-claim:<claim id>:
 * <expiry ms>"), hex. Only its SHA-256 is stored (referral_claims.token_hash, per docs/referrals.md), yet
 * any isolate can recompute the live token from the row, so a repeat POST (referral_claim_open) and
 * GET /me/referral hand back the exact same working link instead of rotating it out from under a
 * partner page that's mid-flow. Rotating (new expiry) yields a new token and invalidates the old one.
 */
async function claimToken(env: Env, claimId: string, expiresAtMs: number): Promise<{ token: string; hash: string }> {
  const token = await hmacHex(env.FILE_SIGNING_SECRET, `referral-claim:${claimId}:${expiresAtMs}`);
  return { token, hash: await sha256Hex(token) };
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

/** The live claim URL for a stored row, or null if its token has expired or doesn't match the derivation. */
async function liveClaimUrl(env: Env, row: { id: string; tokenHash: string; tokenExpiresAt: Date }): Promise<string | null> {
  if (row.tokenExpiresAt.getTime() <= Date.now()) return null;
  const { token, hash } = await claimToken(env, row.id, row.tokenExpiresAt.getTime());
  return hash === row.tokenHash ? buildClaimUrl(env, token) : null;
}

function buildClaimUrl(env: Env, token: string): string {
  return `${referralClaimUrl(env) ?? ''}?token=${encodeURIComponent(token)}`;
}

export async function claimReferral(
  env: Env,
  db: DB,
  userId: string,
  userEmail: string,
  input: { shareConsent: true; consentText: string },
): Promise<ClaimReferralResponse> {
  if (!referralEnabled(env)) throw new ApiError(403, 'referral_disabled', 'Referrals are turned off right now');
  if (isBannedEmail(env, userEmail)) throw forbidden("This account can't claim a reward");
  if (await hasPendingDeletion(db, userId)) throw forbidden("This account can't claim a reward");

  const claimThreshold = referralClaimThreshold(env);
  const qualifiedCount = await countQualified(db, userId);
  if (qualifiedCount < claimThreshold) throw forbidden(`You need ${claimThreshold} qualified referrals to claim your reward`);
  if (!(await hasEligibleSocial(db, env, userId))) {
    throw new ApiError(403, 'referral_claim_needs_social', 'Connect a social account to claim your reward');
  }

  const now = Date.now();
  const [existing] = await db
    .select()
    .from(referralClaims)
    .where(and(eq(referralClaims.userId, userId), eq(referralClaims.milestone, claimThreshold)))
    .limit(1);

  if (existing) {
    if (existing.status === 'redeemed') throw new ApiError(409, 'referral_already_claimed', 'You already claimed this reward');
    const live = await liveClaimUrl(env, existing);
    if (live) throw new ApiError(409, 'referral_claim_open', 'Your reward claim is already open', { url: live });
    // Expired: rotate to a fresh expiry, which derives a new token and invalidates the old one.
    const expiresAt = new Date(now + CLAIM_TOKEN_TTL_MS);
    const { token, hash } = await claimToken(env, existing.id, expiresAt.getTime());
    await db.update(referralClaims).set({ tokenHash: hash, tokenExpiresAt: expiresAt }).where(eq(referralClaims.id, existing.id));
    return { url: buildClaimUrl(env, token), expiresAt: expiresAt.toISOString() };
  }

  const expiresAt = new Date(now + CLAIM_TOKEN_TTL_MS);
  const id = newId();
  const { token, hash } = await claimToken(env, id, expiresAt.getTime());
  await db.insert(referralClaims).values({
    id,
    userId,
    milestone: claimThreshold,
    tokenHash: hash,
    tokenExpiresAt: expiresAt,
    destination: referralClaimUrl(env) ?? '',
    shareConsentAt: new Date(now),
    shareConsentText: input.consentText,
    status: 'issued',
  });
  return { url: buildClaimUrl(env, token), expiresAt: expiresAt.toISOString() };
}

/** GET /referral/claims/verify (partner, bearer REFERRAL_PARTNER_SECRET). */
export async function verifyReferralClaim(db: DB, token: string): Promise<VerifyClaimResponse> {
  const hash = await sha256Hex(token);
  const [row] = await db.select().from(referralClaims).where(eq(referralClaims.tokenHash, hash)).limit(1);
  if (!row) return { valid: false, reason: 'unknown' };
  if (row.status === 'redeemed') return { valid: false, reason: 'redeemed' };
  if (row.tokenExpiresAt.getTime() <= Date.now()) return { valid: false, reason: 'expired' };

  const [user] = await db.select({ email: users.email }).from(users).where(eq(users.id, row.userId)).limit(1);
  const profile = await findVisibleProfileByUserId(db, row.userId);
  return {
    valid: true,
    milestone: row.milestone,
    status: row.status as 'issued' | 'redeemed',
    issuedAt: row.createdAt.toISOString(),
    expiresAt: row.tokenExpiresAt.toISOString(),
    // `email` is included only because the user ticked the consent box to claim at all.
    user: { id: row.userId, displayName: profile?.displayName ?? user?.email ?? '', email: user?.email ?? '' },
  };
}

/** POST /referral/claims/redeem (partner). Idempotent. */
export async function redeemReferralClaim(db: DB, token: string): Promise<RedeemClaimResponse> {
  const hash = await sha256Hex(token);
  const [row] = await db.select().from(referralClaims).where(eq(referralClaims.tokenHash, hash)).limit(1);
  if (!row) throw notFound('Unknown claim token');
  if (row.status === 'redeemed') return { ok: true, redeemedAt: row.redeemedAt!.toISOString() };
  if (row.tokenExpiresAt.getTime() <= Date.now()) throw new ApiError(400, 'referral_claim_expired', 'This claim link has expired');

  const redeemedAt = new Date();
  await db.update(referralClaims).set({ status: 'redeemed', redeemedAt }).where(eq(referralClaims.id, row.id));
  return { ok: true, redeemedAt: redeemedAt.toISOString() };
}

// ---------------------------------------------------------------------------
// GET /me/referral (docs/referrals.md "API")
// ---------------------------------------------------------------------------

async function getAttribution(env: Env, db: DB, userId: string): Promise<ReferralAttribution | null> {
  const [row] = await db.select().from(referrals).where(eq(referrals.referredUserId, userId)).limit(1);
  if (!row) return null;

  const wireStatus = toWireStatus(row.status);
  // Hidden once the caller's own referral is qualified or void (docs/referrals.md "What the user sees").
  if (wireStatus === 'qualified' || wireStatus === 'didnt_qualify') return null;

  const referrerProfile = await findVisibleProfileByUserId(db, row.referrerId);
  if (!referrerProfile) return null; // The referrer's own account/profile is gone or pending deletion.

  const myProfile = await findProfileByUserId(db, userId);
  const social = await hasEligibleSocial(db, env, userId);
  const checklist: ReferralChecklist = { profile: !!myProfile, social };
  if (row.qualifiesAfter) checklist.holdUntil = row.qualifiesAfter.toISOString();

  return { referrerName: referrerProfile.displayName, referrerSlug: referrerProfile.slug, status: wireStatus, checklist };
}

async function listMyReferrals(env: Env, db: DB, referrerId: string): Promise<ReferralListItem[]> {
  const rows = await db.select().from(referrals).where(eq(referrals.referrerId, referrerId)).orderBy(desc(referrals.createdAt));

  const items: ReferralListItem[] = [];
  for (const row of rows) {
    const wireStatus = toWireStatus(row.status);
    const item: ReferralListItem = { id: row.id, status: wireStatus, createdAt: row.createdAt.toISOString() };
    if (row.qualifiesAfter) item.qualifiesAfter = row.qualifiesAfter.toISOString();
    if (row.qualifiedAt) item.qualifiedAt = row.qualifiedAt.toISOString();

    // Blocks and deletions are honoured the same way as everywhere else (docs/referrals.md "API").
    const profile = await findVisibleProfileByUserId(db, row.referredUserId);
    if (profile) {
      item.displayName = profile.displayName;
      item.slug = profile.slug;
      if (profile.avatarKey) item.avatarUrl = await signedFileUrl(env, profile.avatarKey, 7 * 24 * 3600);
    }

    if (wireStatus === 'pending') {
      if (!profile) item.outstanding = 'profile';
      else if (!(await hasEligibleSocial(db, env, row.referredUserId))) item.outstanding = 'social';
      else item.outstanding = 'hold';
    }
    items.push(item);
  }
  return items;
}

export async function getReferralSummary(env: Env, db: DB, userId: string): Promise<GetReferralResponse> {
  const code = await getOrCreateReferralCode(db, userId);
  const founderThreshold = referralFounderThreshold(env);
  const claimThreshold = referralClaimThreshold(env);
  const founderCap = referralFounderCap(env);
  const founderSpotsLeft = Math.max(founderCap - (await countFounders(db)), 0);

  const [myBadge] = await db
    .select({ badge: badgesTable.badge, seq: badgesTable.seq, awardedAt: badgesTable.awardedAt })
    .from(badgesTable)
    .where(eq(badgesTable.userId, userId))
    .limit(1);
  const milestoneBadge: MilestoneBadge | null = myBadge
    ? { badge: myBadge.badge as Badge, ...(myBadge.seq != null ? { seq: myBadge.seq } : {}), awardedAt: myBadge.awardedAt.toISOString() }
    : null;

  const qualifiedCount = await countQualified(db, userId);
  const [pendingRow] = await db
    .select({ n: sql<number>`count(*)` })
    .from(referrals)
    .where(and(eq(referrals.referrerId, userId), inArray(referrals.status, ['pending', 'rejected', 'flagged'])));
  const pendingCount = pendingRow?.n ?? 0;

  const [balanceRow] = await db.select({ total: sql<number>`coalesce(sum(${pointsLedger.amount}), 0)` }).from(pointsLedger).where(eq(pointsLedger.userId, userId));
  const pointsBalance = balanceRow?.total ?? 0;

  const hasSocial = await hasEligibleSocial(db, env, userId);
  const canClaim = qualifiedCount >= claimThreshold && hasSocial;

  const [claimRow] = await db
    .select()
    .from(referralClaims)
    .where(and(eq(referralClaims.userId, userId), eq(referralClaims.milestone, claimThreshold)))
    .limit(1);
  // The token is derived (claimToken), so a live, unredeemed claim's link can be handed back here too.
  const claimUrl = claimRow && claimRow.status === 'issued' ? await liveClaimUrl(env, claimRow) : null;
  const claim: ReferralClaimInfo | null = claimRow
    ? {
        status: claimRow.status as 'issued' | 'redeemed',
        milestone: claimRow.milestone,
        expiresAt: claimRow.tokenExpiresAt.toISOString(),
        claimedAt: claimRow.createdAt.toISOString(),
        ...(claimUrl ? { url: claimUrl } : {}),
      }
    : null;

  const attribution = await getAttribution(env, db, userId);

  const [userRow] = await db.select({ createdAt: users.createdAt }).from(users).where(eq(users.id, userId)).limit(1);
  const [existingReferral] = await db.select({ id: referrals.id }).from(referrals).where(eq(referrals.referredUserId, userId)).limit(1);
  const withinWindow = !!userRow && Date.now() - userRow.createdAt.getTime() <= referralAttributionDays(env) * DAY_MS;
  const canEnterCode = !existingReferral && withinWindow;

  const referralsList = await listMyReferrals(env, db, userId);

  return {
    enabled: referralEnabled(env),
    code,
    link: referralLink(code),
    founderThreshold,
    claimThreshold,
    founderSpotsLeft,
    milestoneBadge,
    qualifiedCount,
    pendingCount,
    pointsBalance,
    hasSocial,
    canClaim,
    claim,
    attribution,
    canEnterCode,
    referrals: referralsList,
  };
}
