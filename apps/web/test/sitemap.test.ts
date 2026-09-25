import { describe, expect, it, vi } from 'vitest';

import type { SitemapProfilesResult } from '@chatsoon/shared/src/types';

import { handleSitemap } from '../src/server/sitemap';
import type { PagesContext, PagesEnv, PagesFetcher } from '../src/server/types';

// sitemap.ts (docs/public-pages-plan.md §2.1, §3.5, Stage D WP-D2), driven with a fake `env.API`, the
// same shape handle.test.ts and photo.test.ts use.

const SECURITY_HEADERS = {
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'strict-origin-when-cross-origin',
  'x-frame-options': 'DENY',
  'permissions-policy': 'camera=(self), microphone=(), geolocation=(), payment=()',
};

function expectSecurityHeaders(headers: Headers): void {
  for (const [name, value] of Object.entries(SECURITY_HEADERS)) expect(headers.get(name)).toBe(value);
}

function jsonResponse(body: SitemapProfilesResult): Response {
  return new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } });
}

function makeCtx(opts: {
  method?: string;
  apiFetch?: PagesFetcher['fetch'];
}): { ctx: PagesContext; api: ReturnType<typeof vi.fn> } {
  const api = vi.fn(
    opts.apiFetch ??
      (async () =>
        jsonResponse({
          profiles: [
            { slug: 'alex-rivera-0001', updatedAt: '2026-09-20T00:00:00.000Z' },
            { slug: 'peter-bui-5ec50167', updatedAt: '2026-09-25T00:00:00.000Z' },
          ],
        })),
  );
  const assets = vi.fn(async () => {
    throw new Error('ASSETS.fetch should never be called by handleSitemap');
  });
  const env: PagesEnv = { API: { fetch: api }, ASSETS: { fetch: assets }, PAGES_SHARED_SECRET: 'test-secret' };
  const request = new Request('https://chatsoon.app/sitemap-profiles.xml', { method: opts.method ?? 'GET' });
  return { ctx: { request, env, next: vi.fn() as PagesContext['next'] }, api };
}

// Simple structural checks in place of a real XML parser (none is set up in this vitest env): a single
// root <urlset>, balanced <url> pairs, and every <url> containing exactly one <loc> and one <lastmod>.
function assertWellFormedSitemap(xml: string): void {
  expect(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>')).toBe(true);
  expect(xml).toMatch(
    /^<\?xml[^>]*\?><urlset xmlns="http:\/\/www\.sitemaps\.org\/schemas\/sitemap\/0\.9">[\s\S]*<\/urlset>$/,
  );
  const opens = xml.match(/<url>/g) ?? [];
  const closes = xml.match(/<\/url>/g) ?? [];
  expect(opens.length).toBe(closes.length);
  const entries = [...xml.matchAll(/<url>([\s\S]*?)<\/url>/g)];
  expect(entries.length).toBe(opens.length);
  for (const [, body] of entries) {
    expect(body).toMatch(/^<loc>[^<]*<\/loc><lastmod>[^<]*<\/lastmod>$/);
  }
}

describe('handleSitemap', () => {
  it('returns a well-formed urlset with the right content type and cache header', async () => {
    const { ctx } = makeCtx({});
    const res = await handleSitemap(ctx);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('application/xml; charset=utf-8');
    expect(res.headers.get('cache-control')).toBe('public, max-age=3600');
    expect(res.headers.get('x-robots-tag')).toBeNull();
    expectSecurityHeaders(res.headers);
    const xml = await res.text();
    assertWellFormedSitemap(xml);
    expect(xml).toContain('<loc>https://chatsoon.app/id/alex-rivera-0001</loc>');
    expect(xml).toContain('<lastmod>2026-09-20T00:00:00.000Z</lastmod>');
    expect(xml).toContain('<loc>https://chatsoon.app/id/peter-bui-5ec50167</loc>');
  });

  it('escapes slugs/timestamps that could break the XML', async () => {
    const { ctx } = makeCtx({
      apiFetch: async () => jsonResponse({ profiles: [{ slug: 'a&b<c>', updatedAt: '2026-09-20T00:00:00.000Z' }] }),
    });
    const res = await handleSitemap(ctx);
    const xml = await res.text();
    expect(xml).not.toContain('a&b<c>');
    expect(xml).toContain('a&amp;b&lt;c&gt;');
  });

  it('returns an empty but well-formed urlset when there are no indexable profiles', async () => {
    const { ctx } = makeCtx({ apiFetch: async () => jsonResponse({ profiles: [] }) });
    const res = await handleSitemap(ctx);
    expect(res.status).toBe(200);
    const xml = await res.text();
    assertWellFormedSitemap(xml);
    expect(xml).not.toContain('<url>');
  });

  it('sends no body on HEAD but keeps the same headers and status', async () => {
    const { ctx } = makeCtx({ method: 'HEAD' });
    const res = await handleSitemap(ctx);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('application/xml; charset=utf-8');
    expect(await res.text()).toBe('');
  });

  it('returns 405 for a method other than GET or HEAD, with no API call', async () => {
    const { ctx, api } = makeCtx({ method: 'POST' });
    const res = await handleSitemap(ctx);
    expect(res.status).toBe(405);
    expect(res.headers.get('allow')).toBe('GET, HEAD');
    expect(api).not.toHaveBeenCalled();
  });

  it('returns 503 with no-store and Retry-After on an API failure — never an empty sitemap', async () => {
    const { ctx } = makeCtx({
      apiFetch: async () => {
        throw new Error('binding unreachable');
      },
    });
    const res = await handleSitemap(ctx);
    expect(res.status).toBe(503);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(res.headers.get('retry-after')).toBeTruthy();
    expectSecurityHeaders(res.headers);
  });

  it('returns 503 on a non-2xx upstream response too', async () => {
    const { ctx } = makeCtx({ apiFetch: async () => new Response('nope', { status: 404 }) });
    const res = await handleSitemap(ctx);
    expect(res.status).toBe(503);
    expect(res.headers.get('cache-control')).toBe('no-store');
  });
});
