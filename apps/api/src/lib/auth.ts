import { expo } from '@better-auth/expo';
import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { createAuthMiddleware } from 'better-auth/api';
import { bearer, emailOTP } from 'better-auth/plugins';
import type { SocialProviders } from 'better-auth/social-providers';
import type { MiddlewareHandler } from 'hono';

import { accounts, sessions, users, verifications } from '../db/schema';
import type { AppEnv, Env } from '../env';
import { appleClientSecret } from './apple-client-secret';
import { getDb } from './db';
import { sendEmail, signInCodeEmail } from './email';
import { ApiError, badRequest, clientIp, forbidden, ipKey, limit, rateLimited } from './errors';
import { ensureReviewerData, isActiveReviewer, isReviewerEmail, reviewerCode, reviewerOtp } from './reviewer';
import { timingSafeEqual } from './signing';

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
 * Better Auth endpoints Chatsoon doesn't use: passwords, email change, and linked-account management,
 * plus the other email OTP flows. They answer 404. Some would email a code to any registered address
 * outside otpRateLimit (password reset), and the Expo OAuth proxy redirects to any https URL (an
 * open redirect on the API domain). Account deletion is DELETE /me.
 * The app uses send-verification-otp, sign-in/email-otp, get-session and sign-out, plus (once a
 * provider is configured, see buildSocialProviders) sign-in/social and callback/:id.
 *
 * '/sign-in/social' is removed from this list in createAuth when at least one provider is configured,
 * so with none configured (today's default) behaviour is unchanged: that path still 404s.
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
 * Discord's raw profile shape (the bits `mapProfileToUser` reads). Declared narrow on purpose: Better
 * Auth passes the full DiscordProfile, but this is all buildSocialProviders needs from it.
 */
interface DiscordProfileUsername {
  username: string;
}

/**
 * Builds Better Auth's `socialProviders` option (issue #24): a provider is included only once every
 * one of its secrets is set on `env`, so an unconfigured provider is simply absent, not broken.
 * Exported so GET /auth-providers (src/index.ts) can report the same set without duplicating this
 * gating logic.
 */
export async function buildSocialProviders(env: Env): Promise<SocialProviders> {
  const providers: SocialProviders = {};

  if (env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET) {
    providers.google = { clientId: env.GOOGLE_CLIENT_ID, clientSecret: env.GOOGLE_CLIENT_SECRET };
  }
  if (env.LINKEDIN_CLIENT_ID && env.LINKEDIN_CLIENT_SECRET) {
    providers.linkedin = { clientId: env.LINKEDIN_CLIENT_ID, clientSecret: env.LINKEDIN_CLIENT_SECRET };
  }
  if (env.DISCORD_CLIENT_ID && env.DISCORD_CLIENT_SECRET) {
    providers.discord = {
      clientId: env.DISCORD_CLIENT_ID,
      clientSecret: env.DISCORD_CLIENT_SECRET,
      // Discord's username isn't kept anywhere in Better Auth's own tables (the accounts row has no
      // room for provider profile fields), so it's copied onto the user row (additionalFields below)
      // for onboarding to prefill links.discord. Only applied on account creation / explicit update,
      // per Better Auth's own account-linking rules (see the account.accountLinking comment below).
      mapProfileToUser: (profile: DiscordProfileUsername) => ({ discordUsername: profile.username }),
    };
  }
  if (env.APPLE_CLIENT_ID && env.APPLE_TEAM_ID && env.APPLE_KEY_ID && env.APPLE_PRIVATE_KEY) {
    const clientSecret = await appleClientSecret(env);
    if (clientSecret) providers.apple = { clientId: env.APPLE_CLIENT_ID, clientSecret };
  }

  return providers;
}

/**
 * Better Auth is created per request because D1 is a per-request binding.
 * Clients authenticate with `Authorization: Bearer <token>` (bearer plugin) on native and web.
 */
export async function createAuth(env: Env, ctx?: WaitUntil) {
  const db = getDb(env);
  const socialProviders = await buildSocialProviders(env);
  const anySocialProvider = Object.keys(socialProviders).length > 0;
  const disabledPaths = anySocialProvider ? DISABLED_AUTH_PATHS.filter((p) => p !== '/sign-in/social') : DISABLED_AUTH_PATHS;

  return betterAuth({
    appName: 'Chatsoon',
    baseURL: env.API_ORIGIN,
    basePath: '/auth',
    secret: env.BETTER_AUTH_SECRET,
    trustedOrigins: allowedOrigins(env),
    disabledPaths,
    database: drizzleAdapter(db, {
      provider: 'sqlite',
      schema: { user: users, session: sessions, account: accounts, verification: verifications },
    }),
    session: {
      expiresIn: 60 * 60 * 24 * 90, // 90 days
      updateAge: 60 * 60 * 24, // refresh daily
    },
    advanced: {
      // Cloudflare sets this to the real client IP on every request (Better Auth's rate limits).
      ipAddress: { ipAddressHeaders: ['cf-connecting-ip'] },
    },
    account: {
      // Links a social sign-in to an existing email/OTP account with the same email address (issue
      // #24 design point 3), but deliberately without `trustedProviders`: reading Better Auth 1.7.5's
      // source (oauth2/link-account.ts), `trustedProviders` is a bypass that allows linking even when
      // the provider's own profile says the email is *not* verified. Leaving it unset means Better
      // Auth's default check applies instead - link only when the incoming profile is verified
      // (Google's `email_verified`, Discord's `verified`, LinkedIn's `email_verified`; Apple's emails
      // are always verified) - which is exactly the "only link verified emails" rule this feature
      // needs, so no extra mapping is needed to enforce it.
      accountLinking: { enabled: true },
    },
    user: {
      additionalFields: {
        // Populated only by mapProfileToUser above, via the OAuth provider-profile path. Never
        // `input: false`: that flag also blocks Better Auth's own provider-profile mapping from
        // writing it (parseAdditionalUserInputFromProviderProfile skips `input: false` fields), not
        // just client input. It's still not client-settable in practice: Better Auth's own
        // /update-user and /sign-up/email endpoints, the only routes that would accept it from a
        // request body, are both in DISABLED_AUTH_PATHS above.
        discordUsername: { type: 'string', required: false },
      },
      // Runs before create-user, link-account, and (for OAuth) sign-in, across *every* auth method,
      // including plain email-otp - so this only rejects the OAuth path (`source.method === 'oauth'`).
      // The reviewer's own sign-in (the fixed OTP code, checked in otpRateLimit/reviewer.ts) must keep
      // working; only reaching that account via social sign-in or linking is what issue #24 blocks.
      validateUserInfo: ({ user, source }) => {
        if (source.method !== 'oauth') return;
        const email = user.email;
        if (!email) return;
        if (isReviewerEmail(email)) {
          return { error: 'reviewer_blocked', errorDescription: "This account can't be used with social sign-in." };
        }
        if (isBannedEmail(env, email)) {
          return { error: 'account_banned', errorDescription: "This email can't be used to sign in to Chatsoon." };
        }
      },
    },
    databaseHooks: {
      session: {
        create: {
          // Nothing reads them, and the privacy policy keeps IPs and device strings (technical
          // logs) for 30 days at most, while a session lasts up to 90 days and keeps refreshing.
          before: async (session) => ({ data: { ...session, ipAddress: null, userAgent: null } }),
        },
      },
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
    socialProviders,
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

export type Auth = Awaited<ReturnType<typeof createAuth>>;

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

/**
 * Sign-in codes mailed per hour across all users. Well above launch traffic and well below what
 * the email provider allows. Past it no code is mailed until the next hour, so a flood of
 * requests for random addresses can't run up bounces and get the sending account paused.
 */
export const OTP_SENDS_PER_HOUR_MAX = 600;
/**
 * Checks of the fixed reviewer code per UTC day, across all locations (the rate limit bindings
 * count per location). At this rate guessing the 6 digit code takes years on average.
 */
export const REVIEWER_CHECKS_PER_DAY_MAX = 500;

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

interface OtpBody {
  email: string | null;
  otp: string | null;
  type: string | null;
}

async function otpBody(req: Request): Promise<OtpBody> {
  const text = (v: unknown) => (typeof v === 'string' && v.trim() ? v : null);
  try {
    const body = (await req.clone().json()) as Record<string, unknown> | null;
    return { email: text(body?.email), otp: text(body?.otp), type: text(body?.type) };
  } catch {
    return { email: null, otp: null, type: null };
  }
}

/**
 * Adds one to a counter shared by every Cloudflare location and returns the new count. The count
 * starts again every `windowMs`. Kept as a row in Better Auth's verifications table, which Better
 * Auth sweeps once the row expires (a window after it ends), so it needs no table of its own.
 */
export async function bumpCounter(env: Env, name: string, windowMs: number): Promise<number> {
  const now = Date.now();
  const start = now - (now % windowMs);
  const id = `counter:${name}:${start}`;
  const row = await env.DB.prepare(
    `insert into verifications (id, identifier, value, expires_at, created_at, updated_at)
     values (?1, ?1, '1', ?2, ?3, ?3)
     on conflict (id) do update set value = cast(value as integer) + 1, updated_at = ?3
     returning value`,
  )
    .bind(id, start + 2 * windowMs, now)
    .first<{ value: string | number }>();
  return Number(row?.value ?? 0);
}

/** True for an address in BANNED_EMAILS (users removed by moderation), matched like emailLimitKey. */
export function isBannedEmail(env: Env, email: string): boolean {
  if (!env.BANNED_EMAILS) return false;
  const key = emailLimitKey(email);
  return env.BANNED_EMAILS.split(',').some((banned) => banned.trim() !== '' && emailLimitKey(banned) === key);
}

/**
 * Checks the reviewer's code before Better Auth does. A wrong guess never reaches Better Auth, so
 * guesses can't use up the attempts on the reviewer's stored code and lock App Review out. Every
 * check counts toward a daily budget shared by all locations, which caps guessing the fixed code.
 */
async function reviewerCodeMatches(env: Env, otp: string | null): Promise<boolean> {
  const checks = await bumpCounter(env, 'reviewer-otp-checks', DAY_MS);
  if (checks > REVIEWER_CHECKS_PER_DAY_MAX) {
    if (checks === REVIEWER_CHECKS_PER_DAY_MAX + 1) {
      console.error('Reviewer code checks over the daily budget. Someone may be guessing it.', checks);
    }
    throw rateLimited();
  }
  const code = reviewerCode(env);
  return !!code && otp !== null && timingSafeEqual(otp, code);
}

/**
 * Guards sending and checking sign-in codes, in front of Better Auth. Reads the body from a clone
 * and leaves the original request untouched for Better Auth. Throws through onError.
 * - Per client IP (OTP_SEND_IP_LIMITER for sends, OTP_IP_LIMITER for checks) and per email
 *   (OTP_LIMITER), so rotating IPs can't flood one inbox or keep guessing one account's code.
 * - A global hourly cap on mailed codes (OTP_SENDS_PER_HOUR_MAX).
 * - Addresses in BANNED_EMAILS can't sign in.
 * - The reviewer's fixed code is checked here (reviewerCodeMatches).
 */
export const otpRateLimit: MiddlewareHandler<AppEnv> = async (c, next) => {
  const path = new URL(c.req.url).pathname.replace(/\/+$/, '');
  const scope = c.req.method === 'POST' ? OTP_LIMITED_PATHS[path] : undefined;
  if (!scope) return next();

  await limit(scope === 'otp' ? c.env.OTP_SEND_IP_LIMITER : c.env.OTP_IP_LIMITER, ipKey(c, scope));
  const { email, otp, type } = await otpBody(c.req.raw);
  // Better Auth doesn't cap the length, and no real inbox has a longer address.
  if (email && email.length > MAX_EMAIL_LENGTH) throw badRequest('Enter a valid email address.');
  if (email && isBannedEmail(c.env, email)) throw forbidden("This email can't be used to sign in to Chatsoon.");

  const reviewer = !!email && isActiveReviewer(c.env, email);
  // Like ipKey, the email bucket only applies behind Cloudflare (always there in production),
  // so local dev and the test suite, which reuse addresses, are not throttled. Nothing is mailed
  // to the active reviewer, so their send bucket is skipped: a flood of requests can't lock App
  // Review out. Checking the fixed code stays limited per email.
  const perEmail = email && clientIp(c) && !(scope === 'otp' && reviewer);
  if (perEmail) await limit(c.env.OTP_LIMITER, `${scope}-email:${emailLimitKey(email)}`);

  if (scope === 'otp-verify' && reviewer && !(await reviewerCodeMatches(c.env, otp))) {
    // The same answer Better Auth gives for a wrong code.
    return c.json({ code: 'INVALID_OTP', message: 'Invalid OTP' }, 400);
  }

  // Only sign-in codes are mailed (sendVerificationOTP), and never to the reviewer.
  if (scope === 'otp' && type === 'sign-in' && email && !reviewer) {
    const sent = await bumpCounter(c.env, 'otp-sends', HOUR_MS);
    if (sent > OTP_SENDS_PER_HOUR_MAX) {
      // Logged once per hour: alert on this line.
      if (sent === OTP_SENDS_PER_HOUR_MAX + 1) console.error('OTP send circuit open', sent);
      throw new ApiError(503, 'internal', "We can't send sign-in codes right now. Please try again later.");
    }
  }
  return next();
};
