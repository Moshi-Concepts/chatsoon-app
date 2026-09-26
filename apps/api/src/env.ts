import type { OgRendererRpc } from '@chatsoon/shared/src/og';

export interface Env {
  DB: D1Database;
  FILES: R2Bucket;
  /** The chatsoon-og Worker (apps/og), bound by service entrypoint. Absent gives the Free-plan fallback. */
  OG?: OgRendererRpc;
  /** Cloudflare Images, used to make the 416x416 WebP avatar variant (Stage F, D8). Absent (a
   * lower-tier account, or a test env) falls back to serving the original avatar unresized. */
  IMAGES?: ImagesBinding;
  CONNECT_LIMITER: RateLimit;
  /** Global per-IP cap across every slug (D24), checked before CONNECT_LIMITER. */
  CONNECT_ANY_LIMITER: RateLimit;
  /** Per email. */
  OTP_LIMITER: RateLimit;
  /** Checking codes, per IP, looser: a conference venue can share one IP. */
  OTP_IP_LIMITER: RateLimit;
  /** Sending codes, per IP. Each send is a real email. */
  OTP_SEND_IP_LIMITER: RateLimit;
  SCAN_LIMITER: RateLimit;
  UPLOAD_LIMITER: RateLimit;
  EXTRACT_LIMITER: RateLimit;
  /** Per user, on AI follow-up drafts (issue #33 PR B). */
  FOLLOWUP_LIMITER: RateLimit;
  REPORT_LIMITER: RateLimit;
  /** Per user, on writes that add rows. */
  WRITE_LIMITER: RateLimit;
  /** Per IP, on profile lookups that find nothing. Shared by GET /id/:slug and GET /_pages/*. */
  PROFILE_MISS_LIMITER: RateLimit;
  /** Per IP, on POST /me/referral/attribute (code guessing). */
  REFERRAL_ATTRIBUTE_LIMITER: RateLimit;

  /** Kill switch for personalised share cards (O20). "false", or no OG binding, uses the default image. */
  OG_CARDS_ENABLED: string;

  WEB_ORIGIN: string;
  API_ORIGIN: string;
  EXTRA_ORIGINS: string;
  EMAIL_PROVIDER: 'resend' | 'log';
  EMAIL_FROM: string;
  REPORTS_NOTIFY_EMAIL: string;
  REVIEWER_ENABLED: string;
  /** Comma separated emails of removed users. Empty or unset: nobody. */
  BANNED_EMAILS?: string;
  EXTRACT_MODEL: string;
  /** "false" turns card extraction off (kill switch). */
  EXTRACT_ENABLED?: string;
  /** Card extractions per account per UTC day. */
  EXTRACT_DAILY_PER_USER?: string;
  /** Card extractions across all accounts per UTC day. */
  EXTRACT_DAILY_TOTAL?: string;
  /** Model for AI follow-up drafts (issue #33 PR B), defaulting like EXTRACT_MODEL to claude-haiku-4-5. */
  FOLLOWUP_MODEL?: string;
  /** "false" turns the AI draft off entirely (kill switch); the route always falls back to the template. */
  FOLLOWUP_AI_ENABLED?: string;
  /** AI follow-up drafts per account per UTC day. */
  FOLLOWUP_DAILY_PER_USER?: string;
  /** AI follow-up drafts across all accounts per UTC day. */
  FOLLOWUP_DAILY_TOTAL?: string;

  // Secrets
  BETTER_AUTH_SECRET: string;
  RESEND_API_KEY?: string;
  ANTHROPIC_API_KEY?: string;
  TURNSTILE_SECRET: string;
  FILE_SIGNING_SECRET: string;
  REVIEWER_CODE?: string;
  /** Shared with the web Function; gates GET /_pages/* (§3.3). Unset means those routes 404. */
  PAGES_SHARED_SECRET?: string;

