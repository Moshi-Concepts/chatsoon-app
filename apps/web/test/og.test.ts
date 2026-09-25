import { describe, expect, it } from 'vitest';

import type { PageProfile } from '@chatsoon/shared/src/types';

import { escapeHtml } from '../src/render/escape';
import { ogTags, profileOgBlock, type OgImage } from '../src/render/og';
import { DEFAULT_OG_IMAGE } from '../src/render/og-asset';

const IMAGE: OgImage = DEFAULT_OG_IMAGE;

const PROFILE: PageProfile = {
  slug: 'peter-bui-5ec50167',
  displayName: 'Peter Bui',
  headline: 'Building Chatsoon',
  company: 'Moshi Concepts',
  role: 'Founder',
  links: {},
  bookingLinks: [],
  contactChannels: [],
  contactVisibility: 'connections',
  avatarVersion: null,
  updatedAt: '2026-09-25T00:00:00.000Z',
  indexable: false,
  ogVersion: 'abcdef0123456789',
};

/** The `content`/`href` value of every tag whose value is meant to be a URL (not plain text). */
function urlValues(html: string): string[] {
  return [...html.matchAll(/(?:property|rel)="(?:og:url|og:image|canonical)"\s+(?:content|href)="([^"]*)"/g)].map(
    (m) => m[1] ?? '',
  );
}

describe('ogTags', () => {
  it('escapes "<>& and quotes in every value', () => {
    const html = ogTags({
      type: 'website',
      title: `A "title" <with> & 'special' chars`,
      description: `A <description> & "more"`,
      url: 'https://chatsoon.app/?a=1&b=2',
      image: IMAGE,
      card: 'summary_large_image',
    });
    expect(html).not.toMatch(/content="[^"]*[<>][^"]*"/);
    expect(html).toContain(escapeHtml(`A "title" <with> & 'special' chars`));
    expect(html).toContain(escapeHtml(`A <description> & "more"`));
  });

  it('gives every url as absolute https', () => {
    const html = ogTags({
      type: 'website',
      title: 'Title',
      description: 'Description',
      url: 'https://chatsoon.app/',
      image: IMAGE,
      card: 'summary_large_image',
    });
    const urls = urlValues(html);
    expect(urls.length).toBeGreaterThan(0);
    for (const value of urls) {
      expect(value).toMatch(/^https:\/\//);
    }
  });

  it('includes width, height and type alongside a summary_large_image card', () => {
    const html = ogTags({
      type: 'website',
      title: 'Title',
      description: 'Description',
      url: 'https://chatsoon.app/',
      image: IMAGE,
      card: 'summary_large_image',
    });
    expect(html).toContain(`<meta property="og:image:width" content="${IMAGE.width}">`);
    expect(html).toContain(`<meta property="og:image:height" content="${IMAGE.height}">`);
    expect(html).toContain(`<meta property="og:image:type" content="${IMAGE.type}">`);
    expect(html).toContain('<meta name="twitter:card" content="summary_large_image">');
  });

  it('emits twitter:site as @ChatSoonApp (O24)', () => {
    const html = ogTags({
      type: 'website',
      title: 'Title',
      description: 'Description',
      url: 'https://chatsoon.app/',
      image: IMAGE,
      card: 'summary_large_image',
    });
    expect(html).toContain('<meta name="twitter:site" content="@ChatSoonApp">');
  });

  it('omits og:url entirely when url is not given', () => {
    const html = ogTags({
      type: 'website',
      title: 'Title',
      description: 'Description',
      image: IMAGE,
      card: 'summary_large_image',
    });
    expect(html).not.toContain('og:url');
  });

  it('has exactly one og:image', () => {
    const html = ogTags({
      type: 'website',
      title: 'Title',
      description: 'Description',
      url: 'https://chatsoon.app/',
      image: IMAGE,
      card: 'summary_large_image',
    });
    expect(html.match(/property="og:image"/g)).toHaveLength(1);
  });
});

describe('profileOgBlock', () => {
  it('is wrapped in the <!--og--> markers with no leftover title or description outside them', () => {
    const block = profileOgBlock(PROFILE, 'https://chatsoon.app');
    expect(block.startsWith('<!--og-->')).toBe(true);
    expect(block.endsWith('<!--/og-->')).toBe(true);
  });

  it('points og:image and og:url at the profile, on the given origin', () => {
    const block = profileOgBlock(PROFILE, 'https://chatsoon.app');
    expect(block).toContain(`<link rel="canonical" href="https://chatsoon.app/id/${PROFILE.slug}">`);
    expect(block).toContain(`content="https://chatsoon.app/id/${PROFILE.slug}"`); // og:url
    expect(block).toContain(`/id/${PROFILE.slug}/og.jpg?v=${PROFILE.ogVersion}`);
  });

  it('falls back to the default image when ogVersion is null', () => {
    const block = profileOgBlock({ ...PROFILE, ogVersion: null }, 'https://chatsoon.app');
    expect(block).toContain(`https://chatsoon.app${DEFAULT_OG_IMAGE.path}`);
    expect(block).not.toContain('/og.jpg');
  });

  it('carries the noindex robots tag by default', () => {
    const block = profileOgBlock(PROFILE, 'https://chatsoon.app');
    expect(block).toContain('<meta name="robots" content="noindex">');
  });

  it('carries noindex explicitly when indexable is false', () => {
    const block = profileOgBlock(PROFILE, 'https://chatsoon.app', false);
    expect(block).toContain('<meta name="robots" content="noindex">');
  });

  it('emits max-image-preview:large instead of noindex when indexable is true (Stage D)', () => {
    const block = profileOgBlock(PROFILE, 'https://chatsoon.app', true);
    expect(block).toContain('<meta name="robots" content="max-image-preview:large">');
    expect(block).not.toContain('noindex');
  });

  it('leaks nothing from fields a whitelist violation upstream might have added', () => {
    const withExtra = {
      ...PROFILE,
      contact: { phone: '+61491570156', whatsapp: '+61491570157', signal: 'peterb' },
      links: { x: 'https://x.com/peter' },
    } as PageProfile & Record<string, unknown>;

    const block = profileOgBlock(withExtra, 'https://chatsoon.app');

    expect(block).not.toContain('491570156');
    expect(block).not.toContain('491570157');
    expect(block).not.toContain('peterb');
    expect(block).not.toContain('x.com/peter');
  });
});
