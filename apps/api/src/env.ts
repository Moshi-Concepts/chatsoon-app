import type { OgRendererRpc } from '@chatsoon/shared/src/og';

export interface Env {
  DB: D1Database;
  FILES: R2Bucket;
  /** The chatsoon-og Worker (apps/og), bound by service entrypoint. Absent gives the Free-plan fallback. */
  OG?: OgRendererRpc;
  CONNECT_LIMITER: RateLimit;
  /** Per email. */
  OTP_LIMITER: RateLimit;
  /** Checking codes, per IP, looser: a conference venue can share one IP. */
  OTP_IP_LIMITER: RateLimit;
  /** Sending codes, per IP. Each send is a real email. */
  OTP_SEND_IP_LIMITER: RateLimit;
  SCAN_LIMITER: RateLimit;
  UPLOAD_LIMITER: RateLimit;
  EXTRACT_LIMITER: RateLimit;
  REPORT_LIMITER: RateLimit;
  /** Per user, on writes that add rows. */
  WRITE_LIMITER: RateLimit;
  /** Per IP, on profile lookups that find nothing. Shared by GET /id/:slug and GET /_pages/*. */
  PROFILE_MISS_LIMITER: RateLimit;

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

  // Secrets
  BETTER_AUTH_SECRET: string;
  RESEND_API_KEY?: string;
  ANTHROPIC_API_KEY?: string;
  TURNSTILE_SECRET: string;
  FILE_SIGNING_SECRET: string;
  REVIEWER_CODE?: string;
  /** Shared with the web Function; gates GET /_pages/* (§3.3). Unset means those routes 404. */
  PAGES_SHARED_SECRET?: string;
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
