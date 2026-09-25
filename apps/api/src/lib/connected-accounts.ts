import type { ConnectedAccountsResponse, SocialValidationProvider } from '@chatsoon/shared';
import { discordEligible, SOCIAL_VALIDATION_PROVIDERS, xEligible } from '@chatsoon/shared';
import { and, eq, inArray } from 'drizzle-orm';

import { accounts, socialChecks, users, type SocialCheckRow } from '../db/schema';
import type { Env } from '../env';
import type { DB } from './db';
import { referralDiscordMinAgeDays, referralXMinFollowers } from './referral-config';

// GET /me/connected-accounts (issue #11, docs/referrals.md "Account linking").

function discordReason(check: SocialCheckRow | undefined, minAgeDays: number): 'discord_age' | 'discord_mfa' {
  // A missing check row (never captured, e.g. an account linked before this feature existed) is
  // treated the same as "mfa off" - the more actionable of the two things to ask the user to fix.
  if (!check || !check.mfaEnabled) return 'discord_mfa';
  return 'discord_age';
}

function xReason(check: SocialCheckRow | undefined): 'x_not_verified' | 'x_followers' {
  if (!check || (!check.verified && !check.identityVerified)) return 'x_not_verified';
  return 'x_followers';
}

/**
 * The actual eligibility check for a linked Discord/X `social_checks` row (or its absence). Exported
 * so `lib/referrals.ts`'s `hasEligibleSocial` (issue #11, docs/referrals.md "Qualification and fraud
 * rules") reuses this exact logic instead of re-implementing it against `discordEligible`/`xEligible`.
 */
export function isDiscordEligible(check: SocialCheckRow | undefined, minAgeDays: number): boolean {
  return !!check && discordEligible({ providerAccountId: check.providerAccountId, mfaEnabled: check.mfaEnabled }, minAgeDays);
}

export function isXEligible(check: SocialCheckRow | undefined, minFollowers: number): boolean {
  return !!check && xEligible({ verified: check.verified, identityVerified: check.identityVerified, followersCount: check.followersCount }, minFollowers);
}

/**
 * One row per linked account whose provider is in `SOCIAL_VALIDATION_PROVIDERS` (never the
 * email-OTP `credential` row - it isn't in that list). `label`:
 * - discord: `users.discord_username`, refreshed on every sign-in/link/reconnect (lib/social-checks.ts).
 * - twitter: omitted. Neither `social_checks` (its schema, per docs/referrals.md, has no room for
 *   it) nor anywhere else stores the X handle, so there's nothing to show here yet - flagged in the
 *   PR notes.
 * - google/apple/linkedin: `users.email`. Better Auth's `accounts` row has no per-provider email
 *   column, so this is the account's current email, which may not be the exact address that
 *   provider reported if it differs from a later `allowDifferentEmails` link.
 */
export async function getConnectedAccounts(db: DB, env: Env, userId: string): Promise<ConnectedAccountsResponse> {
  const linked = await db
    .select({ provider: accounts.providerId, createdAt: accounts.createdAt })
    .from(accounts)
    .where(and(eq(accounts.userId, userId), inArray(accounts.providerId, SOCIAL_VALIDATION_PROVIDERS)));
  if (linked.length === 0) return [];

  const [user] = await db.select({ email: users.email, discordUsername: users.discordUsername }).from(users).where(eq(users.id, userId));
  const checkRows = await db.select().from(socialChecks).where(eq(socialChecks.userId, userId));
  const checkByProvider = new Map(checkRows.map((row) => [row.provider, row]));

  const minAgeDays = referralDiscordMinAgeDays(env);
  const minFollowers = referralXMinFollowers(env);

  return linked.map((row): ConnectedAccountsResponse[number] => {
    // `inArray(accounts.providerId, SOCIAL_VALIDATION_PROVIDERS)` filters the query, but doesn't
    // narrow drizzle's column type (plain `text`), so this is a safe cast, not a runtime check.
    const provider = row.provider as SocialValidationProvider;
    const connectedAt = row.createdAt.toISOString();
    if (provider === 'discord') {
      const check = checkByProvider.get('discord');
      const eligible = isDiscordEligible(check, minAgeDays);
      return {
        provider,
        connectedAt,
        label: user?.discordUsername ?? undefined,
        eligible,
        ...(eligible ? {} : { reason: discordReason(check, minAgeDays) }),
      };
    }
    if (provider === 'twitter') {
      const check = checkByProvider.get('twitter');
      const eligible = isXEligible(check, minFollowers);
      return { provider, connectedAt, eligible, ...(eligible ? {} : { reason: xReason(check) }) };
    }
    // google, apple, linkedin: eligible as soon as they're linked (docs/referrals.md "Decisions").
    return { provider, connectedAt, label: user?.email, eligible: true };
  });
}
