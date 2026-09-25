import type { ApiErrorBody, ProfilePageResult } from '@chatsoon/shared';
import { createExecutionContext, waitOnExecutionContext } from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

import { profiles, type ProfileRow } from '../src/db/schema';
import app from '../src/index';
import { getDb } from '../src/lib/db';
import { currentOgVersion, loadOgAvatar, ogKey, ogPrefix } from '../src/lib/og';
import { call, signUpWithProfile } from './helpers';

// GET /_pages/profile/:slug and GET /_pages/og/:slug (docs/og-plan.md §3.3, WP-4), plus the
// avatar guard (§2.2) and the PUT /me/profile pre-render/sweep (O9) that feeds them.

const PAGES_KEY = env.PAGES_SHARED_SECRET!;

function pagesCall(path: string, opts: { key?: string; ip?: string; ifNoneMatch?: string } = {}) {
  const headers = new Headers();
  headers.set('x-pages-key', opts.key ?? PAGES_KEY);
  if (opts.ip) headers.set('x-client-ip', opts.ip);
  if (opts.ifNoneMatch) headers.set('if-none-match', opts.ifNoneMatch);
  return call(path, { headers });
}

async function profileRow(userId: string): Promise<ProfileRow> {
  const [row] = await getDb(env).select().from(profiles).where(eq(profiles.userId, userId));
  if (!row) throw new Error(`no profile row for ${userId}`);
  return row;
}

async function countOgFiles(userId: string): Promise<number> {
  const page = await env.FILES.list({ prefix: ogPrefix(userId) });
  return page.objects.length;
}

/** Calls the app directly with an ExecutionContext this test can wait on, so PUT /me/profile's
 * `waitUntil(refreshOgCard(...))` has finished before the assertions run (no polling, no flakiness). */
async function putProfileAwaited(token: string, json: unknown) {
  const ctx = createExecutionContext();
  const req = new Request('http://localhost:8787/me/profile', {
    method: 'PUT',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(json),
  });
  const res = await app.fetch(req, env, ctx);
  await waitOnExecutionContext(ctx);
  return res;
}

describe('GET /_pages/profile/:slug', () => {
  it('returns exactly the whitelisted PageProfile fields', async () => {
    const owner = await signUpWithProfile('pages-dto@example.com', 'Page Dee Toh');
    await call('/me/profile', {
      method: 'PUT',
      token: owner.token,
      json: { headline: 'Building things', company: 'Acme', role: 'Founder' },
    });

    const res = await pagesCall(`/_pages/profile/${owner.slug}`);
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    const body = (await res.json()) as ProfilePageResult;
    expect(body.status).toBe('ok');
    if (body.status !== 'ok') throw new Error('expected ok');
    expect(Object.keys(body.profile).sort()).toEqual(
      [
        'slug',
        'displayName',
        'headline',
        'company',
        'role',
        'links',
        'bookingLinks',
        'contactChannels',
        'contactVisibility',
        'avatarVersion',
        'updatedAt',
        'indexable',
        'ogVersion',
      ].sort(),
    );
    expect(body.profile.indexable).toBe(false);
    expect(body.profile.slug).toBe(owner.slug);
  });

  it("never carries phone, WhatsApp or Signal, on the DTO or the rendered image's bytes", async () => {
    const owner = await signUpWithProfile('pages-leak@example.com', 'Leaky Larry');
    await call('/me/profile', {
      method: 'PUT',
      token: owner.token,
      json: {
        contact: { phone: '+61491570156', whatsapp: '+61491570157', signal: 'leaky-signal-user' },
        contactVisibility: 'public',
      },
    });

    const needles = ['491570156', '491570157', 'leaky-signal-user', 'tel:', 'wa.me', 'signal.me'];

    const profileText = await (await pagesCall(`/_pages/profile/${owner.slug}`)).text();
    for (const needle of needles) expect(profileText).not.toContain(needle);

    const imageRes = await pagesCall(`/_pages/og/${owner.slug}`);
    expect(imageRes.status).toBe(200);
    const imageText = new TextDecoder('utf-8', { fatal: false, ignoreBOM: true }).decode(await imageRes.arrayBuffer());
    for (const needle of needles) expect(imageText).not.toContain(needle);
  });
});

