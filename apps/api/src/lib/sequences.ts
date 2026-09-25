import { profileUrl } from '@chatsoon/shared';
import { and, eq, isNull, lte, sql } from 'drizzle-orm';

import { emailLeads, emailPrefs, users, type EmailLeadRow, type EmailPrefsRow } from '../db/schema';
import type { Env } from '../env';
import { getDb, type DB } from './db';
import { leadStepEmail, nudgeEmail, sendEmail } from './email';
import { findProfileByUserId } from './profiles';
import { suppressInviteEmail } from './referrals';
import { isReviewerEmail } from './reviewer';
import { parseLinks } from './serialize';
import { listUnsubscribeHeaders, unsubscribeToken, unsubscribeUrl } from './unsubscribe';

// Email tips sequences (issue #7): API half only (the mobile/web UI is a separate change).
//
// 1. A visitor who ticks "Email me tips..." on the public Connect form (routes/public.ts) and has no
//    Chatsoon account gets an `email_leads` row (`maybeCreateLead`) and, over the following ~7 days,
//    up to three "create your profile" emails (`runEmailSequences`'s lead half).
// 2. A user who finishes onboarding (routes/profile.ts, first PUT /me/profile) gets an `email_prefs`
//    row (`startTipsNudges`) and, over the following ~3 days, up to two "finish your profile" /
//    "share your link" nudges (`runEmailSequences`'s nudge half). The same call converts any lead row
//    for that email, so nobody gets both sequences.
//
// Both halves run from the same cron tick (index.ts's `scheduled`), each row in its own try/catch so
// one bad row (a Resend outage, a malformed profile) never blocks the rest of the batch - the same
// shape as lib/deletion.ts's `runDueDeletions`.

/** The exact wording of the Connect form's opt-in checkbox, kept for the compliance record. */
export const TIPS_CONSENT_TEXT = 'Email me tips to set up my own free Chatsoon profile';

const MINUTE_MS = 60 * 1000;
const DAY_MS = 24 * 60 * MINUTE_MS;

const LEAD_STEP1_DELAY_MS = 10 * MINUTE_MS;
/** Step 2 fires 2 days after step 1; step 3 fires 7 days after step 1 (5 more days after step 2). */
const LEAD_STEP2_DELAY_MS = 2 * DAY_MS;
const LEAD_STEP3_DELAY_MS = 5 * DAY_MS;

/** Nudge 1 fires 1 day after signup; nudge 2 fires 3 days after signup (2 more days after nudge 1). */
const NUDGE1_DELAY_MS = DAY_MS;
const NUDGE2_DELAY_MS = 2 * DAY_MS;

/** Rows handled per half, per scheduled run. Plenty for how little traffic either sequence expects. */
const SEQUENCE_BATCH_LIMIT = 50;

const lowerEmail = (value: string) => value.trim().toLowerCase();

/** True when a Chatsoon account already exists for `email` (case-insensitive). */
async function userExistsWithEmail(db: DB, email: string): Promise<boolean> {
  const [row] = await db
    .select({ id: users.id })
    .from(users)
    .where(sql`lower(${users.email}) = ${email}`)
    .limit(1);
  return !!row;
}

/**
 * Called after a successful web Connect form submission (routes/public.ts) when the visitor ticked
 * the tips checkbox. A no-op unless every condition holds: no Chatsoon account already has this
 * email, and no lead row exists yet. `onConflictDoNothing` alone gets every rule the product wants
 * for free - never re-subscribing someone who unsubscribed, and never resetting an active lead's
 * schedule - because both just mean "a row is already there, leave it exactly as it is".
 */
export async function maybeCreateLead(env: Env, db: DB, email: string, now = Date.now()): Promise<void> {
  const normalized = lowerEmail(email);
  if (await userExistsWithEmail(db, normalized)) return;

  await db
    .insert(emailLeads)
    .values({
      email: normalized,
      consentAt: new Date(now),
      consentSource: 'connect_form',
      consentText: TIPS_CONSENT_TEXT,
      step: 0,
      nextSendAt: new Date(now + LEAD_STEP1_DELAY_MS),
    })
    .onConflictDoNothing();
}

/**
 * Called once, when a user's profile is first created (routes/profile.ts, onboarding). Starts the
 * new-account nudge sequence and stops any lead sequence still running for this same email - from
 * here on the account gets nudges, not lead emails, even if the two are for the same address.
 */
