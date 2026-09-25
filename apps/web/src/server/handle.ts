// GET, HEAD /id/:slug (docs/public-pages-plan.md §2.1, §2.2, §3.3, WP-C5): serves the server-rendered
// profile page built by `renderProfile`. Takes over the route from og-inject.ts's shell-splice, which
// stays only as the fallback for a lookup error or timeout (the "Stage C as built on top of #5" note:
// that's still "today's behaviour", unchanged — not a 503).
//
// Slug canonicalisation reads the request's own pathname rather than trusting the router's parsed
// slug segment alone: confirmed empirically against wrangler 4.136 `pages dev`, a single trailing
// slash on `/id/<slug>/` collapses into the exact same `context.params.path` as `/id/<slug>` with no
// slash at all, so `functions/id/[[path]].ts` alone can't tell the two apart.
//
// Deep imports only (docs/public-pages-plan.md §4): `@chatsoon/shared/src/{slug,types}`.

import { isValidSlug } from '@chatsoon/shared/src/slug';

import { renderProfile, type ProfileAssets } from '../render/profile';
import { renderNotFound, renderRateLimited } from '../render/status';
import { htmlSecurityHeaders } from './headers';
import { injectProfileTags } from './og-inject';
import { fetchProfilePage } from './profile-source';
import type { PagesContext } from './types';

const CLIENT_IP_HEADER = 'cf-connecting-ip';
const ALLOWED_METHODS = 'GET, HEAD';
const DEFAULT_CACHE_CONTROL = 'public, max-age=0, must-revalidate';
const NOT_FOUND_CACHE_CONTROL = 'public, max-age=60';

/** `body` is dropped for a HEAD request; the headers (and status) are identical either way. */
function htmlResponse(body: string | null, status: number, cacheControl: string, method: string): Response {
  return new Response(method === 'HEAD' ? null : body, { status, headers: htmlSecurityHeaders(cacheControl) });
}

/**
 * The 404 page (docs/profile-page-dom.md; §2.1's `/id/:slug` 404 row): an invalid slug, an unknown
 * one, or any other unmatched `/id/*` path (functions/id/[[path]].ts's own catch-all) all render it
 * the same way, with no API call.
 */
export function serveNotFound(url: URL, method: string): Response {
  return htmlResponse(renderNotFound(url.pathname), 404, NOT_FOUND_CACHE_CONTROL, method);
}

function serveRateLimited(url: URL, method: string): Response {
  const headers = htmlSecurityHeaders('no-store');
  headers.set('Retry-After', '60');
  return new Response(method === 'HEAD' ? null : renderRateLimited(url.pathname), { status: 429, headers });
}

/** An uppercase slug or a trailing slash (§2.1): 301 to the canonical lowercase, slash-free path. The
 * query string, if any, rides along unchanged. */
function redirectToCanonical(url: URL, slug: string): Response {
  const headers = htmlSecurityHeaders(DEFAULT_CACHE_CONTROL);
  headers.set('Location', `/id/${slug}${url.search}`);
  return new Response(null, { status: 301, headers });
}

function methodNotAllowed(): Response {
  const headers = htmlSecurityHeaders('no-store');
  headers.set('Allow', ALLOWED_METHODS);
  return new Response(null, { status: 405, headers });
}

/**
 * `rawSlug` is exactly what the router parsed off the URL — case and all, `''` for bare `/id` or
 * `/id/`. `assets` is `functions/_generated/assets.ts`'s build-time output (the router's job, not this
 * function's, to supply).
 */
export async function handle(ctx: PagesContext, rawSlug: string, assets: ProfileAssets): Promise<Response> {
  const { request } = ctx;
  const method = request.method;
  if (method !== 'GET' && method !== 'HEAD') return methodNotAllowed();

  const url = new URL(request.url);
  const canonicalSlug = rawSlug.toLowerCase();
  const needsCanonicalRedirect = canonicalSlug !== rawSlug || url.pathname.endsWith('/');

  if (needsCanonicalRedirect) {
    // A slug that's only invalid because of its case (or a slash) still 404s once lowercased — an
    // uppercase `bad_slug!` shouldn't redirect to a 301 that itself 404s two hops later.
    if (!isValidSlug(canonicalSlug)) return serveNotFound(url, method);
    return redirectToCanonical(url, canonicalSlug);
  }
  if (!isValidSlug(rawSlug)) return serveNotFound(url, method);

  const ip = request.headers.get(CLIENT_IP_HEADER);
  const result = await fetchProfilePage(ctx.env.API, ctx.env, rawSlug, ip);

  if (result === null) {
    // A lookup error or timeout: today's behaviour, unchanged — the SPA shell via context.next(), with
    // the #5 profile tags spliced in. No 503 (the "Stage C as built on top of #5" note).
    return injectProfileTags(ctx, rawSlug);
  }
  if (result.status === 'not_found') return serveNotFound(url, method);
  if (result.status === 'rate_limited') return serveRateLimited(url, method);
  return htmlResponse(renderProfile(result.profile, assets), 200, DEFAULT_CACHE_CONTROL, method);
}
