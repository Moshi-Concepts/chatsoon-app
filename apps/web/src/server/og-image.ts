// GET, HEAD /id/:slug/og.jpg: proxies GET /_pages/og/:slug over the API binding and turns its result
// into the response shape docs/og-plan.md §3.4 gives crawlers, falling back to the generic image on
// any failure so a broken renderer, a disabled kill switch or a slow binding call never serves a
// broken <img>.

import { DEFAULT_OG_IMAGE } from '../render/og-asset';
import { withOgImageSecurityHeaders } from './headers';
import { fetchOgImage } from './profile-source';
import type { PagesContext } from './types';

const CLIENT_IP_HEADER = 'cf-connecting-ip';
const DEFAULT_IMAGE_CACHE_CONTROL = 'public, max-age=60';
// Passed through unchanged from the upstream response, when present, on 200 and 304 alike.
const PASS_THROUGH_HEADERS = ['content-type', 'content-length', 'etag', 'cache-control'];

function passThroughHeaders(upstream: Response): Headers {
  const headers = new Headers();
  for (const name of PASS_THROUGH_HEADERS) {
    const value = upstream.headers.get(name);
    if (value !== null) headers.set(name, value);
  }
  return withOgImageSecurityHeaders(headers);
}

/** `env.ASSETS.fetch(DEFAULT_OG_IMAGE.path)`, resolved against the request's own origin so this works
 * the same in production and in local `wrangler pages dev` (§3.4's 503/timeout/"anything else" row). */
async function defaultImageResponse(ctx: PagesContext, isHead: boolean): Promise<Response> {
  const res = await ctx.env.ASSETS.fetch(new URL(DEFAULT_OG_IMAGE.path, ctx.request.url));
  const headers = withOgImageSecurityHeaders(res.headers);
  headers.set('Cache-Control', DEFAULT_IMAGE_CACHE_CONTROL);
  return new Response(isHead ? null : res.body, { status: res.status, headers });
}

export async function serveOgImage(ctx: PagesContext, slug: string): Promise<Response> {
  const isHead = ctx.request.method === 'HEAD';
  const url = new URL(ctx.request.url);
  const ip = ctx.request.headers.get(CLIENT_IP_HEADER);
  const ifNoneMatch = ctx.request.headers.get('if-none-match');

  const upstream = await fetchOgImage(ctx.env.API, ctx.env, slug, url.searchParams.get('v'), ip, ifNoneMatch);
  if (!upstream) return defaultImageResponse(ctx, isHead); // network error or timeout

  switch (upstream.status) {
    case 200:
    case 304: {
      // A 304 never carries a body per HTTP; a HEAD request never gets one either.
      const body = isHead || upstream.status === 304 ? null : upstream.body;
      return new Response(body, { status: upstream.status, headers: passThroughHeaders(upstream) });
    }
    case 404:
      return new Response(null, {
        status: 404,
        headers: withOgImageSecurityHeaders({ 'Cache-Control': DEFAULT_IMAGE_CACHE_CONTROL }),
      });
    case 429:
      return new Response(null, {
        status: 429,
        headers: withOgImageSecurityHeaders({ 'Cache-Control': 'no-store', 'Retry-After': '60' }),
      });
    default:
      // 503 (og_unavailable, cards disabled or a render failure) and anything unexpected alike.
      return defaultImageResponse(ctx, isHead);
  }
}