export async function startTipsNudges(db: DB, userId: string, email: string, now = Date.now()): Promise<void> {
  const normalized = lowerEmail(email);
  // The App Store / Play review account and the seeded demo+*@chatsoon.app accounts never get tips.
  if (isReviewerEmail(normalized) || /^demo\+[^@]*@chatsoon\.app$/.test(normalized)) return;
  await db.batch([
    db.insert(emailPrefs).values({ userId, nudgeStep: 0, nextNudgeAt: new Date(now + NUDGE1_DELAY_MS) }).onConflictDoNothing(),
    db
      .update(emailLeads)
      .set({ convertedAt: new Date(now), nextSendAt: null })
      .where(and(eq(emailLeads.email, normalized), isNull(emailLeads.convertedAt))),
  ]);
}

/** GET /me's `tipsEmails`: true unless the account opted out. No row yet reads as opted in (the default). */
export async function tipsEmailsEnabled(db: DB, userId: string): Promise<boolean> {
  const [row] = await db.select({ optOutAt: emailPrefs.tipsOptOutAt }).from(emailPrefs).where(eq(emailPrefs.userId, userId)).limit(1);
  return !row?.optOutAt;
}

/**
 * PUT /me/email-prefs and the one-click unsubscribe link both funnel through here. Upserts because a
 * user can opt out before ever completing onboarding (email_prefs is otherwise only created at
 * profile creation, startTipsNudges above) - `onConflictDoNothing` there then leaves the opt-out in
 * place instead of restarting a nudge schedule the user already declined.
 */
export async function setTipsEmailsEnabled(db: DB, userId: string, enabled: boolean, now = Date.now()): Promise<void> {
  if (enabled) {
    await db.update(emailPrefs).set({ tipsOptOutAt: null }).where(eq(emailPrefs.userId, userId));
    return;
  }
  await db
    .insert(emailPrefs)
    .values({ userId, tipsOptOutAt: new Date(now) })
    .onConflictDoUpdate({ target: emailPrefs.userId, set: { tipsOptOutAt: new Date(now) } });
}

/** Marks a lead unsubscribed. Idempotent: a second call on an already-unsubscribed row changes nothing. */
async function unsubscribeLead(db: DB, email: string, now: number): Promise<void> {
  await db
    .update(emailLeads)
    .set({ unsubscribedAt: new Date(now) })
    .where(and(eq(emailLeads.email, email), isNull(emailLeads.unsubscribedAt)));
}

/**
 * POST /email/unsubscribe (routes/email.ts), after the token verifies. `id` is the lead email, the
 * user id, or (issue #11) the lowercased invitee email a referral invite token names.
 */
export async function unsubscribeByToken(db: DB, kind: 'lead' | 'user' | 'invite', id: string, now = Date.now()): Promise<void> {
  if (kind === 'lead') await unsubscribeLead(db, id, now);
  else if (kind === 'invite') await suppressInviteEmail(db, id, now);
  else await setTipsEmailsEnabled(db, id, false, now);
}

/** True when a profile has nothing worth nudging about yet: no photo, no headline, and no links at all. */
function profileIncomplete(profile: Awaited<ReturnType<typeof findProfileByUserId>>): boolean {
  if (!profile) return true;
  if (!profile.avatarKey || !profile.headline) return true;
  return Object.keys(parseLinks(profile.links)).length === 0;
}

/**
 * One due lead row: re-checks whether an account now exists for this email (someone could have
 * signed up between when the row became due and now), converting and stopping if so; otherwise
 * sends the next step's email and advances the schedule, or clears it after step 3.
 */
async function processDueLead(env: Env, db: DB, lead: EmailLeadRow, now: number): Promise<void> {
  if (await userExistsWithEmail(db, lead.email)) {
    await db.update(emailLeads).set({ convertedAt: new Date(now), nextSendAt: null }).where(eq(emailLeads.email, lead.email));
    return;
  }

  const step = ((lead.step ?? 0) + 1) as 1 | 2 | 3;
  const token = await unsubscribeToken(env, 'lead', lead.email);
  const unsubUrl = unsubscribeUrl(env, token);
  const msg = leadStepEmail(step, `${env.WEB_ORIGIN}/sign-in`, unsubUrl);

  await sendEmail(env, {
    to: lead.email,
    subject: msg.subject,
    text: msg.text,
    html: msg.html,
    headers: listUnsubscribeHeaders(unsubUrl),
  });

  const nextSendAt = step === 1 ? new Date(now + LEAD_STEP2_DELAY_MS) : step === 2 ? new Date(now + LEAD_STEP3_DELAY_MS) : null;
  await db.update(emailLeads).set({ step, nextSendAt }).where(eq(emailLeads.email, lead.email));
}

