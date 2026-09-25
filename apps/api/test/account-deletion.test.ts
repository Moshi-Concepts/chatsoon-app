import { REVIEWER_EMAIL, type ApiErrorBody, type CancelDeletionByTokenResponse, type Me } from '@chatsoon/shared';
import { env } from 'cloudflare:workers';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { accountDeletions } from '../src/db/schema';
import { getDb } from '../src/lib/db';
import { runDueDeletions } from '../src/lib/deletion';
import { capturedEmails } from '../src/lib/email';
import { TURNSTILE_VERIFY_URL } from '../src/lib/turnstile';
import { call, signIn, signUpWithProfile } from './helpers';

// The one test below that posts to /id/:slug/connect needs Turnstile to pass; stubbed the same way
// public.test.ts does, so this file never depends on the network either.
const realFetch = globalThis.fetch;
beforeEach(() => {
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = input instanceof Request ? input.url : String(input);
    if (url === TURNSTILE_VERIFY_URL) return Response.json({ success: true });
    return realFetch(input, init);
  });
});
afterEach(() => vi.restoreAllMocks());

// Issue #8: POST/DELETE /me/deletion, POST /account-deletion/cancel, the effect a pending deletion has
// on the account's public presence, and the runDueDeletions scheduled job. DELETE /me (the older,
// immediate path the 1.0 native app still uses) is covered exhaustively in account.test.ts; this file
// only reconfirms it stays untouched by the new scheduling.

const db = getDb(env);

const scheduleDeletion = (token: string) => call('/me/deletion', { method: 'POST', token, json: { confirm: 'DELETE' } });
const cancelPending = (token: string) => call('/me/deletion', { method: 'DELETE', token });
const cancelByToken = (token: string) => call('/account-deletion/cancel', { method: 'POST', json: { token } });

async function me(token: string): Promise<Me> {
  const res = await call('/me', { token });
  expect(res.status).toBe(200);
  return (await res.json()) as Me;
}

async function errorCode(res: Response): Promise<string> {
  return ((await res.json()) as ApiErrorBody).error.code;
}

/** The most recent captured email to `to`, ignoring anything sent to other addresses in this run. */
function lastEmailTo(to: string) {
  return [...capturedEmails()].reverse().find((m) => m.to === to);
}

/** Every captured email to `to` with this subject, oldest first. */
function emailsTo(to: string, subject: string) {
  return capturedEmails().filter((m) => m.to === to && m.subject === subject);
}

/** Pulls the one-time cancel token out of the "scheduled" email's link. */
function tokenFromScheduledEmail(to: string): string {
  const mail = lastEmailTo(to);
  const match = mail?.text.match(/[?&]token=([^\s&]+)/);
  if (!match) throw new Error(`no cancel link found in the scheduled-deletion email to ${to}`);
  return match[1]!;
}

async function accountDeletionRow(userId: string) {
  const [row] = await db.select().from(accountDeletions).where(eq(accountDeletions.userId, userId));
  return row ?? null;
}

async function rowExists(table: string, column: string, value: string): Promise<boolean> {
  const row = await env.DB.prepare(`SELECT 1 AS one FROM "${table}" WHERE "${column}" = ? LIMIT 1`).bind(value).first();
  return row !== null;
}

describe('POST /me/deletion', () => {
  it('requires a session', async () => {
    expect((await scheduleDeletion('not-a-real-token')).status).toBe(401);
  });

  it('requires { confirm: "DELETE" }', async () => {
    const u = await signIn('deletion-confirm@example.com');
    const res = await call('/me/deletion', { method: 'POST', token: u.token, json: { confirm: 'delete' } });
    expect(res.status).toBe(400);
    expect(await errorCode(res)).toBe('bad_request');
    expect(await accountDeletionRow(u.userId)).toBeNull();
  });

  it('schedules deletion about 24h ahead and emails a cancel link', async () => {
    const email = 'deletion-schedule@example.com';
    const u = await signIn(email);
    const before = Date.now();

    const res = await scheduleDeletion(u.token);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { status: string; deleteAfter: string };
    expect(body.status).toBe('scheduled');

    const deleteAfter = new Date(body.deleteAfter).getTime();
    const hoursAhead = (deleteAfter - before) / (60 * 60 * 1000);
    expect(hoursAhead).toBeGreaterThan(23.9);
    expect(hoursAhead).toBeLessThan(24.1);

    const row = await accountDeletionRow(u.userId);
    expect(row).not.toBeNull();
    expect(row!.email).toBe(email);
    expect(row!.deleteAfter.toISOString()).toBe(body.deleteAfter);

    const mails = emailsTo(email, 'Your Chatsoon account will be deleted');
    expect(mails).toHaveLength(1);
    expect(mails[0]!.text).toContain(`${env.WEB_ORIGIN}/cancel-deletion?token=`);
    expect(mails[0]!.html).toContain('Cancel deletion');
  });

  it('is idempotent: a second call keeps the same schedule and sends no second email', async () => {
    const email = 'deletion-idempotent@example.com';
    const u = await signIn(email);

    const first = (await (await scheduleDeletion(u.token)).json()) as { deleteAfter: string };
    const second = (await (await scheduleDeletion(u.token)).json()) as { status: string; deleteAfter: string };

    expect(second.status).toBe('scheduled');
    expect(second.deleteAfter).toBe(first.deleteAfter);
    expect(emailsTo(email, 'Your Chatsoon account will be deleted')).toHaveLength(1);
  });

  it('deletes the reviewer account immediately instead of scheduling it', async () => {
    const code = env.REVIEWER_CODE!;
    const reviewer = await signIn(REVIEWER_EMAIL, code);

    const res = await scheduleDeletion(reviewer.token);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: 'deleted' });

    expect(await rowExists('users', 'id', reviewer.userId)).toBe(false);
    expect(await accountDeletionRow(reviewer.userId)).toBeNull();
    // Every old token is dead, same as DELETE /me.
    expect((await call('/me', { token: reviewer.token })).status).toBe(401);
  });
});

