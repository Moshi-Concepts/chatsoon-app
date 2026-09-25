import { toOgCard } from '@chatsoon/shared/src/og';
import type { ProfilePageResult } from '@chatsoon/shared';

import type { ProfileRow } from './db/schema';
import type { Env } from './env';
import { getDb } from './lib/db';
import { ApiError, limit } from './lib/errors';
import { cardsEnabled, currentOgVersion, hashKey16, loadOgAvatar, ogKey, sweepOgKeys } from './lib/og';
import { findProfileBySlug } from './lib/profiles';
import { toPageProfile } from './lib/serialize';

// Core logic behind the three secret-gated routes in routes/pages.ts: GET /_pages/profile/:slug,
// GET /_pages/og/:slug (docs/og-plan.md §3.3) and GET /_pages/photo/:slug (docs/public-pages-plan.md's
// "Stage C as built on top of #5" note and decision D8). Kept independent of Hono and of how the
// caller's IP arrived.

/** The bucket routes/public.ts already uses for GET /id/:slug misses: one limit, shared by both paths. */
const missKey = (ip: string | null) => (ip ? `profile-miss:${ip}` : null);

type ProfileLookup = { status: 'ok'; row: ProfileRow } | { status: 'not_found' } | { status: 'rate_limited' };

/** A slug miss counts against PROFILE_MISS_LIMITER; a hit never does (a real slug never rate limits). */
async function lookupProfile(env: Env, slug: string, ip: string | null): Promise<ProfileLookup> {
  const row = await findProfileBySlug(getDb(env), slug);
  if (row) return { status: 'ok', row };
  try {
    await limit(env.PROFILE_MISS_LIMITER, missKey(ip));
  } catch (err) {
    if (err instanceof ApiError && err.code === 'rate_limited') return { status: 'rate_limited' };
    throw err;
  }
  return { status: 'not_found' };
}

/** GET /_pages/profile/:slug's whole response body: the route always answers 200 with this (§3.3). */
export async function profilePage(env: Env, slug: string, ip: string | null): Promise<ProfilePageResult> {
  const found = await lookupProfile(env, slug, ip);
  if (found.status !== 'ok') return found;
  return { status: 'ok', profile: await toPageProfile(env, found.row) };
}

export type OgImageResult =
  | { status: 'not_found' }
  | { status: 'rate_limited' }
  | { status: 'unavailable' }
  | { status: 'not_modified'; etag: string }
  | { status: 'ok'; bytes: Uint8Array; etag: string; maxAge: number };

const V_PATTERN = /^[0-9a-f]{16}$/;

/**
 * The one piece of `ExecutionContext` this needs. Spelled out locally (rather than importing the
 * ambient `ExecutionContext`) so both Hono's `c.executionCtx` and a future RPC's own context — which
 * declare it slightly differently — satisfy this by shape instead of by name.
 */
export interface WaitUntilCtx {
  waitUntil(promise: Promise<unknown>): void;
}

/**
 * GET /_pages/og/:slug's body: the profile's current card, cached in R2 after the first render (O9),
 * or the reason there isn't one. `v` is the caller's believed version; it only ever affects how long
 * the response may be cached, never whether one is produced.
 */
export async function profileOgImage(
  env: Env,
  ctx: WaitUntilCtx,
  slug: string,
  v: string | null,
  ip: string | null,
  ifNoneMatch: string | null,
): Promise<OgImageResult> {
  const found = await lookupProfile(env, slug, ip);
  if (found.status !== 'ok') return found;
  if (!cardsEnabled(env)) return { status: 'unavailable' };

  const row = found.row;
  const cur = await currentOgVersion(row);
  // A match proves the caller already has this exact version; skip R2 entirely.
  if (ifNoneMatch === `"${cur}"`) return { status: 'not_modified', etag: cur };

  const key = ogKey(row.userId, cur);
  try {
    const cached = await env.FILES.get(key);
    let bytes: Uint8Array;
    if (cached) {
      bytes = new Uint8Array(await cached.arrayBuffer());
    } else {
      const avatar = await loadOgAvatar(env, row.avatarKey);
      bytes = await env.OG.render(toOgCard(row), avatar);
      await env.FILES.put(key, bytes, {
        httpMetadata: { contentType: 'image/jpeg' },
        customMetadata: { purpose: 'og' },
      });
      // Opportunistic: keeps O9's "one render per version" true even when this request renders a
      // version PUT /me/profile's own waitUntil never got to (cards just turned on; a missed save).
      ctx.waitUntil(sweepOgKeys(env, row.userId, key).catch((err) => console.error('OG sweep failed', err)));
    }
    const maxAge = v !== null && V_PATTERN.test(v) && v === cur ? 3600 : 300;
    return { status: 'ok', bytes, etag: cur, maxAge };
  } catch (err) {
    console.error('OG image render failed', err);
    return { status: 'unavailable' };
  }
}

export type ProfilePhotoResult =
  | { status: 'not_found' }
  | { status: 'rate_limited' }
  | { status: 'ok'; body: ReadableStream; contentType: string; contentLength: number; version: string; maxAge: number };

/**
 * GET /_pages/photo/:slug's body (D8): the profile's own avatar, streamed straight from R2 exactly
 * as stored — no resizing, no re-encoding. No avatar, a missing R2 object, or a stored object whose
 * declared type isn't an image, all read as `not_found`, same as an unknown slug: a photo URL never
 * hints at which case applies. `version` is the same 16-hex hash `toPageProfile` puts in
 * `avatarVersion`, so the caller's own `?v=` either matches it or doesn't.
 */
export async function profilePhoto(
  env: Env,
  slug: string,
  ip: string | null,
  v: string | null,
): Promise<ProfilePhotoResult> {
  const found = await lookupProfile(env, slug, ip);
  if (found.status !== 'ok') return found;

  const avatarKey = found.row.avatarKey;
  if (!avatarKey) return { status: 'not_found' };

  const object = await env.FILES.get(avatarKey);
  if (!object) return { status: 'not_found' };

  const contentType = object.httpMetadata?.contentType;
  if (!contentType?.startsWith('image/')) return { status: 'not_found' };

  const version = await hashKey16(avatarKey);
  const maxAge = v !== null && V_PATTERN.test(v) && v === version ? 3600 : 60;
  return { status: 'ok', body: object.body, contentType, contentLength: object.size, version, maxAge };
}
