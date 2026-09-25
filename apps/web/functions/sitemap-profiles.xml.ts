// Cloudflare Pages Function for GET, HEAD /sitemap-profiles.xml (docs/public-pages-plan.md §2.1, Stage D
// WP-D2). Deliberately thin, like functions/id/[[path]].ts: the real work, and everything the tests in
// apps/web/test exercise, lives in src/server/sitemap.ts.

import { handleSitemap } from '../src/server/sitemap';
import type { PagesContext, PagesEnv } from '../src/server/types';

/** The slice of Cloudflare's real EventContext this file reads. Spelled out locally, like
 * functions/id/[[path]].ts, rather than imported from @cloudflare/workers-types. */
interface EventContext {
  request: Request;
  env: PagesEnv;
  next(input?: Request | string, init?: RequestInit): Promise<Response>;
}

export async function onRequest(context: EventContext): Promise<Response> {
  const { request, env, next } = context;
  const ctx: PagesContext = { request, env, next };
  return handleSitemap(ctx);
}
