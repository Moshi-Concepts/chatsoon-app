import { toOgCard } from '@chatsoon/shared/src/og';
import type { ProfilePageResult, SitemapProfilesResult } from '@chatsoon/shared';
import { and, asc, eq, notInArray, sql } from 'drizzle-orm';

import { profiles, users, type ProfileRow } from './db/schema';
import type { Env } from './env';
import { avatarVariantKey, sweepAvatarVariants } from './lib/avatar';
import { getDb } from './lib/db';
import { ApiError, limit } from './lib/errors';
import { cardsEnabled, currentOgVersion, hashKey16, loadOgAvatar, ogKey, sweepOgKeys } from './lib/og';
import { findProfileBySlugWithEmail } from './lib/profiles';
import { isIndexable, toPageProfile } from './lib/serialize';

// Core logic behind the three secret-gated routes in routes/pages.ts: GET /_pages/profile/:slug,
// GET /_pages/og/:slug (docs/og-plan.md §3.3) and GET /_pages/photo/:slug (docs/public-pages-plan.md's
// "Stage C as built on top of #5" note and decision D8). Kept independent of Hono and of how the
// caller's IP arrived.

/** The bucket routes/public.ts already uses for GET /id/:slug misses: one limit, shared by both paths. */
const missKey = (ip: string | null) => (ip ? `profile-miss:${ip}` : null);

type ProfileLookup =
  | { status: 'ok'; row: ProfileRow; email: string }
  | { status: 'not_found' }
  | { status: 'rate_limited' };

/** A slug miss counts against PROFILE_MISS_LIMITER; a hit never does (a real slug never rate limits). */
async function lookupProfile(env: Env, slug: string, ip: string | null): Promise<ProfileLookup> {
  const found = await findProfileBySlugWithEmail(getDb(env), slug);
  if (found) return { status: 'ok', row: found.row, email: found.email };
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
  return { status: 'ok', profile: await toPageProfile(env, found.row, found.email) };
}

/**
 * The same `isIndexable` predicate as SQL, joined against `users` for the owner's email, so the
 * sitemap and `toPageProfile`'s `indexable` can never disagree. Ordered by slug, capped at 50,000
 * rows (§3.2): a sitemap file has no pagination.
 */
