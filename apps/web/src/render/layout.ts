// The shared <html> shell for every apps/web page: head metadata, the inline stylesheet, the site
// header and footer. home.ts and legal.ts each build their own <main> markup and hand it to page().

import { APP_NAME, COPYRIGHT, SUPPORT_EMAIL, TAGLINE } from '@chatsoon/shared/src/constants';
import { Colors } from '@chatsoon/shared/src/design';

import { consentCss, consentScript, cookieSettingsLinkHtml } from './consent';
import { css } from './css';
import { escapeHtml, escapeJsonLd } from './escape';
import { ogTags, type OgTagsMeta } from './og';

/** Every page built through `page()` gives its own url, image and card (docs/og-plan.md §3.4). */
export type PageOgOptions = OgTagsMeta;

export interface PageOptions {
  title: string;
  description: string;
  canonical: string;
  /** e.g. "noindex". Omitted means the page carries no robots meta tag at all (indexable). */
  robots?: string;
  og: PageOgOptions;
  /** Embedded as `<script type="application/ld+json">`, escaped per §3.4. Omit for no JSON-LD. */
  jsonLd?: unknown;
  /** Raw, trusted inline script source (never user data) placed early in <head>. */
  headScript?: string;
  /** Raw, trusted <main> content, already escaped by the caller. */
  main: string;
  /** Replaces the header's default "Sign in" link. Raw, trusted markup. */
  headerAction?: string;
}

// The app icon (a speech bubble on a violet tile), drawn inline so no page needs an external asset.
// Shared verbatim with apps/mobile/scripts/build-static-pages.mjs (deleted in WP-B3, which folds this
// page into the one renderer).
const LOGO = `<svg width="32" height="32" viewBox="0 0 64 64" aria-hidden="true"><rect width="64" height="64" rx="17" fill="#5146E5"/><path d="M14 23a8 8 0 0 1 8-8h20a8 8 0 0 1 8 8v12a8 8 0 0 1-8 8H29l-9 7v-7.3A8 8 0 0 1 14 35z" fill="#fff"/><circle cx="24" cy="29" r="3.2" fill="#5146E5"/><circle cx="32" cy="29" r="3.2" fill="#5146E5"/><circle cx="40" cy="29" r="3.2" fill="#FF6B4A"/></svg>`;
const LOGO_SMALL = LOGO.replace('width="32" height="32"', 'width="24" height="24"');

const DEFAULT_HEADER_ACTION = `<a class="button" href="/sign-in">Sign in</a>`;

const FOOTER_LINKS = [
  { href: '/privacy', label: 'Privacy' },
  { href: '/terms', label: 'Terms' },
  { href: '/support', label: 'Support' },
  { href: '/accessibility', label: 'Accessibility' },
];

/** Renders one complete `<html>` document. */
export function page(opts: PageOptions): string {
  const robots = opts.robots ? `<meta name="robots" content="${escapeHtml(opts.robots)}">` : '';
  const jsonLd = opts.jsonLd !== undefined ? `<script type="application/ld+json">${escapeJsonLd(opts.jsonLd)}</script>` : '';
  // Runs before the stylesheet and before <body>, so a signed-in visitor's redirect (home) or SPA
  // handoff (Stage C's profile page) starts as early as possible.
  const headScript = opts.headScript ? `<script>${opts.headScript}</script>` : '';

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
${headScript}
<title>${escapeHtml(opts.title)}</title>
<meta name="description" content="${escapeHtml(opts.description)}">
<link rel="canonical" href="${opts.canonical}">
${robots}
${ogTags(opts.og)}
<meta name="theme-color" content="${Colors.light.primary}">
<link rel="icon" href="/favicon.ico">
${jsonLd}
<style>${css()}${consentCss()}</style>
</head>
<body>
<header class="site"><div class="wrap">
<a class="brand" href="/" aria-label="${APP_NAME} home">${LOGO}<span>${APP_NAME}</span></a>
${opts.headerAction ?? DEFAULT_HEADER_ACTION}
</div></header>
<main id="page">${opts.main}</main>
<footer><div class="wrap">
<div><a class="brand" href="/">${LOGO_SMALL}<span>${APP_NAME}</span></a><p class="tagline">${TAGLINE}</p></div>
<div><nav aria-label="Legal">${FOOTER_LINKS.map((l) => `<a href="${l.href}">${l.label}</a>`).join('')}<!--email_off--><a href="mailto:${SUPPORT_EMAIL}">${SUPPORT_EMAIL}</a><!--/email_off--> ${cookieSettingsLinkHtml()}</nav><p class="copy">© 2026 ${COPYRIGHT}</p></div>
</div></footer>
<script>${consentScript()}</script>
</body>
</html>
`;
}
