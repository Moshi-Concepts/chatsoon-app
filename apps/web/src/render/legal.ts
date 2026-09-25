// Renders /privacy, /terms and /support onto layout.ts. A port of the markup in
// apps/mobile/scripts/build-static-pages.mjs (deleted in WP-B3, once build.ts calls this instead) —
// same content, same `rich()`/`anchor()` behaviour, now sharing the header, footer and stylesheet
// every other apps/web page uses instead of carrying its own copy of them.

import { APP_NAME, SUPPORT_EMAIL, WEB_ORIGIN } from '@chatsoon/shared/src/constants';

import { escapeHtml } from './escape';
import { page } from './layout';
import { DEFAULT_OG_IMAGE } from './og-asset';

export type LegalKey = 'privacy' | 'terms' | 'support' | 'accessibility';

export interface LegalSection {
  heading: string;
  paragraphs?: string[];
  bullets?: string[];
}

export interface LegalDoc {
  title: string;
  updated: string;
  intro: string;
  sections: LegalSection[];
}

/** The legal pages a build script needs to render — avoids repeating the key list elsewhere.
 * The footer's Privacy/Terms/Support/Accessibility links live in layout.ts, shared by every page. */
export const LEGAL_KEYS: readonly LegalKey[] = ['privacy', 'terms', 'support', 'accessibility'];

/** Escapes text and turns the support address and chatsoon.app URLs into links (D17 wraps the mailto in email_off). */
function rich(s: string): string {
  return escapeHtml(s)
    .split(escapeHtml(SUPPORT_EMAIL))
    .join(`<!--email_off--><a href="mailto:${SUPPORT_EMAIL}">${SUPPORT_EMAIL}</a><!--/email_off-->`)
    .replace(/https:\/\/chatsoon\.app(?:\/[\w\-/#]*)?/g, (url) => `<a href="${url}">${url}</a>`);
}

/** "Your public profile" -> "your-public-profile", for section ids and the table-of-contents links. */
function anchor(heading: string): string {
  return heading
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function renderSection(s: LegalSection): string {
  const id = anchor(s.heading);
  const paragraphs = (s.paragraphs ?? []).map((p) => `<p>${rich(p)}</p>`).join('');
  const bullets = s.bullets?.length ? `<ul>${s.bullets.map((b) => `<li>${rich(b)}</li>`).join('')}</ul>` : '';
  return `<section id="${id}"><h2>${escapeHtml(s.heading)}</h2>${paragraphs}${bullets}</section>`;
}

export function renderLegal(key: LegalKey, doc: LegalDoc): string {
  const url = `${WEB_ORIGIN}/${key}`;
  const title = `${doc.title} · ${APP_NAME}`;
  const description = doc.intro.length > 300 ? `${doc.intro.slice(0, 297).trimEnd()}...` : doc.intro;
  // Matches build-static-pages.mjs: only worth a contents box once there's enough to jump around.
  const toc =
    doc.sections.length > 6
      ? `<nav class="toc" aria-label="On this page"><h2>On this page</h2><ol>${doc.sections
          .map((s) => `<li><a href="#${anchor(s.heading)}">${escapeHtml(s.heading)}</a></li>`)
          .join('')}</ol></nav>`
      : '';

  const main = `<div class="wrap legal">
<h1>${escapeHtml(doc.title)}</h1>
<p class="updated">Last updated ${escapeHtml(doc.updated)}</p>
<p class="intro">${rich(doc.intro)}</p>
${toc}
${doc.sections.map(renderSection).join('')}
</div>`;

  return page({
    title,
    description,
    canonical: url,
    og: { type: 'website', title, description, url, image: DEFAULT_OG_IMAGE, card: 'summary_large_image' },
    main,
  });
}
