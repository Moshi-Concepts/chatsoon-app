import { DEMO_PROFILE_SLUG, REVIEWER_EMAIL, SEEDED_TAGS } from '@chatsoon/shared';
import { env } from 'cloudflare:workers';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { Env } from '../src/env';
import { createAuth, emailLimitKey, OTP_SENDS_PER_HOUR_MAX, REVIEWER_CHECKS_PER_DAY_MAX } from '../src/lib/auth';
import { capturedEmails, sendEmail, signInCodeEmail } from '../src/lib/email';
import { DEMO_USER_ID, SAMPLE_CONNECTION_USER_ID, ensureReviewerData } from '../src/lib/reviewer';
import { call, signIn } from './helpers';

const sendCode = (email: string, headers?: HeadersInit) =>
  call('/auth/email-otp/send-verification-otp', { method: 'POST', json: { email, type: 'sign-in' }, headers });

const sendCodeOfType = (email: string, type: string) =>
  call('/auth/email-otp/send-verification-otp', { method: 'POST', json: { email, type } });

const verifyCode = (email: string, otp: string, headers?: HeadersInit) =>
  call('/auth/sign-in/email-otp', { method: 'POST', json: { email, otp }, headers });

const emailsTo = (email: string) => capturedEmails().filter((m) => m.to === email);
const lastCode = (email: string) => emailsTo(email).at(-1)?.text.match(/\b(\d{6})\b/)?.[1];
const otherCode = (code: string) => (code === '000000' ? '111111' : '000000');

/**
 * A copy of env with some values replaced, for code paths the Worker's own env doesn't take.
 * A copy, not Object.create(env): env is a Proxy, and writes through a child land on the shared
 * bindings, which would switch the reviewer bypass or the email provider for every later test.
 */
const withEnv = (overrides: Partial<Env>): Env => ({ ...env, ...overrides });

async function count(sql: string, ...params: unknown[]): Promise<number> {
  const row = await env.DB.prepare(sql)
    .bind(...params)
    .first<{ n: number }>();
  return row?.n ?? 0;
}

const contactCount = (userId: string) => count('SELECT count(*) AS n FROM contacts WHERE user_id = ?', userId);
const profileCount = (userId: string) => count('SELECT count(*) AS n FROM profiles WHERE user_id = ?', userId);
/** How many of `ownerId`'s contacts are linked to `linkedId`. */
const linkedCount = (ownerId: string, linkedId: string) =>
  count('SELECT count(*) AS n FROM contacts WHERE user_id = ? AND linked_user_id = ?', ownerId, linkedId);

async function userIdFor(email: string): Promise<string | null> {
  const row = await env.DB.prepare('SELECT id FROM users WHERE email = ?').bind(email).first<{ id: string }>();
  return row?.id ?? null;
}

/** The newest stored sign-in code for an address: `<hash>:<wrong attempts>`. */
async function storedOtpValue(email: string): Promise<string | null> {
  const row = await env.DB.prepare(
    'SELECT value FROM verifications WHERE identifier = ? ORDER BY created_at DESC LIMIT 1',
  )
    .bind(`sign-in-otp-${email}`)
    .first<{ value: string }>();
  return row?.value ?? null;
}

/** Sets a global counter kept by bumpCounter (lib/auth.ts), in every window. */
async function setCounter(name: string, value: number) {
  const { meta } = await env.DB.prepare('UPDATE verifications SET value = ? WHERE id LIKE ?')
    .bind(String(value), `counter:${name}:%`)
    .run();
  expect(meta.changes).toBeGreaterThan(0);
}

/** Hard deletes an account the way DELETE /me ends up: the users row goes, everything cascades. */
async function deleteUserRows(email: string) {
  await env.DB.prepare('DELETE FROM users WHERE email = ?').bind(email).run();
}

/**
 * Rate limit windows are aligned to the wall clock. Starting a burst near the end of one would let
 * the counter reset midway, so wait for a fresh window when close to the edge.
 */
async function awayFromWindowEdge() {
  const intoWindow = Date.now() % 60_000;
  if (intoWindow > 45_000) await new Promise((r) => setTimeout(r, 60_000 - intoWindow + 250));
}