describe('the x-pages-key gate (shared by both routes)', () => {
  it('404s a wrong key, a missing key, and every call once the secret is unset', async () => {
    const owner = await signUpWithProfile('pages-key@example.com', 'Kay Gate');

    const wrongKey = await pagesCall(`/_pages/profile/${owner.slug}`, { key: 'not-the-real-secret' });
    expect(wrongKey.status).toBe(404);
    expect(((await wrongKey.json()) as ApiErrorBody).error.code).toBe('not_found');

    expect((await call(`/_pages/profile/${owner.slug}`)).status).toBe(404);
    expect((await call(`/_pages/og/${owner.slug}`)).status).toBe(404);

    const saved = env.PAGES_SHARED_SECRET;
    env.PAGES_SHARED_SECRET = undefined;
    try {
      expect((await pagesCall(`/_pages/profile/${owner.slug}`)).status).toBe(404);
      expect((await pagesCall(`/_pages/og/${owner.slug}`)).status).toBe(404);
    } finally {
      env.PAGES_SHARED_SECRET = saved;
    }
  });
});

describe('the shared profile-miss rate limit', () => {
  it(
    'rate limits after 60 misses per IP, never a hit, never a missing IP, and shares the bucket with GET /id/:slug',
    { timeout: 30_000 },
    async () => {
      // Avoid straddling the limiter's 60s window.
      const intoWindow = Date.now() % 60_000;
      if (intoWindow > 45_000) await new Promise((r) => setTimeout(r, 60_000 - intoWindow + 250));

      const owner = await signUpWithProfile('pages-ratelimit@example.com', 'Rae Tlimit');
      const ip = '203.0.113.90';
      for (let i = 0; i < 60; i++) {
        const body = (await (await pagesCall(`/_pages/profile/nobody-${i}`, { ip })).json()) as ProfilePageResult;
        expect(body.status, `miss ${i}`).toBe('not_found');
      }

      const guessed = (await (await pagesCall('/_pages/profile/nobody-9999', { ip })).json()) as ProfilePageResult;
      expect(guessed.status).toBe('rate_limited');
      // The image route reads the same bucket.
      expect((await pagesCall('/_pages/og/nobody-9999', { ip })).status).toBe(429);
      // So does the public route (routes/public.ts): "same bucket as the public route" (§3.3).
      expect((await call('/id/nobody-9999', { headers: { 'cf-connecting-ip': ip } })).status).toBe(429);

      // A real slug from that same IP is unaffected.
      const real = (await (await pagesCall(`/_pages/profile/${owner.slug}`, { ip })).json()) as ProfilePageResult;
      expect(real.status).toBe('ok');

      // With no x-client-ip at all, misses are never limited.
      for (let i = 0; i < 65; i++) {
        const body = (await (await pagesCall(`/_pages/profile/nobody-noip-${i}`)).json()) as ProfilePageResult;
        expect(body.status, `no-ip miss ${i}`).toBe('not_found');
      }
    },
  );
});

