import {
  DISCORD_EPOCH_MS,
  REFERRAL_CODE_ALPHABET,
  WEB_ORIGIN,
  type ApiErrorBody,
  type ClaimReferralResponse,
  type GetReferralResponse,
  type Me,
  type PublicProfile,
  type ReferralPageResult,
  type RedeemClaimResponse,
  type SendInvitesResponse,
  type VerifyClaimResponse,
} from '@chatsoon/shared';
import { createExecutionContext, waitOnExecutionContext } from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import { eq, sql } from 'drizzle-orm';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { accounts, badges, pointsLedger, profiles, referralClaims, referralInvites, referrals, socialChecks, users } from '../src/db/schema';
import type { Env } from '../src/env';
import { getDb } from '../src/lib/db';
import { capturedEmails } from '../src/lib/email';
import { attributeReferral, awardMilestoneBadge, claimReferral, runReferralQualification, sweepReferralInvites } from '../src/lib/referrals';
import { unsubscribeToken } from '../src/lib/unsubscribe';
import app from '../src/index';
import { call, signIn, signUpWithProfile } from './helpers';

// Referrals (issue #11, PR 2, docs/referrals.md "Tests"). Linking, the X (twitter) provider and the
// shared social.ts boundary tests are PR 1's (test/social-auth.test.ts, packages/shared/src/social.test.ts).

const db = getDb(env);
const PARTNER_SECRET = env.REFERRAL_PARTNER_SECRET!;

/** A copy of env with some values replaced, same pattern as social-auth.test.ts/email-sequences.test.ts. */
const withEnv = (overrides: Partial<Env>): Env => ({ ...env, ...overrides });

/** Like test/helpers.ts's `call`, but against a custom env (a per-test secret/flag override that must
 * never leak into other tests via the shared ambient `env`). */
async function callWithEnv(path: string, customEnv: Env, init: RequestInit & { token?: string; json?: unknown } = {}) {
  const headers = new Headers(init.headers);
  if (init.token) headers.set('Authorization', `Bearer ${init.token}`);
  let body = init.body;
  if (init.json !== undefined) {
    headers.set('Content-Type', 'application/json');
    body = JSON.stringify(init.json);
  }
  const ctx = createExecutionContext();
  const res = await app.fetch(new Request(`http://localhost:8787${path}`, { ...init, headers, body }), customEnv, ctx);
  await waitOnExecutionContext(ctx);
  return res;
}

let seq = 0;
const fakeSeq = (prefix: string) => `${prefix}-${Date.now()}-${seq++}-${crypto.randomUUID().slice(0, 8)}`;

// ---------------------------------------------------------------------------
// Fast, DB-level fixtures. These bypass the real HTTP sign-up / OAuth flows (already exercised at
// length elsewhere) so the volume this file's sweep/founder-cap/fraud tests need stays fast: creating
// dozens of "referred users" through the full email-OTP + Better Auth round trip would make this file
// the slowest in the suite for no extra coverage, since what's under test here is lib/referrals.ts's
// own logic, not the sign-up flow.
// ---------------------------------------------------------------------------

async function insertFakeUser(overrides: { email?: string; createdAt?: Date; emailVerified?: boolean } = {}) {
  const id = fakeSeq('user');
  const email = overrides.email ?? `${id}@example.com`;
  const now = overrides.createdAt ?? new Date();
  await db.insert(users).values({ id, email, name: '', emailVerified: overrides.emailVerified ?? true, createdAt: now, updatedAt: now });
  return { id, email };
}

async function insertFakeProfile(userId: string, displayName = 'Fake Person') {
  const slug = fakeSeq('slug').toLowerCase();
  await db.insert(profiles).values({ userId, displayName, slug, links: '{}', bookingLinks: '[]', contact: '{}', contactVisibility: 'connections' });
  return slug;
}

async function linkGoogle(userId: string) {
  await db.insert(accounts).values({ id: fakeSeq('acct'), accountId: fakeSeq('google-sub'), providerId: 'google', userId });
}

async function linkLinkedin(userId: string) {
  await db.insert(accounts).values({ id: fakeSeq('acct'), accountId: fakeSeq('linkedin-sub'), providerId: 'linkedin', userId });
}

/** A Discord snowflake decoding to exactly `ageDays` old, same construction as social-auth.test.ts. */
function discordIdAged(ageDays: number): string {
  return (BigInt(Date.now() - ageDays * 86_400_000 - DISCORD_EPOCH_MS) << 22n).toString();
}

async function linkDiscordWithCheck(userId: string, opts: { mfaEnabled: boolean; ageDays: number }) {
  const discordId = discordIdAged(opts.ageDays);
  await db.insert(accounts).values({ id: fakeSeq('acct'), accountId: discordId, providerId: 'discord', userId });
  await db
    .insert(socialChecks)
    .values({ userId, provider: 'discord', providerAccountId: discordId, mfaEnabled: opts.mfaEnabled, verified: false, identityVerified: false, followersCount: 0 });
}

async function linkTwitterWithCheck(userId: string, opts: { verified: boolean; identityVerified: boolean; followersCount: number }) {
  const twitterId = fakeSeq('twitter-id');
  await db.insert(accounts).values({ id: fakeSeq('acct'), accountId: twitterId, providerId: 'twitter', userId });
  await db.insert(socialChecks).values({
    userId,
    provider: 'twitter',
    providerAccountId: twitterId,
    mfaEnabled: false,
    verified: opts.verified,
    identityVerified: opts.identityVerified,
    followersCount: opts.followersCount,
  });
}

/** A pending referral row, already past its hold (or not, if `dueInPast: false`). */
async function insertPendingReferral(referrerId: string, referredUserId: string, opts: { dueInPast?: boolean; createdAt?: Date } = {}) {
  const id = fakeSeq('referral');
  const createdAt = opts.createdAt ?? new Date();
  const qualifiesAfter = opts.dueInPast === false ? new Date(Date.now() + 999_000) : new Date(Date.now() - 1000);
  await db.insert(referrals).values({ id, referrerId, referredUserId, status: 'pending', source: 'typed', createdAt, qualifiesAfter });
  return id;
}

/** A referred user who already satisfies every qualification rule (verified, profile, eligible
 * Google), plus a due pending referral row. One call = one qualifying referral, ready for the sweep. */
