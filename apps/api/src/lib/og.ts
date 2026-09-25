import { computeOgVersion, toOgCard, type OgAvatar, type OgCard, type OgRendererRpc } from '@chatsoon/shared/src/og';

import type { ProfileRow } from '../db/schema';
import type { Env } from '../env';
import { chunk } from './contacts';
import { userPrefix } from './signing';

// Card rendering support for the /_pages/* routes (pages.ts) and PUT /me/profile (routes/profile.ts):
// the R2 key layout, the kill switch, the avatar guard and the save-time pre-render/sweep (O9, O10,
// docs/og-plan.md §3.3). The renderer itself lives in the chatsoon-og Worker (apps/og); this file
// only decides what gets sent to it and where the result is stored.

/** Cards live under u/<userId>/og/<ogVersion>.jpg, next to avatars and card photos. */
export const ogPrefix = (userId: string) => `${userPrefix(userId)}og/`;
export const ogKey = (userId: string, ogVersion: string) => `${ogPrefix(userId)}${ogVersion}.jpg`;

/**
 * True when personalised cards can be rendered: the kill switch (O20, also the Free-plan setting)
 * is on and the OG service binding exists. A type guard so callers get `env.OG` narrowed to defined.
 */
export function cardsEnabled(env: Env): env is Env & { OG: OgRendererRpc } {
  return env.OG_CARDS_ENABLED !== 'false' && !!env.OG;
}

const cardFields = (row: Pick<ProfileRow, 'displayName' | 'role' | 'company' | 'headline'>): OgCard => ({
  displayName: row.displayName,
  role: row.role,
  company: row.company,
  headline: row.headline,
});

type OgCardRow = Pick<ProfileRow, 'displayName' | 'role' | 'company' | 'headline' | 'avatarKey'>;

/** The `ogVersion` this profile hashes to right now (O10). Same inputs as `toPageProfile`. */
export function currentOgVersion(row: OgCardRow) {
  return computeOgVersion(cardFields(row), row.avatarKey);
}

const enc = new TextEncoder();

/** First 16 hex characters of SHA-256(key). Used for `PageProfile.avatarVersion`: it changes the URL
 * a preview embeds whenever the photo changes, without exposing the R2 key itself. */
export async function hashKey16(key: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', enc.encode(key));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('').slice(0, 16);
}

// ---------------------------------------------------------------------------
// Avatar guard (§2.2): the only photo bytes ever handed to the renderer.
// ---------------------------------------------------------------------------

const MAX_AVATAR_BYTES = 1024 * 1024;
const MAX_AVATAR_SIDE = 2048;
/** PNG signature, `\x89PNG\r\n\x1a\n`. */
const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

function sniffAvatarType(bytes: Uint8Array): 'image/jpeg' | 'image/png' | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  if (bytes.length >= 8 && PNG_MAGIC.every((b, i) => bytes[i] === b)) return 'image/png';
  return null;
}

/** Width and height from a JPEG's first SOF marker, or null if none is found before the scan starts. */
function jpegDimensions(bytes: Uint8Array): { width: number; height: number } | null {
  // SOFn markers (baseline and progressive), excluding DHT (C4), JPG (C8) and DAC (CC), which share
  // the 0xC0-0xCF range but aren't start-of-frame.
  const SOF = new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf]);
  let offset = 2; // past the SOI marker, already checked by sniffAvatarType
  while (offset + 4 <= bytes.length) {
    if (bytes[offset] !== 0xff) return null;
    const marker = bytes[offset + 1]!;
    // Standalone markers carry no length: TEM (0x01) and RSTn/SOI/EOI (0xD0-0xD9).
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd9)) {
      offset += 2;
      continue;
    }
    if (marker === 0xda) return null; // start of scan: no SOF before the entropy-coded data
    const length = ((bytes[offset + 2] ?? 0) << 8) | (bytes[offset + 3] ?? 0);
    if (SOF.has(marker)) {
      if (offset + 9 > bytes.length) return null;
      const height = ((bytes[offset + 5] ?? 0) << 8) | (bytes[offset + 6] ?? 0);
      const width = ((bytes[offset + 7] ?? 0) << 8) | (bytes[offset + 8] ?? 0);
      return { height, width };
    }
    offset += 2 + length;
  }
  return null;
}

