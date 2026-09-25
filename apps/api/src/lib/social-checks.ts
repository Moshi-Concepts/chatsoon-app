import { eq } from 'drizzle-orm';

import { socialChecks, users } from '../db/schema';
import type { DB } from './db';

// Referrals (issue #11, docs/referrals.md "Capturing the checks"): the identity-check snapshot for
// a linked Discord or X account, captured on every sign-in *or* link.
//
// Better Auth's OAuth callback calls `provider.getUserInfo(token)` exactly once per callback (sign-in
// and link alike, see node_modules/better-auth/dist/api/routes/callback.mjs), which is where the raw
// provider profile (mfa_enabled, verified, ...) is available - but at that point Better Auth hasn't
// yet decided which local user the account belongs to (for an explicit `/link-social`, the user id
// travels inside an encrypted `state` value decoded later in that same callback, not exposed to the
// provider). `databaseHooks.account.create.after` / `.update.after` (node_modules/better-auth/dist/
// db/with-hooks.mjs) run right after Better Auth writes the `accounts` row, and *do* get the exact
// row (userId, providerId, accountId) - but Better Auth's `Account` schema has no column for
// provider-specific profile fields (the same reason `discordUsername` lives on `users` instead, see
// buildSocialProviders in lib/auth.ts), so the hook alone can't see mfa_enabled/verified/etc.
//
// This module bridges the two: `rememberSocialCheck` (called from a provider's `getUserInfo`
// override) stashes the mapped fields keyed by `${providerId}:${accountId}`; `captureSocialCheck`
// (called from the database hooks) looks the entry up by the account row it was just handed and
// upserts `social_checks`, refreshing `checked_at` every time - so a Reconnect (re-linking the same
// account) always refreshes `mfa_enabled`/`verified`/`followers_count`. The map is keyed by the
// external provider account id (not by user or by request), so two genuinely concurrent callbacks in
// the same isolate can't cross-contaminate different users; a short TTL sweep is a backstop for a
// callback that fails before reaching the database write and would otherwise never consume its entry.

export interface SocialCheckFields {
  /** Discord mfa_enabled. Always false for X. */
  mfaEnabled: boolean;
  /** X: verified && verified_type !== 'none'. Always false for Discord. */
  verified: boolean;
  /** X is_identity_verified. Always false for Discord. */
  identityVerified: boolean;
  /** X public_metrics.followers_count. Always 0 for Discord. */
  followersCount: number;
  /**
   * Discord's username, for GET /me/connected-accounts' `label` (docs/referrals.md "Account
   * linking"). Not part of `social_checks` (that table has no room for it either - same as
   * Better Auth's own `accounts` row); persisted onto `users.discord_username` instead, the
   * existing issue #24 column. Undefined for X: there's nowhere in the schema docs/referrals.md
   * specifies to store the X handle, so `GET /me/connected-accounts` omits `label` for twitter -
   * see the PR notes.
   */
  discordUsername?: string;
}

const pending = new Map<string, { fields: SocialCheckFields; storedAt: number }>();
/** Backstop only: every normal callback consumes its own entry well within this. */
const PENDING_TTL_MS = 5 * 60 * 1000;

const pendingKey = (providerId: string, accountId: string) => `${providerId}:${accountId}`;

/** Called once per OAuth callback from a provider's `getUserInfo` override (discord, twitter). */
export function rememberSocialCheck(providerId: string, accountId: string, fields: SocialCheckFields): void {
  const now = Date.now();
  for (const [k, v] of pending) {
    if (now - v.storedAt > PENDING_TTL_MS) pending.delete(k);
  }
  pending.set(pendingKey(providerId, accountId), { fields, storedAt: now });
}

/**
 * Called from `databaseHooks.account.create.after` / `.update.after` for every account row Better
 * Auth writes. A no-op for any provider that never called `rememberSocialCheck` for this exact
 * (providerId, accountId) - i.e. every provider but discord/twitter, and any discord/twitter row
 * this module didn't see the callback for.
 */
export async function captureSocialCheck(
  db: DB,
  account: { userId: string; providerId: string; accountId: string },
): Promise<void> {
  const k = pendingKey(account.providerId, account.accountId);
  const entry = pending.get(k);
  if (!entry) return;
  pending.delete(k);
  const { fields } = entry;
  const checkedAt = new Date();
  await db
    .insert(socialChecks)
    .values({
      userId: account.userId,
      provider: account.providerId,
      providerAccountId: account.accountId,
      mfaEnabled: fields.mfaEnabled,
      verified: fields.verified,
      identityVerified: fields.identityVerified,
      followersCount: fields.followersCount,
      checkedAt,
    })
    .onConflictDoUpdate({
      target: [socialChecks.userId, socialChecks.provider],
      set: {
        providerAccountId: account.accountId,
        mfaEnabled: fields.mfaEnabled,
        verified: fields.verified,
        identityVerified: fields.identityVerified,
        followersCount: fields.followersCount,
        checkedAt,
      },
    });
  // Better Auth only copies `discordUsername` onto `users` via its own additionalFields mechanism
  // when the *account* is created (a fresh sign-up via Discord); an explicit /link-social (Discord
  // connected after an email sign-up - the Connected accounts screen's main case) never runs that
  // path (`accountLinking.updateUserInfoOnLink` is deliberately left off - see lib/auth.ts - so a
  // link never overwrites the local `name`/`image` either). Refreshing it here instead, from the
  // same profile read that populated `fields`, means the connected-accounts label is right for a
  // linked (not just signed-up) Discord, and for a Reconnect after a username change.
  if (account.providerId === 'discord' && fields.discordUsername) {
    await db.update(users).set({ discordUsername: fields.discordUsername }).where(eq(users.id, account.userId));
  }
}

/** Test-only: clears the isolate-wide pending map so tests don't leak into each other. */
export function resetSocialChecksCacheForTests(): void {
  pending.clear();
}
