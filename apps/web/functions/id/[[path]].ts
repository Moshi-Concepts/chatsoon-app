// Cloudflare Pages Function for every /id/* request (docs/public-pages-plan.md §2.1, §3.3, WP-C5).
// Deliberately thin: it only works out which of the three testable handlers in src/server a request
// belongs to (or that it belongs to none of them), and calls straight through. The real work — and
// everything the tests in apps/web/test exercise — lives in src/server/{handle,og-image,photo}.ts.
//
// `[[path]]` is Cloudflare's catch-all segment syntax: this file matches /id and every /id/<...>. A
// single trailing slash on /id/<slug>/ collapses into the exact same params.path as /id/<slug> with no
// slash at all (confirmed empirically against wrangler 4.136 `pages dev`), which is why the slug
// canonicalisation redirect lives in handle.ts, reading the request's own pathname, rather than here.

import { handle, serveNotFound } from '../../src/server/handle';
import { serveOgImage } from '../../src/server/og-image';
import { servePhoto } from '../../src/server/photo';
import type { PagesContext, PagesEnv } from '../../src/server/types';
import { PROFILE_ASSETS } from '../_generated/assets';

/** The slice of Cloudflare's real EventContext this file reads. Spelled out locally, like
 * src/server/types.ts's PagesContext, rather than imported from @cloudflare/workers-types. */
interface EventContext {
  request: Request;
  env: PagesEnv;
  params: { path?: string | string[] };
  next(input?: Request | string, init?: RequestInit): Promise<Response>;
}

function pathSegments(params: EventContext['params']): string[] {
  if (Array.isArray(params.path)) return params.path;
  return params.path ? [params.path] : [];
}

export async function onRequest(context: EventContext): Promise<Response> {
  const { request, env, next } = context;
  const [slug, ...rest] = pathSegments(context.params);
  const ctx: PagesContext = { request, env, next };
  const method = request.method;
  const isGetOrHead = method === 'GET' || method === 'HEAD';

  // /id/:slug — including bare /id and /id/, which handle() 404s with no API call, same as any other
  // invalid slug.
  if (rest.length === 0) return handle(ctx, slug ?? '', PROFILE_ASSETS);

  // /id/:slug/og.jpg (GET, HEAD only; og-image.ts owns its own fallback image and headers).
  if (slug && rest.length === 1 && rest[0] === 'og.jpg' && isGetOrHead) {
    return serveOgImage(ctx, slug);
  }

  // /id/:slug/photo?v= (GET, HEAD only).
  if (slug && rest.length === 1 && rest[0] === 'photo' && isGetOrHead) {
    return servePhoto(ctx, slug);
  }

  // Any other /id/* path (§2.1's "Other /id/*" row).
  return serveNotFound(new URL(request.url), method);
}
