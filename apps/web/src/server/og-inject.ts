// GET /id/:slug: splices `profileOgBlock`'s personalised tags into the SPA shell `context.next()`
// returns (docs/og-plan.md O12, O13, §3.4 "Tags handler"). This is the one Stage C's `handle.ts` plus
// `renderProfile` replaces outright; the tag builder, the DTO and the image route all stay as they are.

import { WEB_ORIGIN } from '@chatsoon/shared/src/constants';
import { isValidSlug } from '@chatsoon/shared/src/slug';

import { profileOgBlock } from '../render/og';
import { fetchProfilePage } from './profile-source';
import type { PagesContext } from './types';

const CLIENT_IP_HEADER = 'cf-connecting-ip';
const MARKER_BLOCK = /<!--og-->[\s\S]*?<!--\/og-->/;

/** `context.next()` must see none of the caller's conditional headers (§3.4 step 2): a `304` or a
 * `Last-Modified`-qualified body from the asset layer would leave nothing here to splice tags into. */
function withoutConditionalHeaders(request: Request): Request {
  const headers = new Headers(request.headers);
  headers.delete('if-none-match');
  headers.delete('if-modified-since');
  return new Request(request, { headers });
}

/** The shell's own headers describe the *unmodified* bytes `next()` returned; once the body is
 * rewritten those three no longer apply (§3.4 step 5) and must not be forwarded. */
function withoutStaleBodyHeaders(headers: Headers): Headers {
  const out = new Headers(headers);
  out.delete('etag');
  out.delete('content-length');
  out.delete('content-encoding');
  return out;
}

/**
 * `slug` is whatever the router parsed out of the URL; every other failure mode — an invalid slug, a
 * lookup miss, `rate_limited`, a throw or a timeout, a non-200 or non-HTML asset response, or a shell
 * with no marker block to replace — returns `assetRes` (or `next()`) exactly as `context.next()` gave
 * it, so a broken profile source can never break the app shell itself.
 */
export async function injectProfileTags(ctx: PagesContext, slug: string): Promise<Response> {
  if (!isValidSlug(slug)) return ctx.next();

  const ip = ctx.request.headers.get(CLIENT_IP_HEADER);
  const [assetRes, result] = await Promise.all([
    ctx.next(withoutConditionalHeaders(ctx.request)),
    fetchProfilePage(ctx.env.API, ctx.env, slug, ip),
  ]);

  const contentType = assetRes.headers.get('content-type') ?? '';
  if (assetRes.status !== 200 || !contentType.includes('text/html') || result?.status !== 'ok') {
    return assetRes;
  }

  const html = await assetRes.text();
  if (!MARKER_BLOCK.test(html)) return assetRes; // nothing to splice into; serve the shell untouched

  const injected = html.replace(MARKER_BLOCK, profileOgBlock(result.profile, WEB_ORIGIN));
  return new Response(injected, { status: 200, headers: withoutStaleBodyHeaders(assetRes.headers) });
}
