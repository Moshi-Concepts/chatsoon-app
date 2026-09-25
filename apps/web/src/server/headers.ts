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

// The 4 headers docs/public-pages-plan.md §3.3 puts on every /id/* Function response, HTML, photo or
// (from Stage D) the profile sitemap alike (handle.ts, photo.ts, sitemap.ts): "_headers" doesn't apply
// to Function responses (see the file banner above), so these have to be set in code too, same as the
// OG image's 3 already were.
export const PAGE_SECURITY_HEADERS: Readonly<Record<string, string>> = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'X-Frame-Options': 'DENY',
  'Permissions-Policy': 'camera=(self), microphone=(), geolocation=(), payment=()',
};

/** Just the 4 headers above, with no `X-Robots-Tag` either way — for a response that is never
 * per-visitor sensitive and carries no noindex signal of its own (sitemap.ts: a sitemap listing only
 * profiles that are already indexable needs none). */
export function pageSecurityHeaders(base?: Headers | Record<string, string>): Headers {
  const headers = new Headers(base);
  for (const [name, value] of Object.entries(PAGE_SECURITY_HEADERS)) headers.set(name, value);
  return headers;
}

/**
 * Headers for every /id/:slug HTML response (handle.ts, §3.3): the 4 headers above, `Content-Type`,
 * the caller's own `Cache-Control` (§2.4: 200 and 301 use the default value, 404 a longer one, 429 and
 * 405 `no-store`), and `X-Robots-Tag: noindex` unless `indexable` is true (Stage D: computed per
 * profile). Every non-indexable response — 404, 429, redirects, the SPA fallback, and a non-indexable
 * profile — keeps the header by passing no argument or `false`; only a 200 for a profile with
 * `p.indexable === true` passes `true`.
 */
export function htmlSecurityHeaders(cacheControl: string, indexable = false): Headers {
  const headers = pageSecurityHeaders();
  headers.set('Content-Type', 'text/html; charset=utf-8');
  if (!indexable) headers.set('X-Robots-Tag', 'noindex');
  headers.set('Cache-Control', cacheControl);
  return headers;
}

/**
 * Headers for every /id/:slug/photo response (photo.ts, the "Stage C as built on top of #5" note, and
 * Stage D task 3): the same 4 headers, layered onto whatever the caller already put in `base` (the
 * pass-through Content-Type, Content-Length, ETag and Cache-Control from the API, on a 200 or 304), plus
 * `X-Robots-Tag: noindex` unless `indexable` is true. A missing or false `indexable` means noindex —
 * the safe default when the upstream `X-Indexable` header is absent or unrecognised.
 */
export function photoSecurityHeaders(base?: Headers | Record<string, string>, indexable = false): Headers {
  const headers = pageSecurityHeaders(base);
  if (!indexable) headers.set('X-Robots-Tag', 'noindex');
  else headers.delete('X-Robots-Tag');
  return headers;
}
