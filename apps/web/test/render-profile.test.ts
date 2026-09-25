import { gzipSync } from 'node:zlib';

import { describe, expect, it } from 'vitest';

import { bookingOpenUrl } from '@chatsoon/shared/src/booking';
import type { PageProfile, ProfileContactKey } from '@chatsoon/shared/src/types';

import { escapeHtml } from '../src/render/escape';
import { renderProfile, type ProfileAssets } from '../src/render/profile';

const BASE: PageProfile = {
  slug: 'peter-bui-5ec50167',
  displayName: 'Peter Bui',
  headline: 'Midnight & Cardano Ambassador | Founder at Moshi Concepts and crypto YouTuber',
  company: 'Moshi Concepts',
  role: 'Founder',
  links: {
    linkedin: 'https://www.linkedin.com/in/peterbui',
    x: 'https://x.com/peterbui',
    telegram: 'https://t.me/peterbui',
    youtube: '@peterbui',
    website: 'https://moshiconcepts.com',
  },
  bookingLinks: [
    { label: 'Token 2049 catchups', url: 'https://calendly.com/peterbui/token2049', provider: 'calendly' },
    { label: 'Crypto chat', url: 'https://calendly.com/peterbui/crypto-chat', provider: 'calendly' },
    { label: 'Intro call', url: 'https://cal.com/peterbui/intro', provider: 'calcom' },
    { label: 'Book a meeting', url: 'https://calendar.app.google/abc123', provider: 'google' },
    { label: 'Office hours', url: 'https://outlook.office.com/book/user/xyz', provider: 'microsoft' },
  ],
  contactChannels: [],
  contactVisibility: 'connections',
  avatarVersion: 'abcdef0123456789',
  updatedAt: '2026-09-25T00:00:00.000Z',
  indexable: false,
  ogVersion: null,
};

const ASSETS: ProfileAssets = {
  islandUrl: '/_p/profile-abc123.js',
  siteKey: '1x00000000000000000000AA',
  apiOrigin: 'https://api.chatsoon.app',
  spa: {
    styles: '<style data-href="/_expo/static/css/web/reset.css">html{margin:0}</style>',
    entryScriptSrc: '/_expo/static/js/web/entry-abc123.js',
  },
};

