import { gzipSync } from 'node:zlib';

import { describe, expect, it } from 'vitest';

import landing from '../../mobile/src/content/landing.json';
import { renderHome, type LandingContent } from '../src/render/home';

// A minimal, valid <svg> stands in for the real QR code build.ts (WP-B3) generates with `qrcode`.
const QR_SVG = '<svg viewBox="0 0 29 29" xmlns="http://www.w3.org/2000/svg"><rect width="29" height="29"/></svg>';

const html = renderHome(landing as LandingContent, { qrSvg: QR_SVG });

/** Every `<a ...>…</a>`, so tests can check each one has an accessible name. */
function anchors(doc: string): string[] {
  return doc.match(/<a\b[^>]*>[\s\S]*?<\/a>/g) ?? [];
}

describe('renderHome', () => {
  it('has exactly one h1', () => {
    expect(html.match(/<h1[\s>]/g)).toHaveLength(1);
  });

  it('has a meta description and a canonical link', () => {
    expect(html).toMatch(/<meta name="description" content="[^"]+">/);
    expect(html).toContain('<link rel="canonical" href="https://chatsoon.app/">');
  });

  it('loads no external script or stylesheet', () => {
    expect(html).not.toMatch(/<script[^>]*\bsrc=/);
    expect(html).not.toMatch(/<link[^>]*rel="stylesheet"/);
  });

  it('gzips to 14 KB or less', () => {
    expect(gzipSync(Buffer.from(html, 'utf8')).byteLength).toBeLessThanOrEqual(14 * 1024);
  });

  it('gives every link visible text or an aria-label', () => {
    const links = anchors(html);
    expect(links.length).toBeGreaterThan(0);
    for (const a of links) {
      const hasAriaLabel = /aria-label="[^"]+"/.test(a);
      const text = a
        .replace(/<[^>]+>/g, '')
        .replace(/&[a-z]+;/gi, ' ')
        .trim();
      expect(hasAriaLabel || text.length > 0, `link has neither text nor an aria-label: ${a}`).toBe(true);
    }
  });

  it('embeds JSON-LD that parses', () => {
    const match = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/);
    const json = match?.[1];
    expect(json).toBeTruthy();
    const data = JSON.parse(json ?? '');
    expect(data['@context']).toBe('https://schema.org');
    expect(Array.isArray(data['@graph'])).toBe(true);
    expect(data['@graph'].map((n: { '@type': string }) => n['@type'])).toEqual([
      'WebSite',
      'Organization',
      'WebApplication',
    ]);
  });

  it('wraps the mailto link in email_off comments', () => {
    expect(html).toMatch(/<!--email_off-->[\s\S]*?mailto:hello@chatsoon\.app[\s\S]*?<!--\/email_off-->/);
  });

  it('never mentions localhost', () => {
    expect(html.toLowerCase()).not.toContain('localhost');
  });
});
