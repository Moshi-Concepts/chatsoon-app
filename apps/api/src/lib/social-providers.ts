import type { DiscordProfile, TwitterProfile } from 'better-auth/social-providers';

import { rememberSocialCheck } from './social-checks';

// Custom `getUserInfo` overrides for Better Auth's discord/twitter social providers (issue #11).
// Setting `options.getUserInfo` on either provider makes Better Auth call this instead of its own
// built-in fetch (node_modules/@better-auth/core/src/social-providers/{discord,twitter}.ts: both
// start with `if (options.getUserInfo) return options.getUserInfo(token)`), so each of these
// replicates just enough of the original behaviour to avoid a regression (Discord's avatar URL, the
// `discordUsername` prefill from issue #24) while adding the one thing docs/referrals.md needs: a
// `rememberSocialCheck` call with the raw check fields, picked up by lib/auth.ts's
// `databaseHooks.account.create`/`update` (see lib/social-checks.ts for why the hand-off works this
// way instead of a simpler-looking option). `data:` in each return value must satisfy Better Auth's
// own `DiscordProfile`/`TwitterProfile` types (imported from `better-auth/social-providers`, not
// hand-rolled) since `providers.discord`/`providers.twitter` (lib/auth.ts) are typed against them.

interface OAuthToken {
  accessToken?: string;
}

/** Copied from the default provider's getUserInfo so a missing avatar still gets Discord's default. */
function discordAvatarUrl(profile: DiscordProfile): string {
  if (!profile.avatar) {
    const defaultAvatarNumber =
      profile.discriminator === '0' ? Number(BigInt(profile.id) >> 22n) % 6 : Number.parseInt(profile.discriminator, 10) % 5;
    return `https://cdn.discordapp.com/embed/avatars/${defaultAvatarNumber}.png`;
  }
  const format = profile.avatar.startsWith('a_') ? 'gif' : 'png';
  return `https://cdn.discordapp.com/avatars/${profile.id}/${profile.avatar}.${format}`;
}

/**
 * Discord's `getUserInfo` plus `social_checks` capture (docs/referrals.md "Capturing the checks").
 * Runs on every Discord sign-in *and* link (Better Auth calls this once per OAuth callback either
 * way; see lib/social-checks.ts).
 */
export async function discordGetUserInfo(token: OAuthToken) {
  if (!token.accessToken) return null;
  const res = await fetch('https://discord.com/api/users/@me', {
    headers: { authorization: `Bearer ${token.accessToken}` },
  });
  if (!res.ok) return null;
  // Cast, like Better Auth's own default implementation's `betterFetch<DiscordProfile>(...)` does:
  // there's no runtime validation of Discord's response shape either way.
  const profile = (await res.json()) as DiscordProfile;
  rememberSocialCheck('discord', profile.id, {
    mfaEnabled: profile.mfa_enabled === true,
    verified: false,
    identityVerified: false,
    followersCount: 0,
    discordUsername: profile.username,
  });
  return {
    user: {
      name: profile.global_name || profile.username || '',
      email: profile.email,
      emailVerified: profile.verified === true,
      image: discordAvatarUrl(profile),
      // Same additionalFields hand-off `mapProfileToUser` used before this override (buildSocialProviders):
      // any extra property on the returned `user` that matches a configured `user.additionalFields`
      // schema entry (discordUsername) gets copied onto the local user row.
      discordUsername: profile.username,
    },
    data: profile,
  };
}

/**
 * Better Auth's own `TwitterProfile.data` (better-auth/social-providers) only declares the fields
 * its *default* fetch requests (docs/referrals.md notes this: "asks for a minimal user.fields"), so
 * it's missing the three this override additionally asks X for. Extending it (rather than a fresh
 * interface) keeps the return value a structural subtype of `TwitterProfile`, which is what
 * `data:` below must satisfy.
 */
type XProfile = TwitterProfile & {
  data: TwitterProfile['data'] & {
    verified_type?: 'none' | 'blue' | 'business' | 'government';
    is_identity_verified?: boolean;
    public_metrics?: { followers_count?: number };
  };
};

const TWITTER_USER_FIELDS = 'username,name,profile_image_url,verified,verified_type,is_identity_verified,public_metrics';

/**
 * X's `getUserInfo` (issue #11). No email scope is requested (docs/referrals.md "Adding X" -
 * `users.read tweet.read` only), so X never supplies one: a stable, synthetic placeholder address
 * stands in instead (`<x id>@twitter.placeholder.invalid`, the same non-routable pattern
 * `.invalid` domain Better Auth's own `createPlaceholderEmail` uses per RFC 6761 §6.4), with
 * `emailVerified: false` since there's nothing to verify. This is also why X is link-only: see
 * lib/auth.ts's `hooks.before` for where sign-in via twitter is refused outright.
 *
 * A 402 (credit/billing) or any other non-2xx from X returns null, before Better Auth's callback
 * touches the `accounts` table (node_modules/better-auth/dist/api/routes/callback.mjs calls
 * `getUserInfo` first), so nothing is written. Better Auth then redirects to the link flow's
 * errorCallbackURL with `?error=unable_to_get_user_info`, which Connected accounts turns into a
 * "try again in a few minutes" message. Throwing instead would strand the user on a bare 502 page from
 * api.chatsoon.app mid-OAuth.
 */
export async function twitterGetUserInfo(token: OAuthToken) {
  if (!token.accessToken) return null;
  const res = await fetch(`https://api.x.com/2/users/me?user.fields=${TWITTER_USER_FIELDS}`, {
    headers: { authorization: `Bearer ${token.accessToken}` },
  });
  if (!res.ok) {
    if (res.status === 402) console.error('X users/me returned 402: the X API credit balance needs topping up');
    return null;
  }
  // X's response is `{ data: {...} }`; `data:` below is the whole response object (matching
  // TwitterProfile's shape), while `profile` here is the nested user object with the fields we read.
  const body = (await res.json()) as XProfile;
  const profile = body.data;
  const verified = profile.verified === true && profile.verified_type !== 'none';
  const identityVerified = profile.is_identity_verified === true;
  const followersCount = profile.public_metrics?.followers_count ?? 0;
  rememberSocialCheck('twitter', profile.id, { mfaEnabled: false, verified, identityVerified, followersCount });
  return {
    user: {
      name: profile.name,
      email: `${profile.id}@twitter.placeholder.invalid`,
      emailVerified: false,
      image: profile.profile_image_url,
    },
    data: body,
  };
}
