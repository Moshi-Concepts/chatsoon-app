import type { AvatarWidth } from '@chatsoon/shared/src/constants';

import { chunk } from './contacts';
import type { Env } from '../env';
import { userPrefix } from './signing';

// The resized WebP avatar variants (Stage F item 2, decision D8; generalised to every AVATAR_WIDTHS
// size by issue #23): key layout and the save-time cleanup PUT /me/profile does when an avatar
// changes or is removed. Each variant is otherwise built lazily, on the first GET /_pages/photo/:slug
// that needs it at that width (pages.ts).

/** Variants for width `w` live under u/<userId>/avatar-<w>/<version>.webp, next to the original
 * avatar and the og/ cards (lib/og.ts). `version` is the same 16-hex hash as `PageProfile.avatarVersion`
 * (`hashKey16(avatarKey)`, lib/og.ts), so a new avatar always gets a fresh key. The 416 path is
 * unchanged from before this generalisation, so existing cached objects are still found and used. */
export const avatarVariantPrefix = (userId: string, w: AvatarWidth) => `${userPrefix(userId)}avatar-${w}/`;
export const avatarVariantKey = (userId: string, version: string, w: AvatarWidth) =>
  `${avatarVariantPrefix(userId, w)}${version}.webp`;

/**
 * Deletes every avatar-<w> key under this user except `keep` (or all of them, when `keep` is null).
 * Mirrors `sweepOgKeys` (lib/og.ts). Best effort: callers await or `waitUntil` this and always catch.
 */
export async function sweepAvatarVariants(env: Env, userId: string, w: AvatarWidth, keep: string | null): Promise<void> {
  const prefix = avatarVariantPrefix(userId, w);
  const stale: string[] = [];
  let cursor: string | undefined;
  do {
    const page = await env.FILES.list({ prefix, cursor });
    for (const obj of page.objects) if (obj.key !== keep) stale.push(obj.key);
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);
  for (const part of chunk(stale)) await env.FILES.delete(part);
}
