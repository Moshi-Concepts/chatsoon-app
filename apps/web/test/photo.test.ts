import { describe, expect, it, vi } from 'vitest';

import { servePhoto } from '../src/server/photo';
import type { PagesContext, PagesEnv, PagesFetcher } from '../src/server/types';

// photo.ts (docs/public-pages-plan.md's "Stage C as built on top of #5" note, decision D8, WP-C5),
// driven with a fake `env.API`, the same shape og-image.test.ts uses.

const SECURITY_HEADERS = {
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'strict-origin-when-cross-origin',
  'x-frame-options': 'DENY',
  'permissions-policy': 'camera=(self), microphone=(), geolocation=(), payment=()',
  'x-robots-tag': 'noindex',
};

const PHOTO_BYTES = new Uint8Array([0xff, 0xd8, 0xff, 1, 2, 3]);

function expectSecurityHeaders(headers: Headers): void {
  for (const [name, value] of Object.entries(SECURITY_HEADERS)) expect(headers.get(name)).toBe(value);
}

function makeCtx(opts: {
  method?: string;
  query?: string;
  apiFetch?: PagesFetcher['fetch'];
  headers?: Record<string, string>;
}): { ctx: PagesContext; api: ReturnType<typeof vi.fn> } {
  const api = vi.fn(
    opts.apiFetch ??
      (async () => new Response(PHOTO_BYTES, { status: 200, headers: { 'content-type': 'image/jpeg' } })),
  );
  const assets = vi.fn(async () => {
    throw new Error('ASSETS.fetch should never be called by servePhoto (there is no default avatar)');
  });
  const env: PagesEnv = { API: { fetch: api }, ASSETS: { fetch: assets }, PAGES_SHARED_SECRET: 'test-secret' };
  const request = new Request(`https://chatsoon.app/id/peter-bui-5ec50167/photo${opts.query ?? ''}`, {
    method: opts.method ?? 'GET',
    headers: { 'cf-connecting-ip': '203.0.113.5', ...opts.headers },
  });
  return { ctx: { request, env, next: vi.fn() as PagesContext['next'] }, api };
}

