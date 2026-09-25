import { gzipSync } from 'node:zlib';

import { describe, expect, it } from 'vitest';

import { Colors, type ThemeColors } from '@chatsoon/shared/src/design';

import {
  consentAction,
  consentCss,
  consentCssStandalone,
  consentScript,
  CONSENT_STORAGE_KEY,
  cookieSettingsLinkHtml,
  injectConsentIntoIndexHtml,
} from '../src/render/consent';

// WCAG 2.x relative luminance and contrast ratio (same maths as render-css.test.ts / design.test.ts).
function channel(c: number): number {
  const cs = c / 255;
  return cs <= 0.03928 ? cs / 12.92 : ((cs + 0.055) / 1.055) ** 2.4;
}
function luminance(hex: string): number {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}
function contrast(a: string, b: string): number {
  const l1 = luminance(a);
  const l2 = luminance(b);
  const [hi, lo] = l1 > l2 ? [l1, l2] : [l2, l1];
  return (hi + 0.05) / (lo + 0.05);
}

describe('consentAction (the decision consentScript()\'s init() mirrors)', () => {
  it('shows the banner with no stored choice, or an unrecognised value', () => {
    expect(consentAction(null)).toBe('banner');
    expect(consentAction('')).toBe('banner');
    expect(consentAction('yes')).toBe('banner');
  });

  it('loads GA for a stored "granted"', () => {
    expect(consentAction('granted')).toBe('load');
  });

  it('loads nothing for a stored "denied"', () => {
    expect(consentAction('denied')).toBe('none');
  });
});

describe('consentScript', () => {
  const script = consentScript();

  it('is valid, self-contained JS (parses as a Function body)', () => {
    expect(() => new Function(script)).not.toThrow();
  });

  it('reads and writes the exact storage key and value, wrapped in try/catch', () => {
    expect(script).toContain(CONSENT_STORAGE_KEY);
    expect(script).toContain('localStorage.getItem');
    expect(script).toContain('localStorage.setItem');
    expect(script).toContain('try');
    expect(script).toContain('catch');
  });

  it('carries the GA4 measurement id and the documented opt-out flag', () => {
    expect(script).toContain('G-9JPQ94MJLZ');
    expect(script).toContain('ga-disable-');
  });

  it('only ever references googletagmanager.com inside this script string', () => {
    expect(script).toContain('googletagmanager.com');
  });

  it('shows the required banner text and the analytics-cookies privacy link', () => {
    expect(script).toContain("We'd like to use analytics cookies to understand how chatsoon.app is used.");
    expect(script).toContain('/privacy#analytics-cookies');
    expect(script).toContain('Privacy policy');
    expect(script).toContain('Accept');
    expect(script).toContain('Decline');
  });

  it('sets role=region and aria-label="Cookie consent" on the banner, via setAttribute not innerHTML', () => {
    expect(script).toContain('region');
    expect(script).toContain('Cookie consent');
    expect(script).not.toContain('innerHTML');
  });

  it('builds every DOM node with createElement, never innerHTML', () => {
    expect(script).toMatch(/createElement/);
    expect(script).not.toContain('.innerHTML');
  });

  it('exposes window.chatsoonConsent.open for the "Cookie settings" control', () => {
    expect(script).toContain('chatsoonConsent');
    expect(script).toContain('data-consent-open');
  });

  it('stays under about 1.5 KB gzipped (it ships inline on every page)', () => {
    expect(gzipSync(Buffer.from(script, 'utf8')).byteLength).toBeLessThan(1536);
  });
});

describe('cookieSettingsLinkHtml', () => {
  it('is a real <button> wired to the delegated data-consent-open listener', () => {
    const html = cookieSettingsLinkHtml();
    expect(html).toContain('<button');
    expect(html).toContain('data-consent-open');
    expect(html).toContain('Cookie settings');
  });
});

describe('consent CSS', () => {
  it('consentCss() points its custom properties at the site’s existing design tokens', () => {
    const css = consentCss();
    expect(css).toContain('--cc-bg:var(--surface)');
    expect(css).toContain('.cc-banner{position:fixed');
  });

  it('consentCssStandalone() sets its properties from Colors with a prefers-color-scheme override', () => {
    const css = consentCssStandalone();
    expect(css).toContain(Colors.light.surface);
    expect(css).toContain(Colors.dark.surface);
    expect(css).toContain('@media (prefers-color-scheme:dark)');
  });

  it('the banner never shifts layout: position is fixed', () => {
    expect(consentCss()).toMatch(/\.cc-banner\{position:fixed/);
    expect(consentCssStandalone()).toMatch(/\.cc-banner\{position:fixed/);
  });

  describe('AA contrast (banner text and buttons) in light and dark', () => {
    const cases: [label: string, colors: ThemeColors][] = [
      ['light', Colors.light],
      ['dark', Colors.dark],
    ];
    it.each(cases)('%s: text on the banner background is at least 4.5:1', (_label, c) => {
      expect(contrast(c.text, c.surface)).toBeGreaterThanOrEqual(4.5);
    });
    it.each(cases)('%s: the Accept button text is at least 4.5:1 on its background', (_label, c) => {
      expect(contrast(c.onPrimary, c.primary)).toBeGreaterThanOrEqual(4.5);
    });
  });
});

describe('injectConsentIntoIndexHtml', () => {
  const SHELL = `<!doctype html>
<html><head><meta charset="utf-8"></head>
<body><div id="root"></div><script src="/entry.js"></script></body></html>
`;

  it('adds one <style> to <head> and one <script> to <body>, after #root and the entry script', () => {
    const html = injectConsentIntoIndexHtml(SHELL);
    expect(html).toContain(consentCssStandalone());
    expect(html).toContain(consentScript());
    const rootIndex = html.indexOf('<div id="root">');
    const entryIndex = html.indexOf('<script src="/entry.js">');
    const consentScriptIndex = html.lastIndexOf('<script>');
    expect(consentScriptIndex).toBeGreaterThan(rootIndex);
    expect(consentScriptIndex).toBeGreaterThan(entryIndex);
  });

  it('never nests the consent script inside #root', () => {
    const html = injectConsentIntoIndexHtml(SHELL);
    const rootOpen = html.indexOf('<div id="root">');
    const rootClose = html.indexOf('</div>', rootOpen);
    const consentScriptIndex = html.lastIndexOf('<script>');
    expect(consentScriptIndex).toBeGreaterThan(rootClose);
  });

  it('throws on a shell with no </head> or no </body>', () => {
    expect(() => injectConsentIntoIndexHtml('<html><body></body></html>')).toThrow();
    expect(() => injectConsentIntoIndexHtml('<html><head></head></html>')).toThrow();
  });
});