describe('GET /_pages/og/:slug', () => {
  it('renders once, caches the file in R2, and serves the cached bytes afterwards', async () => {
    const owner = await signUpWithProfile('pages-cache@example.com', 'Cache Carla');

    const first = await pagesCall(`/_pages/og/${owner.slug}`);
    expect(first.status).toBe(200);
    expect(first.headers.get('content-type')).toBe('image/jpeg');
    const cur = first.headers.get('etag')?.replaceAll('"', '');
    expect(cur).toMatch(/^[0-9a-f]{16}$/);

    const key = ogKey(owner.userId, cur!);
    expect(await env.FILES.head(key)).not.toBeNull();

    // Overwrite the cached file with a sentinel. A second render would put the stub's bytes right
    // back; the cached path never touches the renderer, so the sentinel must survive.
    await env.FILES.put(key, 'sentinel-not-a-fresh-render');
    const second = await pagesCall(`/_pages/og/${owner.slug}`);
    expect(new TextDecoder().decode(await second.arrayBuffer())).toBe('sentinel-not-a-fresh-render');
  });

  it('gives max-age 3600 for the current version, 300 for a stale one, and 304 on a matching ETag', async () => {
    const owner = await signUpWithProfile('pages-etag@example.com', 'Eve Tag');
    const first = await pagesCall(`/_pages/og/${owner.slug}`);
    expect(first.headers.get('cache-control')).toBe('public, max-age=300'); // no ?v= yet: treated as stale
    const cur = first.headers.get('etag')!.replaceAll('"', '');

    const currentV = await pagesCall(`/_pages/og/${owner.slug}?v=${cur}`);
    expect(currentV.headers.get('cache-control')).toBe('public, max-age=3600');

    const staleV = await pagesCall(`/_pages/og/${owner.slug}?v=${'0'.repeat(16)}`);
    expect(staleV.headers.get('cache-control')).toBe('public, max-age=300');

    const notModified = await pagesCall(`/_pages/og/${owner.slug}`, { ifNoneMatch: `"${cur}"` });
    expect(notModified.status).toBe(304);
    expect(await notModified.text()).toBe('');
    expect(notModified.headers.get('etag')).toBe(`"${cur}"`);
    // A 304 with no Cache-Control leaves a cache's freshness lifetime unclear, defeating the 1-hour
    // cache the ETag/max-age design intends (§3.3/§3.4); it must carry the same header a 200 for the
    // current version would.
    expect(notModified.headers.get('cache-control')).toBe('public, max-age=3600');
  });

  it('404s an unknown slug and never renders', async () => {
    const res = await pagesCall('/_pages/og/nobody-at-all-00000000');
    expect(res.status).toBe(404);
    expect(((await res.json()) as ApiErrorBody).error.code).toBe('not_found');
  });
});

describe('OG_CARDS_ENABLED and the OG binding (the Free-plan fallback, O20)', () => {
  it('gives ogVersion: null and a 503 og_unavailable image when cards are disabled', async () => {
    const owner = await signUpWithProfile('pages-disabled@example.com', 'Dee Sabled');
    const saved = env.OG_CARDS_ENABLED;
    env.OG_CARDS_ENABLED = 'false';
    try {
      const body = (await (await pagesCall(`/_pages/profile/${owner.slug}`)).json()) as ProfilePageResult;
      expect(body.status).toBe('ok');
      if (body.status === 'ok') expect(body.profile.ogVersion).toBeNull();

      const image = await pagesCall(`/_pages/og/${owner.slug}`);
      expect(image.status).toBe(503);
      expect(((await image.json()) as { error: { code: string } }).error.code).toBe('og_unavailable');
    } finally {
      env.OG_CARDS_ENABLED = saved;
    }
  });

  it('gives the same fallback when the OG service binding is missing entirely', async () => {
    const owner = await signUpWithProfile('pages-nobinding@example.com', 'No Binding');
    const saved = env.OG;
    env.OG = undefined;
    try {
      const body = (await (await pagesCall(`/_pages/profile/${owner.slug}`)).json()) as ProfilePageResult;
      if (body.status === 'ok') expect(body.profile.ogVersion).toBeNull();
      expect((await pagesCall(`/_pages/og/${owner.slug}`)).status).toBe(503);
    } finally {
      env.OG = saved;
    }
  });
});

