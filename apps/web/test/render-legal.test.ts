import { describe, expect, it } from 'vitest';

import legalContent from '../../mobile/src/content/legal.json';
import { escapeHtml } from '../src/render/escape';
import { renderLegal, type LegalDoc, type LegalKey } from '../src/render/legal';
import { DEFAULT_OG_IMAGE } from '../src/render/og-asset';

const legal = legalContent as Record<LegalKey, LegalDoc>;
const KEYS: LegalKey[] = ['privacy', 'terms', 'support'];

function anchor(heading: string): string {
  return heading
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

describe.each(KEYS)('renderLegal(%s)', (key) => {
  const doc = legal[key];
  const html = renderLegal(key, doc);

  it('keeps every section heading and its anchor id', () => {
    for (const section of doc.sections) {
      expect(html).toContain(`<h2>${escapeHtml(section.heading)}</h2>`);
      expect(html).toContain(`id="${anchor(section.heading)}"`);
    }
  });

  it('has exactly one h1, matching the document title', () => {
    expect(html.match(/<h1[\s>]/g)).toHaveLength(1);
    expect(html).toContain(`<h1>${escapeHtml(doc.title)}</h1>`);
  });

  it('has a canonical link and a matching og:url', () => {
    const url = `https://chatsoon.app/${key}`;
    expect(html).toContain(`<link rel="canonical" href="${url}">`);
    expect(html).toContain(`<meta property="og:url" content="${url}">`);
  });

  it('has a single og:image using the default share image, and summary_large_image', () => {
    expect(html.match(/property="og:image"/g)).toHaveLength(1);
    expect(html).toContain(`<meta property="og:image" content="https://chatsoon.app${DEFAULT_OG_IMAGE.path}">`);
    expect(html).toContain('<meta name="twitter:card" content="summary_large_image">');
    expect(html).toContain('<meta name="twitter:site" content="@ChatSoonApp">');
  });

  it('wraps the mailto link in email_off comments', () => {
    expect(html).toMatch(/<!--email_off-->[\s\S]*?mailto:hello@chatsoon\.app[\s\S]*?<!--\/email_off-->/);
  });

  it('never mentions localhost', () => {
    expect(html.toLowerCase()).not.toContain('localhost');
  });

  it('has the consent script and a Cookie settings control, with no eager Google request', () => {
    expect(html).toContain('data-consent-open');
    expect(html).toContain('Cookie settings');
    expect(html).toContain('chatsoonConsent');
    expect(html).not.toMatch(/<script[^>]*\bsrc=["'][^"']*googletagmanager\.com/);
    expect(html).toContain('googletagmanager.com');
  });
});

it('the privacy page has the #analytics-cookies anchor from an "Analytics cookies" section', () => {
  const html = renderLegal('privacy', legal.privacy);
  expect(html).toContain('id="analytics-cookies"');
  expect(html).toContain('<h2>Analytics cookies</h2>');
});

it('only adds a table of contents past 6 sections', () => {
  for (const key of KEYS) {
    const html = renderLegal(key, legal[key]);
    expect(html.includes('class="toc"')).toBe(legal[key].sections.length > 6);
  }
});
