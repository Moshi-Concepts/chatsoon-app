import type { Env } from '../env';

// Referral config (issue #11, docs/referrals.md "Config"). PR 1 added the two Discord/X eligibility
// thresholds (GET /me/connected-accounts); PR 2 (lib/referrals.ts, routes/referrals.ts) adds the rest.
// Every numeric var is parsed with a fallback so a missing/blank var (e.g. an older deploy) never throws.

const intVar = (value: string | undefined, fallback: number): number => {
  const n = Number.parseInt(value ?? '', 10);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
};

/** Minimum Discord account age, in days, for a linked Discord to count as eligible. Default 90. */
export const referralDiscordMinAgeDays = (env: Env): number => intVar(env.REFERRAL_DISCORD_MIN_AGE_DAYS, 90);

/** Minimum X follower count for a linked X account to count as eligible. Default 50. */
export const referralXMinFollowers = (env: Env): number => intVar(env.REFERRAL_X_MIN_FOLLOWERS, 50);

/** Kill switch. Defaults closed ("false") so an older/misconfigured deploy never opens attribution by accident. */
export const referralEnabled = (env: Env): boolean => env.REFERRAL_ENABLED === 'true';

/** Qualified referrals for the permanent milestone badge. Default 10. */
export const referralFounderThreshold = (env: Env): number => intVar(env.REFERRAL_FOUNDER_THRESHOLD, 10);

/** How many people can ever be numbered 'founder'. Default 100. */
export const referralFounderCap = (env: Env): number => intVar(env.REFERRAL_FOUNDER_CAP, 100);

/** Qualified referrals to unlock the reward claim. Default 20. */
export const referralClaimThreshold = (env: Env): number => intVar(env.REFERRAL_CLAIM_THRESHOLD, 20);

/** Points credited to the referrer once a referral qualifies. Default 100. */
export const referralPointsPerReferral = (env: Env): number => intVar(env.REFERRAL_POINTS_PER_REFERRAL, 100);

/** Points credited to the referred person the moment their attribution is accepted. Default 1. */
export const referralPointsForJoining = (env: Env): number => intVar(env.REFERRAL_POINTS_FOR_JOINING, 1);

/** Days after attribution before a pending referral can qualify. Default 7. */
export const referralHoldDays = (env: Env): number => intVar(env.REFERRAL_HOLD_DAYS, 7);

/** A caller's account must be at most this many days old to attribute a code. Default 14. */
export const referralAttributionDays = (env: Env): number => intVar(env.REFERRAL_ATTRIBUTION_DAYS, 14);

/** Days a pending/rejected referral gets before the sweep gives up on it. Default 60. */
export const referralMaxPendingDays = (env: Env): number => intVar(env.REFERRAL_MAX_PENDING_DAYS, 60);

/** Invites one account can send per UTC day. Default 20. */
export const referralInviteDailyPerUser = (env: Env): number => intVar(env.REFERRAL_INVITE_DAILY_PER_USER, 20);

/** The partner's landing page; POST /me/referral/claims appends `?token=`. No default: unset means claims can't issue a URL. */
export const referralClaimUrl = (env: Env): string | undefined => env.REFERRAL_CLAIM_URL || undefined;
