import { describe, expect, it } from 'vitest';

import type { OgCard } from './og';
import { describeProfile, firstName, profileOgTitle, profileTitle, roleLine } from './profile-page';

// Fixtures mirror apps/mobile/src/app/id/[slug].tsx's describe() exactly, so describeProfile's
// output can be compared against it by hand.
const withEverything: OgCard = {
  displayName: 'Peter Bui',
  role: 'Founder',
  company: 'Moshi Concepts',
  headline: 'Building the networking CRM for events',
};
const withHeadlineOnly: OgCard = { displayName: 'Alex Rivera', role: null, company: null, headline: 'Product design' };
const withNothing: OgCard = { displayName: 'Sam', role: null, company: null, headline: null };

/** Today's describe() (apps/mobile/src/app/id/[slug].tsx), for comparison against describeProfile. */
function legacyDescribe(p: OgCard): string {
  const about = [p.headline, roleLine(p.role, p.company)].filter(Boolean).join(' · ');
  const cta = `Connect with ${firstName(p.displayName)} on Chatsoon.`;
  return about ? `${p.displayName}: ${about}. ${cta}` : cta;
}

describe('firstName', () => {
  it('takes the first word, or the whole name when there is one word', () => {
    expect(firstName('Peter Bui')).toBe('Peter');
    expect(firstName('Cher')).toBe('Cher');
    expect(firstName('  Peter   Bui  ')).toBe('Peter');
  });
});

describe('roleLine', () => {
  it('combines role and company, or falls back to whichever is set', () => {
    expect(roleLine('Founder', 'Acme')).toBe('Founder at Acme');
    expect(roleLine('Founder', null)).toBe('Founder');
    expect(roleLine(null, 'Acme')).toBe('Acme');
    expect(roleLine(null, null)).toBeNull();
  });
});

describe('describeProfile', () => {
  it.each([
    ['a profile with role, company and headline', withEverything],
    ['a profile with only a headline', withHeadlineOnly],
    ['a profile with nothing but a name', withNothing],
  ])('matches today\'s describe() for %s', (_label, p) => {
    expect(describeProfile(p)).toBe(legacyDescribe(p));
  });

  it('is never longer than 160 characters, even for the longest possible fields', () => {
    const longest: OgCard = {
      displayName: 'A'.repeat(80),
      role: 'B'.repeat(80),
      company: 'C'.repeat(80),
      headline: 'D'.repeat(120),
    };
    const result = describeProfile(longest);
    expect(result.length).toBeLessThanOrEqual(160);
    // The cut lands on a word boundary: describeProfile never truncates mid-word here because every
    // field above is a single run of one repeated character (one "word"), so word-boundary and
    // hard-cut coincide; a mixed-word fixture below checks the boundary itself.
  });

  it('cuts long text on a word boundary, not mid-word', () => {
    const words = Array.from({ length: 40 }, (_, i) => `word${i}`).join(' ');
    const long: OgCard = { displayName: 'Peter Bui', role: null, company: null, headline: words };
    const full = legacyDescribe(long);
    expect(full.length).toBeGreaterThan(160); // sanity: this fixture actually needs truncating

    const result = describeProfile(long);
    expect(result.length).toBeLessThanOrEqual(160);
    // The result is a real prefix of the untruncated text, cut right after a whole word.
    expect(full.startsWith(result)).toBe(true);
    expect(full[result.length]).toBe(' ');
  });
});

describe('profileTitle', () => {
  it('appends the app name', () => {
    expect(profileTitle({ displayName: 'Peter Bui' })).toBe('Peter Bui · Chatsoon');
  });
});

describe('profileOgTitle', () => {
  it('uses "{name} – {roleLine}" when there is a role or company', () => {
    expect(profileOgTitle(withEverything)).toBe('Peter Bui – Founder at Moshi Concepts');
  });

  it('falls back to the headline when there is no role or company', () => {
    expect(profileOgTitle(withHeadlineOnly)).toBe('Alex Rivera – Product design');
  });

  it('is just the name when there is nothing to add', () => {
    expect(profileOgTitle(withNothing)).toBe('Sam');
  });

  it('falls back to the name alone when the full title is over 70 characters', () => {
    const p: OgCard = {
      displayName: 'A Very Long Display Name That Takes Up Quite A Lot Of Space',
      role: 'Founder',
      company: 'A Company With An Extremely Long Name Indeed',
      headline: null,
    };
    const full = `${p.displayName} – ${roleLine(p.role, p.company)}`;
    expect(full.length).toBeGreaterThan(70);
    expect(profileOgTitle(p)).toBe(p.displayName);
  });
});
