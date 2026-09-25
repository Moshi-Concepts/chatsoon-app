import { SUPPORT_EMAIL, type ApiErrorBody, type Me } from '@chatsoon/shared';
import { env } from 'cloudflare:workers';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { emailLeads, emailPrefs } from '../src/db/schema';
import type { Env } from '../src/env';
import { getDb } from '../src/lib/db';
import { capturedEmails, sendEmail } from '../src/lib/email';
import { runEmailSequences, TIPS_CONSENT_TEXT } from '../src/lib/sequences';
import { TURNSTILE_VERIFY_URL } from '../src/lib/turnstile';
import { unsubscribeToken } from '../src/lib/unsubscribe';
import { call, signIn, signUpWithProfile } from './helpers';

// Issue #7 (API half): the lead nurture sequence for Connect-form visitors who opt in, the
// new-account nudge sequence, the shared unsubscribe endpoint, and sendEmail's new `headers` option
// that both sequences rely on for the RFC 8058 List-Unsubscribe pair.

const db = getDb(env);

/** A copy of env with some values replaced, same pattern as auth.test.ts. */
const withEnv = (overrides: Partial<Env>): Env => ({ ...env, ...overrides });

// Connect form posts need Turnstile to pass; stubbed the same way public.test.ts does.
const realFetch = globalThis.fetch;
beforeEach(() => {
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = input instanceof Request ? input.url : String(input);
    if (url === TURNSTILE_VERIFY_URL) return Response.json({ success: true });
    return realFetch(input, init);
  });
});
afterEach(() => vi.restoreAllMocks());

const connect = (slug: string, overrides: Record<string, unknown> = {}) =>
  call(`/id/${slug}/connect`, {
    method: 'POST',
    json: {
      name: 'Larry Lead',
      contact: 'larry-lead@example.com',
      turnstileToken: 'XXXX.DUMMY.TOKEN.XXXX',
      ...overrides,
    },
  });

async function leadRow(email: string) {
  const [row] = await db.select().from(emailLeads).where(eq(emailLeads.email, email.toLowerCase())).limit(1);
  return row ?? null;
}

async function prefsRow(userId: string) {
  const [row] = await db.select().from(emailPrefs).where(eq(emailPrefs.userId, userId)).limit(1);
  return row ?? null;
}

async function me(token: string): Promise<Me> {
  const res = await call('/me', { token });
  expect(res.status).toBe(200);
  return (await res.json()) as Me;
}

const emailsTo = (to: string) => capturedEmails().filter((m) => m.to === to);

async function putAvatar(userId: string) {
  const key = `u/${userId}/avatar/${crypto.randomUUID()}.jpg`;
  await env.FILES.put(key, new Uint8Array([1, 2, 3]), { httpMetadata: { contentType: 'image/jpeg' } });
  return key;
}

// ---------------------------------------------------------------------------
// sendEmail's new `headers` option
// ---------------------------------------------------------------------------