describe('servePhoto', () => {
  it('passes through Content-Type, Content-Length, ETag and Cache-Control, plus the security headers', async () => {
    const { ctx } = makeCtx({
      apiFetch: async () =>
        new Response(PHOTO_BYTES, {
          status: 200,
          headers: {
            'content-type': 'image/jpeg',
            'content-length': String(PHOTO_BYTES.byteLength),
            etag: '"deadbeefdeadbeef"',
            'cache-control': 'public, max-age=3600',
          },
        }),
    });
    const res = await servePhoto(ctx, 'peter-bui-5ec50167');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('image/jpeg');
    expect(res.headers.get('content-length')).toBe(String(PHOTO_BYTES.byteLength));
    expect(res.headers.get('etag')).toBe('"deadbeefdeadbeef"');
    expect(res.headers.get('cache-control')).toBe('public, max-age=3600');
    expectSecurityHeaders(res.headers);
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(PHOTO_BYTES);
  });

  it('passes through Content-Type: image/webp and a "<version>-416" ETag (the resized avatar variant, Stage F, D8)', async () => {
    const WEBP_BYTES = new Uint8Array([0x52, 0x49, 0x46, 0x46, 1, 2, 3]);
    const { ctx } = makeCtx({
      apiFetch: async () =>
        new Response(WEBP_BYTES, {
          status: 200,
          headers: {
            'content-type': 'image/webp',
            'content-length': String(WEBP_BYTES.byteLength),
            etag: '"deadbeefdeadbeef-416"',
            'cache-control': 'public, max-age=3600',
          },
        }),
    });
    const res = await servePhoto(ctx, 'peter-bui-5ec50167');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('image/webp');
    expect(res.headers.get('content-length')).toBe(String(WEBP_BYTES.byteLength));
    expect(res.headers.get('etag')).toBe('"deadbeefdeadbeef-416"');
    expect(res.headers.get('cache-control')).toBe('public, max-age=3600');
    expectSecurityHeaders(res.headers);
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(WEBP_BYTES);
  });

  it('keeps X-Robots-Tag: noindex when the upstream response carries X-Indexable: 0', async () => {
    const { ctx } = makeCtx({
      apiFetch: async () =>
        new Response(PHOTO_BYTES, {
          status: 200,
          headers: { 'content-type': 'image/jpeg', 'x-indexable': '0' },
        }),
    });
    const res = await servePhoto(ctx, 'peter-bui-5ec50167');
    expect(res.headers.get('x-robots-tag')).toBe('noindex');
    expect(res.headers.has('x-indexable')).toBe(false);
  });

  it('keeps X-Robots-Tag: noindex when the upstream response has no X-Indexable header at all (Stage D: fail safe)', async () => {
    const { ctx } = makeCtx({
      apiFetch: async () => new Response(PHOTO_BYTES, { status: 200, headers: { 'content-type': 'image/jpeg' } }),
    });
    const res = await servePhoto(ctx, 'peter-bui-5ec50167');
    expect(res.headers.get('x-robots-tag')).toBe('noindex');
  });

  it('drops X-Robots-Tag entirely when the upstream response carries X-Indexable: 1, and strips X-Indexable itself', async () => {
    const { ctx } = makeCtx({
      apiFetch: async () =>
        new Response(PHOTO_BYTES, {
          status: 200,
          headers: { 'content-type': 'image/jpeg', 'x-indexable': '1' },
        }),
    });
    const res = await servePhoto(ctx, 'peter-bui-5ec50167');
    expect(res.headers.get('x-robots-tag')).toBeNull();
    expect(res.headers.has('x-indexable')).toBe(false);
  });

  it('forwards If-None-Match and returns a bodyless 304 with Cache-Control passed through', async () => {
    const { ctx, api } = makeCtx({
      headers: { 'if-none-match': '"deadbeefdeadbeef"' },
      apiFetch: async () =>
        new Response(null, {
          status: 304,
          headers: { etag: '"deadbeefdeadbeef"', 'cache-control': 'public, max-age=3600' },
        }),
    });
    const res = await servePhoto(ctx, 'peter-bui-5ec50167');
    expect(res.status).toBe(304);
    expect(await res.text()).toBe('');
    expect(res.headers.get('etag')).toBe('"deadbeefdeadbeef"');
    expect(res.headers.get('cache-control')).toBe('public, max-age=3600');
    const forwarded = api.mock.calls[0]?.[1] as RequestInit;
    expect(new Headers(forwarded.headers).get('if-none-match')).toBe('"deadbeefdeadbeef"');
    expectSecurityHeaders(res.headers);
  });

  it('sends no body on HEAD even for a 200', async () => {
    const { ctx } = makeCtx({ method: 'HEAD' });
    const res = await servePhoto(ctx, 'peter-bui-5ec50167');
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('');
  });

  it('404s with a 60s public cache and no body', async () => {
    const { ctx } = makeCtx({ apiFetch: async () => new Response(null, { status: 404 }) });
    const res = await servePhoto(ctx, 'nobody-at-all');
    expect(res.status).toBe(404);
    expect(res.headers.get('cache-control')).toBe('public, max-age=60');
    expectSecurityHeaders(res.headers);
    expect(await res.text()).toBe('');
  });

  it('429s with no-store and Retry-After: 60', async () => {
    const { ctx } = makeCtx({ apiFetch: async () => new Response(null, { status: 429 }) });
    const res = await servePhoto(ctx, 'peter-bui-5ec50167');
    expect(res.status).toBe(429);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(res.headers.get('retry-after')).toBe('60');
    expectSecurityHeaders(res.headers);
  });

  it('404s on a network error (a stand-in for a timeout) — there is no default avatar', async () => {
    const { ctx } = makeCtx({
      apiFetch: async () => {
        throw new Error('binding unreachable');
      },
    });
    const res = await servePhoto(ctx, 'peter-bui-5ec50167');
    expect(res.status).toBe(404);
    expect(res.headers.get('cache-control')).toBe('public, max-age=60');
    expectSecurityHeaders(res.headers);
  });
});
