import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { PageProfile, ProfilePageResult } from '@chatsoon/shared/src/types';

import { handle } from '../src/server/handle';
import type { ProfileAssets } from '../src/render/profile';
import type { PagesContext, PagesEnv, PagesFetcher } from '../src/server/types';

// handle.ts (docs/public-pages-plan.md §2.1, §2.2, §3.3, WP-C5), driven with a fake `next`, a fake
// `env.API` and a fake `env.ASSETS`, the same shape og-inject.test.ts and og-image.test.ts use.

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
  badges: [],
  avatarVersion: null,
  updatedAt: '2026-09-25T00:00:00.000Z',
  indexable: false,
  ogVersion: 'abcdef0123456789',
};

const ASSETS: ProfileAssets = {
  islandUrl: '/_p/profile-testhash.js',
  siteKey: 'test-site-key',
  apiOrigin: 'https://api.chatsoon.app',
  spa: { styles: '<style id="expo-reset">html,body{height:100%}</style>', entryScriptSrc: '/_expo/static/js/web/entry-test.js' },
};

const SECURITY_HEADERS = {
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'strict-origin-when-cross-origin',
  'x-frame-options': 'DENY',
  'permissions-policy': 'camera=(self), microphone=(), geolocation=(), payment=()',
  'x-robots-tag': 'noindex',
};

function expectSecurityHeaders(headers: Headers): void {
  for (const [name, value] of Object.entries(SECURITY_HEADERS)) expect(headers.get(name)).toBe(value);
}

function shellResponse(): Response {
  return new Response(SHELL_HTML, { headers: { 'content-type': 'text/html; charset=utf-8', etag: '"shell-etag"' } });
}

function jsonResponse(body: ProfilePageResult): Response {
  return new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } });
}

function makeCtx(opts: {
  url?: string;
  method?: string;
  next?: PagesContext['next'];
  apiFetch?: PagesFetcher['fetch'];
}): { ctx: PagesContext; next: ReturnType<typeof vi.fn>; api: ReturnType<typeof vi.fn> } {
  const next = vi.fn(opts.next ?? (async () => shellResponse()));
  const api = vi.fn(
    opts.apiFetch ?? (async () => jsonResponse({ status: 'ok', profile: PROFILE })),
  );
  const assets = vi.fn(async () => {
    throw new Error('ASSETS.fetch should never be called by handle()');
  });
  const env: PagesEnv = { API: { fetch: api }, ASSETS: { fetch: assets }, PAGES_SHARED_SECRET: 'test-secret' };
  const request = new Request(opts.url ?? `https://chatsoon.app/id/${PROFILE.slug}`, {
    method: opts.method ?? 'GET',
    headers: { 'cf-connecting-ip': '203.0.113.5' },
  });
  return { ctx: { request, env, next: next as PagesContext['next'] }, next, api };
}