describe('sendEmail headers', () => {
  it('passes custom headers through to Resend', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(JSON.stringify({ id: 'email_1' }), { status: 200 }));
    const resendEnv = withEnv({ EMAIL_PROVIDER: 'resend', RESEND_API_KEY: 're_test_key' });

    await sendEmail(resendEnv, {
      to: 'headers-test@example.com',
      subject: 'Test',
      text: 'Body',
      headers: {
        'List-Unsubscribe': '<https://api.chatsoon.app/email/unsubscribe?token=abc>, <mailto:hello@chatsoon.app?subject=unsubscribe>',
        'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
      },
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, init] = fetchMock.mock.calls[0]!;
    const body = JSON.parse(init?.body as string);
    expect(body.headers).toEqual({
      'List-Unsubscribe': '<https://api.chatsoon.app/email/unsubscribe?token=abc>, <mailto:hello@chatsoon.app?subject=unsubscribe>',
      'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
    });
  });

  it('omits the field entirely when no headers are given (unchanged behaviour)', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(JSON.stringify({ id: 'email_2' }), { status: 200 }));
    const resendEnv = withEnv({ EMAIL_PROVIDER: 'resend', RESEND_API_KEY: 're_test_key' });

    await sendEmail(resendEnv, { to: 'no-headers@example.com', subject: 'Test', text: 'Body' });

    const [, init] = fetchMock.mock.calls[0]!;
    const body = JSON.parse(init?.body as string);
    expect(body.headers).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// POST /id/:slug/connect tipsOptIn -> email_leads
// ---------------------------------------------------------------------------

describe('POST /id/:slug/connect tipsOptIn', () => {
  it('creates a lead only when tipsOptIn is true', async () => {
    const owner = await signUpWithProfile('lead-owner-optin@example.com', 'Lead Owner Optin');
    const email = 'opt-in-lead@example.com';

    expect((await connect(owner.slug, { contact: email, tipsOptIn: true })).status).toBe(201);

    const row = await vi.waitFor(async () => {
      const r = await leadRow(email);
      expect(r).not.toBeNull();
      return r!;
    });
    expect(row.step).toBe(0);
    expect(row.consentSource).toBe('connect_form');
    expect(row.consentText).toBe(TIPS_CONSENT_TEXT);
    expect(row.consentText).toBe('Email me tips to set up my own free Chatsoon profile');
    expect(row.unsubscribedAt).toBeNull();
    expect(row.convertedAt).toBeNull();
    const dueInMs = row.nextSendAt!.getTime() - Date.now();
    expect(dueInMs).toBeGreaterThan(9 * 60 * 1000);
    expect(dueInMs).toBeLessThan(11 * 60 * 1000);
  });

  it('creates no lead when tipsOptIn is omitted or explicitly false', async () => {
    const owner = await signUpWithProfile('lead-owner-noopt@example.com', 'Lead Owner Noopt');

    const noField = 'no-opt-in-lead-a@example.com';
    expect((await connect(owner.slug, { contact: noField })).status).toBe(201);

    const explicitFalse = 'no-opt-in-lead-b@example.com';
    expect((await connect(owner.slug, { contact: explicitFalse, tipsOptIn: false })).status).toBe(201);

    // Give any stray background task a moment, same pattern as public.test.ts's flood test.
    await new Promise((r) => setTimeout(r, 100));
    expect(await leadRow(noField)).toBeNull();
    expect(await leadRow(explicitFalse)).toBeNull();
  });

  it('creates no lead when the email already belongs to a Chatsoon account', async () => {
    const owner = await signUpWithProfile('lead-owner-existing@example.com', 'Lead Owner Existing');
    const existingEmail = 'already-has-an-account@example.com';
    await signIn(existingEmail);

    expect((await connect(owner.slug, { contact: existingEmail, tipsOptIn: true })).status).toBe(201);
    await new Promise((r) => setTimeout(r, 100));
    expect(await leadRow(existingEmail)).toBeNull();
  });

  it('never re-subscribes an unsubscribed lead, and never resets an already-scheduled lead', async () => {
    const owner = await signUpWithProfile('lead-owner-resub@example.com', 'Lead Owner Resub');
    const email = 'resubscribe-me@example.com';

    expect((await connect(owner.slug, { contact: email, tipsOptIn: true })).status).toBe(201);
    await vi.waitFor(async () => expect(await leadRow(email)).not.toBeNull());

    // An active lead's schedule must not be reset by connecting again.
    const farFuture = new Date(Date.now() + 999_000);
    await db.update(emailLeads).set({ nextSendAt: farFuture }).where(eq(emailLeads.email, email));
    expect((await connect(owner.slug, { contact: email, tipsOptIn: true, name: 'Larry Again' })).status).toBe(201);
    await new Promise((r) => setTimeout(r, 100));
    expect((await leadRow(email))!.nextSendAt!.getTime()).toBe(farFuture.getTime());

    // Once unsubscribed, connecting again must never re-subscribe.
    await db.update(emailLeads).set({ unsubscribedAt: new Date() }).where(eq(emailLeads.email, email));
    expect((await connect(owner.slug, { contact: email, tipsOptIn: true, name: 'Larry Once More' })).status).toBe(201);
    await new Promise((r) => setTimeout(r, 100));
    expect((await leadRow(email))!.unsubscribedAt).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// runEmailSequences: lead sequence
// ---------------------------------------------------------------------------

describe('runEmailSequences: lead sequence', () => {
  it('sends step 1 once due (with the unsubscribe link and header), advances, then stops after step 3', async () => {
    const owner = await signUpWithProfile('lead-job-owner@example.com', 'Lead Job Owner');
    const email = 'lead-job-sequence@example.com';
    expect((await connect(owner.slug, { contact: email, tipsOptIn: true })).status).toBe(201);
    await vi.waitFor(async () => expect(await leadRow(email)).not.toBeNull());

    // Not due yet: a run right now must send nothing.
    await runEmailSequences(env, Date.now());
    expect(emailsTo(email)).toHaveLength(0);

    const now = Date.now();
    await db.update(emailLeads).set({ nextSendAt: new Date(now - 1000) }).where(eq(emailLeads.email, email));
    await runEmailSequences(env, now);

    let mails = emailsTo(email);
    expect(mails).toHaveLength(1);
    expect(mails[0]!.subject).toBe('Create your free Chatsoon profile');
    expect(mails[0]!.text).toContain(`${env.WEB_ORIGIN}/sign-in`);
    expect(mails[0]!.text).toMatch(/Unsubscribe: .*\/email\/unsubscribe\?token=/);
    expect(mails[0]!.text).toContain(`Chatsoon, by Moshi Concepts Inc. · ${SUPPORT_EMAIL}`);
    expect(mails[0]!.headers?.['List-Unsubscribe']).toMatch(
      new RegExp(`^<${env.API_ORIGIN.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\\\$&')}/email/unsubscribe\\?token=.+>, <mailto:${SUPPORT_EMAIL}\\?subject=unsubscribe>$`),
    );
    expect(mails[0]!.headers?.['List-Unsubscribe-Post']).toBe('List-Unsubscribe=One-Click');

    let row = await leadRow(email);
    expect(row!.step).toBe(1);
    expect(row!.nextSendAt).not.toBeNull();
    expect((row!.nextSendAt!.getTime() - now) / (24 * 60 * 60 * 1000)).toBeCloseTo(2, 1);

    // Step 2, forced due.
    await db.update(emailLeads).set({ nextSendAt: new Date(now - 1000) }).where(eq(emailLeads.email, email));
    await runEmailSequences(env, now);
    mails = emailsTo(email);
    expect(mails).toHaveLength(2);
    expect(mails[1]!.subject).toBe('Your digital business card, ready in a minute');
    row = await leadRow(email);
    expect(row!.step).toBe(2);
    expect((row!.nextSendAt!.getTime() - now) / (24 * 60 * 60 * 1000)).toBeCloseTo(5, 1);

    // Step 3, forced due: the sequence ends here.
    await db.update(emailLeads).set({ nextSendAt: new Date(now - 1000) }).where(eq(emailLeads.email, email));
    await runEmailSequences(env, now);
    mails = emailsTo(email);
    expect(mails).toHaveLength(3);
    expect(mails[2]!.subject).toBe('Last reminder: your free Chatsoon profile');
    row = await leadRow(email);
    expect(row!.step).toBe(3);
    expect(row!.nextSendAt).toBeNull();

    // No `next_send_at` left, so running again sends nothing more (checked at the real current time,
    // not jumped forward, so it doesn't also fire every other test's still-pending, not-yet-due row).
    await runEmailSequences(env, Date.now());
    expect(emailsTo(email)).toHaveLength(3);
  });

  it('stops the sequence once the lead converts (an account now exists for that email)', async () => {
    const owner = await signUpWithProfile('lead-convert-owner@example.com', 'Lead Convert Owner');
    const email = 'convert-mid-sequence@example.com';
    expect((await connect(owner.slug, { contact: email, tipsOptIn: true })).status).toBe(201);
    await vi.waitFor(async () => expect(await leadRow(email)).not.toBeNull());

    // The lead's own address signs up and finishes onboarding: startTipsNudges converts the lead.
    await signUpWithProfile(email, 'Convert Mid Sequence');
    await vi.waitFor(async () => {
      const row = await leadRow(email);
      expect(row?.convertedAt).not.toBeNull();
      expect(row?.nextSendAt).toBeNull();
    });

    await runEmailSequences(env, Date.now());
    expect(emailsTo(email).filter((m) => m.subject.includes('Chatsoon profile'))).toHaveLength(0);
  });

  it("also converts a due lead when the job notices an account now exists for its email (a race with the lead's own scheduled send)", async () => {
    const owner = await signUpWithProfile('lead-race-owner@example.com', 'Lead Race Owner');
    const email = 'race-condition-lead@example.com';
    expect((await connect(owner.slug, { contact: email, tipsOptIn: true })).status).toBe(201);
    await vi.waitFor(async () => expect(await leadRow(email)).not.toBeNull());

    // An account now exists for this email (signed in, no profile yet), but nothing told the lead
    // row about it directly - only runEmailSequences's own re-check should catch this.
    await signIn(email);
    await db.update(emailLeads).set({ nextSendAt: new Date(Date.now() - 1000) }).where(eq(emailLeads.email, email));

    await runEmailSequences(env, Date.now());
    // `email` also received its own sign-in code from `signIn` above; only the tips step matters here.
    expect(emailsTo(email).filter((m) => m.subject.includes('Chatsoon profile'))).toHaveLength(0);
    const row = await leadRow(email);
    expect(row!.convertedAt).not.toBeNull();
    expect(row!.nextSendAt).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// runEmailSequences: new-account nudges
// ---------------------------------------------------------------------------

describe('runEmailSequences: new-account nudges', () => {
  it('starts email_prefs on onboarding, with next_nudge_at about 24h out', async () => {
    const before = Date.now();
    const u = await signUpWithProfile('nudge-starts@example.com', 'Nudge Starts');
    const row = await vi.waitFor(async () => {
      const r = await prefsRow(u.userId);
      expect(r).not.toBeNull();
      return r!;
    });
    expect(row.nudgeStep).toBe(0);
    expect(row.tipsOptOutAt).toBeNull();
    const hoursAhead = (row.nextNudgeAt!.getTime() - before) / (60 * 60 * 1000);
    expect(hoursAhead).toBeGreaterThan(23.9);
    expect(hoursAhead).toBeLessThan(24.1);
  });

  it('skips nudge 1 for an already-complete profile, but still advances to the nudge 2 schedule', async () => {
    const displayName = 'Nadia Nudge Complete';
    const u = await signUpWithProfile('nudge-complete@example.com', displayName);
    await vi.waitFor(async () => expect(await prefsRow(u.userId)).not.toBeNull());

    const avatarKey = await putAvatar(u.userId);
    const putRes = await call('/me/profile', {
      method: 'PUT',
      token: u.token,
      json: { displayName, headline: 'Building things people remember', avatarKey, links: { x: 'nadia' } },
    });
    expect(putRes.status).toBe(200);

    const now = Date.now();
    await db.update(emailPrefs).set({ nextNudgeAt: new Date(now - 1000) }).where(eq(emailPrefs.userId, u.userId));
    await runEmailSequences(env, now);

    expect(emailsTo('nudge-complete@example.com').filter((m) => m.subject === 'Finish your Chatsoon profile')).toHaveLength(0);
    let row = await prefsRow(u.userId);
    expect(row!.nudgeStep).toBe(1);
    expect(row!.nextNudgeAt).not.toBeNull();
    expect((row!.nextNudgeAt!.getTime() - now) / (24 * 60 * 60 * 1000)).toBeCloseTo(2, 1);

    // Nudge 2 always sends, with the profile link and no display name anywhere in it.
    await db.update(emailPrefs).set({ nextNudgeAt: new Date(now - 1000) }).where(eq(emailPrefs.userId, u.userId));
    await runEmailSequences(env, now);
    const mails = emailsTo('nudge-complete@example.com').filter((m) => m.subject === 'Put your Chatsoon link in your bio');
    expect(mails).toHaveLength(1);
    expect(mails[0]!.text).not.toContain(displayName);
    expect(mails[0]!.html).not.toContain(displayName);
    expect(mails[0]!.text).toContain(`chatsoon.app/id/${u.slug}`);
    expect(mails[0]!.text).toMatch(/Unsubscribe: .*\/email\/unsubscribe\?token=/);

    row = await prefsRow(u.userId);
    expect(row!.nudgeStep).toBe(2);
    expect(row!.nextNudgeAt).toBeNull();

    // Sequence is over: running again (right away, so no other test's real schedule is disturbed)
    // must not send a second nudge 2.
    await runEmailSequences(env, Date.now());
    expect(emailsTo('nudge-complete@example.com').filter((m) => m.subject === 'Put your Chatsoon link in your bio')).toHaveLength(1);
  });

  it('sends nudge 1 for an incomplete profile, with no display name and the unsubscribe header', async () => {
    const displayName = 'Ollie Incomplete';
    const u = await signUpWithProfile('nudge-incomplete@example.com', displayName);
    await vi.waitFor(async () => expect(await prefsRow(u.userId)).not.toBeNull());

    await db.update(emailPrefs).set({ nextNudgeAt: new Date(Date.now() - 1000) }).where(eq(emailPrefs.userId, u.userId));
    await runEmailSequences(env, Date.now());

    const mails = emailsTo('nudge-incomplete@example.com').filter((m) => m.subject === 'Finish your Chatsoon profile');
    expect(mails).toHaveLength(1);
    expect(mails[0]!.text).not.toContain(displayName);
    expect(mails[0]!.text).toContain(`${env.WEB_ORIGIN}/profile-edit`);
    expect(mails[0]!.headers?.['List-Unsubscribe-Post']).toBe('List-Unsubscribe=One-Click');
  });

  it('sends no nudges once opted out', async () => {
    const u = await signUpWithProfile('nudge-opted-out@example.com', 'Nudge Opted Out');
    await vi.waitFor(async () => expect(await prefsRow(u.userId)).not.toBeNull());

    expect((await call('/me/email-prefs', { method: 'PUT', token: u.token, json: { tipsEmails: false } })).status).toBe(200);
    await db.update(emailPrefs).set({ nextNudgeAt: new Date(Date.now() - 1000) }).where(eq(emailPrefs.userId, u.userId));

    await runEmailSequences(env, Date.now());
    // The account's own sign-in code also landed here (from `signUpWithProfile`); only the nudge matters.
    expect(emailsTo('nudge-opted-out@example.com').filter((m) => m.subject === 'Finish your Chatsoon profile')).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// GET /me tipsEmails, PUT /me/email-prefs
// ---------------------------------------------------------------------------

describe('GET /me tipsEmails and PUT /me/email-prefs', () => {
  it('defaults to true, and the toggle flips it both ways', async () => {
    const u = await signIn('email-prefs-toggle@example.com');
    expect((await me(u.token)).tipsEmails).toBe(true);

    const off = await call('/me/email-prefs', { method: 'PUT', token: u.token, json: { tipsEmails: false } });
    expect(off.status).toBe(200);
    expect(await off.json()).toEqual({ tipsEmails: false });
    expect((await me(u.token)).tipsEmails).toBe(false);

    const on = await call('/me/email-prefs', { method: 'PUT', token: u.token, json: { tipsEmails: true } });
    expect(await on.json()).toEqual({ tipsEmails: true });
    expect((await me(u.token)).tipsEmails).toBe(true);
  });

  it('works before onboarding, and the opt-out survives it (no nudge schedule is started)', async () => {
    const u = await signIn('email-prefs-early-optout@example.com');
    expect((await call('/me/email-prefs', { method: 'PUT', token: u.token, json: { tipsEmails: false } })).status).toBe(200);

    const putRes = await call('/me/profile', { method: 'PUT', token: u.token, json: { displayName: 'Early Opt Out' } });
    expect(putRes.status).toBe(200);

    await new Promise((r) => setTimeout(r, 100));
    const row = await prefsRow(u.userId);
    expect(row).not.toBeNull();
    expect(row!.tipsOptOutAt).not.toBeNull();
    // onConflictDoNothing left the pre-existing opt-out row alone: no nudge schedule was started.
    expect(row!.nextNudgeAt).toBeNull();
    expect((await me(u.token)).tipsEmails).toBe(false);
  });

  it('requires a session', async () => {
    const res = await call('/me/email-prefs', { method: 'PUT', json: { tipsEmails: false } });
    expect(res.status).toBe(401);
  });
});

// ---------------------------------------------------------------------------
// GET/POST /email/unsubscribe
// ---------------------------------------------------------------------------

describe('GET/POST /email/unsubscribe', () => {
  it('GET redirects to the web unsubscribe page and never unsubscribes', async () => {
    const owner = await signUpWithProfile('unsub-get-owner@example.com', 'Unsub Get Owner');
    const email = 'unsub-get-lead@example.com';
    expect((await connect(owner.slug, { contact: email, tipsOptIn: true })).status).toBe(201);
    await vi.waitFor(async () => expect(await leadRow(email)).not.toBeNull());

    const token = await unsubscribeToken(env, 'lead', email);
    const res = await call(`/email/unsubscribe?token=${encodeURIComponent(token)}`, { redirect: 'manual' });
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe(`${env.WEB_ORIGIN}/unsubscribe?token=${token}`);

    expect((await leadRow(email))!.unsubscribedAt).toBeNull();
  });

  it('POST unsubscribes a lead idempotently, accepting a form-encoded RFC 8058 body', async () => {
    const owner = await signUpWithProfile('unsub-post-owner@example.com', 'Unsub Post Owner');
    const email = 'unsub-post-lead@example.com';
    expect((await connect(owner.slug, { contact: email, tipsOptIn: true })).status).toBe(201);
    await vi.waitFor(async () => expect(await leadRow(email)).not.toBeNull());

    const token = await unsubscribeToken(env, 'lead', email);
    const res = await call(`/email/unsubscribe?token=${encodeURIComponent(token)}`, {
      method: 'POST',
      body: new URLSearchParams({ 'List-Unsubscribe': 'One-Click' }),
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect((await leadRow(email))!.unsubscribedAt).not.toBeNull();

    // Idempotent: a second POST (JSON this time) still succeeds and changes nothing further.
    const second = await call(`/email/unsubscribe?token=${encodeURIComponent(token)}`, { method: 'POST', json: {} });
    expect(second.status).toBe(200);

    // And it actually stops the sequence: a forced-due run sends nothing.
    await db.update(emailLeads).set({ nextSendAt: new Date(Date.now() - 1000) }).where(eq(emailLeads.email, email));
    await runEmailSequences(env, Date.now());
    expect(emailsTo(email)).toHaveLength(0);
  });

  it('POST with a user token opts that account out of tips emails', async () => {
    const u = await signIn('unsub-user@example.com');
    const token = await unsubscribeToken(env, 'user', u.userId);

    const res = await call(`/email/unsubscribe?token=${encodeURIComponent(token)}`, { method: 'POST', json: {} });
    expect(res.status).toBe(200);
    expect((await me(u.token)).tipsEmails).toBe(false);
  });

  it('gives 400 invalid_token for an unknown, malformed or tampered token', async () => {
    for (const bad of ['not-a-real-token', '', 'AA.BB.CC']) {
      const res = await call(`/email/unsubscribe?token=${encodeURIComponent(bad)}`, { method: 'POST', json: {} });
      expect(res.status, bad).toBe(400);
      expect(((await res.json()) as ApiErrorBody).error.code).toBe('invalid_token');
    }

    const valid = await unsubscribeToken(env, 'lead', 'someone@example.com');
    const tampered = valid.slice(0, -1) + (valid.at(-1) === 'A' ? 'B' : 'A');
    const res = await call(`/email/unsubscribe?token=${encodeURIComponent(tampered)}`, { method: 'POST', json: {} });
    expect(res.status).toBe(400);
  });
});

// ---------------------------------------------------------------------------
// Account deletion removes both tables
// ---------------------------------------------------------------------------

describe('account deletion', () => {
  it('removes the email_leads and email_prefs rows', async () => {
    const owner = await signUpWithProfile('delete-cleanup-owner@example.com', 'Delete Cleanup Owner');
    const leadEmail = 'delete-cleanup-lead@example.com';
    expect((await connect(owner.slug, { contact: leadEmail, tipsOptIn: true })).status).toBe(201);
    await vi.waitFor(async () => expect(await leadRow(leadEmail)).not.toBeNull());

    // Signing up with the lead's own email converts it and creates an email_prefs row.
    const u = await signUpWithProfile(leadEmail, 'Delete Cleanup User');
    await vi.waitFor(async () => expect(await prefsRow(u.userId)).not.toBeNull());
    expect(await leadRow(leadEmail)).not.toBeNull();

    const res = await call('/me', { method: 'DELETE', token: u.token });
    expect(res.status).toBe(204);

    expect(await prefsRow(u.userId)).toBeNull();
    expect(await leadRow(leadEmail)).toBeNull();
  });
});
