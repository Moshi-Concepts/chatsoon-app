import { chunk } from './contacts';
import type { Env } from '../env';
import { userPrefix } from './signing';

// The 416x416 WebP avatar variant (Stage F item 2, decision D8): key layout and the save-time
// cleanup PUT /me/profile does when an avatar changes or is removed. The variant is otherwise built
// lazily, on the first GET /_pages/photo/:slug that needs it (pages.ts).

/** Variants live under u/<userId>/avatar-416/<version>.webp, next to the original avatar and the
 * og/ cards (lib/og.ts). `version` is the same 16-hex hash as `PageProfile.avatarVersion`
 * (`hashKey16(avatarKey)`, lib/og.ts), so a new avatar always gets a fresh key. */
export const avatarVariantPrefix = (userId: string) => `${userPrefix(userId)}avatar-416/`;
export const avatarVariantKey = (userId: string, version: string) => `${avatarVariantPrefix(userId)}${version}.webp`;

/**
 * Deletes every avatar-416 key under this user except `keep` (or all of them, when `keep` is null).
 * Mirrors `sweepOgKeys` (lib/og.ts). Best effort: callers await or `waitUntil` this and always catch.
 */
export async function sweepAvatarVariants(env: Env, userId: string, keep: string | null): Promise<void> {
  const prefix = avatarVariantPrefix(userId);
  const stale: string[] = [];
  let cursor: string | undefined;
  do {
    const page = await env.FILES.list({ prefix, cursor });
    for (const obj of page.objects) if (obj.key !== keep) stale.push(obj.key);
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);
  for (const part of chunk(stale)) await env.FILES.delete(part);
}
