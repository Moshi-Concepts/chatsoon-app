import { expo } from '@better-auth/expo';
import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { createAuthMiddleware } from 'better-auth/api';
import { bearer, emailOTP } from 'better-auth/plugins';
import type { MiddlewareHandler } from 'hono';

import { accounts, sessions, users, verifications } from '../db/schema';
import type { AppEnv, Env } from '../env';
import { getDb } from './db';
import { sendEmail, signInCodeEmail } from './email';
import { badRequest, clientIp, ipKey, limit } from './errors';
import { ensureReviewerData, isActiveReviewer, reviewerOtp } from './reviewer';

export function allowedOrigins(env: Env): string[] {
  const extra = (env.EXTRA_ORIGINS ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  return [env.WEB_ORIGIN, ...extra, 'chatsoon://'];
}

export interface WaitUntil {
  waitUntil(promise: Promise<unknown>): void;
}

/**
 * Better Auth endpoints Chatsoon doesn't use: passwords, email change, social and linked accounts,
 * and the other email OTP flows. They answer 404. Some would email a code to any registered address
 * outside otpRateLimit (password reset), and the Expo OAuth proxy redirects to any https URL (an
 * open redirect on the API domain). Account deletion is DELETE /me.
 * The app uses send-verification-otp, sign-in/email-otp, get-session and sign-out.
 */
const DISABLED_AUTH_PATHS = [
  '/expo-authorization-proxy',
  '/email-otp/check-verification-otp',
  '/email-otp/verify-email',
  '/email-otp/request-password-reset',
  '/forget-password/email-otp',
  '/email-otp/reset-password',
  '/email-otp/request-email-change',
  '/email-otp/change-email',
  '/sign-up/email',
  '/sign-in/email',
  '/sign-in/social',
  '/request-password-reset',
  '/reset-password',
  '/change-password',
  '/verify-password',
  '/verify-email',
  '/send-verification-email',
  '/change-email',
  '/update-user',
  '/delete-user',
  '/link-social',
  '/unlink-account',
  '/list-accounts',
  '/account-info',
  '/refresh-token',
  '/get-access-token',
];

/**
 * Better Auth is created per request because D1 is a per-request binding.
 * Clients authenticate with `Authorization: Bearer <token>` (bearer plugin) on native and web.
 */
export function createAuth(env: Env, ctx?: WaitUntil) {
  const db = getDb(env);
  return betterAuth({
    appName: 'Chatsoon',
    baseURL: env.API_ORIGIN,
    basePath: '/auth',
    secret: env.BETTER_AUTH_SECRET,
    trustedOrigins: allowedOrigins(env),
    disabledPaths: DISABLED_AUTH_PATHS,
    database: drizzleAdapter(db, {
      provider: 'sqlite',
      schema: { user: users, session: sessions, account: accounts, verification: verifications },
    }),
    session: {
      expiresIn: 60 * 60 * 24 * 90, // 90 days
      updateAge: 60 * 60 * 24, // refresh daily
    },
    advanced: {
      // Cloudflare sets this to the real client IP on every request (rate limits, session records).
      ipAddress: { ipAddressHeaders: ['cf-connecting-ip'] },
    },
    hooks: {
      after: createAuthMiddleware(async (actx) => {
        if (actx.path !== '/sign-in/email-otp') return;
        const user = actx.context.newSession?.user;
        if (!user || !isActiveReviewer(env, user.email)) return;
        // Awaited so the sample contacts are there when the app loads them after sign-in.
        // A failure must not block the sign-in; the next reviewer sign-in retries.
        await ensureReviewerData(env, user.id).catch((err) => console.error('Reviewer sample data failed', err));
      }),
    },
    plugins: [
      expo(),
      bearer(),
      emailOTP({
        otpLength: 6,
        expiresIn: 600,
        allowedAttempts: 5,
        storeOTP: 'hashed',
        disableSignUp: false,
        generateOTP: ({ email, type }) => reviewerOtp(env, email, type),
        async sendVerificationOTP({ email, otp, type }) {
          // Sign-in is the only code the app asks for. The email says "sign-in code", so any other
          // type (e.g. requested by hand with type "forget-password") is never mailed.
          if (type !== 'sign-in') return;
          // The reviewer types the fixed code from the review notes, so there is nothing to send.
          if (reviewerOtp(env, email, type) === otp) return;
          const sending = sendEmail(env, { to: email, ...signInCodeEmail(otp) }).catch((err) =>
            console.error('Sign-in code email failed', err),
          );
          // Don't hold the response on the email provider (also avoids a timing signal).
          if (ctx) ctx.waitUntil(sending);
          else await sending;
        },
      }),
    ],
  });
}

export type Auth = ReturnType<typeof createAuth>;

// ---------------------------------------------------------------------------
// Sign-in code rate limiting, mounted in front of Better Auth in src/index.ts.
// ---------------------------------------------------------------------------

const OTP_LIMITED_PATHS: Record<string, string> = {
  '/auth/email-otp/send-verification-otp': 'otp',
  '/auth/sign-in/email-otp': 'otp-verify',
};

/**
 * Normalises an email for rate limit keys: lowercase, no +tag, and no dots for Gmail, so the
 * variants that land in one inbox share one bucket.
 */
export function emailLimitKey(email: string): string {
  const value = email.trim().toLowerCase();
  const at = value.lastIndexOf('@');
  if (at < 1) return value;
  let local = value.slice(0, at);
  let domain = value.slice(at + 1);
  local = local.split('+')[0] || local;
  if (domain === 'googlemail.com') domain = 'gmail.com';
  if (domain === 'gmail.com') local = local.replace(/\./g, '') || local;
  return `${local}@${domain}`;
}

/** RFC 5321 limit, also enforced by emailSchema in @chatsoon/shared. */
const MAX_EMAIL_LENGTH = 254;

async function bodyEmail(req: Request): Promise<string | null> {
  try {
    const body = (await req.clone().json()) as { email?: unknown } | null;
    return typeof body?.email === 'string' && body.email.trim() ? body.email : null;
  } catch {
    return null;
  }
}

/**
 * Rate limits sending and checking sign-in codes per client IP (OTP_IP_LIMITER) and per email (OTP_LIMITER), so rotating IPs
 * can't flood one inbox or keep guessing one account's code. Reads the body from a clone and leaves
 * the original request untouched for Better Auth. Throws rate_limited (429) through onError.
 */
export const otpRateLimit: MiddlewareHandler<AppEnv> = async (c, next) => {
  const path = new URL(c.req.url).pathname.replace(/\/+$/, '');
  const scope = c.req.method === 'POST' ? OTP_LIMITED_PATHS[path] : undefined;
  if (scope) {
    await limit(c.env.OTP_IP_LIMITER, ipKey(c, scope));
    const email = await bodyEmail(c.req.raw);
    // Better Auth doesn't cap the length, and no real inbox has a longer address.
    if (email && email.length > MAX_EMAIL_LENGTH) throw badRequest('Enter a valid email address.');
    // Like ipKey, the email bucket only applies behind Cloudflare (always there in production),
    // so local dev and the test suite, which reuse addresses, are not throttled. Nothing is mailed
    // to the active reviewer, so their send bucket is skipped: a flood of requests can't lock App
    // Review out. Checking the fixed code stays limited per email.
    const perEmail = email && clientIp(c) && !(scope === 'otp' && isActiveReviewer(c.env, email));
    if (perEmail) await limit(c.env.OTP_LIMITER, `${scope}-email:${emailLimitKey(email)}`);
  }
  await next();
};
