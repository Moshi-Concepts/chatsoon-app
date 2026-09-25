import { describe, expect, it, vi } from 'vitest';

import type { ReferralPageResult } from '@chatsoon/shared/src/referrals';

import { serveReferral } from '../src/server/referral';
import type { ReferralAssets } from '../src/render/referral';
import type { PagesContext, PagesEnv, PagesFetcher } from '../src/server/types';

// src/server/referral.ts (issue #11), driven with a fake `env.API`, the same shape handle.test.ts uses
// for /id/:slug.

const CODE = 'ABCD2345';

const REFERRAL: ReferralPageResult = {
  status: 'ok',
  referral: { displayName: 'Peter Bui', slug: 'peter-bui-5ec50167', avatarVersion: null, headline: null, ogVersion: null },
};

const ASSETS: ReferralAssets = { islandUrl: '/_p/referral-testhash.js' };

function jsonResponse(body: ReferralPageResult): Response {
  return new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } });
}

function makeCtx(opts: {
  url?: string;
  method?: string;
  apiFetch?: PagesFetcher['fetch'];
}): { ctx: PagesContext; api: ReturnType<typeof vi.fn> } {
  const api = vi.fn(opts.apiFetch ?? (async () => jsonResponse(REFERRAL)));
  const assets = vi.fn(async () => {
    throw new Error('ASSETS.fetch should never be called by serveReferral()');
  });
  const next = vi.fn(async () => new Response('unused'));
  const env: PagesEnv = { API: { fetch: api }, ASSETS: { fetch: assets }, PAGES_SHARED_SECRET: 'test-secret' };
  const request = new Request(opts.url ?? `https://chatsoon.app/r/${CODE}`, {
    method: opts.method ?? 'GET',
    headers: { 'cf-connecting-ip': '203.0.113.5' },
  });
  return { ctx: { request, env, next: next as PagesContext['next'] }, api };
}

describe('serveReferral', () => {
  it('renders the landing page with a 200 for a valid, known code', async () => {
    const { ctx } = makeCtx({});
    const res = await serveReferral(ctx, CODE, ASSETS);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('text/html; charset=utf-8');
    expect(res.headers.get('x-robots-tag')).toBe('noindex');
    const html = await res.text();
    expect(html).toContain('Peter Bui invited you to Chatsoon');
  });

  it('sets the cs_ref cookie with the documented attributes for a valid code', async () => {
    const { ctx } = makeCtx({});
    const res = await serveReferral(ctx, CODE, ASSETS);
    expect(res.headers.get('set-cookie')).toBe(`cs_ref=${CODE}; Path=/; Max-Age=2592000; SameSite=Lax; Secure`);
  });

  it('never caches the 200 (a per-visitor, cookie-setting response)', async () => {
    const { ctx } = makeCtx({});
    const res = await serveReferral(ctx, CODE, ASSETS);
    expect(res.headers.get('cache-control')).toBe('private, no-store');
  });

  it('uppercases a lowercase code before looking it up', async () => {
    const { ctx, api } = makeCtx({ url: `https://chatsoon.app/r/${CODE.toLowerCase()}` });
    const res = await serveReferral(ctx, CODE.toLowerCase(), ASSETS);
    expect(res.status).toBe(200);
    const calledUrl = String(api.mock.calls[0]![0]);
    expect(calledUrl).toContain(`/_pages/referral/${CODE}`);
    expect(res.headers.get('set-cookie')).toContain(`cs_ref=${CODE};`);
  });

  it('404s an unknown code with no Set-Cookie header', async () => {
    const { ctx } = makeCtx({ apiFetch: async () => jsonResponse({ status: 'not_found' }) });
    const res = await serveReferral(ctx, CODE, ASSETS);
    expect(res.status).toBe(404);
    expect(res.headers.get('set-cookie')).toBeNull();
    expect(await res.text()).toContain('Invite not found');
  });

  it('404s an invalid code format with no API call at all', async () => {
    const { ctx, api } = makeCtx({ url: 'https://chatsoon.app/r/bad!' });
    const res = await serveReferral(ctx, 'bad!', ASSETS);
    expect(res.status).toBe(404);
    expect(api).not.toHaveBeenCalled();
    expect(res.headers.get('set-cookie')).toBeNull();
  });

  it('404s with no cookie when the API call fails or times out', async () => {
    const { ctx } = makeCtx({
      apiFetch: async () => {
        throw new Error('binding unreachable');
      },
    });
    const res = await serveReferral(ctx, CODE, ASSETS);
    expect(res.status).toBe(404);
    expect(res.headers.get('set-cookie')).toBeNull();
  });

  it('returns 405 for a method other than GET or HEAD, with no API call', async () => {
    const { ctx, api } = makeCtx({ method: 'POST' });
    const res = await serveReferral(ctx, CODE, ASSETS);
    expect(res.status).toBe(405);
    expect(res.headers.get('allow')).toBe('GET, HEAD');
    expect(api).not.toHaveBeenCalled();
  });

  it('sends no body on HEAD for a 200', async () => {
    const { ctx } = makeCtx({ method: 'HEAD' });
    const res = await serveReferral(ctx, CODE, ASSETS);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('');
    // The cookie still gets set even without a body.
    expect(res.headers.get('set-cookie')).toContain('cs_ref=');
  });

  it('sends no body on HEAD for a 404', async () => {
    const { ctx } = makeCtx({ method: 'HEAD', apiFetch: async () => jsonResponse({ status: 'not_found' }) });
    const res = await serveReferral(ctx, CODE, ASSETS);
    expect(res.status).toBe(404);
    expect(await res.text()).toBe('');
  });
});
