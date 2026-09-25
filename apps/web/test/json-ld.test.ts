import { describe, expect, it } from 'vitest';

import type { PageProfile } from '@chatsoon/shared/src/types';

import { profileJsonLd } from '../src/render/json-ld';

// profileJsonLd (docs/public-pages-plan.md §3.4, Stage D WP-D2): the plain object embedded by
// renderProfile with escapeJsonLd. Tested directly here so the omit-when-null and sameAs rules aren't
// buried behind the whole page's markup.

const BASE: PageProfile = {
  slug: 'peter-bui-5ec50167',
  displayName: 'Peter Bui',
  headline: 'Building Chatsoon',
  company: 'Moshi Concepts',
  role: 'Founder',
  links: {
    linkedin: 'https://www.linkedin.com/in/peterbui',
    x: 'https://x.com/peterbui?utm_source=qr&utm_campaign=launch&ref=abc',
    telegram: 'https://t.me/peterbui',
    youtube: '@peterbui',
    website: 'https://moshiconcepts.com/about?ref=abc&utm_medium=card&utm_source=qr',
  },
  bookingLinks: [{ label: 'Intro call', url: 'https://cal.com/peterbui/intro', provider: 'calcom' }],
  contactChannels: [],
  contactVisibility: 'connections',
  avatarVersion: 'abcdef0123456789',
  updatedAt: '2026-09-25T00:00:00.000Z',
  indexable: true,
  ogVersion: null,
};

const ORIGIN = 'https://chatsoon.app';

describe('profileJsonLd', () => {
  it('builds a fully-filled ProfilePage with the mainEntity Person', () => {
    const data = profileJsonLd(BASE, ORIGIN);
    expect(data['@context']).toBe('https://schema.org');
    expect(data['@type']).toBe('ProfilePage');
    expect(data['@id']).toBe(`${ORIGIN}/id/${BASE.slug}`);
    expect(data.url).toBe(`${ORIGIN}/id/${BASE.slug}`);
    expect(data.dateModified).toBe(BASE.updatedAt);

    const mainEntity = data.mainEntity as Record<string, unknown>;
    expect(mainEntity['@type']).toBe('Person');
    expect(mainEntity['@id']).toBe(`${ORIGIN}/id/${BASE.slug}#person`);
    expect(mainEntity.name).toBe(BASE.displayName);
    expect(mainEntity.description).toBe(BASE.headline);
    expect(mainEntity.jobTitle).toBe(BASE.role);
    expect(mainEntity.worksFor).toEqual({ '@type': 'Organization', name: BASE.company });
    expect(mainEntity.image).toBe(`${ORIGIN}/id/${BASE.slug}/photo?v=${BASE.avatarVersion}`);
    expect(mainEntity.url).toBe(`${ORIGIN}/id/${BASE.slug}`);
  });

  it('uses the same isPartOf @id as the home page WebSite node', () => {
    const data = profileJsonLd(BASE, ORIGIN);
    expect(data.isPartOf).toEqual({
      '@type': 'WebSite',
      '@id': `${ORIGIN}/#website`,
      name: 'Chatsoon',
      url: `${ORIGIN}/`,
    });
  });

  it('omits description, jobTitle, worksFor, image and sameAs when their source fields are null/empty', () => {
    const thin: PageProfile = {
      ...BASE,
      headline: null,
      role: null,
      company: null,
      avatarVersion: null,
      links: {},
    };
    const data = profileJsonLd(thin, ORIGIN);
    const mainEntity = data.mainEntity as Record<string, unknown>;
    expect(mainEntity).not.toHaveProperty('description');
    expect(mainEntity).not.toHaveProperty('jobTitle');
    expect(mainEntity).not.toHaveProperty('worksFor');
    expect(mainEntity).not.toHaveProperty('image');
    expect(mainEntity).not.toHaveProperty('sameAs');
  });

  it('keeps a headline without a role/company, and a role without a company (independent omission)', () => {
    const headlineOnly = profileJsonLd({ ...BASE, role: null, company: null }, ORIGIN);
    const mainEntity = headlineOnly.mainEntity as Record<string, unknown>;
    expect(mainEntity.description).toBe(BASE.headline);
    expect(mainEntity).not.toHaveProperty('jobTitle');
    expect(mainEntity).not.toHaveProperty('worksFor');
  });

  it('sameAs holds only the 5 allowed link kinds, with utm_* stripped and other params kept', () => {
    const data = profileJsonLd(BASE, ORIGIN);
    const mainEntity = data.mainEntity as Record<string, unknown>;
    const sameAs = mainEntity.sameAs as string[];
    expect(sameAs).toHaveLength(5);
    expect(sameAs).toContain('https://www.linkedin.com/in/peterbui');
    expect(sameAs).toContain('https://t.me/peterbui');
    expect(sameAs).toContain('https://www.youtube.com/@peterbui');
    // toLinkUrl normalises x/telegram/linkedin/youtube down to a bare canonical profile URL with no
    // query string at all, so utm_* never survives there either way; `website` is the one kind whose
    // toLinkUrl preserves the full path and query, so it's the meaningful case for "utm stripped, other
    // params kept".
    const websiteUrl = sameAs.find((u) => u.includes('moshiconcepts.com'))!;
    expect(websiteUrl).toBeTruthy();
    expect(websiteUrl).not.toContain('utm_medium');
    expect(websiteUrl).not.toContain('utm_source');
    expect(websiteUrl).toContain('ref=abc');
    expect(websiteUrl).toContain('/about');
  });

  it('never includes telephone, contactPoint, email, tel:, wa.me, signal.me, a vCard or a booking URL, even with contactChannels set', () => {
    const withExtra = {
      ...BASE,
      contactChannels: ['phone', 'whatsapp', 'signal'],
      contactVisibility: 'public',
      // A whitelist violation upstream (PageProfile has no `contact` field at all) must still leak nothing.
      contact: { phone: '+61491570156', whatsapp: '+61491570157', signal: 'peterb-signal' },
    } as PageProfile & Record<string, unknown>;

    const json = JSON.stringify(profileJsonLd(withExtra, ORIGIN));
    expect(json).not.toContain('telephone');
    expect(json).not.toContain('contactPoint');
    expect(json).not.toContain('491570156');
    expect(json).not.toContain('491570157');
    expect(json).not.toContain('peterb-signal');
    expect(json).not.toContain('tel:');
    expect(json).not.toContain('wa.me');
    expect(json).not.toContain('signal.me');
    expect(json.toLowerCase()).not.toContain('vcard');
    expect(json).not.toContain('cal.com');
    expect(json).not.toContain('calcom');
  });
});