describe('email OTP sign-in', () => {
  it('creates the user on first sign-in and the bearer token resolves the session', async () => {
    const email = 'jordan@example.com';
    expect(await userIdFor(email)).toBeNull();

    const { token, userId } = await signIn(email);
    expect(token).toBeTruthy();

    const row = await env.DB.prepare('SELECT email, email_verified FROM users WHERE id = ?')
      .bind(userId)
      .first<{ email: string; email_verified: number }>();
    expect(row).toEqual({ email, email_verified: 1 });

    const res = await call('/auth/get-session', { token });
    expect(res.status).toBe(200);
    const data = (await res.json()) as { user: { id: string; email: string } };
    expect(data.user).toMatchObject({ id: userId, email });

    // Signing in again reuses the account.
    const again = await signIn(email);
    expect(again.userId).toBe(userId);
    expect(await count('SELECT count(*) AS n FROM users WHERE email = ?', email)).toBe(1);
  });

  it('emails a branded 6 digit code and stores only its hash', async () => {
    const email = 'casey@example.com';
    expect((await sendCode(email)).status).toBe(200);

    const mail = emailsTo(email).at(-1);
    const code = lastCode(email);
    expect(code).toMatch(/^\d{6}$/);
    expect(mail?.subject).toBe(`${code} is your Chatsoon code`);
    expect(mail?.text).toContain('expires in 10 minutes');
    expect(mail?.html).toContain(`>${code}</td>`);

    const stored = await env.DB.prepare('SELECT value, expires_at FROM verifications WHERE identifier = ?')
      .bind(`sign-in-otp-${email}`)
      .first<{ value: string; expires_at: number }>();
    expect(stored).not.toBeNull();
    expect(stored!.value).not.toContain(code!);
    // 10 minute expiry.
    const ttl = stored!.expires_at - Date.now();
    expect(ttl).toBeGreaterThan(9 * 60_000);
    expect(ttl).toBeLessThanOrEqual(10 * 60_000);
  });

  it('rejects a wrong code without creating a session or a user', async () => {
    const email = 'riley@example.com';
    await sendCode(email);
    const code = lastCode(email)!;

    const res = await verifyCode(email, otherCode(code));
    expect(res.status).toBe(400);
    expect(res.headers.get('set-auth-token')).toBeNull();
    expect(await userIdFor(email)).toBeNull();

    // The right code still works after one miss.
    const ok = await verifyCode(email, code);
    expect(ok.status).toBe(200);
  });

  it('locks the code after 5 wrong attempts', async () => {
    const email = 'morgan@example.com';
    await sendCode(email);
    const code = lastCode(email)!;

    for (let i = 0; i < 5; i++) expect((await verifyCode(email, otherCode(code))).status).toBe(400);
    const locked = await verifyCode(email, code);
    expect(locked.status).toBe(403);
    expect(await userIdFor(email)).toBeNull();

    // A new code works.
    const { userId } = await signIn(email);
    expect(userId).toBeTruthy();
  });

  it('only emails sign-in codes, and turns off the auth endpoints the app does not use', async () => {
    const email = 'avery@example.com';
    const { token } = await signIn(email);
    const mailCount = emailsTo(email).length;

    // Password reset would otherwise email a code to any registered address, outside the OTP limits.
    for (const path of ['/email-otp/request-password-reset', '/forget-password/email-otp']) {
      const res = await call(`/auth${path}`, { method: 'POST', json: { email } });
      expect(res.status, path).toBe(404);
    }
    const reset = await call('/auth/email-otp/reset-password', {
      method: 'POST',
      json: { email, otp: '123456', password: 'correct-horse-battery' },
    });
    expect(reset.status).toBe(404);
    expect((await call('/auth/update-user', { method: 'POST', token, json: { name: 'x' } })).status).toBe(404);
    expect((await call('/auth/sign-in/email', { method: 'POST', json: { email, password: 'x' } })).status).toBe(404);
    // The Expo OAuth proxy would redirect anywhere (no social sign-in in 1.0).
    const target = encodeURIComponent('https://evil.example/login?state=abc');
    const proxy = await call(`/auth/expo-authorization-proxy?authorizationURL=${target}`, { redirect: 'manual' });
    expect(proxy.status).toBe(404);
    expect(proxy.headers.get('location')).toBeNull();

    // Other code types can still be requested by hand, but nothing is sent.
    expect((await sendCodeOfType(email, 'forget-password')).status).toBe(200);
    expect((await sendCodeOfType(email, 'email-verification')).status).toBe(200);
    expect(emailsTo(email)).toHaveLength(mailCount);

    // What the app does use still works.
    expect((await call('/auth/get-session', { token })).status).toBe(200);
    expect((await call('/auth/sign-out', { method: 'POST', token, json: {} })).status).toBe(200);
    expect(await (await call('/auth/get-session', { token })).json()).toBeNull();
  });

  it('rejects an email address longer than any real inbox', async () => {
    const email = `${'a'.repeat(250)}@example.com`;
    const res = await sendCode(email);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: { code: 'bad_request', message: 'Enter a valid email address.' } });
    expect(emailsTo(email)).toHaveLength(0);
  });

  it("doesn't keep the sign-in IP address or user agent on the session", async () => {
    const email = 'session-privacy@example.com';
    await sendCode(email);
    const res = await verifyCode(email, lastCode(email)!, {
      'cf-connecting-ip': '198.51.100.77',
      'User-Agent': 'Chatsoon/1.0 (iPhone; iOS 19.0)',
    });
    expect(res.status).toBe(200);
    const userId = await userIdFor(email);
    const row = await env.DB.prepare('SELECT ip_address, user_agent FROM sessions WHERE user_id = ?')
      .bind(userId)
      .first();
    expect(row).toEqual({ ip_address: null, user_agent: null });
  });

  it('does not accept the reviewer code for other addresses', async () => {
    const email = 'not-the-reviewer@example.com';
    await sendCode(email);
    const code = lastCode(email)!;
    if (code !== env.REVIEWER_CODE) expect((await verifyCode(email, env.REVIEWER_CODE!)).status).toBe(400);
  });
});

