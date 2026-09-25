// Cloudflare Pages Function for /r/<code> (issue #11, docs/referrals.md "Web files"), the same thin
// shape as functions/id/[[path]].ts: it only wires the real Cloudflare EventContext into
// src/server/referral.ts's PagesContext and hands the one path param over. All the logic that
// apps/web/test actually exercises lives in src/server/referral.ts.
//
// `[code]` (not `[[path]]`) matches exactly one path segment: only /r/<something>, never bare /r or
// /r/<code>/anything-else — there's nothing else under this route to catch.

import { serveReferral } from '../../src/server/referral';
import type { PagesContext, PagesEnv } from '../../src/server/types';
import { REFERRAL_ASSETS } from '../_generated/assets';

/** The slice of Cloudflare's real EventContext this file reads, spelled out locally like
 * functions/id/[[path]].ts's own copy. */
interface EventContext {
  request: Request;
  env: PagesEnv;
  params: { code?: string };
  next(input?: Request | string, init?: RequestInit): Promise<Response>;
}

export async function onRequest(context: EventContext): Promise<Response> {
  const { request, env, next } = context;
  const ctx: PagesContext = { request, env, next };
  return serveReferral(ctx, context.params.code ?? '', REFERRAL_ASSETS);
}