describe('DELETE /me/deletion', () => {
  it('requires a session', async () => {
    expect((await cancelPending('not-a-real-token')).status).toBe(401);
  });

  it('404s when nothing is pending', async () => {
    const u = await signIn('deletion-cancel-none@example.com');
    const res = await cancelPending(u.token);
    expect(res.status).toBe(404);
    expect(await errorCode(res)).toBe('not_found');
  });

  it('cancels a pending deletion, restoring the account and its public profile', async () => {
    const owner = await signUpWithProfile('deletion-cancel@example.com', 'Cancel Me');
    await scheduleDeletion(owner.token);
    expect((await call(`/id/${owner.slug}`)).status).toBe(404);

    const res = await cancelPending(owner.token);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: 'cancelled' });

    expect(await accountDeletionRow(owner.userId)).toBeNull();
    expect((await me(owner.token)).deletionScheduledFor).toBeNull();
    expect((await call(`/id/${owner.slug}`)).status).toBe(200);

    // Nothing left pending to cancel a second time.
    expect((await cancelPending(owner.token)).status).toBe(404);
  });
});

describe('POST /account-deletion/cancel', () => {
  it('cancels with a valid token and returns the masked email', async () => {
    const email = 'deletion-token-cancel@example.com';
    const owner = await signUpWithProfile(email, 'Token Cancel');
    await scheduleDeletion(owner.token);
    const token = tokenFromScheduledEmail(email);

    const res = await cancelByToken(token);
    expect(res.status).toBe(200);
    const body = (await res.json()) as CancelDeletionByTokenResponse;
    expect(body).toEqual({ status: 'cancelled', email: 'd***@example.com' });

    expect(await accountDeletionRow(owner.userId)).toBeNull();
    expect((await call(`/id/${owner.slug}`)).status).toBe(200);
  });

  it('gives 400 invalid_token for an unknown token', async () => {
    const res = await cancelByToken('not-a-real-cancel-token');
    expect(res.status).toBe(400);
    expect(await errorCode(res)).toBe('invalid_token');
  });

  it('gives 400 invalid_token for a token that was already used', async () => {
    const email = 'deletion-token-reuse@example.com';
    const owner = await signUpWithProfile(email, 'Token Reuse');
    await scheduleDeletion(owner.token);
    const token = tokenFromScheduledEmail(email);

    expect((await cancelByToken(token)).status).toBe(200);
    const second = await cancelByToken(token);
    expect(second.status).toBe(400);
    expect(await errorCode(second)).toBe('invalid_token');
  });

  it('requires a token in the body', async () => {
    const res = await call('/account-deletion/cancel', { method: 'POST', json: {} });
    expect(res.status).toBe(400);
    expect(await errorCode(res)).toBe('bad_request');
  });
});

