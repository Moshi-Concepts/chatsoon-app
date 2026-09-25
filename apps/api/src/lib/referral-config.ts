import type { Env } from '../env';

// Numeric referral config (issue #11, docs/referrals.md "Config"). Only the two values PR 1 needs
// (the Discord/X eligibility thresholds for GET /me/connected-accounts) live here; the rest of
// docs/referrals.md's REFERRAL_* vars are PR 2's concern (lib/referrals.ts).

const intVar = (value: string | undefined, fallback: number): number => {
  const n = Number.parseInt(value ?? '', 10);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
};

/** Minimum Discord account age, in days, for a linked Discord to count as eligible. Default 90. */
export const referralDiscordMinAgeDays = (env: Env): number => intVar(env.REFERRAL_DISCORD_MIN_AGE_DAYS, 90);

/** Minimum X follower count for a linked X account to count as eligible. Default 50. */
export const referralXMinFollowers = (env: Env): number => intVar(env.REFERRAL_X_MIN_FOLLOWERS, 50);
