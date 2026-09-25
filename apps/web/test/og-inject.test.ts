import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { PageProfile, ProfilePageResult } from '@chatsoon/shared/src/types';

import { injectProfileTags } from '../src/server/og-inject';
import type { PagesContext, PagesEnv, PagesFetcher } from '../src/server/types';

// og-inject.ts (docs/og-plan.md §3.4 "Tags handler", WP-5), driven with a fake `next`, a fake
// `env.API` and a fake `env.ASSETS`, as the plan's own test list asks for.

const SHELL_HTML =
  '<!doctype html><html><head><meta charset="utf-8">' +
  '<!--og--><title>Chatsoon</title><meta name="description" content="Generic">' +
  '<meta property="og:image" content="https://chatsoon.app/og/chatsoon-5a6e4ad4.jpg"><!--/og-->' +
  '</head><body><div id="root"></div></body></html>';

const PROFILE: PageProfile = {
  slug: 'peter-bui-5ec50167',
  displayName: 'Peter Bui',
  headline: 'Building Chatsoon',
  company: 'Moshi Concepts',
  role: 'Founder',
  links: {},
  bookingLinks: [],
  contactChannels: [],
  contactVisibility: 'connections',
  avatarVersion: null,
  updatedAt: '2026-09-25T00:00:00.000Z',
  indexable: false,
  ogVersion: 'abcdef0123456789',
};

function shellResponse(): Response {
  return new Response(SHELL_HTML, { headers: { 'content-type': 'text/html; charset=utf-8', etag: '"shell-etag"' } });
}

function jsonResponse(body: ProfilePageResult): Response {
  return new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } });
}

function makeCtx(opts: {
  next?: PagesContext['next'];
  apiFetch?: PagesFetcher['fetch'];
  assetsFetch?: PagesFetcher['fetch'];
  headers?: Record<string, string>;
}): { ctx: PagesContext; next: ReturnType<typeof vi.fn>; api: ReturnType<typeof vi.fn>; assets: ReturnType<typeof vi.fn> } {
  const next = vi.fn(opts.next ?? (async () => shellResponse()));
  const api = vi.fn(opts.apiFetch ?? (async () => jsonResponse({ status: 'ok', profile: PROFILE })));
  const assets = vi.fn(
    opts.assetsFetch ??
      (async () => {
        throw new Error('ASSETS.fetch should never be called by injectProfileTags');
      }),
  );
  const env: PagesEnv = { API: { fetch: api }, ASSETS: { fetch: assets }, PAGES_SHARED_SECRET: 'test-secret' };
  const request = new Request('https://chatsoon.app/id/peter-bui-5ec50167', {
    headers: { 'cf-connecting-ip': '203.0.113.5', ...opts.headers },
  });
  return { ctx: { request, env, next: next as PagesContext['next'] }, next, api, assets };
}

describe('injectProfileTags', () => {
  it('removes the generic block, leaves exactly one og:image, ending before byte 2048', async () => {
    const { ctx } = makeCtx({});
    const res = await injectProfileTags(ctx, PROFILE.slug);
    const html = await res.text();

    expect(html).not.toContain('content="Generic"');
    expect(html.match(/property="og:image"/g)).toHaveLength(1);
    expect(html).toContain(`/id/${PROFILE.slug}/og.jpg?v=${PROFILE.ogVersion}`);

    const endIndex = html.indexOf('<!--/og-->');
    expect(endIndex).toBeGreaterThan(-1);
    expect(Buffer.byteLength(html.slice(0, endIndex + '<!--/og-->'.length), 'utf8')).toBeLessThan(2048);
  });

  it('never touches env.ASSETS (no /index.html fetch)', async () => {
    const { ctx, assets } = makeCtx({});
    await injectProfileTags(ctx, PROFILE.slug);
    expect(assets).not.toHaveBeenCalled();
  });

  it('strips If-None-Match and If-Modified-Since before calling next()', async () => {
    const { ctx, next } = makeCtx({ headers: { 'if-none-match': '"x"', 'if-modified-since': 'yesterday' } });
    await injectProfileTags(ctx, PROFILE.slug);
    const forwarded = next.mock.calls[0]?.[0] as Request;
    expect(forwarded.headers.get('if-none-match')).toBeNull();
    expect(forwarded.headers.get('if-modified-since')).toBeNull();
  });

  it('drops ETag, Content-Length and Content-Encoding from the rewritten response', async () => {
    const { ctx } = makeCtx({
      next: async () =>
        new Response(SHELL_HTML, {
          headers: {
            'content-type': 'text/html',
            etag: '"shell-etag"',
            'content-length': String(SHELL_HTML.length),
            'content-encoding': 'gzip',
          },
        }),
    });
    const res = await injectProfileTags(ctx, PROFILE.slug);
    expect(res.headers.get('etag')).toBeNull();
    expect(res.headers.get('content-length')).toBeNull();
    expect(res.headers.get('content-encoding')).toBeNull();
  });

  it('makes no API call for an invalid slug, and returns next() untouched', async () => {
    const { ctx, api, next } = makeCtx({});
    const res = await injectProfileTags(ctx, 'Not A Valid Slug!');
    expect(api).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledTimes(1);
    expect(await res.text()).toBe(SHELL_HTML);
  });

  it('returns the untouched shell on not_found', async () => {
    const { ctx } = makeCtx({ apiFetch: async () => jsonResponse({ status: 'not_found' }) });
    const res = await injectProfileTags(ctx, PROFILE.slug);
    expect(await res.text()).toBe(SHELL_HTML);
  });

  it('returns the untouched shell on rate_limited', async () => {
    const { ctx } = makeCtx({ apiFetch: async () => jsonResponse({ status: 'rate_limited' }) });
    const res = await injectProfileTags(ctx, PROFILE.slug);
    expect(await res.text()).toBe(SHELL_HTML);
  });

  it('returns the untouched shell when the API binding throws', async () => {
    const { ctx } = makeCtx({
      apiFetch: async () => {
        throw new Error('binding unreachable');
      },
    });
    const res = await injectProfileTags(ctx, PROFILE.slug);
    expect(await res.text()).toBe(SHELL_HTML);
  });

  describe('on a timeout', () => {
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());

    it('returns the untouched shell', async () => {
      const { ctx } = makeCtx({ apiFetch: () => new Promise<Response>(() => {}) }); // never resolves
      const pending = injectProfileTags(ctx, PROFILE.slug);
      await vi.advanceTimersByTimeAsync(1500);
      const res = await pending;
      expect(await res.text()).toBe(SHELL_HTML);
    });
  });

  it("leaks nothing an injected `contact` field on the fetched profile might carry", async () => {
    const withExtra = { ...PROFILE, contact: { phone: '+61491570156', whatsapp: '+61491570157' } } as PageProfile &
      Record<string, unknown>;
    const { ctx } = makeCtx({ apiFetch: async () => jsonResponse({ status: 'ok', profile: withExtra }) });
    const res = await injectProfileTags(ctx, PROFILE.slug);
    const html = await res.text();
    expect(html).not.toContain('491570156');
    expect(html).not.toContain('491570157');
  });
});