/**
 * One due user row: nudge 1 only sends when the profile still looks unfinished (otherwise it's
 * skipped, but the sequence still advances to nudge 2's schedule); nudge 2 always sends and always
 * ends the sequence. Never includes the account's display name - only its own profile link.
 */
async function processDueNudge(env: Env, db: DB, pref: EmailPrefsRow, now: number): Promise<void> {
  const [user] = await db.select({ email: users.email }).from(users).where(eq(users.id, pref.userId)).limit(1);
  if (!user) {
    // The account is gone; email_prefs should already have been removed with it (lib/account.ts),
    // but guard against a leftover row rather than emailing nobody forever.
    await db.delete(emailPrefs).where(eq(emailPrefs.userId, pref.userId));
    return;
  }

  const step = ((pref.nudgeStep ?? 0) + 1) as 1 | 2;
  const profile = await findProfileByUserId(db, pref.userId);

  if (step === 1) {
    if (profileIncomplete(profile)) {
      const token = await unsubscribeToken(env, 'user', pref.userId);
      const unsubUrl = unsubscribeUrl(env, token);
      const msg = nudgeEmail(1, `${env.WEB_ORIGIN}/profile-edit`, unsubUrl);
      await sendEmail(env, {
        to: user.email,
        subject: msg.subject,
        text: msg.text,
        html: msg.html,
        headers: listUnsubscribeHeaders(unsubUrl),
      });
    }
    await db.update(emailPrefs).set({ nudgeStep: 1, nextNudgeAt: new Date(now + NUDGE2_DELAY_MS) }).where(eq(emailPrefs.userId, pref.userId));
    return;
  }

  // Step 2: always sends (when there's a profile and slug to link to) and always ends the sequence.
  if (profile) {
    const token = await unsubscribeToken(env, 'user', pref.userId);
    const unsubUrl = unsubscribeUrl(env, token);
    const msg = nudgeEmail(2, profileUrl(profile.slug), unsubUrl);
    await sendEmail(env, {
      to: user.email,
      subject: msg.subject,
      text: msg.text,
      html: msg.html,
      headers: listUnsubscribeHeaders(unsubUrl),
    });
  }
  await db.update(emailPrefs).set({ nudgeStep: 2, nextNudgeAt: null }).where(eq(emailPrefs.userId, pref.userId));
}

export interface SequenceRunResult {
  leadsProcessed: number;
  leadsFailed: number;
  nudgesProcessed: number;
  nudgesFailed: number;
}

/**
 * The scheduled job (wrangler.jsonc `triggers.crons`, wired up in index.ts's `scheduled` export
 * alongside `runDueDeletions`, in its own `waitUntil` so a failure here never affects deletions or
 * vice versa). Each row runs in its own try/catch, same as `runDueDeletions`.
 */
export async function runEmailSequences(env: Env, now: number): Promise<SequenceRunResult> {
  const db = getDb(env);
  const result: SequenceRunResult = { leadsProcessed: 0, leadsFailed: 0, nudgesProcessed: 0, nudgesFailed: 0 };

  const dueLeads = await db
    .select()
    .from(emailLeads)
    .where(and(lte(emailLeads.nextSendAt, new Date(now)), isNull(emailLeads.unsubscribedAt), isNull(emailLeads.convertedAt)))
    .limit(SEQUENCE_BATCH_LIMIT);
  for (const lead of dueLeads) {
    try {
      await processDueLead(env, db, lead, now);
      result.leadsProcessed++;
    } catch (err) {
      result.leadsFailed++;
      console.error(`runEmailSequences: lead ${lead.email} failed`, err);
    }
  }

  const dueNudges = await db
    .select()
    .from(emailPrefs)
    .where(and(lte(emailPrefs.nextNudgeAt, new Date(now)), isNull(emailPrefs.tipsOptOutAt)))
    .limit(SEQUENCE_BATCH_LIMIT);
  for (const pref of dueNudges) {
    try {
      await processDueNudge(env, db, pref, now);
      result.nudgesProcessed++;
    } catch (err) {
      result.nudgesFailed++;
      console.error(`runEmailSequences: nudge for user ${pref.userId} failed`, err);
    }
  }

  return result;
}