  // Social sign-in (issue #24). Each provider is only added to Better Auth's socialProviders once
  // every one of its secrets below is set (lib/auth.ts buildSocialProviders); with none set, the API
  // behaves exactly as before. GET /auth-providers reports which are live.
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  LINKEDIN_CLIENT_ID?: string;
  LINKEDIN_CLIENT_SECRET?: string;
  DISCORD_CLIENT_ID?: string;
  DISCORD_CLIENT_SECRET?: string;
  /** Apple's Services ID (not the app's bundle id). */
  APPLE_CLIENT_ID?: string;
  APPLE_TEAM_ID?: string;
  /** The key id of the .p8 signing key below. */
  APPLE_KEY_ID?: string;
  /** The full contents of the .p8 private key Apple issues for APPLE_KEY_ID (PEM, PKCS8). Used to
   * sign Apple's client secret JWT ourselves (lib/apple-client-secret.ts); never logged. */
  APPLE_PRIVATE_KEY?: string;
  /** X (Twitter), issue #11. Link-only: X never returns an email, so it's excluded from sign-in
   * (GET /auth-providers' `providers`) but appears in `linkProviders` once both are set. */
  TWITTER_CLIENT_ID?: string;
  TWITTER_CLIENT_SECRET?: string;

  // Referrals (issue #11, docs/referrals.md). Parsed as numbers with defaults by
  // lib/referral-config.ts, so a missing/blank var (e.g. an older deploy) doesn't throw.
  /** Minimum Discord account age, in days, for a linked Discord to count as eligible. Default 90. */
  REFERRAL_DISCORD_MIN_AGE_DAYS?: string;
  /** Minimum X follower count for a linked X account to count as eligible. Default 50. */
  REFERRAL_X_MIN_FOLLOWERS?: string;
  /** Kill switch (docs/referrals.md "Release" step 1): "false" (the shipped default) makes
   * POST /me/referral/attribute, /me/referral/invites and /me/referral/claims answer
   * `referral_disabled`; GET /me/referral and GET /referral/:code still work either way. */
  REFERRAL_ENABLED?: string;
  /** Qualified referrals for the permanent milestone badge (founder/early_adopter). Default 10. */
  REFERRAL_FOUNDER_THRESHOLD?: string;
  /** How many people can ever be numbered 'founder'; everyone after gets 'early_adopter'. Default 100. */
  REFERRAL_FOUNDER_CAP?: string;
  /** Qualified referrals to unlock the reward claim. Default 20. */
  REFERRAL_CLAIM_THRESHOLD?: string;
  /** Points credited to the referrer once a referral qualifies. Default 100. */
  REFERRAL_POINTS_PER_REFERRAL?: string;
  /** Points credited to the referred person the moment their attribution is accepted. Default 1. */
  REFERRAL_POINTS_FOR_JOINING?: string;
  /** Days after attribution before a pending referral can qualify. Default 7. */
  REFERRAL_HOLD_DAYS?: string;
  /** A caller's account must be this many days old (or younger) to attribute a code. Default 14. */
  REFERRAL_ATTRIBUTION_DAYS?: string;
  /** Days a pending/rejected referral gets before the sweep gives up on it (status 'void'). Default 60. */
  REFERRAL_MAX_PENDING_DAYS?: string;
  /** Invites one account can send per UTC day (usage_counters `refinvite:user:<id>:<day>`). Default 20. */
  REFERRAL_INVITE_DAILY_PER_USER?: string;
  /** The partner's landing page; POST /me/referral/claims appends `?token=`. */
  REFERRAL_CLAIM_URL?: string;
  /** Bearer secret for the two partner endpoints (GET/POST /referral/claims/*). Unset: always 401 - never open. */
  REFERRAL_PARTNER_SECRET?: string;
  /** HMAC key for `referrals.ip_hash`/`ua_hash`. Unset: both columns are stored null. */
  REFERRAL_HASH_SECRET?: string;
}

export interface AuthedUser {
  id: string;
  email: string;
}

export type AppEnv = {
  Bindings: Env;
  Variables: {
    /** Set by requireAuth. */
    user: AuthedUser;
  };
};
