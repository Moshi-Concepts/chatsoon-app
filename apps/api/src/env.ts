export interface Env {
  DB: D1Database;
  FILES: R2Bucket;
  CONNECT_LIMITER: RateLimit;
  /** Per email. */
  OTP_LIMITER: RateLimit;
  /** Per IP, looser: a conference venue can share one IP. */
  OTP_IP_LIMITER: RateLimit;
  SCAN_LIMITER: RateLimit;
  UPLOAD_LIMITER: RateLimit;
  EXTRACT_LIMITER: RateLimit;
  REPORT_LIMITER: RateLimit;

  WEB_ORIGIN: string;
  API_ORIGIN: string;
  EXTRA_ORIGINS: string;
  EMAIL_PROVIDER: 'resend' | 'log';
  EMAIL_FROM: string;
  REPORTS_NOTIFY_EMAIL: string;
  REVIEWER_ENABLED: string;
  EXTRACT_MODEL: string;

  // Secrets
  BETTER_AUTH_SECRET: string;
  RESEND_API_KEY?: string;
  ANTHROPIC_API_KEY?: string;
  TURNSTILE_SECRET: string;
  FILE_SIGNING_SECRET: string;
  REVIEWER_CODE?: string;
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
