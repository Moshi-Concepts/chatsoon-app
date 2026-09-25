// Cloudflare Pages Function for every /id/* request (docs/og-plan.md O12, §3.4). Deliberately thin:
// it only figures out which of the two testable handlers in src/server a request belongs to (or that
// it belongs to neither), and calls straight through to context.next() otherwise. The real work —
// and everything the tests in apps/web/test exercise — lives in src/server/{og-inject,og-image}.ts.
//
// `[[path]]` is Cloudflare's catch-all segment syntax: this file matches /id and every /id/<...>.

import { injectProfileTags } from '../../src/server/og-inject';
import { serveOgImage } from '../../src/server/og-image';
import type { PagesContext, PagesEnv } from '../../src/server/types';

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

  // /id/:slug (GET only; HEAD falls through to next() unchanged, per §3.4's table, until Stage C).
  if (slug && rest.length === 0 && request.method === 'GET') {
    return injectProfileTags(ctx, slug);
  }

  // /id/:slug/og.jpg (GET, HEAD).
  if (slug && rest.length === 1 && rest[0] === 'og.jpg' && (request.method === 'GET' || request.method === 'HEAD')) {
    return serveOgImage(ctx, slug);
  }

  return next();
}