/** Width and height from a PNG's IHDR chunk, which is always the first chunk. */
function pngDimensions(bytes: Uint8Array): { width: number; height: number } | null {
  if (bytes.length < 24 || bytes[12] !== 0x49 || bytes[13] !== 0x48 || bytes[14] !== 0x44 || bytes[15] !== 0x52) {
    return null;
  }
  const u32 = (i: number) =>
    (((bytes[i] ?? 0) << 24) | ((bytes[i + 1] ?? 0) << 16) | ((bytes[i + 2] ?? 0) << 8) | (bytes[i + 3] ?? 0)) >>> 0;
  return { width: u32(16), height: u32(20) };
}

/**
 * The avatar the renderer may use, or null when it must fall back to initials (§2.2's avatar guard).
 * Reads the object once, so its bytes are checked against the same content this call returns.
 */
export async function loadOgAvatar(env: Env, avatarKey: string | null): Promise<OgAvatar | null> {
  if (!avatarKey) return null;
  const object = await env.FILES.get(avatarKey);
  if (!object || object.size > MAX_AVATAR_BYTES) return null;
  const declared = object.httpMetadata?.contentType;
  if (declared !== 'image/jpeg' && declared !== 'image/png') return null;

  const bytes = new Uint8Array(await object.arrayBuffer());
  const sniffed = sniffAvatarType(bytes);
  if (sniffed !== declared) return null; // R2 metadata must match the actual bytes, not just the upload's say-so

  const dims = sniffed === 'image/jpeg' ? jpegDimensions(bytes) : pngDimensions(bytes);
  if (!dims || dims.width > MAX_AVATAR_SIDE || dims.height > MAX_AVATAR_SIDE) return null;

  return { bytes, type: sniffed };
}

// ---------------------------------------------------------------------------
// Save-time pre-render (PUT /me/profile → waitUntil(refreshOgCard(...))).
// ---------------------------------------------------------------------------

/** Deletes every og key under this user except `keep` (or all of them, when `keep` is null). */
export async function sweepOgKeys(env: Env, userId: string, keep: string | null): Promise<void> {
  const prefix = ogPrefix(userId);
  const stale: string[] = [];
  let cursor: string | undefined;
  do {
    const page = await env.FILES.list({ prefix, cursor });
    for (const obj of page.objects) if (obj.key !== keep) stale.push(obj.key);
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);
  for (const part of chunk(stale)) await env.FILES.delete(part);
}

/**
 * Renders and stores the profile's current card if it isn't already in R2, then removes every other
 * version this user has (O9). Called from `c.executionCtx.waitUntil` after every profile save, so it
 * must never throw: a failure here must not fail (or be seen to fail) the save itself.
 */
export async function refreshOgCard(env: Env, row: ProfileRow): Promise<void> {
  try {
    if (!cardsEnabled(env)) {
      await sweepOgKeys(env, row.userId, null);
      return;
    }
    const version = await currentOgVersion(row);
    const key = ogKey(row.userId, version);
    if (!(await env.FILES.head(key))) {
      const avatar = await loadOgAvatar(env, row.avatarKey);
      const bytes = await env.OG.render(toOgCard(row), avatar);
      await env.FILES.put(key, bytes, {
        httpMetadata: { contentType: 'image/jpeg' },
        customMetadata: { purpose: 'og' },
      });
    }
    await sweepOgKeys(env, row.userId, key);
  } catch (err) {
    console.error('refreshOgCard failed', err);
  }
}
