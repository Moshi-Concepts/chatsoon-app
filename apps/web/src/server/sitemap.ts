// GET, HEAD /sitemap-profiles.xml (docs/public-pages-plan.md §2.1, §3.5, Stage D WP-D2): a sitemaps.org
// `urlset` listing every indexable profile, built from GET /_pages/sitemap over the API binding (the
// same service binding, header and shared-secret mechanism as fetchProfilePage in profile-source.ts).
//
// On an API failure this returns 503 with `Cache-Control: no-store`, never an empty sitemap: an empty
// `urlset` would tell Google every profile has been removed, which isn't what a lookup failure means.
//
// Deep imports only (docs/public-pages-plan.md §4): `@chatsoon/shared/src/constants`.

import { WEB_ORIGIN } from '@chatsoon/shared/src/constants';

import { escapeHtml } from '../render/escape';
import { pageSecurityHeaders } from './headers';
import { fetchSitemapProfiles } from './profile-source';
import type { PagesContext } from './types';

const ALLOWED_METHODS = 'GET, HEAD';
const XML_CONTENT_TYPE = 'application/xml; charset=utf-8';
const DEFAULT_CACHE_CONTROL = 'public, max-age=3600';

function xmlResponse(body: string | null, status: number, cacheControl: string, method: string): Response {
  const headers = pageSecurityHeaders();
  headers.set('Content-Type', XML_CONTENT_TYPE);
  headers.set('Cache-Control', cacheControl);
  return new Response(method === 'HEAD' ? null : body, { status, headers });
}

function methodNotAllowed(): Response {
  const headers = pageSecurityHeaders();
  headers.set('Allow', ALLOWED_METHODS);
  return new Response(null, { status: 405, headers: withNoStore(headers) });
}

function withNoStore(headers: Headers): Headers {
  headers.set('Cache-Control', 'no-store');
  return headers;
}

function serviceUnavailable(): Response {
  const headers = withNoStore(pageSecurityHeaders());
  headers.set('Retry-After', '30');
  return new Response(null, { status: 503, headers });
}

/** One `<url>` entry, XML-escaped. `updatedAt` is already an ISO timestamp from the API, so it's safe
 * as `<lastmod>` content once escaped like everything else here. */
function urlEntry(slug: string, updatedAt: string): string {
  const loc = `${WEB_ORIGIN}/id/${slug}`;
  return `<url><loc>${escapeHtml(loc)}</loc><lastmod>${escapeHtml(updatedAt)}</lastmod></url>`;
}

function renderSitemap(profiles: { slug: string; updatedAt: string }[]): string {
  const urls = profiles.map((p) => urlEntry(p.slug, p.updatedAt)).join('');
  return `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls}</urlset>`;
}

export async function handleSitemap(ctx: PagesContext): Promise<Response> {
  const method = ctx.request.method;
  if (method !== 'GET' && method !== 'HEAD') return methodNotAllowed();

  const result = await fetchSitemapProfiles(ctx.env.API, ctx.env);
  if (result === null) return serviceUnavailable();

  return xmlResponse(renderSitemap(result.profiles), 200, DEFAULT_CACHE_CONTROL, method);
}