describe('Public presence while a deletion is pending', () => {
  it('the profile page, vcard, web connect and QR scan-connect all read as not found', async () => {
    const owner = await signUpWithProfile('deletion-public@example.com', 'Public Gone');
    const scanner = await signUpWithProfile('deletion-public-scanner@example.com', 'Scanner');
    expect((await call(`/id/${owner.slug}`)).status).toBe(200);

    await scheduleDeletion(owner.token);

    expect((await call(`/id/${owner.slug}`)).status).toBe(404);
    expect((await call(`/id/${owner.slug}/vcard`)).status).toBe(404);
    const connectRes = await call(`/id/${owner.slug}/connect`, {
      method: 'POST',
      json: { name: 'Someone', contact: 'someone@example.com', turnstileToken: 'x' },
    });
    expect(connectRes.status).toBe(404);
    const scanRes = await call('/connections/scan', { method: 'POST', token: scanner.token, json: { slug: owner.slug } });
    expect(scanRes.status).toBe(404);

    await cancelPending(owner.token);
    expect((await call(`/id/${owner.slug}`)).status).toBe(200);
  });

  it('drops out of GET /_pages/profile and the sitemap', async () => {
    const owner = await signUpWithProfile('deletion-pages@example.com', 'Pages Gone');
    const putRes = await call('/me/profile', {
      method: 'PUT',
      token: owner.token,
      json: { displayName: 'Pages Gone', headline: 'Something worth reading', searchVisible: true },
    });
    expect(putRes.status).toBe(200);

    const pagesHeaders = { 'x-pages-key': env.PAGES_SHARED_SECRET! };
    const before = await call(`/_pages/profile/${owner.slug}`, { headers: pagesHeaders });
    expect((await before.json())).toMatchObject({ status: 'ok' });
    const sitemapBefore = (await (await call('/_pages/sitemap', { headers: pagesHeaders })).json()) as {
      profiles: { slug: string }[];
    };
    expect(sitemapBefore.profiles.map((p) => p.slug)).toContain(owner.slug);

    await scheduleDeletion(owner.token);

    const after = await call(`/_pages/profile/${owner.slug}`, { headers: pagesHeaders });
    expect(await after.json()).toEqual({ status: 'not_found' });
    const sitemapAfter = (await (await call('/_pages/sitemap', { headers: pagesHeaders })).json()) as {
      profiles: { slug: string }[];
    };
    expect(sitemapAfter.profiles.map((p) => p.slug)).not.toContain(owner.slug);
  });

  it("does not affect the owner's own GET /me and PUT /me/profile", async () => {
    const owner = await signUpWithProfile('deletion-owner-still-works@example.com', 'Still Me');
    await scheduleDeletion(owner.token);

    const body = await me(owner.token);
    expect(body.profile?.slug).toBe(owner.slug);
    expect(body.deletionScheduledFor).not.toBeNull();

    const put = await call('/me/profile', { method: 'PUT', token: owner.token, json: { displayName: 'Still Me Edited' } });
    expect(put.status).toBe(200);
  });
});

describe('GET /me deletionScheduledFor', () => {
  it('is null with no pending deletion, and an ISO timestamp once one is scheduled', async () => {
    const u = await signIn('deletion-me-field@example.com');
    expect((await me(u.token)).deletionScheduledFor).toBeNull();

    const scheduled = (await (await scheduleDeletion(u.token)).json()) as { deleteAfter: string };
    expect((await me(u.token)).deletionScheduledFor).toBe(scheduled.deleteAfter);
  });
});

describe('DELETE /me (unchanged, immediate)', () => {
  it('still deletes immediately, with no schedule and no cancel email', async () => {
    const email = 'delete-me-still-immediate@example.com';
    const u = await signIn(email);

    const res = await call('/me', { method: 'DELETE', token: u.token });
    expect(res.status).toBe(204);
    expect(await rowExists('users', 'id', u.userId)).toBe(false);
    expect(await accountDeletionRow(u.userId)).toBeNull();
    expect(emailsTo(email, 'Your Chatsoon account will be deleted')).toHaveLength(0);
    expect(emailsTo(email, 'Your Chatsoon account has been deleted')).toHaveLength(0);
  });
});

describe('runDueDeletions', () => {
  it('finishes only due rows: deletes the account and sends the final email, leaving other schedules alone', async () => {
    const dueEmail = 'due-deletion@example.com';
    const notDueEmail = 'not-due-deletion@example.com';
    const due = await signUpWithProfile(dueEmail, 'Due Person');
    const notDue = await signUpWithProfile(notDueEmail, 'Not Due Person');

    await scheduleDeletion(due.token);
    await scheduleDeletion(notDue.token);
    // Back-date only the due account's schedule; the other keeps its real ~24h-from-now deleteAfter.
    await db.update(accountDeletions).set({ deleteAfter: new Date(Date.now() - 1000) }).where(eq(accountDeletions.userId, due.userId));

    const before = Date.now();
    const result = await runDueDeletions(env, before);
    expect(result.processed).toBeGreaterThanOrEqual(1);
    expect(result.failed).toBe(0);

    // The due account and everything it owned is gone (same shape of check as DELETE /me's tests).
    expect(await rowExists('users', 'id', due.userId)).toBe(false);
    expect(await rowExists('profiles', 'user_id', due.userId)).toBe(false);
    expect(await accountDeletionRow(due.userId)).toBeNull();
    expect((await call(`/id/${due.slug}`)).status).toBe(404);
    expect((await call('/me', { token: due.token })).status).toBe(401);

    const finalMail = emailsTo(dueEmail, 'Your Chatsoon account has been deleted');
    expect(finalMail).toHaveLength(1);
    expect(finalMail[0]!.text).toContain("last email we'll send you");

    // The account whose grace period has not passed yet is untouched.
    expect(await rowExists('users', 'id', notDue.userId)).toBe(true);
    const stillPending = await accountDeletionRow(notDue.userId);
    expect(stillPending).not.toBeNull();
    expect(stillPending!.deleteAfter.getTime()).toBeGreaterThan(before);
    expect(emailsTo(notDueEmail, 'Your Chatsoon account has been deleted')).toHaveLength(0);
  });

  it('processes nothing when no deletion is due', async () => {
    const result = await runDueDeletions(env, Date.now() - 365 * 24 * 60 * 60 * 1000);
    expect(result).toEqual({ processed: 0, failed: 0 });
  });
});
