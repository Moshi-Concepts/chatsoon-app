// GET /r/:code (issue #11, docs/referrals.md "Web files", "Landing page"): looks up a referral code
// through the API service binding, same pattern as src/server/handle.ts's /id/:slug lookup, and
// renders the inviter's landing page or a 404. Sets the `cs_ref` attribution cookie
// (docs/referrals.md "How attribution works" step 2) only for a response that actually resolves to a
// real code — never for an invalid format or an unknown one.
//
// Deep imports only, per CLAUDE.md: `@chatsoon/shared/src/referrals`.

import { isValidReferralCode } from '@chatsoon/shared/src/referrals';

import { renderReferral, renderReferralNotFound, type ReferralAssets } from '../render/referral';
import { htmlSecurityHeaders } from './headers';
import { fetchReferralPage } from './profile-source';
import type { PagesContext } from './types';

const CLIENT_IP_HEADER = 'cf-connecting-ip';
const ALLOWED_METHODS = 'GET, HEAD';
const NOT_FOUND_CACHE_CONTROL = 'public, max-age=60';
// A per-visitor response (it sets a cookie), so it's never cached or shared — same reasoning as any
// other cookie-setting response, and unlike /id/:slug's 200 the same instant a code is looked up.
const OK_CACHE_CONTROL = 'private, no-store';
/** 30 days (docs/referrals.md "How attribution works" step 2 and "Landing page"). */
const COOKIE_MAX_AGE_S = 60 * 60 * 24 * 30;

/** Exactly the attributes docs/referrals.md's "Web files"/"How attribution works" ask for. The island
 * (src/client/referral.ts) writes the matching localStorage entry; this response owns the cookie. */
function referralCookie(code: string): string {
  return `cs_ref=${code}; Path=/; Max-Age=${COOKIE_MAX_AGE_S}; SameSite=Lax; Secure`;
}

function htmlResponse(body: string | null, status: number, method: string, headers: Headers): Response {
  return new Response(method === 'HEAD' ? null : body, { status, headers });
}

function methodNotAllowed(): Response {
  const headers = htmlSecurityHeaders('no-store');
  headers.set('Allow', ALLOWED_METHODS);
  return new Response(null, { status: 405, headers });
}

/** An invalid format, an unknown code, or a lookup failure all render identically: a plain 404 with the
 * store/coming-soon line and no cookie (docs/referrals.md "Landing page"). */
function serveNotFound(path: string, method: string): Response {
  const headers = htmlSecurityHeaders(NOT_FOUND_CACHE_CONTROL);
  return htmlResponse(renderReferralNotFound(path), 404, method, headers);
}

export async function serveReferral(ctx: PagesContext, rawCode: string, assets: ReferralAssets): Promise<Response> {
  const { request } = ctx;
  const method = request.method;
  if (method !== 'GET' && method !== 'HEAD') return methodNotAllowed();

  const url = new URL(request.url);
  // Uppercased before validating (codes are always stored/rendered uppercase, docs/referrals.md
  // "Data"), same leniency as the anonymous GET /referral/:code the mobile app uses. Unlike a profile
  // slug, a differently-cased code never redirects — there's no canonical URL to redirect *to* here
  // (every valid code already resolves at exactly one path), so a mistyped case just resolves in place.
  const code = rawCode.trim().toUpperCase();

  // An invalid format never reaches the API at all (docs/referrals.md "Landing page": "no cookie" also
  // covers this — there's nothing to look up, so nothing to set a cookie for).
  if (!isValidReferralCode(code)) return serveNotFound(url.pathname, method);

  const ip = request.headers.get(CLIENT_IP_HEADER);
  const result = await fetchReferralPage(ctx.env.API, ctx.env, code, ip);

  if (result === null || result.status === 'not_found') return serveNotFound(url.pathname, method);

  const headers = htmlSecurityHeaders(OK_CACHE_CONTROL);
  headers.append('Set-Cookie', referralCookie(code));
  return htmlResponse(renderReferral(code, result.referral, assets), 200, method, headers);
}