export async function indexableProfiles(env: Env): Promise<SitemapProfilesResult> {
  const rows = await getDb(env)
    .select({ slug: profiles.slug, updatedAt: profiles.updatedAt, email: users.email })
    .from(profiles)
    .innerJoin(users, eq(users.id, profiles.userId))
    .where(
      and(
        eq(profiles.searchVisible, true),
        eq(profiles.searchBlocked, false),
        notInArray(profiles.slug, ['alex-rivera-demo', 'maya-lindqvist-demo']),
        sql`${users.email} not like 'demo+%@chatsoon.app'`,
        sql`lower(${users.email}) <> 'review@chatsoon.app'`,
        sql`(coalesce(${profiles.headline}, '') <> '' or coalesce(${profiles.role}, '') <> '' or coalesce(${profiles.company}, '') <> '' or coalesce(${profiles.avatarKey}, '') <> '')`,
      ),
    )
    .orderBy(asc(profiles.slug))
    .limit(50_000);

  return { profiles: rows.map((r) => ({ slug: r.slug, updatedAt: r.updatedAt.toISOString() })) };
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
  | {
      status: 'ok';
      body: ReadableStream | Uint8Array;
      contentType: string;
      contentLength: number;
      version: string;
      /**
       * '416' when the 416x416 WebP variant (Stage F item 2, D8) was served; 'original' when the
       * avatar was streamed unresized (no `IMAGES` binding, the source wasn't eligible, or building
       * the variant failed). The caller's ETag must differ between the two: a browser holding the
       * original JPEG under the plain `"<version>"` ETag must not get a 304 for the WebP, or vice
       * versa.
       */
      variant: 'original' | '416';
      maxAge: number;
      /** Same predicate as `PageProfile.indexable` (§3.2/§3.3): the caller sets `X-Indexable` from it. */
      indexable: boolean;
    };

/** Only originals up to this size are ever resized; a bigger one is served as-is (design point 2d). */
const MAX_AVATAR_ORIGINAL_BYTES = 5 * 1024 * 1024;

type AvatarVariantOutcome =
  | { kind: 'variant'; body: ReadableStream | Uint8Array; contentLength: number }
  // The original's bytes were already read out of its R2 stream while attempting a variant (to feed
  // `IMAGES.input()`, or to compare sizes), so `object.body` is spent: the caller must serve these
  // buffered bytes instead of re-reading `object`.
  | { kind: 'buffered-original'; bytes: Uint8Array }
  // No attempt was made at all; `object.body` is untouched and the caller streams it as before.
  | { kind: 'no-attempt' };

/**
 * Builds the 416x416 WebP avatar variant for one avatar (the caller has already checked R2 for a
 * stored one), or decides there isn't going to be one. Never throws: `env.IMAGES` being absent is normal (a lower-tier account); an actual
 * transform or store failure is logged once and treated the same as "no variant" so the request can
 * still be served from the original (design point 2c).
 */
async function loadAvatarVariant(
  env: Env,
  ctx: WaitUntilCtx,
  userId: string,
  version: string,
  object: R2ObjectBody,
  contentType: string,
): Promise<AvatarVariantOutcome> {
  const variantKey = avatarVariantKey(userId, version);

  if (!env.IMAGES || object.size > MAX_AVATAR_ORIGINAL_BYTES || !contentType.startsWith('image/')) {
    return { kind: 'no-attempt' };
  }

  // Buffered up front (rather than handed to IMAGES as `object.body` directly) so these bytes are
  // still available to fall back on if the transform, the size comparison, or the store fails partway.
  const originalBytes = new Uint8Array(await object.arrayBuffer());
  try {
    const rendered = await env.IMAGES.input(new Response(originalBytes).body!)
      .transform({ width: 416, height: 416, fit: 'cover' })
      .output({ format: 'image/webp', quality: 80 });
    const variantBytes = new Uint8Array(await new Response(rendered.image()).arrayBuffer());
    // Unlikely, but cheap to check (design point 2e): never ship a "savings" feature that regresses.
    if (variantBytes.byteLength > originalBytes.byteLength) {
      return { kind: 'buffered-original', bytes: originalBytes };
    }

    // Doesn't block the response: the caller already has `variantBytes` to serve immediately. A
    // failed put (or sweep) here just means the next request redoes the transform.
    ctx.waitUntil(
      env.FILES
        .put(variantKey, variantBytes, { httpMetadata: { contentType: 'image/webp' } })
        .then(() => sweepAvatarVariants(env, userId, variantKey))
        .catch((err) => console.error('Storing avatar variant failed', err)),
    );
    return { kind: 'variant', body: variantBytes, contentLength: variantBytes.byteLength };
  } catch (err) {
    console.error('Avatar variant transform failed', err);
    return { kind: 'buffered-original', bytes: originalBytes };
  }
}

/**
 * GET /_pages/photo/:slug's body (D8): the profile's own avatar. No avatar, a missing R2 object, or
 * a stored object whose declared type isn't an image, all read as `not_found`, same as an unknown
 * slug: a photo URL never hints at which case applies. `version` is the same 16-hex hash
 * `toPageProfile` puts in `avatarVersion`, so the caller's own `?v=` either matches it or doesn't
 * (unaffected by which variant is actually served — design point 3).
 *
 * Serves the 416x416 WebP variant (Stage F item 2) when one can be made or already exists, falling
 * back to the original avatar exactly as before Stage F otherwise.
 */
export async function profilePhoto(
  env: Env,
  ctx: WaitUntilCtx,
  slug: string,
  ip: string | null,
  v: string | null,
): Promise<ProfilePhotoResult> {
  const found = await lookupProfile(env, slug, ip);
  if (found.status !== 'ok') return found;

  const avatarKey = found.row.avatarKey;
  if (!avatarKey) return { status: 'not_found' };

  const indexable = isIndexable(found.row, found.email);
  const version = await hashKey16(avatarKey);
  const maxAge = v !== null && V_PATTERN.test(v) && v === version ? 3600 : 60;

  // The stored variant first: once it exists (every request after the first), the original is never
  // read, saving an R2 round trip on the page's LCP image. It's keyed by the current avatar's version
  // and deleted when that avatar changes or is removed, so a hit always belongs to `avatarKey`.
  const existing = await env.FILES.get(avatarVariantKey(found.row.userId, version));
  if (existing) {
    return {
      status: 'ok',
      body: existing.body,
      contentType: 'image/webp',
      contentLength: existing.size,
      version,
      variant: '416',
      maxAge,
      indexable,
    };
  }

  const object = await env.FILES.get(avatarKey);
  if (!object) return { status: 'not_found' };

  const contentType = object.httpMetadata?.contentType;
  if (!contentType?.startsWith('image/')) return { status: 'not_found' };

  const outcome = await loadAvatarVariant(env, ctx, found.row.userId, version, object, contentType);
  if (outcome.kind === 'variant') {
    return {
      status: 'ok',
      body: outcome.body,
      contentType: 'image/webp',
      contentLength: outcome.contentLength,
      version,
      variant: '416',
      maxAge,
      indexable,
    };
  }

  const body = outcome.kind === 'buffered-original' ? outcome.bytes : object.body;
  const contentLength = outcome.kind === 'buffered-original' ? outcome.bytes.byteLength : object.size;
  return { status: 'ok', body, contentType, contentLength, version, variant: 'original', maxAge, indexable };
}