describe('reviewer login', () => {
  it('signs in with the fixed code and sends no email', async () => {
    await deleteUserRows(REVIEWER_EMAIL);
    expect(env.REVIEWER_CODE).toMatch(/^\d{6}$/);

    expect((await sendCode(REVIEWER_EMAIL)).status).toBe(200);
    expect(emailsTo(REVIEWER_EMAIL)).toHaveLength(0);

    expect((await verifyCode(REVIEWER_EMAIL, otherCode(env.REVIEWER_CODE!))).status).toBe(400);

    const { token } = await signIn(REVIEWER_EMAIL, env.REVIEWER_CODE);
    const res = await call('/auth/get-session', { token });
    const data = (await res.json()) as { user: { email: string } };
    expect(data.user.email).toBe(REVIEWER_EMAIL);
    expect(emailsTo(REVIEWER_EMAIL)).toHaveLength(0);
  });

  it('gives the reviewer a profile, tags, sample contacts and a demo connection', async () => {
    await deleteUserRows(REVIEWER_EMAIL);
    const { userId } = await signIn(REVIEWER_EMAIL, env.REVIEWER_CODE);

    const profile = await env.DB.prepare('SELECT display_name, headline, slug FROM profiles WHERE user_id = ?')
      .bind(userId)
      .first<{ display_name: string; headline: string; slug: string }>();
    expect(profile).toMatchObject({ display_name: 'App Reviewer', headline: 'Testing Chatsoon' });
    expect(profile!.slug).toMatch(/^app-reviewer-[0-9a-f]{8}$/);

    const tagNames = await env.DB.prepare('SELECT name FROM tags WHERE user_id = ?')
      .bind(userId)
      .all<{ name: string }>();
    expect(tagNames.results.map((t) => t.name).sort()).toEqual([...SEEDED_TAGS].sort());

    const { results: rows } = await env.DB.prepare(
      `SELECT id, name, source, extraction_status, linked_user_id, notes, priority, event_id
       FROM contacts WHERE user_id = ?`,
    )
      .bind(userId)
      .all<{
        id: string;
        name: string;
        source: string;
        extraction_status: string;
        linked_user_id: string | null;
        notes: string | null;
        priority: number | null;
        event_id: string | null;
      }>();
    expect(rows).toHaveLength(6);
    expect(new Set(rows.map((r) => r.source))).toEqual(
      new Set(['manual', 'qr_scan', 'card_photo', 'web_connect', 'app_connect']),
    );
    for (const r of rows) {
      expect(r.notes).toBeTruthy();
      expect(r.priority).toBeGreaterThanOrEqual(1);
      expect(r.priority).toBeLessThanOrEqual(5);
    }
    expect(rows.filter((r) => r.event_id === 'evt_token2049').length).toBeGreaterThanOrEqual(5);
    expect(rows.find((r) => r.source === 'card_photo')?.extraction_status).toBe('confirmed');
    const linkedContact = rows.find((r) => r.source === 'app_connect');
    expect(linkedContact).toMatchObject({ name: 'Maya Lindqvist', linked_user_id: SAMPLE_CONNECTION_USER_ID });
    // Every id is a UUID, like contacts created by the app.
    for (const r of rows) expect(r.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);

    // Every contact is tagged, only with the reviewer's own tags.
    const untagged = await count(
      `SELECT count(*) AS n FROM contacts c
       WHERE c.user_id = ? AND NOT EXISTS (SELECT 1 FROM contact_tags ct WHERE ct.contact_id = c.id)`,
      userId,
    );
    expect(untagged).toBe(0);
    const foreignTags = await count(
      `SELECT count(*) AS n FROM contact_tags ct JOIN tags t ON t.id = ct.tag_id
       WHERE ct.user_id = ? AND t.user_id != ?`,
      userId,
      userId,
    );
    expect(foreignTags).toBe(0);

    const [a, b] = [userId, SAMPLE_CONNECTION_USER_ID].sort();
    const connection = await env.DB.prepare('SELECT status, event_id FROM connections WHERE user_a = ? AND user_b = ?')
      .bind(a, b)
      .first();
    expect(connection).toEqual({ status: 'accepted', event_id: 'evt_token2049' });

    // Not connected to the profile the review notes say to scan, so that scan is a first connection.
    const [x, y] = [userId, DEMO_USER_ID].sort();
    expect(await count('SELECT count(*) AS n FROM connections WHERE user_a = ? AND user_b = ?', x, y)).toBe(0);
    expect(await linkedCount(userId, DEMO_USER_ID)).toBe(0);
  });

  it('keeps the sample data idempotent and respects deleted contacts', async () => {
    await deleteUserRows(REVIEWER_EMAIL);
    const first = await signIn(REVIEWER_EMAIL, env.REVIEWER_CODE);
    const second = await signIn(REVIEWER_EMAIL, env.REVIEWER_CODE);
    expect(second.userId).toBe(first.userId);
    expect(await contactCount(first.userId)).toBe(6);
    expect(await profileCount(first.userId)).toBe(1);
    expect(await count('SELECT count(*) AS n FROM tags WHERE user_id = ?', first.userId)).toBe(SEEDED_TAGS.length);
    const connectionCount = await count(
      'SELECT count(*) AS n FROM connections WHERE user_a = ? OR user_b = ?',
      first.userId,
      first.userId,
    );
    expect(connectionCount).toBe(1);

    await env.DB.prepare("DELETE FROM contacts WHERE user_id = ? AND source = 'manual'").bind(first.userId).run();
    await signIn(REVIEWER_EMAIL, env.REVIEWER_CODE);
    expect(await contactCount(first.userId)).toBe(4);
  });

  it('brings the samples back when the reviewer has no contacts left', async () => {
    await deleteUserRows(REVIEWER_EMAIL);
    const { userId, token } = await signIn(REVIEWER_EMAIL, env.REVIEWER_CODE);
    const contactIds = async () => {
      const { results } = await env.DB.prepare('SELECT id FROM contacts WHERE user_id = ? ORDER BY id')
        .bind(userId)
        .all<{ id: string }>();
      return results.map((r) => r.id);
    };
    const slugOf = () => env.DB.prepare('SELECT slug FROM profiles WHERE user_id = ?').bind(userId).first('slug');
    const before = await contactIds();
    const slug = await slugOf();

    for (const id of before) expect((await call(`/contacts/${id}`, { method: 'DELETE', token })).ok).toBe(true);
    expect(await contactCount(userId)).toBe(0);

    await signIn(REVIEWER_EMAIL, env.REVIEWER_CODE);
    expect(await contactIds()).toEqual(before);
    // The profile (and the slug its QR code points at) is kept, and nothing is duplicated.
    expect(await profileCount(userId)).toBe(1);
    expect(await slugOf()).toBe(slug);
    expect(await count('SELECT count(*) AS n FROM tags WHERE user_id = ?', userId)).toBe(SEEDED_TAGS.length);
    expect(await count('SELECT count(*) AS n FROM connections WHERE user_a = ? OR user_b = ?', userId, userId)).toBe(1);
  });

  it('writes the samples once when two sign-ins seed at the same moment', async () => {
    await deleteUserRows(REVIEWER_EMAIL);
    const { userId } = await signIn(REVIEWER_EMAIL, env.REVIEWER_CODE);
    await env.DB.prepare('DELETE FROM contacts WHERE user_id = ?').bind(userId).run();

    // The profile exists, so only the deterministic contact ids stop the second seed.
    const results = await Promise.allSettled([ensureReviewerData(env, userId), ensureReviewerData(env, userId)]);
    expect(results.some((r) => r.status === 'fulfilled' && r.value)).toBe(true);
    expect(await profileCount(userId)).toBe(1);
    expect(await contactCount(userId)).toBe(6);
    expect(await count('SELECT count(*) AS n FROM contact_tags WHERE user_id = ?', userId)).toBe(12);
    expect(await ensureReviewerData(env, userId)).toBe(false);
  });

  it('scans the demo QR as a first connection, even after blocking the sample connection', async () => {
    await deleteUserRows(REVIEWER_EMAIL);
    const { userId, token } = await signIn(REVIEWER_EMAIL, env.REVIEWER_CODE);

    // A reviewer may try block on the connected sample profile before testing the scan.
    const blocked = await call('/blocks', { method: 'POST', token, json: { targetUserId: SAMPLE_CONNECTION_USER_ID } });
    expect(blocked.status).toBe(201);
    expect(await contactCount(userId)).toBe(5);

    const res = await call('/connections/scan', { method: 'POST', token, json: { slug: DEMO_PROFILE_SLUG } });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { alreadyConnected: boolean; contact: { name: string; linkedUserId: string } };
    expect(body.alreadyConnected).toBe(false);
    expect(body.contact).toMatchObject({ name: 'Alex Rivera', linkedUserId: DEMO_USER_ID });
    expect(await linkedCount(DEMO_USER_ID, userId)).toBe(1);

    // The blocked profile doesn't come back with the samples.
    await env.DB.prepare('DELETE FROM contacts WHERE user_id = ?').bind(userId).run();
    await signIn(REVIEWER_EMAIL, env.REVIEWER_CODE);
    expect(await contactCount(userId)).toBe(5);
    expect(await linkedCount(userId, SAMPLE_CONNECTION_USER_ID)).toBe(0);
  });

  it('lifts an earlier reviewer block on the demo scan profile at the next sign-in', async () => {
    await deleteUserRows(REVIEWER_EMAIL);
    const first = await signIn(REVIEWER_EMAIL, env.REVIEWER_CODE);
    const scanDemo = (token: string) =>
      call('/connections/scan', { method: 'POST', token, json: { slug: DEMO_PROFILE_SLUG } });
    expect((await scanDemo(first.token)).status).toBe(200);
    const demoCardsOfReviewer = () =>
      count(
        'SELECT count(*) AS n FROM contacts WHERE user_id = ?1 AND (linked_user_id = ?2 OR unlinked_user_id = ?2)',
        DEMO_USER_ID,
        first.userId,
      );
    expect(await demoCardsOfReviewer()).toBe(1);

    // One reviewer blocks the demo profile and leaves the account as it is.
    const blocked = await call('/blocks', { method: 'POST', token: first.token, json: { targetUserId: DEMO_USER_ID } });
    expect(blocked.status).toBe(201);
    expect((await scanDemo(first.token)).status).toBe(403);

    // The next reviewer signs in and the documented scan works as a first connection.
    const next = await signIn(REVIEWER_EMAIL, env.REVIEWER_CODE);
    expect(next.userId).toBe(first.userId);
    const res = await scanDemo(next.token);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { alreadyConnected: boolean; contact: { linkedUserId: string } };
    expect(body.alreadyConnected).toBe(false);
    expect(body.contact.linkedUserId).toBe(DEMO_USER_ID);
    // The demo profile's card of the reviewer is linked again, not duplicated.
    expect(await demoCardsOfReviewer()).toBe(1);
    expect(await linkedCount(DEMO_USER_ID, first.userId)).toBe(1);

    // A block on the connected sample profile stays.
    await call('/blocks', { method: 'POST', token: next.token, json: { targetUserId: SAMPLE_CONNECTION_USER_ID } });
    await signIn(REVIEWER_EMAIL, env.REVIEWER_CODE);
    const mayaBlocks = await count(
      'SELECT count(*) AS n FROM blocks WHERE blocker_id = ? AND blocked_id = ?',
      first.userId,
      SAMPLE_CONNECTION_USER_ID,
    );
    expect(mayaBlocks).toBe(1);
  });

  it('recreates the sample data after the reviewer account is deleted', async () => {
    await deleteUserRows(REVIEWER_EMAIL);
    const before = await signIn(REVIEWER_EMAIL, env.REVIEWER_CODE);
    expect(await contactCount(before.userId)).toBe(6);

    await deleteUserRows(REVIEWER_EMAIL);
    expect(await contactCount(before.userId)).toBe(0);
    expect(await profileCount(before.userId)).toBe(0);

    const after = await signIn(REVIEWER_EMAIL, env.REVIEWER_CODE);
    expect(after.userId).not.toBe(before.userId);
    expect(await profileCount(after.userId)).toBe(1);
    expect(await contactCount(after.userId)).toBe(6);
    expect(await linkedCount(after.userId, SAMPLE_CONNECTION_USER_ID)).toBe(1);
  });

  it('treats the reviewer like any other address when the flag is off', async () => {
    await deleteUserRows(REVIEWER_EMAIL);
    const auth = await createAuth(withEnv({ REVIEWER_ENABLED: 'false' }));
    const post = (path: string, body: unknown) =>
      auth.handler(
        new Request(`${env.API_ORIGIN}/auth${path}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        }),
      );

    const sent = await post('/email-otp/send-verification-otp', { email: REVIEWER_EMAIL, type: 'sign-in' });
    expect(sent.status).toBe(200);
    const code = lastCode(REVIEWER_EMAIL);
    expect(code).toMatch(/^\d{6}$/);

    if (code !== env.REVIEWER_CODE) {
      const fixed = await post('/sign-in/email-otp', { email: REVIEWER_EMAIL, otp: env.REVIEWER_CODE });
      expect(fixed.status).toBe(400);
    }
    const res = await post('/sign-in/email-otp', { email: REVIEWER_EMAIL, otp: code });
    expect(res.status).toBe(200);
    const { user } = (await res.json()) as { user: { id: string } };
    expect(await profileCount(user.id)).toBe(0);
    expect(await contactCount(user.id)).toBe(0);

    // The override stayed local: the Worker still has the bypass on.
    expect(env.REVIEWER_ENABLED).toBe('true');
    await deleteUserRows(REVIEWER_EMAIL);
    expect(await contactCount((await signIn(REVIEWER_EMAIL, env.REVIEWER_CODE)).userId)).toBe(6);
  });
});

describe('demo profile migration', () => {
  it('seeds the profile the reviewer starts connected to', async () => {
    const row = await env.DB.prepare(
      `SELECT u.name, u.email, u.email_verified, p.slug, p.display_name, p.company, p.role, p.links
       FROM profiles p JOIN users u ON u.id = p.user_id WHERE u.id = ?`,
    )
      .bind(SAMPLE_CONNECTION_USER_ID)
      .first<Record<string, unknown>>();
    expect(row).toMatchObject({
      name: 'Maya Lindqvist',
      email: 'demo+maya@chatsoon.app',
      email_verified: 1,
      slug: 'maya-lindqvist-demo',
      display_name: 'Maya Lindqvist',
      company: 'Contoso Events',
      role: 'Community Lead',
    });
    expect(JSON.parse(row!.links as string)).toEqual({ x: 'chatsoonapp', website: 'https://chatsoon.app' });
  });

  it('seeds the second test profile the reviewer scans', async () => {
    const row = await env.DB.prepare(
      `SELECT u.id, u.name, u.email, u.email_verified, p.display_name, p.headline, p.company, p.role, p.links
       FROM profiles p JOIN users u ON u.id = p.user_id WHERE p.slug = ?`,
    )
      .bind(DEMO_PROFILE_SLUG)
      .first<Record<string, unknown>>();
    expect(row).toMatchObject({
      id: DEMO_USER_ID,
      name: 'Alex Rivera',
      email: 'demo+alex@chatsoon.app',
      email_verified: 1,
      display_name: 'Alex Rivera',
      headline: 'Partnerships at Northwind Labs',
      company: 'Northwind Labs',
      role: 'Head of Partnerships',
    });
    expect(JSON.parse(row!.links as string)).toEqual({ x: 'chatsoonapp', website: 'https://chatsoon.app' });
  });
});

describe('sign-in code rate limits', () => {
  it('limits code requests per IP', { timeout: 30_000 }, async () => {
    await awayFromWindowEdge();
    const ip = { 'cf-connecting-ip': '203.0.113.10' };
    // OTP_SEND_IP_LIMITER allows 10 a minute: every send mails a code to any address.
    for (let i = 0; i < 10; i++) expect((await sendCode(`ip-limit-${i}@example.com`, ip)).status).toBe(200);

    const blocked = await sendCode('ip-limit-10@example.com', ip);
    expect(blocked.status).toBe(429);
    expect(await blocked.json()).toEqual({ error: { code: 'rate_limited', message: expect.any(String) } });
    expect(emailsTo('ip-limit-10@example.com')).toHaveLength(0);

    // Other clients are unaffected, and checking codes has its own, looser bucket (a venue IP).
    expect((await sendCode('ip-limit-6@example.com', { 'cf-connecting-ip': '203.0.113.11' })).status).toBe(200);
    const code = lastCode('ip-limit-3@example.com')!;
    expect((await verifyCode('ip-limit-3@example.com', code, ip)).status).toBe(200);
  });

  it('limits code requests per email across IPs, including address variants', { timeout: 30_000 }, async () => {
    await awayFromWindowEdge();
    const variants = [
      'flood.me@gmail.com',
      'floodme@gmail.com',
      'FloodMe+1@gmail.com',
      'f.loodme@googlemail.com',
      'floodme+x@gmail.com',
    ];
    for (const [i, email] of variants.entries()) {
      expect((await sendCode(email, { 'cf-connecting-ip': `198.51.100.${i + 1}` })).status).toBe(200);
    }
    const blocked = await sendCode('floodme@gmail.com', { 'cf-connecting-ip': '198.51.100.99' });
    expect(blocked.status).toBe(429);
  });

  it('limits code checks per IP', { timeout: 30_000 }, async () => {
    await awayFromWindowEdge();
    const email = 'guess@example.com';
    await sendCode(email);
    const code = lastCode(email)!;
    const ip = { 'cf-connecting-ip': '203.0.113.20' };
    for (let i = 0; i < 5; i++) expect((await verifyCode(email, otherCode(code), ip)).status).toBe(400);
    expect((await verifyCode(email, code, ip)).status).toBe(429);
  });

  it('never locks the reviewer out of sending, but limits guesses at the fixed code', { timeout: 30_000 }, async () => {
    await awayFromWindowEdge();
    // Nothing is mailed to the reviewer, so a flood of send requests from many IPs changes nothing.
    for (let i = 1; i <= 7; i++) {
      expect((await sendCode(REVIEWER_EMAIL, { 'cf-connecting-ip': `192.0.2.${i}` })).status).toBe(200);
    }
    // Guessing the fixed code from rotating IPs is still capped per email.
    const wrong = otherCode(env.REVIEWER_CODE!);
    for (let i = 1; i <= 5; i++) {
      expect((await verifyCode(REVIEWER_EMAIL, wrong, { 'cf-connecting-ip': `192.0.2.${100 + i}` })).status).toBe(400);
    }
    const res = await verifyCode(REVIEWER_EMAIL, env.REVIEWER_CODE!, { 'cf-connecting-ip': '192.0.2.200' });
    expect(res.status).toBe(429);

    // The wrong guesses never reached Better Auth, so they didn't use up the stored code's attempts:
    // once the bucket empties, the fixed code works without a new send.
    expect(await storedOtpValue(REVIEWER_EMAIL)).toMatch(/:0$/);
    expect((await verifyCode(REVIEWER_EMAIL, env.REVIEWER_CODE!)).status).toBe(200);
  });

  it('answers a wrong reviewer code exactly like any other wrong code', async () => {
    const email = 'plain-wrong@example.com';
    await sendCode(email);
    const plain = await verifyCode(email, otherCode(lastCode(email)!));

    await sendCode(REVIEWER_EMAIL);
    const reviewer = await verifyCode(REVIEWER_EMAIL, otherCode(env.REVIEWER_CODE!));
    expect(reviewer.status).toBe(plain.status);
    expect(await reviewer.json()).toEqual(await plain.json());
    expect(await storedOtpValue(REVIEWER_EMAIL)).toMatch(/:0$/);
  });

  it('caps checks of the reviewer code per day across all locations', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      await sendCode(REVIEWER_EMAIL);
      expect((await verifyCode(REVIEWER_EMAIL, otherCode(env.REVIEWER_CODE!))).status).toBe(400);
      await setCounter('reviewer-otp-checks', REVIEWER_CHECKS_PER_DAY_MAX);

      // Past the budget even the right code is refused, so the check can't be used to guess.
      const over = await verifyCode(REVIEWER_EMAIL, env.REVIEWER_CODE!);
      expect(over.status).toBe(429);
      expect((await verifyCode(REVIEWER_EMAIL, env.REVIEWER_CODE!)).status).toBe(429);
      expect(errors.mock.calls.filter(([msg]) => String(msg).includes('Reviewer code checks'))).toHaveLength(1);

      // Other addresses are unaffected.
      expect((await sendCode('budget-bystander@example.com')).status).toBe(200);
      const code = lastCode('budget-bystander@example.com')!;
      expect((await verifyCode('budget-bystander@example.com', code)).status).toBe(200);
    } finally {
      await setCounter('reviewer-otp-checks', 0);
      errors.mockRestore();
    }
    expect((await verifyCode(REVIEWER_EMAIL, env.REVIEWER_CODE!)).status).toBe(200);
  });

  it('stops mailing codes for the rest of the hour past the global cap', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      expect((await sendCode('cap-first@example.com')).status).toBe(200);
      await setCounter('otp-sends', OTP_SENDS_PER_HOUR_MAX);

      const over = await sendCode('cap-over@example.com');
      expect(over.status).toBe(503);
      expect(((await over.json()) as { error: { message: string } }).error.message).toMatch(/can't send sign-in codes/);
      expect(emailsTo('cap-over@example.com')).toHaveLength(0);
      expect((await sendCode('cap-over-2@example.com')).status).toBe(503);
      // Logged once, for an alert.
      expect(errors.mock.calls.filter(([msg]) => msg === 'OTP send circuit open')).toHaveLength(1);

      // Nothing is mailed to the reviewer, so their sign-in still works.
      expect((await sendCode(REVIEWER_EMAIL)).status).toBe(200);
      expect((await verifyCode(REVIEWER_EMAIL, env.REVIEWER_CODE!)).status).toBe(200);
    } finally {
      await setCounter('otp-sends', 0);
      errors.mockRestore();
    }
    expect((await sendCode('cap-after@example.com')).status).toBe(200);
    expect(emailsTo('cap-after@example.com')).toHaveLength(1);
  });

  it('refuses sign-in codes for removed users in BANNED_EMAILS', async () => {
    for (const email of ['Removed.User+again@example.com', 'other-removed@example.com']) {
      const res = await sendCode(email);
      expect(res.status, email).toBe(403);
      expect(((await res.json()) as { error: { code: string } }).error.code).toBe('forbidden');
      expect(emailsTo(email)).toHaveLength(0);
      expect((await verifyCode(email, '123456')).status).toBe(403);
    }
    expect((await sendCode('removed.user.not@example.com')).status).toBe(200);
  });

  it('normalises emails for limit keys', () => {
    expect(emailLimitKey(' F.Lood+promo@GoogleMail.com ')).toBe('flood@gmail.com');
    expect(emailLimitKey('first.last+tag@example.com')).toBe('first.last@example.com');
    expect(emailLimitKey('+tag@example.com')).toBe('+tag@example.com');
  });
});

describe('transactional email', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('builds the sign-in code email', () => {
    const { subject, text, html } = signInCodeEmail('482913');
    expect(subject).toBe('482913 is your Chatsoon code');
    expect(text.match(/\b\d{6}\b/g)).toEqual(['482913']);
    expect(text).toContain('expires in 10 minutes');
    expect(text).toContain("If you didn't request this, you can ignore this email.");
    expect(text).toContain('Moshi Concepts Inc.');
    expect(html).toContain('482913');
    expect(html).toContain('#5146E5');
    expect(html).toContain('monospace');
    expect(html).toContain('10 minutes');
    expect(html).toContain('&copy;');
    expect(html).toContain('Moshi Concepts Inc.');
    expect(html).not.toMatch(/<style|<link|<script/i);
  });

  it('sends through Resend with the sender, reply-to, text and html', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(JSON.stringify({ id: 'email_123' }), { status: 200 }));
    const resendEnv = withEnv({ EMAIL_PROVIDER: 'resend', RESEND_API_KEY: 're_test_key' });
    const captured = capturedEmails().length;

    await sendEmail(resendEnv, { to: 'sam@example.com', ...signInCodeEmail('123456') });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('https://api.resend.com/emails');
    expect(init?.method).toBe('POST');
    expect(new Headers(init?.headers).get('Authorization')).toBe('Bearer re_test_key');
    const body = JSON.parse(init?.body as string);
    expect(body).toMatchObject({
      from: env.EMAIL_FROM,
      to: ['sam@example.com'],
      reply_to: 'hello@chatsoon.app',
      subject: '123456 is your Chatsoon code',
    });
    expect(body.text).toContain('123456');
    expect(body.html).toContain('123456');
    expect(new Headers(init?.headers).get('Idempotency-Key')).toMatch(/^[0-9a-f-]{36}$/);
    // Resend mode never uses the test capture, and the Worker itself still logs.
    expect(capturedEmails().length).toBe(captured);
    expect(env.EMAIL_PROVIDER).toBe('log');
  });

  it('throws a clear error when Resend rejects the email, without retrying', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(JSON.stringify({ message: 'Invalid `from` field' }), { status: 422 }));
    const resendEnv = withEnv({ EMAIL_PROVIDER: 'resend', RESEND_API_KEY: 're_test_key' });
    await expect(sendEmail(resendEnv, { to: 'sam@example.com', subject: 's', text: 't' })).rejects.toThrow(
      /Resend rejected email to sam@example.com \(422\): .*Invalid `from` field/,
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('retries when Resend is rate limiting or failing, with the same idempotency key', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response('{"name":"rate_limit_exceeded"}', { status: 429, headers: { 'retry-after': '0' } }))
      .mockResolvedValueOnce(new Response('{"name":"internal_server_error"}', { status: 500, headers: { 'retry-after': '0' } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: 'email_456' }), { status: 200 }));
    const resendEnv = withEnv({ EMAIL_PROVIDER: 'resend', RESEND_API_KEY: 're_test_key' });

    await sendEmail(resendEnv, { to: 'sam@example.com', subject: 's', text: 't' });

    expect(fetchMock).toHaveBeenCalledTimes(3);
    const keys = fetchMock.mock.calls.map(([, init]) => new Headers(init?.headers).get('Idempotency-Key'));
    expect(new Set(keys).size).toBe(1);
    expect(keys[0]).toBeTruthy();
  });

  it('gives up after three failed attempts', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockImplementation(async () => new Response('busy', { status: 503, headers: { 'retry-after': '0' } }));
    const resendEnv = withEnv({ EMAIL_PROVIDER: 'resend', RESEND_API_KEY: 're_test_key' });
    await expect(sendEmail(resendEnv, { to: 'sam@example.com', subject: 's', text: 't' })).rejects.toThrow(
      /Resend rejected email to sam@example.com \(503\): busy/,
    );
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('refuses to send without an API key', async () => {
    const noKey = withEnv({ EMAIL_PROVIDER: 'resend', RESEND_API_KEY: '' });
    await expect(sendEmail(noKey, { to: 'a@example.com', subject: 's', text: 't' })).rejects.toThrow(/RESEND_API_KEY/);
  });
});