async function seedQualifyingReferral(referrerId: string): Promise<{ referredUserId: string; referralId: string }> {
  const { id: referredUserId } = await insertFakeUser();
  await insertFakeProfile(referredUserId);
  await linkGoogle(referredUserId);
  const referralId = await insertPendingReferral(referrerId, referredUserId);
  return { referredUserId, referralId };
}

async function seedNQualifyingReferrals(referrerId: string, n: number) {
  for (let i = 0; i < n; i++) await seedQualifyingReferral(referrerId);
}

async function referralRow(id: string) {
  const [row] = await db.select().from(referrals).where(eq(referrals.id, id));
  return row ?? null;
}

async function badgeRow(userId: string) {
  const [row] = await db.select().from(badges).where(eq(badges.userId, userId));
  return row ?? null;
}

async function pointsFor(userId: string, event: string) {
  return db.select().from(pointsLedger).where(sql`${pointsLedger.userId} = ${userId} and ${pointsLedger.event} = ${event}`);
}

const emailsTo = (to: string) => capturedEmails().filter((m) => m.to === to);

async function me(token: string): Promise<Me> {
  const res = await call('/me', { token });
  expect(res.status).toBe(200);
  return (await res.json()) as Me;
}

async function referralSummary(token: string): Promise<GetReferralResponse> {
  const res = await call('/me/referral', { token });
  expect(res.status).toBe(200);
  return (await res.json()) as GetReferralResponse;
}

/** Signs up a real (Better Auth) user with a profile - used where the test needs a genuine referrer/code.
 * Emails are lowercased: Better Auth normalises addresses on the way in, so a mixed-case label (e.g.
 * 'cap-A') would otherwise never match test/helpers.ts's `signIn`, which looks up the captured OTP
 * email by exact `to` string. */
async function realUser(label: string) {
  const email = `${fakeSeq(label)}@example.com`.toLowerCase();
  const result = await signUpWithProfile(email, `${label} Person`);
  return { ...result, email };
}

