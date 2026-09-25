import { describe, expect, it, vi } from 'vitest';

import { serveOgImage } from '../src/server/og-image';
import type { PagesContext, PagesEnv, PagesFetcher } from '../src/server/types';

// og-image.ts (docs/og-plan.md §3.4 "Image handler", WP-5), driven with a fake `env.API` and a fake
// `env.ASSETS`, as the plan's own test list asks for.

const SECURITY_HEADERS = {
  'x-content-type-options': 'nosniff',
  'x-robots-tag': 'noindex',
  'content-security-policy': "default-src 'none'; sandbox",
};

const DEFAULT_IMAGE_BYTES = new Uint8Array([0xff, 0xd8, 0xff, 0, 1, 2, 3]);
const CARD_BYTES = new Uint8Array([0xff, 0xd8, 0xff, 9, 9, 9]);

function expectSecurityHeaders(headers: Headers): void {
  for (const [name, value] of Object.entries(SECURITY_HEADERS)) expect(headers.get(name)).toBe(value);
}

function makeCtx(opts: {
  method?: string;
  query?: string;
  apiFetch?: PagesFetcher['fetch'];
  headers?: Record<string, string>;
}): { ctx: PagesContext; api: ReturnType<typeof vi.fn>; assets: ReturnType<typeof vi.fn> } {
  const api = vi.fn(
    opts.apiFetch ??
      (async () => new Response(CARD_BYTES, { status: 200, headers: { 'content-type': 'image/jpeg' } })),
  );
  const assets = vi.fn(async () => new Response(DEFAULT_IMAGE_BYTES, { headers: { 'content-type': 'image/jpeg' } }));
  const env: PagesEnv = { API: { fetch: api }, ASSETS: { fetch: assets }, PAGES_SHARED_SECRET: 'test-secret' };
  const request = new Request(`https://chatsoon.app/id/peter-bui-5ec50167/og.jpg${opts.query ?? ''}`, {
    method: opts.method ?? 'GET',
    headers: { 'cf-connecting-ip': '203.0.113.5', ...opts.headers },
  });
  return { ctx: { request, env, next: vi.fn() as PagesContext['next'] }, api, assets };
}

describe('serveOgImage', () => {
  it('passes through Content-Type, Content-Length, ETag and Cache-Control, plus the 3 security headers', async () => {
    const { ctx } = makeCtx({
      apiFetch: async () =>
        new Response(CARD_BYTES, {
          status: 200,
          headers: {
            'content-type': 'image/jpeg',
            'content-length': String(CARD_BYTES.byteLength),
            etag: '"abc123"',
            'cache-control': 'public, max-age=3600',
          },
        }),
    });
    const res = await serveOgImage(ctx, 'peter-bui-5ec50167');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('image/jpeg');
    expect(res.headers.get('content-length')).toBe(String(CARD_BYTES.byteLength));
    expect(res.headers.get('etag')).toBe('"abc123"');
    expect(res.headers.get('cache-control')).toBe('public, max-age=3600');
    expectSecurityHeaders(res.headers);
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(CARD_BYTES);
  });

  it('forwards If-None-Match and returns a bodyless 304 on a match, with Cache-Control passed through', async () => {
    const { ctx, api } = makeCtx({
      headers: { 'if-none-match': '"abc123"' },
      apiFetch: async () =>
        new Response(null, { status: 304, headers: { etag: '"abc123"', 'cache-control': 'public, max-age=3600' } }),
    });
    const res = await serveOgImage(ctx, 'peter-bui-5ec50167');
    expect(res.status).toBe(304);
    expect(await res.text()).toBe('');
    expect(res.headers.get('etag')).toBe('"abc123"');
    // The upstream API route (apps/api/src/routes/pages.ts) always sets this on a 304; asserting it
    // here catches a regression on either side of the boundary, since passThroughHeaders() only
    // forwards headers the upstream response actually has.
    expect(res.headers.get('cache-control')).toBe('public, max-age=3600');
    const forwarded = api.mock.calls[0]?.[1] as RequestInit;
    expect(new Headers(forwarded.headers).get('if-none-match')).toBe('"abc123"');
    expectSecurityHeaders(res.headers);
  });

  it('sends no body on HEAD even for a 200', async () => {
    const { ctx } = makeCtx({ method: 'HEAD' });
    const res = await serveOgImage(ctx, 'peter-bui-5ec50167');
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('');
  });

  it('404s with a 60s public cache and no body', async () => {
    const { ctx } = makeCtx({ apiFetch: async () => new Response(null, { status: 404 }) });
    const res = await serveOgImage(ctx, 'nobody-at-all');
    expect(res.status).toBe(404);
    expect(res.headers.get('cache-control')).toBe('public, max-age=60');
    expectSecurityHeaders(res.headers);
    expect(await res.text()).toBe('');
  });

  it('429s with no-store and Retry-After: 60', async () => {
    const { ctx } = makeCtx({ apiFetch: async () => new Response(null, { status: 429 }) });
    const res = await serveOgImage(ctx, 'peter-bui-5ec50167');
    expect(res.status).toBe(429);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(res.headers.get('retry-after')).toBe('60');
    expectSecurityHeaders(res.headers);
  });

  it('falls back to the default image on a 503', async () => {
    const { ctx, assets } = makeCtx({ apiFetch: async () => new Response(null, { status: 503 }) });
    const res = await serveOgImage(ctx, 'peter-bui-5ec50167');
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('public, max-age=60');
    expectSecurityHeaders(res.headers);
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(DEFAULT_IMAGE_BYTES);
    expect(assets).toHaveBeenCalledTimes(1);
  });

  it('falls back to the default image on a network error (a stand-in for a timeout)', async () => {
    const { ctx, assets } = makeCtx({
      apiFetch: async () => {
        throw new Error('binding unreachable');
      },
    });
    const res = await serveOgImage(ctx, 'peter-bui-5ec50167');
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('public, max-age=60');
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(DEFAULT_IMAGE_BYTES);
    expect(assets).toHaveBeenCalledTimes(1);
  });

  it('sends no body for the default-image fallback on HEAD', async () => {
    const { ctx } = makeCtx({ method: 'HEAD', apiFetch: async () => new Response(null, { status: 503 }) });
    const res = await serveOgImage(ctx, 'peter-bui-5ec50167');
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('');
  });
});
