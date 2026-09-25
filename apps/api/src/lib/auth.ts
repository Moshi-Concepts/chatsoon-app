import { expo } from '@better-auth/expo';
import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { APIError, createAuthMiddleware } from 'better-auth/api';
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
import { captureSocialCheck } from './social-checks';
import { discordGetUserInfo, twitterGetUserInfo } from './social-providers';

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
 * provider is configured, see buildSocialProviders) sign-in/social, callback/:id and (issue #11)
 * link-social for a signed-in user connecting a further provider.
 *
 * '/sign-in/social' and '/link-social' are removed from this list in createAuth when at least one
 * provider is configured, so with none configured (today's default) behaviour is unchanged: both
 * paths still 404. account-info and list-accounts stay disabled either way (unlink-account isn't
 * used yet either, see the accountLinking comment below).
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
 * Builds Better Auth's `socialProviders` option (issue #24, plus twitter for issue #11): a provider
 * is included only once every one of its secrets is set on `env`, so an unconfigured provider is
 * simply absent, not broken. Exported so GET /auth-providers (src/index.ts) can report the same set
 * without duplicating this gating logic.
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
      // discordGetUserInfo (issue #11) replaces Better Auth's own fetch entirely so it can also
      // capture mfa_enabled for social_checks (lib/social-checks.ts); it still sets discordUsername
      // the same way the old mapProfileToUser option did.
      getUserInfo: discordGetUserInfo,
    };
  }
  if (env.APPLE_CLIENT_ID && env.APPLE_TEAM_ID && env.APPLE_KEY_ID && env.APPLE_PRIVATE_KEY) {
    const clientSecret = await appleClientSecret(env);
    if (clientSecret) providers.apple = { clientId: env.APPLE_CLIENT_ID, clientSecret };
  }
  if (env.TWITTER_CLIENT_ID && env.TWITTER_CLIENT_SECRET) {
    providers.twitter = {
      clientId: env.TWITTER_CLIENT_ID,
      clientSecret: env.TWITTER_CLIENT_SECRET,
      // docs/referrals.md "Adding X": users.read + tweet.read only, no email scope. Better Auth's
      // twitter provider doesn't require offline.access for the initial link (refreshAccessToken is
      // only ever called lazily, never during the callback itself), and this is a one-time identity
      // check, not a standing API integration, so there's no need for a refresh token either.
      disableDefaultScope: true,
      scope: ['users.read', 'tweet.read'],
      // Replaces Better Auth's default X profile fetch (which asks for a minimal user.fields and
      // requests an extra `confirmed_email` scope this app deliberately doesn't use) with the fields
      // docs/referrals.md needs, and captures social_checks the same way discordGetUserInfo does.
      getUserInfo: twitterGetUserInfo,
    };
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
  const ENABLED_WHEN_ANY_PROVIDER = ['/sign-in/social', '/link-social'];
  const disabledPaths = anySocialProvider
    ? DISABLED_AUTH_PATHS.filter((p) => !ENABLED_WHEN_ANY_PROVIDER.includes(p))
    : DISABLED_AUTH_PATHS;

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
      accountLinking: {
        enabled: true,
        // Links a social sign-in to an existing email/OTP account with the same email address (issue
        // #24 design point 3), but deliberately without google/apple/linkedin/discord in
        // `trustedProviders`: reading Better Auth 1.7.5's source (oauth2/link-account.ts, the
        // `isTrustedProvider` check ~line 77), `trustedProviders` is a bypass that allows *auto-linking
        // at sign-in* even when the provider's own profile says the email is *not* verified. Leaving
        // it unset for those four means Better Auth's default check applies instead - auto-link only
        // when the incoming profile is verified (Google's `email_verified`, Discord's `verified`,
        // LinkedIn's `email_verified`; Apple's emails are always verified) - exactly the "only link
        // verified emails" rule docs/referrals.md "Decisions" #1 asks for, so no extra mapping is
        // needed to enforce it.
        //
        // `twitter` IS listed, and must be for /link-social to work at all - this is a second,
        // separate trustedProviders gate that oauth2/link-account.ts doesn't have. The explicit
        // `/link-social` flow itself (api/routes/callback.mjs's `if (link)` branch, ~line 173, and the
        // id-token variant in api/routes/account.mjs, ~line 207) refuses to complete *any* link -
        // automatic or explicit - unless the provider is trusted OR the provider's profile says its
        // email is verified; this check runs before, and independently of, `allowDifferentEmails`
        // below. X never returns an email at all (see social-providers.ts's twitterGetUserInfo), so
        // its `emailVerified` is always false; without `twitter` here, every `/link-social` attempt
        // for X fails with "unable to link account", full stop. Adding it does not reopen the
        // auto-link-at-sign-in risk the paragraph above describes, because that risk needs a
        // *matching real email* on an existing user, and X can never supply one (twitterGetUserInfo
        // always returns a synthetic, per-account placeholder address) - the auto-link-at-sign-in
        // lookup this bypasses can never match an existing user for twitter. Sign-in via twitter is
        // also refused outright below (`hooks.before`), so that code path never runs for it regardless
        // of this setting. This is a place where docs/referrals.md's "never twitter" instruction (for
        // trustedProviders generally) undercovers what Better Auth 1.7.5 actually gates on - flagged
        // in the PR notes for Peter to confirm.
        trustedProviders: ['twitter'],
        // For a signed-in user linking a further provider (docs/referrals.md "Account linking"): the
        // session already proves who's linking, so a work LinkedIn or an Apple relay address is the
        // normal case, not a red flag. Confirmed at node_modules/better-auth/dist/api/routes/
        // {account,callback}.mjs that `allowDifferentEmails` governs only the email-*match* check in
        // the explicit `/link-social` flow (both its id-token and redirect variants) - it has no effect
        // on `oauth2/link-account.ts`'s separate auto-link-at-sign-in path, which always requires a
        // matching email regardless of this setting.
        allowDifferentEmails: true,
      },
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
      account: {
        // Captures social_checks (issue #11, docs/referrals.md "Capturing the checks") on every
        // Discord or X sign-in *or* link. `create` fires for a brand-new sign-up and for auto-link-at-
        // sign-in (`internalAdapter.linkAccount` also goes through `createWithHooks(..., 'account', ...)`,
        // see node_modules/better-auth/dist/db/internal-adapter.mjs); `update` fires for an ordinary
        // re-sign-in via an already-linked account and for an explicit Reconnect through /link-social
        // (node_modules/better-auth/dist/db/with-hooks.mjs's `create.after`/`update.after` get the full
        // written row - id, userId, providerId, accountId - which is exactly the correlation key
        // `captureSocialCheck` needs; see lib/social-checks.ts for why the raw profile fields
        // themselves have to travel a different way, via `getUserInfo`). A no-op for every other
        // provider (google/apple/linkedin/credential), since only discord/twitter's `getUserInfo`
        // ever calls `rememberSocialCheck`.
        create: {
          after: async (account) => {
            await captureSocialCheck(db, account);
          },
        },
        update: {
          after: async (account) => {
            await captureSocialCheck(db, account);
          },
        },
      },
    },
    hooks: {
      before: createAuthMiddleware(async (actx) => {
        // X can't sign in (docs/referrals.md "Adding X": it never returns an email - see
        // social-providers.ts's twitterGetUserInfo), so it's link-only even though it's a normal
        // registered social provider once TWITTER_CLIENT_ID/SECRET are set (GET /auth-providers
        // excludes it from the sign-in `providers` list for the same reason, but that's a UI-level
        // filter Better Auth itself doesn't know about). Refusing it here, not just in the UI, also
        // means the `trustedProviders: ['twitter']` entry above (needed for /link-social, see the
        // comment there) can never reach the auto-link-at-sign-in code path it would otherwise bypass.
        const body = actx.body as { provider?: unknown } | undefined;
        if (actx.path === '/sign-in/social' && body?.provider === 'twitter') {
          throw new APIError('NOT_FOUND', { code: 'PROVIDER_NOT_FOUND', message: 'twitter sign-in is not available' });
        }
      }),
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