afterEach(() => {
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// GET /me/referral: the code
// ---------------------------------------------------------------------------

describe('GET /me/referral: the referral code', () => {
  it('creates an 8 char Crockford-minus code once, and a second call returns the same one', async () => {
    const user = await realUser('code');
    const first = await referralSummary(user.token);
    expect(first.code).toHaveLength(8);
    expect(first.code).toBe(first.code.toUpperCase());
    for (const ch of first.code) expect(REFERRAL_CODE_ALPHABET).toContain(ch);
    // referralLink (packages/shared) uses the hardcoded WEB_ORIGIN constant, not env.WEB_ORIGIN - the
    // same precedent as profileUrl (constants.ts), which every existing email/CSV link already follows.
    expect(first.link).toBe(`${WEB_ORIGIN}/r/${first.code}`);

    const second = await referralSummary(user.token);
    expect(second.code).toBe(first.code);
  });

  it('requires a session', async () => {
    expect((await call('/me/referral')).status).toBe(401);
  });

  it('carries enabled: true from REFERRAL_ENABLED (test env), and false with the flag off', async () => {
    const user = await realUser('code-enabled');
    expect((await referralSummary(user.token)).enabled).toBe(true);

    const disabledEnv = withEnv({ REFERRAL_ENABLED: 'false' });
    const res = await callWithEnv('/me/referral', disabledEnv, { token: user.token });
    expect(res.status).toBe(200);
    expect(((await res.json()) as GetReferralResponse).enabled).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// POST /me/referral/attribute
// ---------------------------------------------------------------------------

describe('POST /me/referral/attribute', () => {
  const attribute = (token: string, json: Record<string, unknown>) => call('/me/referral/attribute', { method: 'POST', token, json });

  it('happy path: pending, qualifies_after ~7 days out, and one referral_joined ledger row for the referred user', async () => {
    const referrer = await realUser('attr-happy-referrer');
    const code = (await referralSummary(referrer.token)).code;
    const referred = await signIn(`${fakeSeq('attr-happy-referred')}@example.com`);

    const before = Date.now();
    const res = await attribute(referred.token, { code });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ attributed: true });

    const [row] = await db.select().from(referrals).where(eq(referrals.referredUserId, referred.userId));
    expect(row?.status).toBe('pending');
    expect(row?.referrerId).toBe(referrer.userId);
    const daysOut = (row!.qualifiesAfter!.getTime() - before) / (24 * 60 * 60 * 1000);
    expect(daysOut).toBeGreaterThan(6.9);
    expect(daysOut).toBeLessThan(7.1);

    const ledger = await pointsFor(referred.userId, 'referral_joined');
    expect(ledger).toHaveLength(1);
    expect(ledger[0]!.amount).toBe(1);
    expect(ledger[0]!.refId).toBe(row!.id);
  });

  it('self-referral, an unknown code, and a second attribution each fail and credit nothing further', async () => {
    const referrer = await realUser('attr-self-referrer');
    const code = (await referralSummary(referrer.token)).code;

    const selfRes = await attribute(referrer.token, { code });
    expect(selfRes.status).toBe(400);
    expect(((await selfRes.json()) as ApiErrorBody).error.code).toBe('referral_self');

    const stranger = await signIn(`${fakeSeq('attr-unknown')}@example.com`);
    const unknownRes = await attribute(stranger.token, { code: 'ZZZZZZZZ' });
    expect(unknownRes.status).toBe(404);

    const firstOk = await attribute(stranger.token, { code });
    expect(firstOk.status).toBe(200);
    const secondRes = await attribute(stranger.token, { code });
    expect(secondRes.status).toBe(409);
    expect(((await secondRes.json()) as ApiErrorBody).error.code).toBe('referral_already_attributed');

    // Only the one successful attribute (stranger -> referrer) credited a point; every failed
    // attempt (self, unknown, duplicate) credited nothing.
    expect(await pointsFor(stranger.userId, 'referral_joined')).toHaveLength(1);
    expect(await pointsFor(referrer.userId, 'referral_joined')).toHaveLength(0);
  });

  it('referral_window_closed for an account older than REFERRAL_ATTRIBUTION_DAYS', async () => {
    const referrer = await realUser('attr-window-referrer');
    const code = (await referralSummary(referrer.token)).code;
    const oldCreatedAt = new Date(Date.now() - 20 * 24 * 60 * 60 * 1000);
    const old = await insertFakeUser({ createdAt: oldCreatedAt });

    await expect(attributeReferral(env, db, { id: old.id, email: old.email, createdAt: oldCreatedAt }, { code }, { ip: null, userAgent: null, deviceId: null })).rejects.toMatchObject({
      code: 'referral_window_closed',
    });
    expect(await db.select().from(referrals).where(eq(referrals.referredUserId, old.id))).toHaveLength(0);
  });

  it('a repeat device id inserts rejected/device_dup and still returns attributed: true; the referrer sees it as pending', async () => {
    const referrer = await realUser('attr-device-referrer');
    const code = (await referralSummary(referrer.token)).code;
    const deviceId = fakeSeq('device');

    const first = await signIn(`${fakeSeq('attr-device-1')}@example.com`);
    const firstRes = await call('/me/referral/attribute', { method: 'POST', token: first.token, json: { code }, headers: { 'X-Chatsoon-Device': deviceId } });
    expect(firstRes.status).toBe(200);

    const second = await signIn(`${fakeSeq('attr-device-2')}@example.com`);
    const secondRes = await call('/me/referral/attribute', { method: 'POST', token: second.token, json: { code }, headers: { 'X-Chatsoon-Device': deviceId } });
    expect(secondRes.status).toBe(200);
    expect(await secondRes.json()).toEqual({ attributed: true });

    const [row] = await db.select().from(referrals).where(eq(referrals.referredUserId, second.userId));
    expect(row?.status).toBe('rejected');
    expect(row?.reason).toBe('device_dup');

    // The referred person still got their joining point (never reversed).
    expect(await pointsFor(second.userId, 'referral_joined')).toHaveLength(1);

    // The referrer's list shows it as 'pending', never 'rejected' - a farmer learns nothing.
    const summary = await referralSummary(referrer.token);
    const item = summary.referrals.find((r) => r.id === row!.id);
    expect(item?.status).toBe('pending');
  });

  it('100 signups from one IP hash for one referrer all insert pending (no automatic IP rule)', async () => {
    const referrer = await realUser('attr-ip-fanout-referrer');
    const code = (await referralSummary(referrer.token)).code;
    const ip = '203.0.113.77';

    for (let i = 0; i < 100; i++) {
      const fake = await insertFakeUser();
      const result = await attributeReferral(env, db, { id: fake.id, email: fake.email, createdAt: new Date() }, { code }, { ip, userAgent: null, deviceId: null });
      expect(result).toEqual({ attributed: true });
    }

    const rows = await db.select({ status: referrals.status }).from(referrals).where(eq(referrals.referrerId, referrer.userId));
    const pendingRows = rows.filter((r) => r.status === 'pending');
    expect(pendingRows.length).toBeGreaterThanOrEqual(100);
  }, 20_000);
});

// ---------------------------------------------------------------------------
// REFERRAL_ENABLED = false
// ---------------------------------------------------------------------------

describe('REFERRAL_ENABLED = false', () => {
  const disabledEnv = withEnv({ REFERRAL_ENABLED: 'false' });

  it('attribute, invites and claims answer referral_disabled; GET /me/referral and GET /referral/:code still work', async () => {
    const user = await realUser('disabled-flow');
    const code = (await referralSummary(user.token)).code;

    const attributeRes = await callWithEnv('/me/referral/attribute', disabledEnv, { method: 'POST', token: user.token, json: { code: 'AAAAAAAA' } });
    expect(attributeRes.status).toBe(403);
    expect(((await attributeRes.json()) as ApiErrorBody).error.code).toBe('referral_disabled');

    const invitesRes = await callWithEnv('/me/referral/invites', disabledEnv, { method: 'POST', token: user.token, json: { emails: ['a@example.com'] } });
    expect(((await invitesRes.json()) as ApiErrorBody).error.code).toBe('referral_disabled');

    const claimsRes = await callWithEnv('/me/referral/claims', disabledEnv, {
      method: 'POST',
      token: user.token,
      json: { shareConsent: true, consentText: 'Share my name and email' },
    });
    expect(((await claimsRes.json()) as ApiErrorBody).error.code).toBe('referral_disabled');

    const getRes = await callWithEnv('/me/referral', disabledEnv, { token: user.token });
    expect(getRes.status).toBe(200);
    expect(((await getRes.json()) as GetReferralResponse).code).toBe(code);

    const publicRes = await callWithEnv(`/referral/${code}`, disabledEnv);
    expect(publicRes.status).toBe(200);
  });
});

// ---------------------------------------------------------------------------
// Qualification sweep
// ---------------------------------------------------------------------------

describe('runReferralQualification', () => {
  it('does nothing before qualifies_after', async () => {
    const referrer = await realUser('sweep-notyet-referrer');
    const { id: referredUserId } = await insertFakeUser();
    await insertFakeProfile(referredUserId);
    await linkGoogle(referredUserId);
    const id = await insertPendingReferral(referrer.userId, referredUserId, { dueInPast: false });

    await runReferralQualification(env, db);
    expect((await referralRow(id))?.status).toBe('pending');
  });

  it('an unverified email leaves the referral pending and bumps qualifies_after', async () => {
    const referrer = await realUser('sweep-unverified-referrer');
    const { id: referredUserId } = await insertFakeUser({ emailVerified: false });
    await insertFakeProfile(referredUserId);
    await linkGoogle(referredUserId);
    const id = await insertPendingReferral(referrer.userId, referredUserId);
    const before = (await referralRow(id))!.qualifiesAfter!.getTime();

    await runReferralQualification(env, db);
    const after = await referralRow(id);
    expect(after?.status).toBe('pending');
    expect(after!.qualifiesAfter!.getTime()).toBeGreaterThan(before);
  });

  it('no profiles row leaves the referral pending', async () => {
    const referrer = await realUser('sweep-noprofile-referrer');
    const { id: referredUserId } = await insertFakeUser();
    await linkGoogle(referredUserId);
    const id = await insertPendingReferral(referrer.userId, referredUserId);

    await runReferralQualification(env, db);
    expect((await referralRow(id))?.status).toBe('pending');
  });

  it('no eligible social account leaves the referral pending', async () => {
    const referrer = await realUser('sweep-nosocial-referrer');
    const { id: referredUserId } = await insertFakeUser();
    await insertFakeProfile(referredUserId);
    const id = await insertPendingReferral(referrer.userId, referredUserId);

    await runReferralQualification(env, db);
    expect((await referralRow(id))?.status).toBe('pending');
  });

  it('an email-OTP-only account never counts as social; a linked google account does', async () => {
    const referrer = await realUser('sweep-social-referrer');

    const otpOnly = await insertFakeUser();
    await insertFakeProfile(otpOnly.id);
    // No `accounts` row at all: the same case hasEligibleSocial sees for an email-OTP-only sign-up
    // (Better Auth's own 'credential' provider row isn't in SOCIAL_VALIDATION_PROVIDERS either way).
    const otpReferralId = await insertPendingReferral(referrer.userId, otpOnly.id);

    const withGoogle = await insertFakeUser();
    await insertFakeProfile(withGoogle.id);
    await linkGoogle(withGoogle.id);
    const googleReferralId = await insertPendingReferral(referrer.userId, withGoogle.id);

    await runReferralQualification(env, db);
    expect((await referralRow(otpReferralId))?.status).toBe('pending');
    expect((await referralRow(googleReferralId))?.status).toBe('qualified');
  });

  it('a discord row counts only with mfa_enabled and an id 90+ days old (young id, no mfa, and both good)', async () => {
    const referrer = await realUser('sweep-discord-referrer');

    async function discordCase(ageDays: number, mfaEnabled: boolean) {
      const { id } = await insertFakeUser();
      await insertFakeProfile(id);
      await linkDiscordWithCheck(id, { ageDays, mfaEnabled });
      return insertPendingReferral(referrer.userId, id);
    }

    const young = await discordCase(1, true);
    const noMfa = await discordCase(200, false);
    const good = await discordCase(200, true);

    await runReferralQualification(env, db);
    expect((await referralRow(young))?.status).toBe('pending');
    expect((await referralRow(noMfa))?.status).toBe('pending');
    expect((await referralRow(good))?.status).toBe('qualified');
  });

  it('a twitter row counts only with verified or identity_verified true and followers_count >= 50', async () => {
    const referrer = await realUser('sweep-twitter-referrer');

    async function twitterCase(opts: { verified: boolean; identityVerified: boolean; followersCount: number }) {
      const { id } = await insertFakeUser();
      await insertFakeProfile(id);
      await linkTwitterWithCheck(id, opts);
      return insertPendingReferral(referrer.userId, id);
    }

    const unverified = await twitterCase({ verified: false, identityVerified: false, followersCount: 1000 });
    const verifiedLowFollowers = await twitterCase({ verified: true, identityVerified: false, followersCount: 10 });
    const idVerifiedGoodFollowers = await twitterCase({ verified: false, identityVerified: true, followersCount: 50 });
    const verifiedGoodFollowers = await twitterCase({ verified: true, identityVerified: false, followersCount: 50 });

    await runReferralQualification(env, db);
    expect((await referralRow(unverified))?.status).toBe('pending');
    expect((await referralRow(verifiedLowFollowers))?.status).toBe('pending');
    expect((await referralRow(idVerifiedGoodFollowers))?.status).toBe('qualified');
    expect((await referralRow(verifiedGoodFollowers))?.status).toBe('qualified');
  });

  it('voids a never-qualifying referral after REFERRAL_MAX_PENDING_DAYS (60), keeping it pending until then', async () => {
    const referrer = await realUser('sweep-void-referrer');
    const { id: referredUserId } = await insertFakeUser();
    // No profile, no social: never qualifies. Attributed 61 days ago.
    const id = await insertPendingReferral(referrer.userId, referredUserId, { createdAt: new Date(Date.now() - 61 * 24 * 60 * 60 * 1000) });

    await runReferralQualification(env, db);
    const row = await referralRow(id);
    expect(row?.status).toBe('void');
    expect(row?.reason).toBe('never_qualified');
  });

  it('a rejected row past REFERRAL_MAX_PENDING_DAYS becomes void, keeping its reason', async () => {
    const referrer = await realUser('sweep-rejected-void-referrer');
    const { id: referredUserId } = await insertFakeUser();
    const id = fakeSeq('referral');
    await db.insert(referrals).values({
      id,
      referrerId: referrer.userId,
      referredUserId,
      status: 'rejected',
      reason: 'device_dup',
      source: 'typed',
      createdAt: new Date(Date.now() - 61 * 24 * 60 * 60 * 1000),
    });

    await runReferralQualification(env, db);
    const row = await referralRow(id);
    expect(row?.status).toBe('void');
    expect(row?.reason).toBe('device_dup');
  });

  it('a row set to flagged by hand is skipped until flag_cleared_at (never selected by the sweep)', async () => {
    const referrer = await realUser('sweep-flagged-referrer');
    const { id: referredUserId } = await insertFakeUser();
    await insertFakeProfile(referredUserId);
    await linkGoogle(referredUserId);
    const id = fakeSeq('referral');
    await db
      .insert(referrals)
      .values({ id, referrerId: referrer.userId, referredUserId, status: 'flagged', reason: 'ops_flag', source: 'typed', qualifiesAfter: new Date(Date.now() - 1000) });

    await runReferralQualification(env, db);
    expect((await referralRow(id))?.status).toBe('flagged');
  });

  it('marks the matching referral_invites row converted once the invited email is attributed and qualifies', async () => {
    const referrer = await realUser('sweep-convert-referrer');
    const targetEmail = `${fakeSeq('sweep-convert-target')}@example.com`;
    await db.insert(referralInvites).values({ id: fakeSeq('invite'), referrerId: referrer.userId, email: targetEmail });

    const { id: referredUserId } = await insertFakeUser({ email: targetEmail });
    await insertFakeProfile(referredUserId);
    await linkGoogle(referredUserId);
    await insertPendingReferral(referrer.userId, referredUserId);

    await runReferralQualification(env, db);
    const [invite] = await db.select().from(referralInvites).where(eq(referralInvites.email, targetEmail));
    expect(invite?.convertedAt).not.toBeNull();
  });

  it('credits the points_ledger exactly once even if the same referral is reprocessed (concurrent-sweep safety net)', async () => {
    const referrer = await realUser('sweep-dedup-referrer');
    const { referralId } = await seedQualifyingReferral(referrer.userId);

    await runReferralQualification(env, db);
    expect((await referralRow(referralId))?.status).toBe('qualified');
    expect((await pointsFor(referrer.userId, 'referral_qualified')).filter((p) => p.refId === referralId)).toHaveLength(1);

    // Simulate a second, concurrent sweep having also picked up this exact row while still pending.
    await db.update(referrals).set({ status: 'pending', qualifiesAfter: new Date(Date.now() - 1000) }).where(eq(referrals.id, referralId));
    await runReferralQualification(env, db);

    const ledgerRows = (await pointsFor(referrer.userId, 'referral_qualified')).filter((p) => p.refId === referralId);
    expect(ledgerRows).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// Founder badges, the cap (REFERRAL_FOUNDER_CAP=3), and claims
// ---------------------------------------------------------------------------
//
// These share one global `badges` table and cap, so they run as one ordered narrative: A, B and C
// each become 'founder' (seq 1, 2, 3) in turn, D becomes 'early_adopter'; A then continues on to 20
// qualified referrals to cover the Claim ready email and the claim flow. Keeping this all in one
// describe, in this order, is deliberate - see the PR notes.

describe('Founder badges, the cap, and claims (REFERRAL_FOUNDER_CAP=3)', () => {
  it('the 10th qualification awards founder #1, sends the Milestone badge email (not Qualified), and a re-run never awards a second badge', async () => {
    const a = await realUser('cap-A');
    await seedNQualifyingReferrals(a.userId, 10);
    await runReferralQualification(env, db);

    const badge = await badgeRow(a.userId);
    expect(badge).toMatchObject({ badge: 'founder', seq: 1 });

    const milestoneMail = emailsTo(a.email).find((m) => m.subject.startsWith("You're Chatsoon Founding member"));
    expect(milestoneMail?.subject).toBe("You're Chatsoon Founding member #1");
    // Referrals 1..9 each got an ordinary Qualified email; the 10th got Milestone instead of a 10th one.
    const qualifiedMails = emailsTo(a.email).filter((m) => m.subject.includes('just qualified as your referral'));
    expect(qualifiedMails).toHaveLength(9);
    expect(qualifiedMails.some((m) => m.subject.includes('10 of 10'))).toBe(false);

    const summary = await referralSummary(a.token);
    expect(summary.founderSpotsLeft).toBe(2);
    expect(summary.milestoneBadge).toMatchObject({ badge: 'founder', seq: 1 });

    // Re-processing the same qualifying event (a concurrent-sweep simulation) never awards a second badge.
    const [oneQualified] = await db
      .select({ id: referrals.id })
      .from(referrals)
      .where(sql`${referrals.referrerId} = ${a.userId} and ${referrals.status} = 'qualified'`)
      .limit(1);
    await db.update(referrals).set({ status: 'pending', qualifiesAfter: new Date(Date.now() - 1000) }).where(eq(referrals.id, oneQualified!.id));
    await runReferralQualification(env, db);
    expect(await db.select().from(badges).where(eq(badges.userId, a.userId))).toHaveLength(1);
  });

  it('the second referrer to reach 10 gets founder #2', async () => {
    const b = await realUser('cap-B');
    await seedNQualifyingReferrals(b.userId, 10);
    await runReferralQualification(env, db);
    expect(await badgeRow(b.userId)).toMatchObject({ badge: 'founder', seq: 2 });
    expect((await referralSummary(b.token)).founderSpotsLeft).toBe(1);
  });

  it('the third referrer to reach 10 gets founder #3, using up the cap', async () => {
    const c = await realUser('cap-C');
    await seedNQualifyingReferrals(c.userId, 10);
    await runReferralQualification(env, db);
    expect(await badgeRow(c.userId)).toMatchObject({ badge: 'founder', seq: 3 });
    expect((await referralSummary(c.token)).founderSpotsLeft).toBe(0);
  });

  it('the fourth referrer to reach 10 gets early_adopter with seq null once the cap is reached', async () => {
    const d = await realUser('cap-D');
    await seedNQualifyingReferrals(d.userId, 10);
    await runReferralQualification(env, db);
    expect(await badgeRow(d.userId)).toMatchObject({ badge: 'early_adopter', seq: null });
    expect((await referralSummary(d.token)).founderSpotsLeft).toBe(0);
  });

  it('a duplicate (badge, seq) insert is rejected by the unique index and falls through to early_adopter rather than throwing', async () => {
    const customEnv = withEnv({ REFERRAL_FOUNDER_CAP: '999' }); // well above the current founder count
    const [countRow] = await db.select({ n: sql<number>`count(*)` }).from(badges).where(eq(badges.badge, 'founder'));
    const currentCount = countRow!.n;
    const phantom = await insertFakeUser();
    // Occupies exactly the seq a fresh award would compute (currentCount + 1 at insert time, once this
    // phantom row itself is counted): simulates two isolates racing for the same number.
    await db.insert(badges).values({ userId: phantom.id, badge: 'founder', seq: currentCount + 2, awardedAt: new Date() });

    const real = await insertFakeUser();
    const result = await awardMilestoneBadge(db, customEnv, real.id, 'fake-ref-id-race');
    expect(result).toEqual({ badge: 'early_adopter', seq: null });
    expect(await badgeRow(real.id)).toMatchObject({ badge: 'early_adopter', seq: null });
  });

  it('GET /me and GET /id/:slug carry badges: [{ badge, seq }] once earned, [] before', async () => {
    const fresh = await realUser('cap-badges-check-fresh'); // no badge yet
    expect((await me(fresh.token)).profile?.badges).toEqual([]);
    const freshIdRes = await call(`/id/${fresh.slug}`);
    expect(((await freshIdRes.json()) as PublicProfile).badges).toEqual([]);

    // Reuse the first founder from this describe block's ordered narrative above.
    const [founderBadge] = await db.select({ userId: badges.userId }).from(badges).where(sql`${badges.badge} = 'founder' and ${badges.seq} = 1`);
    const [founderProfile] = await db.select({ slug: profiles.slug }).from(profiles).where(eq(profiles.userId, founderBadge!.userId));
    const founderIdRes = await call(`/id/${founderProfile!.slug}`);
    expect(((await founderIdRes.json()) as PublicProfile).badges).toEqual([{ badge: 'founder', seq: 1 }]);
  });

  it('qualifying 10 more (20 total) sends Claim ready (not Qualified) on the 20th', async () => {
    const [founderBadge] = await db.select({ userId: badges.userId }).from(badges).where(sql`${badges.badge} = 'founder' and ${badges.seq} = 1`);
    const referrerId = founderBadge!.userId;
    const [referrerUser] = await db.select({ email: users.email }).from(users).where(eq(users.id, referrerId));

    await seedNQualifyingReferrals(referrerId, 10); // 11th..20th
    await runReferralQualification(env, db);

    const claimReadyMails = emailsTo(referrerUser!.email).filter((m) => m.subject === 'You can claim your Chatsoon reward');
    expect(claimReadyMails).toHaveLength(1);

    const [qualifiedCountRow] = await db
      .select({ n: sql<number>`count(*)` })
      .from(referrals)
      .where(sql`${referrals.referrerId} = ${referrerId} and ${referrals.status} = 'qualified'`);
    expect(qualifiedCountRow!.n).toBe(20);
  });

  it('claims: refused under the claim threshold, even holding the founder badge (referrer B, at 10)', async () => {
    const [bBadge] = await db.select({ userId: badges.userId }).from(badges).where(sql`${badges.badge} = 'founder' and ${badges.seq} = 2`);
    const [bUser] = await db.select({ email: users.email }).from(users).where(eq(users.id, bBadge!.userId));
    await expect(claimReferral(env, db, bBadge!.userId, bUser!.email, { shareConsent: true, consentText: 'Share my info' })).rejects.toMatchObject({ status: 403 });
  });

  describe('the claim flow (referrer A, now at 20 qualified referrals)', () => {
    async function referrerAToken(): Promise<{ token: string; userId: string; email: string }> {
      const [founderBadge] = await db.select({ userId: badges.userId }).from(badges).where(sql`${badges.badge} = 'founder' and ${badges.seq} = 1`);
      const [userRow] = await db.select({ email: users.email }).from(users).where(eq(users.id, founderBadge!.userId));
      // Sign in again as this same (real, Better Auth) account to get a fresh bearer token.
      const s = await signIn(userRow!.email);
      return { token: s.token, userId: s.userId, email: userRow!.email };
    }

    it('refused without a social account (referral_claim_needs_social)', async () => {
      const a = await referrerAToken();
      const res = await call('/me/referral/claims', { method: 'POST', token: a.token, json: { shareConsent: true, consentText: 'Share my name and email' } });
      expect(res.status).toBe(403);
      expect(((await res.json()) as ApiErrorBody).error.code).toBe('referral_claim_needs_social');
    });

    it('allowed once a linkedin account is linked; issued once; a repeat call while live returns referral_claim_open with the same URL', async () => {
      const a = await referrerAToken();
      await linkLinkedin(a.userId);

      const first = await call('/me/referral/claims', { method: 'POST', token: a.token, json: { shareConsent: true, consentText: 'Share my name and email' } });
      expect(first.status).toBe(200);
      const firstBody = (await first.json()) as ClaimReferralResponse;
      expect(firstBody.url).toContain(`${env.REFERRAL_CLAIM_URL}?token=`);
      const daysOut = (new Date(firstBody.expiresAt).getTime() - Date.now()) / (24 * 60 * 60 * 1000);
      expect(daysOut).toBeGreaterThan(29.9);
      expect(daysOut).toBeLessThan(30.1);

      const second = await call('/me/referral/claims', { method: 'POST', token: a.token, json: { shareConsent: true, consentText: 'Share my name and email' } });
      expect(second.status).toBe(409);
      const secondBody = (await second.json()) as ApiErrorBody;
      expect(secondBody.error.code).toBe('referral_claim_open');
      // The token is derived from the claim row, so any isolate hands back the same live link.
      expect(secondBody.error.url).toBe(firstBody.url);
    });

    it('an expired token rotates to a new one on the next call', async () => {
      const a = await referrerAToken();
      const [claim] = await db.select().from(referralClaims).where(eq(referralClaims.userId, a.userId));
      await db.update(referralClaims).set({ tokenExpiresAt: new Date(Date.now() - 1000) }).where(eq(referralClaims.id, claim!.id));

      const res = await call('/me/referral/claims', { method: 'POST', token: a.token, json: { shareConsent: true, consentText: 'Share my name and email' } });
      expect(res.status).toBe(200);
      const body = (await res.json()) as ClaimReferralResponse;
      const [updated] = await db.select().from(referralClaims).where(eq(referralClaims.id, claim!.id));
      expect(updated!.tokenHash).not.toBe(claim!.tokenHash);
      expect(body.url).toContain('?token=');
    });

    it('GET /me/referral carries the live claim url, the same one POST hands back', async () => {
      const a = await referrerAToken();
      const summary = await referralSummary(a.token);
      expect(summary.claim?.status).toBe('issued');
      expect(summary.claim?.milestone).toBe(20);
      expect(summary.claim?.url).toContain(`${env.REFERRAL_CLAIM_URL}?token=`);
      const again = await call('/me/referral/claims', { method: 'POST', token: a.token, json: { shareConsent: true, consentText: 'Share my name and email' } });
      expect(((await again.json()) as ApiErrorBody).error.url).toBe(summary.claim?.url);
    });

    it('partner GET verify returns the user and the consent-gated email; wrong or missing secret is 401', async () => {
      const a = await referrerAToken();
      const url = (await referralSummary(a.token)).claim!.url!;
      const token = new URL(url).searchParams.get('token')!;

      const wrongAuth = await call(`/referral/claims/verify?token=${encodeURIComponent(token)}`, { headers: { Authorization: 'Bearer wrong-secret' } });
      expect(wrongAuth.status).toBe(401);
      const noAuth = await call(`/referral/claims/verify?token=${encodeURIComponent(token)}`);
      expect(noAuth.status).toBe(401);

      const res = await call(`/referral/claims/verify?token=${encodeURIComponent(token)}`, { headers: { Authorization: `Bearer ${PARTNER_SECRET}` } });
      expect(res.status).toBe(200);
      const body = (await res.json()) as VerifyClaimResponse;
      expect(body).toMatchObject({ valid: true, milestone: 20, status: 'issued', user: { id: a.userId, email: a.email } });
    });

    it('partner POST redeem is idempotent, and a verify afterwards is valid: false, reason: redeemed', async () => {
      const a = await referrerAToken();
      const url = (await referralSummary(a.token)).claim!.url!;
      const token = new URL(url).searchParams.get('token')!;

      const authHeaders = { Authorization: `Bearer ${PARTNER_SECRET}` };
      const first = await call('/referral/claims/redeem', { method: 'POST', json: { token }, headers: authHeaders });
      expect(first.status).toBe(200);
      const firstBody = (await first.json()) as RedeemClaimResponse;
      expect(firstBody.ok).toBe(true);

      const second = await call('/referral/claims/redeem', { method: 'POST', json: { token }, headers: authHeaders });
      expect(second.status).toBe(200);
      const secondBody = (await second.json()) as RedeemClaimResponse;
      expect(secondBody.redeemedAt).toBe(firstBody.redeemedAt);

      const verify = await call(`/referral/claims/verify?token=${encodeURIComponent(token)}`, { headers: authHeaders });
      expect((await verify.json()) as VerifyClaimResponse).toEqual({ valid: false, reason: 'redeemed' });
    });

    it('referral_already_claimed once redeemed', async () => {
      const a = await referrerAToken();
      const res = await call('/me/referral/claims', { method: 'POST', token: a.token, json: { shareConsent: true, consentText: 'Share my name and email' } });
      expect(res.status).toBe(409);
      expect(((await res.json()) as ApiErrorBody).error.code).toBe('referral_already_claimed');
    });
  });
});

// ---------------------------------------------------------------------------
// Invites
// ---------------------------------------------------------------------------

describe('POST /me/referral/invites', () => {
  it('sends and records an invite, with a List-Unsubscribe header and the /r/<code> link', async () => {
    const referrer = await realUser('invite-content-referrer');
    const code = (await referralSummary(referrer.token)).code;
    const target = `${fakeSeq('invite-content-target')}@example.com`;

    const res = await call('/me/referral/invites', { method: 'POST', token: referrer.token, json: { emails: [target] } });
    expect(res.status).toBe(200);
    expect((await res.json()) as SendInvitesResponse).toEqual({ sent: 1, skipped: 0 });

    const mail = emailsTo(target)[0];
    expect(mail).toBeTruthy();
    expect(mail!.subject).toContain('invited you to Chatsoon');
    expect(mail!.text).toContain(`/r/${code}`);
    expect(mail!.headers?.['List-Unsubscribe']).toMatch(/^<.*\/email\/unsubscribe\?token=.+>, <mailto:/);
    expect(mail!.headers?.['List-Unsubscribe-Post']).toBe('List-Unsubscribe=One-Click');

    const [row] = await db.select().from(referralInvites).where(eq(referralInvites.email, target));
    expect(row?.referrerId).toBe(referrer.userId);
  });

  it('skips an address whose email already belongs to an account, counted but not named', async () => {
    const referrer = await realUser('invite-existing-referrer');
    const email = `${fakeSeq('invite-existing')}@example.com`;
    await signIn(email);

    const res = await call('/me/referral/invites', { method: 'POST', token: referrer.token, json: { emails: [email] } });
    expect(res.status).toBe(200);
    expect((await res.json()) as SendInvitesResponse).toEqual({ sent: 0, skipped: 1 });
  });

  it('an unsubscribed address is suppressed from every future invite, from any referrer', async () => {
    const referrerA = await realUser('invite-unsub-a');
    const referrerB = await realUser('invite-unsub-b');
    const target = `${fakeSeq('invite-unsub-target')}@example.com`;

    const first = await call('/me/referral/invites', { method: 'POST', token: referrerA.token, json: { emails: [target] } });
    expect((await first.json()) as SendInvitesResponse).toEqual({ sent: 1, skipped: 0 });

    const token = await unsubscribeToken(env, 'invite', target);
    const unsubRes = await call(`/email/unsubscribe?token=${encodeURIComponent(token)}`, { method: 'POST', json: {} });
    expect(unsubRes.status).toBe(200);

    const second = await call('/me/referral/invites', { method: 'POST', token: referrerB.token, json: { emails: [target] } });
    expect((await second.json()) as SendInvitesResponse).toEqual({ sent: 0, skipped: 1 });
    expect(emailsTo(target)).toHaveLength(1); // only referrer A's original send, never a second
  });

  it('the 90 day cross-referrer cap: a 4th referrer inviting the same address within 90 days is skipped', async () => {
    const target = `${fakeSeq('invite-crosscap-target')}@example.com`;
    const referrers = await Promise.all([1, 2, 3, 4].map(() => realUser('invite-crosscap')));

    for (let i = 0; i < 3; i++) {
      const res = await call('/me/referral/invites', { method: 'POST', token: referrers[i]!.token, json: { emails: [target] } });
      expect((await res.json()) as SendInvitesResponse, `referrer ${i}`).toEqual({ sent: 1, skipped: 0 });
    }
    const fourth = await call('/me/referral/invites', { method: 'POST', token: referrers[3]!.token, json: { emails: [target] } });
    expect((await fourth.json()) as SendInvitesResponse).toEqual({ sent: 0, skipped: 1 });
  });

  it('the daily cap (20 per user per day): a 21st invite in a later call is refused with referral_invite_limit', async () => {
    const referrer = await realUser('invite-dailycap-referrer');
    const twenty = Array.from({ length: 20 }, () => `${fakeSeq('invite-dailycap')}@example.com`);
    const firstBatch = await call('/me/referral/invites', { method: 'POST', token: referrer.token, json: { emails: twenty } });
    expect((await firstBatch.json()) as SendInvitesResponse).toEqual({ sent: 20, skipped: 0 });

    const oneMore = await call('/me/referral/invites', {
      method: 'POST',
      token: referrer.token,
      json: { emails: [`${fakeSeq('invite-dailycap-overflow')}@example.com`] },
    });
    expect(oneMore.status).toBe(429);
    expect(((await oneMore.json()) as ApiErrorBody).error.code).toBe('referral_invite_limit');
  }, 20_000);

  it('requires a session, and 1-20 valid emails', async () => {
    expect((await call('/me/referral/invites', { method: 'POST', json: { emails: ['a@example.com'] } })).status).toBe(401);
    const referrer = await realUser('invite-validation-referrer');
    expect((await call('/me/referral/invites', { method: 'POST', token: referrer.token, json: { emails: [] } })).status).toBe(400);
    expect((await call('/me/referral/invites', { method: 'POST', token: referrer.token, json: { emails: Array(21).fill('a@example.com') } })).status).toBe(400);
  });
});

// ---------------------------------------------------------------------------
// GET /referral/:code and GET /_pages/referral/:code
// ---------------------------------------------------------------------------

describe('GET /referral/:code', () => {
  it("returns the code owner's public card", async () => {
    const owner = await realUser('public-code-owner');
    const code = (await referralSummary(owner.token)).code;
    const res = await call(`/referral/${code.toLowerCase()}`); // lowercase input still resolves
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ displayName: 'public-code-owner Person', slug: owner.slug });
  });

  it('404s an unknown code', async () => {
    const res = await call('/referral/ZZZZZZZZ');
    expect(res.status).toBe(404);
  });
});

describe('GET /_pages/referral/:code', () => {
  const PAGES_KEY = env.PAGES_SHARED_SECRET!;

  it('mirrors GET /_pages/profile/:slug: needs the shared secret, and returns the code owner otherwise', async () => {
    const owner = await realUser('pages-referral-owner');
    const code = (await referralSummary(owner.token)).code;

    const noKey = await call(`/_pages/referral/${code}`);
    expect(noKey.status).toBe(404);

    const wrongKey = await call(`/_pages/referral/${code}`, { headers: { 'x-pages-key': 'not-the-secret' } });
    expect(wrongKey.status).toBe(404);

    const res = await call(`/_pages/referral/${code}`, { headers: { 'x-pages-key': PAGES_KEY } });
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    const body = (await res.json()) as ReferralPageResult;
    // ogVersion is a hash of the profile fields (cards are enabled in the test env, see
    // vitest.config.ts), never null here — asserted separately since its exact value isn't fixed.
    expect(body).toMatchObject({
      status: 'ok',
      referral: { displayName: 'pages-referral-owner Person', slug: owner.slug, avatarVersion: null, headline: null },
    });
    if (body.status === 'ok') expect(body.referral.ogVersion).toMatch(/^[0-9a-f]{16}$/);
  });

  it('mirrors the not-found case for an unknown code', async () => {
    const res = await call('/_pages/referral/ZZZZZZZZ', { headers: { 'x-pages-key': PAGES_KEY } });
    expect(res.status).toBe(200);
    expect((await res.json()) as ReferralPageResult).toEqual({ status: 'not_found' });
  });
});

// ---------------------------------------------------------------------------
// Deletion
// ---------------------------------------------------------------------------

describe('Account deletion', () => {
  it('deleting the referrer removes referrals, claims, badges and invites (FK cascade)', async () => {
    const referrer = await realUser('delete-referrer');
    await seedNQualifyingReferrals(referrer.userId, 1);
    await runReferralQualification(env, db);
    await linkLinkedin(referrer.userId);
    await call('/me/referral/invites', { method: 'POST', token: referrer.token, json: { emails: [`${fakeSeq('delete-referrer-invite')}@example.com`] } });

    expect(await db.select().from(referrals).where(eq(referrals.referrerId, referrer.userId))).not.toHaveLength(0);
    expect(await db.select().from(referralInvites).where(eq(referralInvites.referrerId, referrer.userId))).not.toHaveLength(0);

    const res = await call('/me', { method: 'DELETE', token: referrer.token });
    expect(res.status).toBe(204);

    expect(await db.select().from(referrals).where(eq(referrals.referrerId, referrer.userId))).toHaveLength(0);
    expect(await db.select().from(referralInvites).where(eq(referralInvites.referrerId, referrer.userId))).toHaveLength(0);
    expect(await db.select().from(badges).where(eq(badges.userId, referrer.userId))).toHaveLength(0);
    expect(await db.select().from(referralClaims).where(eq(referralClaims.userId, referrer.userId))).toHaveLength(0);
  });

  it('deleting the referred user removes their referral row and leaves the referrer already-credited points alone', async () => {
    const referrer = await realUser('delete-referred-referrer');
    const { referralId } = await seedQualifyingReferral(referrer.userId);
    await runReferralQualification(env, db);
    expect((await pointsFor(referrer.userId, 'referral_qualified')).filter((p) => p.refId === referralId)).toHaveLength(1);

    const [referredUserId] = await db.select({ id: referrals.referredUserId }).from(referrals).where(eq(referrals.id, referralId));
    const { deleteUserData } = await import('../src/lib/account');
    await deleteUserData(env, db, referredUserId!.id, `${referredUserId!.id}@example.com`);

    expect(await db.select().from(referrals).where(eq(referrals.id, referralId))).toHaveLength(0);
    // The referrer's own points are untouched: they belong to the referrer's user id, not the
    // referred (now deleted) user's.
    expect((await pointsFor(referrer.userId, 'referral_qualified')).filter((p) => p.refId === referralId)).toHaveLength(1);
  });

  it('deleting an account whose email matches a pending invite removes that referral_invites row', async () => {
    const referrer = await realUser('delete-invite-referrer');
    const targetEmail = `${fakeSeq('delete-invite-target')}@example.com`;
    await call('/me/referral/invites', { method: 'POST', token: referrer.token, json: { emails: [targetEmail] } });
    expect(await db.select().from(referralInvites).where(eq(referralInvites.email, targetEmail))).not.toHaveLength(0);

    const newAccount = await signIn(targetEmail);
    const res = await call('/me', { method: 'DELETE', token: newAccount.token });
    expect(res.status).toBe(204);

    expect(await db.select().from(referralInvites).where(eq(referralInvites.email, targetEmail))).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Invite retention sweep
// ---------------------------------------------------------------------------

describe('sweepReferralInvites (compliance retention)', () => {
  it('deletes a stale, never-actioned invite after 12 months, deletes a converted one, but keeps an unsubscribed one forever', async () => {
    const referrer = await realUser('sweep-invites-referrer');
    const staleEmail = `${fakeSeq('sweep-invites-stale')}@example.com`;
    const convertedEmail = `${fakeSeq('sweep-invites-converted')}@example.com`;
    const unsubEmail = `${fakeSeq('sweep-invites-unsub')}@example.com`;

    const thirteenMonthsAgo = new Date(Date.now() - 400 * 24 * 60 * 60 * 1000);
    await db.insert(referralInvites).values({ id: fakeSeq('invite'), referrerId: referrer.userId, email: staleEmail, sentAt: thirteenMonthsAgo });
    await db.insert(referralInvites).values({ id: fakeSeq('invite'), referrerId: referrer.userId, email: convertedEmail, convertedAt: new Date() });
    await db.insert(referralInvites).values({ id: fakeSeq('invite'), referrerId: referrer.userId, email: unsubEmail, unsubscribedAt: thirteenMonthsAgo });

    await sweepReferralInvites(db);

    expect(await db.select().from(referralInvites).where(eq(referralInvites.email, staleEmail))).toHaveLength(0);
    expect(await db.select().from(referralInvites).where(eq(referralInvites.email, convertedEmail))).toHaveLength(0);
    expect(await db.select().from(referralInvites).where(eq(referralInvites.email, unsubEmail))).toHaveLength(1);
  });
});
