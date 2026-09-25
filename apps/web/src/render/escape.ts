// HTML- and JSON-LD-safe string escaping shared by every apps/web renderer (home, legal and, from
// Stage C, the profile page). No dependencies: this module also runs inside a Cloudflare Pages
// Function.

const HTML_ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

/** Escapes text for use in HTML content or inside a double-quoted attribute value. */
export function escapeHtml(value: string): string {
  return String(value).replace(/[&<>"']/g, (c) => HTML_ESCAPES[c] ?? c);
}

// U+2028/U+2029 (line/paragraph separator) are valid inside a JSON string but terminate a statement
// when a <script> body is parsed as JavaScript in older engines, so they get escaped too. Built with
// fromCharCode rather than a \u escape literal in source, so nothing along the way can turn the
// escape sequence back into the raw character.
const LINE_SEPARATOR = String.fromCharCode(0x2028);
const PARAGRAPH_SEPARATOR = String.fromCharCode(0x2029);

const JSON_LD_ESCAPES: Record<string, string> = {
  '<': '\\u003c',
  '>': '\\u003e',
  '&': '\\u0026',
  [LINE_SEPARATOR]: '\\u2028',
  [PARAGRAPH_SEPARATOR]: '\\u2029',
};
const JSON_LD_UNSAFE = new RegExp(`[<>&${LINE_SEPARATOR}${PARAGRAPH_SEPARATOR}]`, 'g');

/**
 * Serialises a value for embedding in `<script type="application/ld+json">`: escapes the characters
 * that could close the surrounding tag or break older parsers. Per docs/public-pages-plan.md §3.4.
 * The replacements are plain backslash-u escapes, so the result stays valid JSON.
 */
export function escapeJsonLd(value: unknown): string {
  return JSON.stringify(value).replace(JSON_LD_UNSAFE, (c) => JSON_LD_ESCAPES[c] ?? c);
}