describe('renderProfile', () => {
  it('has exactly one h1, containing the name', () => {
    const html = renderProfile(BASE, ASSETS);
    expect(html.match(/<h1[\s>]/g)).toHaveLength(1);
    expect(html).toContain(`<h1>${escapeHtml(BASE.displayName)}</h1>`);
  });

  it('carries the contract data attributes on the one <main id="page">', () => {
    const html = renderProfile(BASE, ASSETS);
    expect(html.match(/<main[\s>]/g)).toHaveLength(1);
    const main = html.match(/<main id="page"[^>]*>/)?.[0] ?? '';
    expect(main).toContain(`data-slug="${BASE.slug}"`);
    expect(main).toContain(`data-api="${ASSETS.apiOrigin}"`);
    expect(main).toContain(`data-sitekey="${ASSETS.siteKey}"`);
    expect(main).toContain('data-first="Peter"');
    expect(main).toContain(`data-visibility="${BASE.contactVisibility}"`);
  });

  it('renders the avatar as an eager, correctly sized <img>, never lazy', () => {
    const html = renderProfile(BASE, ASSETS);
    const img = html.match(/<img[^>]*id="avatar"[^>]*>/)?.[0] ?? '';
    expect(img).toBeTruthy();
    expect(img).toContain('width="208"');
    expect(img).toContain('height="208"');
    expect(img).toContain('fetchpriority="high"');
    expect(img).toContain(`alt="${escapeHtml(BASE.displayName)}"`);
    expect(img).not.toContain('loading="lazy"');
  });

  it('renders initials instead of an <img> when there is no avatar', () => {
    const html = renderProfile({ ...BASE, avatarVersion: null }, ASSETS);
    expect(html).not.toMatch(/<img[^>]*id="avatar"/);
    expect(html).toContain('class="avatar initials"');
  });

  it('gives every target="_blank" anchor a noopener rel', () => {
    const html = renderProfile(BASE, ASSETS);
    const anchors = html.match(/<a\b[^>]*target="_blank"[^>]*>/g) ?? [];
    expect(anchors.length).toBeGreaterThan(0);
    for (const a of anchors) {
      const rel = (a.match(/rel="([^"]*)"/)?.[1] ?? '').split(/\s+/);
      expect(rel).toContain('noopener');
    }
  });

  it('gives every profile link an href from toLinkUrl, with rel="me noopener noreferrer"', () => {
    const html = renderProfile(BASE, ASSETS);
    expect(html).toContain('href="https://www.linkedin.com/in/peterbui" target="_blank" rel="me noopener noreferrer"');
    expect(html).toContain('href="https://x.com/peterbui" target="_blank" rel="me noopener noreferrer"');
  });

  it('gives each booking row an href equal to bookingOpenUrl, and nofollow/ugc/noopener', () => {
    const html = renderProfile(BASE, ASSETS);
    const rows = html.match(/<a class="booking-row"[^>]*>/g) ?? [];
    expect(rows).toHaveLength(BASE.bookingLinks.length);
    for (const link of BASE.bookingLinks) {
      expect(html).toContain(`<a class="booking-row" href="${escapeHtml(bookingOpenUrl(link))}"`);
    }
    for (const row of rows) {
      const rel = (row.match(/rel="([^"]*)"/)?.[1] ?? '').split(/\s+/);
      expect(rel).toEqual(expect.arrayContaining(['nofollow', 'ugc', 'noopener', 'noreferrer']));
    }
  });

  it('gives the vCard link rel="nofollow" and the api-origin href', () => {
    const html = renderProfile(BASE, ASSETS);
    const href = `${ASSETS.apiOrigin}/id/${BASE.slug}/vcard`;
    const link = html.match(/<a[^>]*href="[^"]*\/vcard"[^>]*>/)?.[0] ?? '';
    expect(link).toContain(`href="${escapeHtml(href)}"`);
    expect(link).toContain('rel="nofollow"');
  });

  it('matches every label[for] to a real input id', () => {
    const html = renderProfile(BASE, ASSETS);
    const fors = [...html.matchAll(/<label for="([^"]+)">/g)].map((m) => m[1]);
    expect(fors.length).toBeGreaterThanOrEqual(3);
    for (const id of fors) {
      expect(html).toMatch(new RegExp(`id="${id}"`));
    }
  });

  it('gives the Turnstile slot a reserved min-height of 65px', () => {
    const html = renderProfile(BASE, ASSETS);
    expect(html).toContain('<div id="turnstile-slot" style="min-height:65px"></div>');
  });

  it('gzips to 14 KB or less with 5 links and 5 booking links', () => {
    const html = renderProfile(BASE, ASSETS);
    expect(gzipSync(Buffer.from(html, 'utf8')).byteLength).toBeLessThanOrEqual(14 * 1024);
  });

  it('escapes <script>, quotes and & in the name and headline', () => {
    const evil: PageProfile = {
      ...BASE,
      displayName: `A <script>alert(1)</script> & "Name"`,
      headline: `Head<line> & "quote"`,
    };
    const html = renderProfile(evil, ASSETS);
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).not.toContain('Head<line>');
    expect(html).not.toContain('& "Name"');
    expect(html).toContain(escapeHtml(evil.displayName));
    expect(html).toContain(escapeHtml(evil.headline ?? ''));
  });

  it('is noindex with no JSON-LD when the profile is not indexable', () => {
    const html = renderProfile({ ...BASE, indexable: false }, ASSETS);
    expect(html).toContain('<meta name="robots" content="noindex">');
    expect(html).not.toContain('application/ld+json');
  });

  describe('an indexable profile (Stage D)', () => {
    const INDEXABLE: PageProfile = { ...BASE, indexable: true };

    it('carries no "noindex" anywhere, and max-image-preview:large instead', () => {
      const html = renderProfile(INDEXABLE, ASSETS);
      expect(html.toLowerCase()).not.toContain('noindex');
      expect(html).toContain('<meta name="robots" content="max-image-preview:large">');
    });

    it('embeds a parseable ProfilePage JSON-LD script', () => {
      const html = renderProfile(INDEXABLE, ASSETS);
      const match = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/);
      expect(match).toBeTruthy();
      const data = JSON.parse(match![1]!.replace(/\\u003c/g, '<').replace(/\\u003e/g, '>').replace(/\\u0026/g, '&'));
      expect(data['@type']).toBe('ProfilePage');
      expect(data['@id']).toBe(`https://chatsoon.app/id/${INDEXABLE.slug}`);
      expect(data.mainEntity['@type']).toBe('Person');
      expect(data.mainEntity.name).toBe(INDEXABLE.displayName);
      expect(data.isPartOf['@id']).toBe('https://chatsoon.app/#website');
    });

    it('never emits telephone, contactPoint, tel:, wa.me, signal.me or a vcard link in the JSON-LD, even with contactChannels set', () => {
      const withContact: PageProfile = {
        ...INDEXABLE,
        contactChannels: ['phone', 'whatsapp', 'signal'],
        contactVisibility: 'public',
      };
      const html = renderProfile(withContact, ASSETS);
      const match = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)![1]!;
      expect(match).not.toContain('telephone');
      expect(match).not.toContain('contactPoint');
      expect(match).not.toContain('tel:');
      expect(match).not.toContain('wa.me');
      expect(match).not.toContain('signal.me');
      expect(match).not.toContain('vcard');
    });
  });

  it('loads no external script except the island module, and no stylesheet link', () => {
    const html = renderProfile(BASE, ASSETS);
    const srcScripts = [...html.matchAll(/<script[^>]*\bsrc="([^"]+)"/g)].map((m) => m[1]);
    expect(srcScripts).toEqual([ASSETS.islandUrl]);
    expect(html).toContain(`<script type="module" src="${ASSETS.islandUrl}"></script>`);
    expect(html).not.toMatch(/<link[^>]*rel="stylesheet"/);
  });

  it('adds the spa-mode CSS and the head/body handoff scripts', () => {
    const html = renderProfile(BASE, ASSETS);
    expect(html).toContain('.spa #page,.spa header.site,.spa body>footer{display:none}');
    expect(html).toContain("l.remove()");
    expect(html).toContain("classList.add('spa')");
    expect(html).toContain('chatsoon.session');
    expect(html).toContain(ASSETS.spa.entryScriptSrc);
  });

  it('never mentions localhost', () => {
    expect(renderProfile(BASE, ASSETS).toLowerCase()).not.toContain('localhost');
  });

  it('never renders phone, WhatsApp or Signal values, even if the DTO carries an injected `contact`', () => {
    const withContact = {
      ...BASE,
      contactChannels: ['phone', 'whatsapp', 'signal'] as ProfileContactKey[],
      contactVisibility: 'public',
      // A whitelist violation upstream (types.ts's PageProfile has no `contact` field at all): the
      // renderer must never read it even if one is smuggled onto the object.
      contact: { phone: '+61491570156', whatsapp: '+61491570157', signal: 'peterb-signal-username' },
    } as PageProfile & Record<string, unknown>;

    const html = renderProfile(withContact, ASSETS);

    expect(html).not.toContain('491570156');
    expect(html).not.toContain('491570157');
    expect(html).not.toContain('peterb-signal-username');
    expect(html).not.toContain('tel:');
    expect(html).not.toContain('wa.me');
    expect(html).not.toContain('signal.me');
  });

  describe('contact chips', () => {
    it('renders locked chips and a note for connections visibility', () => {
      const html = renderProfile(
        { ...BASE, contactChannels: ['phone', 'whatsapp'], contactVisibility: 'connections' },
        ASSETS,
      );
      expect(html).toContain('data-channels="phone whatsapp"');
      expect(html).toContain('class="chip locked"');
      expect(html).toContain('Connect with Peter to get their number.');
      expect(html).not.toContain('data-reveal');
    });

    it('renders tap-to-reveal buttons for public visibility', () => {
      const html = renderProfile({ ...BASE, contactChannels: ['signal'], contactVisibility: 'public' }, ASSETS);
      expect(html).toContain('data-reveal="signal"');
      expect(html).not.toContain('class="chip locked"');
      expect(html).not.toContain('to get their number');
    });

    it('omits the chips container entirely with no channels', () => {
      const html = renderProfile({ ...BASE, contactChannels: [] }, ASSETS);
      expect(html).not.toContain('id="contact-chips"');
    });
  });

  it('omits the booking section entirely with no booking links', () => {
    const html = renderProfile({ ...BASE, bookingLinks: [] }, ASSETS);
    expect(html).not.toContain('id="booking"');
  });

  describe('promo card (issue #16)', () => {
    it('renders a purple promo card with the free-profile heading, aria-labelledby and a /sign-in CTA', () => {
      const html = renderProfile(BASE, ASSETS);
      expect(html).toContain('<section id="promo" class="card promo-card" aria-labelledby="promo-h">');
      expect(html).toContain('<h2 id="promo-h">Get your own free profile</h2>');
      expect(html).toContain('<a class="button button-block promo-cta" href="/sign-in">Create your free profile</a>');
    });

    it('gives the "see how it works" link an href of "/"', () => {
      const html = renderProfile(BASE, ASSETS);
      expect(html).toContain('<a class="promo-more" href="/">See how it works</a>');
    });
  });
});
