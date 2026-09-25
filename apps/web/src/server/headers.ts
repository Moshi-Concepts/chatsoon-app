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
