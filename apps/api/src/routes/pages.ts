import { Hono, type Context } from 'hono';

import type { AppEnv } from '../env';
import { errorBody } from '../lib/errors';
import { timingSafeEqual } from '../lib/signing';
import { indexableProfiles, profileOgImage, profilePage, profilePhoto } from '../pages';

// GET /_pages/profile/:slug, GET /_pages/og/:slug and GET /_pages/photo/:slug: the Pages Function
// transport for public page tags, share-card images and avatars (docs/og-plan.md §3.3, decision O14;
// docs/public-pages-plan.md decision D8). All three routes exist only for the web Function's
// service-binding call; nothing else should ever have `PAGES_SHARED_SECRET`.

/** True only when `x-pages-key` matches the shared secret. Checked before `x-client-ip` is trusted. */
function authorized(c: Context<AppEnv>): boolean {
  const secret = c.env.PAGES_SHARED_SECRET;
  const provided = c.req.header('x-pages-key');
  return !!secret && !!provided && timingSafeEqual(provided, secret);
}

export const pagesRoutes = new Hono<AppEnv>();

pagesRoutes.get('/_pages/profile/:slug', async (c) => {
  // A bad or missing key reads exactly like an unknown route: no hint that /_pages/* exists at all.
  if (!authorized(c)) return c.json(errorBody('not_found', 'Not found'), 404);
  const ip = c.req.header('x-client-ip') ?? null;
  const result = await profilePage(c.env, c.req.param('slug'), ip);
  // The result's own `status` carries not-found and rate-limited, so the HTTP status is always 200.
  c.header('Cache-Control', 'no-store');
  return c.json(result);
});

pagesRoutes.get('/_pages/og/:slug', async (c) => {
  if (!authorized(c)) return c.json(errorBody('not_found', 'Not found'), 404);
  const ip = c.req.header('x-client-ip') ?? null;
  const v = c.req.query('v') ?? null;
  const ifNoneMatch = c.req.header('if-none-match') ?? null;
  const result = await profileOgImage(c.env, c.executionCtx, c.req.param('slug'), v, ip, ifNoneMatch);

  switch (result.status) {
    case 'not_found':
      return c.json(errorBody('not_found', 'Profile not found'), 404);
    case 'rate_limited':
      return c.json(errorBody('rate_limited', 'Too many requests, try again in a minute'), 429);
    case 'unavailable':
      // Not an ApiErrorCode: this body is read by the web Function (WP-5), not the app or shared types.
      return c.json({ error: { code: 'og_unavailable', message: 'Could not render a preview image' } }, 503);
    case 'not_modified':
      // ifNoneMatch matched `cur` exactly, so this is always the current version: same Cache-Control
      // as the 200 "current version" case (§3.4), or a 304 leaves the client's cache freshness unclear.
      return c.body(null, 304, { ETag: `"${result.etag}"`, 'Cache-Control': 'public, max-age=3600' });
    case 'ok':
      // A plain Response, not c.body(): Hono's typed body union doesn't accept a generic
      // Uint8Array<ArrayBufferLike> (what `new Uint8Array(arrayBuffer)` returns), only one backed
      // by a concrete ArrayBuffer.
      return new Response(result.bytes, {
        headers: {
          'Content-Type': 'image/jpeg',
          'Content-Length': String(result.bytes.byteLength),
          ETag: `"${result.etag}"`,
          'Cache-Control': `public, max-age=${result.maxAge}`,
        },
      });
  }
});

pagesRoutes.get('/_pages/photo/:slug', async (c) => {
  if (!authorized(c)) return c.json(errorBody('not_found', 'Not found'), 404);
  const ip = c.req.header('x-client-ip') ?? null;
  const v = c.req.query('v') ?? null;
  const result = await profilePhoto(c.env, c.executionCtx, c.req.param('slug'), ip, v);

  switch (result.status) {
    case 'not_found':
      return c.json(errorBody('not_found', 'Not found'), 404);
    case 'rate_limited':
      return c.json(errorBody('rate_limited', 'Too many requests, try again in a minute'), 429);
    case 'ok': {
      // The variant gets its own ETag suffix (design point 3): a browser holding the original JPEG
      // under the plain `"<version>"` ETag must not get served a 304 once a WebP variant exists.
      const etag = result.variant === '416' ? `"${result.version}-416"` : `"${result.version}"`;
      const headers = {
        'Content-Type': result.contentType,
        'Content-Length': String(result.contentLength),
        ETag: etag,
        'Cache-Control': `public, max-age=${result.maxAge}`,
        // The web Function turns this into X-Robots-Tag on the actual /id/:slug/photo response.
        'X-Indexable': result.indexable ? '1' : '0',
      };
      // Same headers either way (D8): a 304 just drops the body once the caller's own copy proves current.
      if (c.req.header('if-none-match') === headers.ETag) return c.body(null, 304, headers);
      return new Response(result.body, { headers });
    }
  }
});

/**
 * GET /_pages/sitemap: every indexable profile, for the web Function's sitemap-profiles.xml
 * (docs/public-pages-plan.md §3.2/§2.1). Secret-gated and never cached, same as the other /_pages/*
 * routes; the web Function applies its own `max-age=3600` to the XML it builds from this.
 */
pagesRoutes.get('/_pages/sitemap', async (c) => {
  if (!authorized(c)) return c.json(errorBody('not_found', 'Not found'), 404);
  const result = await indexableProfiles(c.env);
  c.header('Cache-Control', 'no-store');
  return c.json(result);
});
