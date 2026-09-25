// Security headers for og-image.ts's responses (docs/og-plan.md §3.4): "`_headers` doesn't apply to
// Function responses", so the three headers that file gives every /id/*/og.jpg response have to be set
// here instead, on every outcome (200, 304, 404, 429 and the default-image fallback alike).

export const OG_IMAGE_SECURITY_HEADERS: Readonly<Record<string, string>> = {
  'X-Content-Type-Options': 'nosniff',
  'X-Robots-Tag': 'noindex',
  'Content-Security-Policy': "default-src 'none'; sandbox",
};

/** `base` seeds the result (a plain object or an existing `Headers`); the three security headers are
 * then always set, last, so nothing upstream can override them. */
export function withOgImageSecurityHeaders(base?: Headers | Record<string, string>): Headers {
  const headers = new Headers(base);
  for (const [name, value] of Object.entries(OG_IMAGE_SECURITY_HEADERS)) headers.set(name, value);
  return headers;
}

// The 4 headers docs/public-pages-plan.md §3.3 puts on every /id/* Function response, HTML or photo
// alike (handle.ts, photo.ts): "_headers" doesn't apply to Function responses (see the file banner
// above), so these have to be set in code too, same as the OG image's 3 already were.
const PAGE_SECURITY_HEADERS: Readonly<Record<string, string>> = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'X-Frame-Options': 'DENY',
  'Permissions-Policy': 'camera=(self), microphone=(), geolocation=(), payment=()',
};

/**
 * Headers for every /id/:slug HTML response (handle.ts, §3.3): the 4 headers above, `Content-Type`,
 * `X-Robots-Tag: noindex` (every profile stays noindex until Stage D computes it per profile) and the
 * caller's own `Cache-Control` (§2.4: 200 and 301 use the default value, 404 a longer one, 429 and 405
 * `no-store`).
 */
export function htmlSecurityHeaders(cacheControl: string): Headers {
  const headers = new Headers(PAGE_SECURITY_HEADERS);
  headers.set('Content-Type', 'text/html; charset=utf-8');
  headers.set('X-Robots-Tag', 'noindex');
  headers.set('Cache-Control', cacheControl);
  return headers;
}

/**
 * Headers for every /id/:slug/photo response (photo.ts, the "Stage C as built on top of #5" note): the
 * same 4 headers plus `X-Robots-Tag: noindex` (the avatar isn't indexable until Stage D either),
 * layered onto whatever the caller already put in `base` (the pass-through Content-Type,
 * Content-Length, ETag and Cache-Control from the API, on a 200 or 304).
 */
export function photoSecurityHeaders(base?: Headers | Record<string, string>): Headers {
  const headers = new Headers(base);
  for (const [name, value] of Object.entries(PAGE_SECURITY_HEADERS)) headers.set(name, value);
  headers.set('X-Robots-Tag', 'noindex');
  return headers;
}
