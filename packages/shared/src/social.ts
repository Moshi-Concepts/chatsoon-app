// Referrals (issue #11, PR 1): the identity checks behind "has an eligible social account".
// Plain string/BigInt only, no `URL` class, so `apps/web` can import this module path directly
// without pulling in anything DOM-shaped. See docs/referrals.md "Capturing the checks".

/**
 * Providers whose linked `accounts` row counts toward a referral's social-account requirement
 * (docs/referrals.md "Decisions"). Deliberately separate from `SOCIAL_PROVIDERS` (constants.ts),
 * which is the *sign-in* provider list shown on the sign-in screen: `twitter` (X) can't sign
 * someone in (it never returns an email, see lib/auth.ts), so it's link-only and never appears in
 * `SOCIAL_PROVIDERS`, but it does count here once linked and eligible.
 */
export const SOCIAL_VALIDATION_PROVIDERS = ['google', 'apple', 'discord', 'linkedin', 'twitter'] as const;
export type SocialValidationProvider = (typeof SOCIAL_VALIDATION_PROVIDERS)[number];

/** Providers Better Auth captures a `social_checks` row for. Google, Apple and LinkedIn are
 * eligible the moment they're linked, so there's nothing to check or store for them. */
export const SOCIAL_CHECK_PROVIDERS = ['discord', 'twitter'] as const;
export type SocialCheckProvider = (typeof SOCIAL_CHECK_PROVIDERS)[number];

/** Why a linked Discord or X account isn't eligible yet (GET /me/connected-accounts, referrals.ts). */
export type SocialIneligibleReason = 'discord_age' | 'discord_mfa' | 'x_not_verified' | 'x_followers';

/** Discord ids are snowflakes: ms since the Discord epoch (2015-01-01) in the top 42 bits. */
export const DISCORD_EPOCH_MS = 1420070400000;

/** Decodes a Discord snowflake id to its creation time (ms since epoch). Plain BigInt shift, no
 * network call needed, so this is safe to run live at read time (GET /me/connected-accounts, the
 * qualification sweep) rather than needing a stored value. */
export const discordCreatedAt = (id: string) => Number(BigInt(id) >> 22n) + DISCORD_EPOCH_MS;

/**
 * True if a linked Discord account counts for a referral: 2FA was on when it was linked (the
 * `social_checks.mfa_enabled` snapshot; Discord's OAuth2 user object gives no live way to re-check
 * this later) and the account is at least `minAgeDays` old, computed live from its id.
 */
export function discordEligible(
  check: { providerAccountId: string; mfaEnabled: boolean },
  minAgeDays: number,
  now = Date.now(),
): boolean {
  return check.mfaEnabled && discordCreatedAt(check.providerAccountId) <= now - minAgeDays * 86_400_000;
}

/**
 * True if a linked X account counts for a referral: verified (any `verified_type` but `'none'`) or
 * ID verified, and at least `minFollowers` followers, both as reported when it was linked (X billing
 * means it's never re-read later; see docs/referrals.md).
 */
export function xEligible(
  check: { verified: boolean; identityVerified: boolean; followersCount: number },
  minFollowers: number,
): boolean {
  return (check.verified || check.identityVerified) && check.followersCount >= minFollowers;
}
