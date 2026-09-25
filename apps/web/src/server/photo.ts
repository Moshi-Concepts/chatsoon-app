// GET, HEAD /id/:slug/photo?v=: proxies GET /_pages/photo/:slug over the API binding (docs/public-
// pages-plan.md's "Stage C as built on top of #5" note, decision D8, and Stage D task 3). Mirrors
// og-image.ts's shape (pass-through headers, If-None-Match forwarded, no body on HEAD or on a 304), but
// there's no generic fallback image for an avatar: a lookup failure, a network error or a timeout are
// all a plain 404.

import { photoSecurityHeaders } from './headers';
import { fetchProfilePhoto } from './profile-source';
import type { PagesContext } from './types';

const CLIENT_IP_HEADER = 'cf-connecting-ip';
const NOT_FOUND_CACHE_CONTROL = 'public, max-age=60';
// Passed through unchanged from the upstream response, when present, on 200 and 304 alike (D8: the
// API sets the same Cache-Control either way, so a 304 just drops the body once the caller's own copy
// proves current). `x-indexable` is deliberately not in this list: it's an internal signal read by
// `isIndexable` below and must never reach the browser (§3.3 lists the response headers exactly, and
// this isn't one of them).
const PASS_THROUGH_HEADERS = ['content-type', 'content-length', 'etag', 'cache-control'];

/** `X-Indexable: 1` from the API's photo response (Stage D contract) means the profile is indexable, so
 * the photo should carry no noindex either. Anything else — `0`, absent, malformed — means noindex: a
 * missing header must fail safe rather than accidentally index a photo. */
function isIndexable(upstream: Response): boolean {
  return upstream.headers.get('x-indexable') === '1';
}

function passThroughHeaders(upstream: Response): Headers {
  const headers = new Headers();
  for (const name of PASS_THROUGH_HEADERS) {
    const value = upstream.headers.get(name);
    if (value !== null) headers.set(name, value);
  }
  return photoSecurityHeaders(headers, isIndexable(upstream));
}

function notFoundResponse(): Response {
  return new Response(null, { status: 404, headers: photoSecurityHeaders({ 'Cache-Control': NOT_FOUND_CACHE_CONTROL }) });
}

export async function servePhoto(ctx: PagesContext, slug: string): Promise<Response> {
  const isHead = ctx.request.method === 'HEAD';
  const url = new URL(ctx.request.url);
  const ip = ctx.request.headers.get(CLIENT_IP_HEADER);
  const ifNoneMatch = ctx.request.headers.get('if-none-match');

  const upstream = await fetchProfilePhoto(
    ctx.env.API,
    ctx.env,
    slug,
    url.searchParams.get('v'),
    url.searchParams.get('w'),
    ip,
    ifNoneMatch,
  );
  if (!upstream) return notFoundResponse(); // network error or timeout: no default avatar to fall back to

  switch (upstream.status) {
    case 200:
    case 304: {
      // A 304 never carries a body per HTTP; a HEAD request never gets one either.
      const body = isHead || upstream.status === 304 ? null : upstream.body;
      return new Response(body, { status: upstream.status, headers: passThroughHeaders(upstream) });
    }
    case 429:
      return new Response(null, {
        status: 429,
        headers: photoSecurityHeaders({ 'Cache-Control': 'no-store', 'Retry-After': '60' }),
      });
    default:
      // 404 and anything unexpected alike.
      return notFoundResponse();
  }
}