describe('handle', () => {
  it('renders the profile with a 200 and the default cache header', async () => {
    const { ctx } = makeCtx({});
    const res = await handle(ctx, PROFILE.slug, ASSETS);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('text/html; charset=utf-8');
    expect(res.headers.get('cache-control')).toBe('public, max-age=0, must-revalidate');
    expectSecurityHeaders(res.headers);
    const html = await res.text();
    expect(html).toContain(ASSETS.islandUrl);
    expect(html).toContain(PROFILE.displayName);
  });

  it('renders an indexable profile with no X-Robots-Tag header and max-image-preview:large in the meta tag (Stage D)', async () => {
    const indexableProfile: PageProfile = { ...PROFILE, indexable: true };
    const { ctx } = makeCtx({ apiFetch: async () => jsonResponse({ status: 'ok', profile: indexableProfile }) });
    const res = await handle(ctx, PROFILE.slug, ASSETS);
    expect(res.status).toBe(200);
    expect(res.headers.get('x-robots-tag')).toBeNull();
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    expect(res.headers.get('referrer-policy')).toBe('strict-origin-when-cross-origin');
    expect(res.headers.get('x-frame-options')).toBe('DENY');
    const html = await res.text();
    expect(html.toLowerCase()).not.toContain('noindex');
    expect(html).toContain('<meta name="robots" content="max-image-preview:large">');
    expect(html).toContain('application/ld+json');
  });

  it('keeps X-Robots-Tag: noindex for a non-indexable profile, with no JSON-LD', async () => {
    const { ctx } = makeCtx({}); // PROFILE.indexable is false
    const res = await handle(ctx, PROFILE.slug, ASSETS);
    expect(res.headers.get('x-robots-tag')).toBe('noindex');
    const html = await res.text();
    expect(html).toContain('<meta name="robots" content="noindex">');
    expect(html).not.toContain('application/ld+json');
  });

  it('leaks nothing an injected `contact` field on the fetched profile might carry', async () => {
    const withExtra = { ...PROFILE, contact: { phone: '+61491570156', whatsapp: '+61491570157' } } as PageProfile &
      Record<string, unknown>;
    const { ctx } = makeCtx({ apiFetch: async () => jsonResponse({ status: 'ok', profile: withExtra }) });
    const res = await handle(ctx, PROFILE.slug, ASSETS);
    const html = await res.text();
    expect(html).not.toContain('491570156');
    expect(html).not.toContain('491570157');
    expect(html).not.toContain('tel:');
    expect(html).not.toContain('wa.me');
  });

  it('404s an unknown slug (not_found)', async () => {
    const { ctx } = makeCtx({ apiFetch: async () => jsonResponse({ status: 'not_found' }) });
    const res = await handle(ctx, PROFILE.slug, ASSETS);
    expect(res.status).toBe(404);
    expect(res.headers.get('cache-control')).toBe('public, max-age=60');
    expectSecurityHeaders(res.headers);
    expect(await res.text()).toContain('Profile not found');
  });

  it('404s an invalid slug with no API call', async () => {
    const { ctx, api } = makeCtx({ url: 'https://chatsoon.app/id/bad_slug!' });
    const res = await handle(ctx, 'bad_slug!', ASSETS);
    expect(res.status).toBe(404);
    expect(api).not.toHaveBeenCalled();
    expectSecurityHeaders(res.headers);
  });

  it('301s an uppercase slug to the canonical lowercase path, with no API call', async () => {
    const { ctx, api } = makeCtx({ url: 'https://chatsoon.app/id/Peter-Bui-5ec50167' });
    const res = await handle(ctx, 'Peter-Bui-5ec50167', ASSETS);
    expect(res.status).toBe(301);
    expect(res.headers.get('location')).toBe('/id/peter-bui-5ec50167');
    expect(api).not.toHaveBeenCalled();
    expectSecurityHeaders(res.headers);
  });

  it('301s a trailing slash to the slash-free canonical path, with no API call', async () => {
    const { ctx, api } = makeCtx({ url: `https://chatsoon.app/id/${PROFILE.slug}/` });
    const res = await handle(ctx, PROFILE.slug, ASSETS);
    expect(res.status).toBe(301);
    expect(res.headers.get('location')).toBe(`/id/${PROFILE.slug}`);
    expect(api).not.toHaveBeenCalled();
  });

  it('404s an uppercase slug that is still invalid once lowercased, with no API call and no redirect', async () => {
    const { ctx, api } = makeCtx({ url: 'https://chatsoon.app/id/Bad_Slug!' });
    const res = await handle(ctx, 'Bad_Slug!', ASSETS);
    expect(res.status).toBe(404);
    expect(api).not.toHaveBeenCalled();
  });

  it('429s on rate_limited, with Retry-After and no-store', async () => {
    const { ctx } = makeCtx({ apiFetch: async () => jsonResponse({ status: 'rate_limited' }) });
    const res = await handle(ctx, PROFILE.slug, ASSETS);
    expect(res.status).toBe(429);
    expect(res.headers.get('retry-after')).toBe('60');
    expect(res.headers.get('cache-control')).toBe('no-store');
    expectSecurityHeaders(res.headers);
    expect(await res.text()).toContain('Too many requests');
  });

  it('delegates to injectProfileTags on a lookup error (no 503): a fallback lookup that succeeds still splices the profile tags in', async () => {
    // handle()'s own lookup fails; injectProfileTags() then makes its own lookup (og-inject.ts's
    // documented behaviour, unchanged) and this one succeeds — exactly "today's behaviour".
    let calls = 0;
    const { ctx, next } = makeCtx({
      apiFetch: async () => {
        calls += 1;
        if (calls === 1) throw new Error('binding unreachable');
        return jsonResponse({ status: 'ok', profile: PROFILE });
      },
    });
    const res = await handle(ctx, PROFILE.slug, ASSETS);
    expect(res.status).toBe(200);
    expect(next).toHaveBeenCalledTimes(1);
    expect(calls).toBe(2);
    const html = await res.text();
    expect(html).not.toContain('content="Generic"');
    expect(html).toContain(`/id/${PROFILE.slug}/og.jpg?v=${PROFILE.ogVersion}`);
  });

  it('falls back to the plain, untouched SPA shell (no 503) when the fallback lookup fails too', async () => {
    const { ctx, next } = makeCtx({
      apiFetch: async () => {
        throw new Error('binding unreachable');
      },
    });
    const res = await handle(ctx, PROFILE.slug, ASSETS);
    expect(res.status).toBe(200);
    expect(next).toHaveBeenCalledTimes(1);
    expect(await res.text()).toBe(SHELL_HTML);
  });

  describe('on a lookup timeout', () => {
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());

    it('falls back to the SPA shell too (no 503)', async () => {
      const { ctx } = makeCtx({ apiFetch: () => new Promise<Response>(() => {}) }); // never resolves
      const pending = handle(ctx, PROFILE.slug, ASSETS);
      // handle()'s own fetchProfilePage call times out (1.5s), then its injectProfileTags() fallback
      // makes an equivalent call that also times out.
      await vi.advanceTimersByTimeAsync(1500);
      await vi.advanceTimersByTimeAsync(1500);
      const res = await pending;
      expect(res.status).toBe(200);
      expect(await res.text()).toBe(SHELL_HTML);
    });
  });

  it('returns 405 for a method other than GET or HEAD, with no API call', async () => {
    const { ctx, api } = makeCtx({ method: 'POST' });
    const res = await handle(ctx, PROFILE.slug, ASSETS);
    expect(res.status).toBe(405);
    expect(res.headers.get('allow')).toBe('GET, HEAD');
    expect(api).not.toHaveBeenCalled();
    expectSecurityHeaders(res.headers);
  });

  it('sends no body on HEAD for a 200', async () => {
    const { ctx } = makeCtx({ method: 'HEAD' });
    const res = await handle(ctx, PROFILE.slug, ASSETS);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('');
  });

  it('sends no body on HEAD for a 404', async () => {
    const { ctx } = makeCtx({ method: 'HEAD', apiFetch: async () => jsonResponse({ status: 'not_found' }) });
    const res = await handle(ctx, PROFILE.slug, ASSETS);
    expect(res.status).toBe(404);
    expect(await res.text()).toBe('');
  });
});