describe('loadOgAvatar (the avatar guard behind §2.2)', () => {
  const userId = 'og-guard-test-user';

  // SOI, a baseline SOF0 (height 100, width 200), EOI: enough for the SOF scanner, no real scan data.
  const jpeg = (width: number, height: number) =>
    new Uint8Array([
      0xff, 0xd8, 0xff, 0xc0, 0x00, 0x0b, 0x08, (height >> 8) & 0xff, height & 0xff, (width >> 8) & 0xff,
      width & 0xff, 0x01, 0x01, 0x11, 0x00, 0xff, 0xd9,
    ]);

  // PNG signature + a minimal IHDR chunk carrying width/height; CRC and later chunks are never read.
  const png = (width: number, height: number) => {
    const bytes = new Uint8Array(24);
    bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
    bytes.set([0x00, 0x00, 0x00, 0x0d], 8);
    bytes.set([0x49, 0x48, 0x44, 0x52], 12);
    new DataView(bytes.buffer).setUint32(16, width);
    new DataView(bytes.buffer).setUint32(20, height);
    return bytes;
  };

  async function put(key: string, bytes: Uint8Array | string, contentType?: string) {
    await env.FILES.put(key, bytes, contentType ? { httpMetadata: { contentType } } : undefined);
    return key;
  }

  it('returns null with no avatar key', async () => {
    expect(await loadOgAvatar(env, null)).toBeNull();
  });

  it('returns null when the key has nothing in R2', async () => {
    expect(await loadOgAvatar(env, `u/${userId}/avatar/missing.jpg`)).toBeNull();
  });

  it('returns the bytes for a valid, correctly-typed JPEG or PNG within the size limits', async () => {
    const jpegKey = await put(`u/${userId}/avatar/a.jpg`, jpeg(200, 100), 'image/jpeg');
    expect(await loadOgAvatar(env, jpegKey)).toEqual({ bytes: jpeg(200, 100), type: 'image/jpeg' });

    const pngKey = await put(`u/${userId}/avatar/a.png`, png(200, 100), 'image/png');
    expect(await loadOgAvatar(env, pngKey)).toEqual({ bytes: png(200, 100), type: 'image/png' });
  });

  it('returns null for a declared type R2 never allows here (WebP, HEIC)', async () => {
    const key = await put(`u/${userId}/avatar/a.webp`, 'RIFF....WEBP', 'image/webp');
    expect(await loadOgAvatar(env, key)).toBeNull();
  });

  it("returns null when the declared content type doesn't match the actual bytes", async () => {
    const key = await put(`u/${userId}/avatar/mismatch.jpg`, png(200, 100), 'image/jpeg');
    expect(await loadOgAvatar(env, key)).toBeNull();
  });

  it('returns null when either side is over 2048px', async () => {
    const key = await put(`u/${userId}/avatar/huge.jpg`, jpeg(3000, 100), 'image/jpeg');
    expect(await loadOgAvatar(env, key)).toBeNull();
  });

  it('returns null when the file is over 1MB', async () => {
    const big = new Uint8Array(1024 * 1024 + 1);
    big.set(jpeg(200, 100));
    const key = await put(`u/${userId}/avatar/big.jpg`, big, 'image/jpeg');
    expect(await loadOgAvatar(env, key)).toBeNull();
  });
});

describe('PUT /me/profile pre-renders and sweeps the og card (O9)', () => {
  it('pre-renders on a headline change and removes the old version, but skips a links-only edit', async () => {
    const owner = await signUpWithProfile('pages-prerender@example.com', 'Pre Renderer');

    const put1 = await putProfileAwaited(owner.token, { displayName: 'Pre Renderer', headline: 'First headline' });
    expect(put1.status).toBe(200);
    const v1 = await currentOgVersion(await profileRow(owner.userId));
    const key1 = ogKey(owner.userId, v1);
    expect(await env.FILES.head(key1)).not.toBeNull();
    expect(await countOgFiles(owner.userId)).toBe(1);

    // A links-only edit doesn't touch any of the card's fields: same version, same one file.
    const put2 = await putProfileAwaited(owner.token, {
      displayName: 'Pre Renderer',
      links: { website: 'https://example.com' },
    });
    expect(put2.status).toBe(200);
    expect(await currentOgVersion(await profileRow(owner.userId))).toBe(v1);
    expect(await env.FILES.head(key1)).not.toBeNull();
    expect(await countOgFiles(owner.userId)).toBe(1);

    // A headline edit renders a new version and sweeps the old one away.
    const put3 = await putProfileAwaited(owner.token, { displayName: 'Pre Renderer', headline: 'Second headline' });
    expect(put3.status).toBe(200);
    const v3 = await currentOgVersion(await profileRow(owner.userId));
    expect(v3).not.toBe(v1);
    expect(await env.FILES.head(key1)).toBeNull();
    expect(await env.FILES.head(ogKey(owner.userId, v3))).not.toBeNull();
    expect(await countOgFiles(owner.userId)).toBe(1);
  });
});
