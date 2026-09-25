// Calls the four secret-gated routes over the API service binding (O14, docs/og-plan.md §3.3):
// GET /_pages/profile/:slug for the tags handler, GET /_pages/og/:slug for the image handler,
// GET /_pages/photo/:slug (docs/public-pages-plan.md's "Stage C as built on top of #5" note and
// decision D8) for the avatar, and GET /_pages/sitemap (Stage D, WP-D2) for the profile sitemap. Each
// buckets its own kind of "no answer" into a single, simple result rather than throwing, since a broken
// or slow binding call must never break the app shell or the image response it feeds — og-inject.ts,
// og-image.ts, photo.ts and sitemap.ts each fall back to their own "as if nothing was found" path.

import { API_ORIGIN, DEFAULT_AVATAR_WIDTH, normalizeAvatarWidth } from '@chatsoon/shared/src/constants';
import type { ProfilePageResult, SitemapProfilesResult } from '@chatsoon/shared/src/types';

import type { PagesEnv, PagesFetcher } from './types';

const CLIENT_IP_HEADER = 'x-client-ip';
const PAGES_KEY_HEADER = 'x-pages-key';

// docs/og-plan.md's "checked for this plan" note: binding calls carry no cf-connecting-ip of their
// own, so the caller's IP (read off the incoming request by og-inject.ts/og-image.ts) is forwarded
// explicitly. `PAGES_SHARED_SECRET` unset just means the API's own gate 404s both routes below.
function pagesHeaders(env: PagesEnv, ip: string | null): Headers {
  const headers = new Headers();
  if (env.PAGES_SHARED_SECRET) headers.set(PAGES_KEY_HEADER, env.PAGES_SHARED_SECRET);
  if (ip) headers.set(CLIENT_IP_HEADER, ip);
  return headers;
}

/** Races `promise` against a timer that rejects after `ms`, bounding how long a hung or slow
 * chatsoon-api can hold a Pages Function response open (§3.4's "with a 1.5s/10s timeout"). The timer
 * is always cleared once either side settles, so a fast, successful call never leaves one ticking. */
function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const timedOut = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new Error(`timed out after ${ms}ms`)), ms);
  });
  return Promise.race([promise, timedOut]).finally(() => clearTimeout(timer));
}

/** Exported so the tests can drive them with fake timers instead of waiting on the wall clock. */
export const PROFILE_LOOKUP_TIMEOUT_MS = 1500;
export const OG_IMAGE_TIMEOUT_MS = 10_000;
/** Same budget as the OG image: both stream a body straight out of R2 over the binding. */
export const PROFILE_PHOTO_TIMEOUT_MS = 10_000;
/** Generous budget for a crawler-only, no-visitor-waiting request that may list up to 50,000 rows
 * (§3.2's `indexableProfiles` cap). */
export const SITEMAP_TIMEOUT_MS = 10_000;

/**
 * GET /_pages/profile/:slug (§3.3). Always resolves: a network error, a non-2xx response, a body that
 * isn't the expected JSON, or the 1.5s timeout all come back as `null`, which og-inject.ts treats
 * exactly like there being no profile to inject at all.
 */
export async function fetchProfilePage(
  api: PagesFetcher,
  env: PagesEnv,
  slug: string,
  ip: string | null,
): Promise<ProfilePageResult | null> {
  try {
    const res = await withTimeout(
      api.fetch(`${API_ORIGIN}/_pages/profile/${encodeURIComponent(slug)}`, { headers: pagesHeaders(env, ip) }),
      PROFILE_LOOKUP_TIMEOUT_MS,
    );
    if (!res.ok) return null;
    return (await res.json()) as ProfilePageResult;
  } catch {
    return null;
  }
}

/**
 * GET /_pages/og/:slug (§3.3). Returns the upstream `Response` untouched so og-image.ts can read its
 * status and headers directly (it, not this function, decides what each status means for the caller);
 * `null` only for a network error or the 10s timeout, which og-image.ts treats as "unavailable".
 */
export async function fetchOgImage(
  api: PagesFetcher,
  env: PagesEnv,
  slug: string,
  v: string | null,
  ip: string | null,
  ifNoneMatch: string | null,
): Promise<Response | null> {
  const headers = pagesHeaders(env, ip);
  if (ifNoneMatch) headers.set('if-none-match', ifNoneMatch);
  const url = new URL(`${API_ORIGIN}/_pages/og/${encodeURIComponent(slug)}`);
  if (v) url.searchParams.set('v', v);
  try {
    return await withTimeout(api.fetch(url, { headers }), OG_IMAGE_TIMEOUT_MS);
  } catch {
    return null;
  }
}

/**
 * GET /_pages/photo/:slug (D8). Returns the upstream `Response` untouched, same reasoning as
 * `fetchOgImage`: photo.ts (not this function) decides what each status means for the caller; `null`
 * only for a network error or the 10s timeout, which photo.ts treats as a 404 (there's no default
 * avatar to fall back to).
 *
 * `w` (issue #23, the `srcset` widths) is normalised with the same `normalizeAvatarWidth` the API
 * itself applies, so the two always agree on what's valid; the default width is never forwarded as
 * `w=416`, since that's already what a bare `/_pages/photo/:slug` (no `w` at all) resolves to — every
 * URL from before this feature keeps hitting the API exactly as it did.
 */
export async function fetchProfilePhoto(
  api: PagesFetcher,
  env: PagesEnv,
  slug: string,
  v: string | null,
  w: string | null,
  ip: string | null,
  ifNoneMatch: string | null,
): Promise<Response | null> {
  const headers = pagesHeaders(env, ip);
  if (ifNoneMatch) headers.set('if-none-match', ifNoneMatch);
  const url = new URL(`${API_ORIGIN}/_pages/photo/${encodeURIComponent(slug)}`);
  if (v) url.searchParams.set('v', v);
  const width = normalizeAvatarWidth(w);
  if (width !== DEFAULT_AVATAR_WIDTH) url.searchParams.set('w', String(width));
  try {
    return await withTimeout(api.fetch(url, { headers }), PROFILE_PHOTO_TIMEOUT_MS);
  } catch {
    return null;
  }
}

/**
 * GET /_pages/sitemap (§3.2, Stage D, WP-D2). No client IP: this is never a per-visitor request, so
 * `pagesHeaders` is called with `null`. Always resolves: a network error, a non-2xx response, a body
 * that isn't the expected JSON, or the timeout all come back as `null`, which sitemap.ts treats as an
 * API failure (a 503, never an empty sitemap — an empty one would tell Google every profile is gone).
 */
export async function fetchSitemapProfiles(api: PagesFetcher, env: PagesEnv): Promise<SitemapProfilesResult | null> {
  try {
    const res = await withTimeout(
      api.fetch(`${API_ORIGIN}/_pages/sitemap`, { headers: pagesHeaders(env, null) }),
      SITEMAP_TIMEOUT_MS,
    );
    if (!res.ok) return null;
    return (await res.json()) as SitemapProfilesResult;
  } catch {
    return null;
  }
}
