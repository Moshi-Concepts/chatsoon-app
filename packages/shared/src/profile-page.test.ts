import { describe, expect, it } from 'vitest';

import { REPORT_REASONS } from './constants';
import type { OgCard } from './og';
import {
  CONNECT_FORM_MAX,
  REPORT_REASON_LABELS,
  connectErrorMessage,
  describeProfile,
  firstName,
  profileOgTitle,
  profileTitle,
  roleLine,
  SESSION_STORAGE_KEY,
} from './profile-page';
import { connectFormSchema } from './schemas';

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

describe('REPORT_REASON_LABELS', () => {
  it('covers every reason in REPORT_REASONS, with no extras', () => {
    expect(Object.keys(REPORT_REASON_LABELS).sort()).toEqual([...REPORT_REASONS].sort());
  });

  it('gives every reason a title and a subtitle', () => {
    for (const reason of REPORT_REASONS) {
      expect(REPORT_REASON_LABELS[reason].title.length).toBeGreaterThan(0);
      expect(REPORT_REASON_LABELS[reason].subtitle.length).toBeGreaterThan(0);
    }
  });

  it("matches today's report-dialog.tsx copy for a couple of reasons", () => {
    expect(REPORT_REASON_LABELS.spam).toEqual({
      title: 'Spam or scam',
      subtitle: 'Unwanted messages, fake offers or phishing',
    });
    expect(REPORT_REASON_LABELS.other).toEqual({
      title: 'Something else',
      subtitle: 'Tell us what happened below',
    });
  });
});

describe('CONNECT_FORM_MAX', () => {
  // A payload that sits exactly at CONNECT_FORM_MAX for every field. If these ever drift from
  // connectFormSchema's real .max()s, the "exactly at the max" parse below starts failing.
  // `contact` must still be a syntactically valid email at both lengths, so going one over the max
  // fails because of the length cap, not the email format.
  const contactAtMax = `${'a'.repeat(CONNECT_FORM_MAX.contact - 6)}@a.com`;
  const contactOverMax = `${'a'.repeat(CONNECT_FORM_MAX.contact - 5)}@a.com`;
  const atMax = {
    name: 'A'.repeat(CONNECT_FORM_MAX.name),
    contact: contactAtMax,
    note: 'c'.repeat(CONNECT_FORM_MAX.note),
    turnstileToken: 'token',
  };

  it('equals connectFormSchema\'s real max lengths: valid exactly at the max, invalid one over', () => {
    expect(connectFormSchema.safeParse(atMax).success).toBe(true);
    expect(connectFormSchema.safeParse({ ...atMax, name: atMax.name + 'x' }).success).toBe(false);
    expect(connectFormSchema.safeParse({ ...atMax, contact: contactOverMax }).success).toBe(false);
    expect(connectFormSchema.safeParse({ ...atMax, note: atMax.note + 'x' }).success).toBe(false);
  });
});

describe('connectErrorMessage', () => {
  it("matches today's connect-form.tsx errorMessage for a captcha failure", () => {
    expect(connectErrorMessage(400, 'captcha_failed')).toBe(
      'The spam check failed. Please complete it again and resend.',
    );
  });

  it("matches today's connect-form.tsx errorMessage for a rate limit", () => {
    expect(connectErrorMessage(429, 'rate_limited')).toBe('Too many attempts. Please wait a minute and try again.');
  });

  it("matches today's connect-form.tsx errorMessage for a 404, regardless of code", () => {
    expect(connectErrorMessage(404, 'not_found')).toBe("This profile isn't available any more.");
  });

  it('returns null for anything else, so the caller falls back to the server message (or its own generic one)', () => {
    expect(connectErrorMessage(500, 'internal')).toBeNull();
    expect(connectErrorMessage(400, 'validation_error')).toBeNull();
  });
});

describe('SESSION_STORAGE_KEY', () => {
  it("is the localStorage key apps/mobile/src/lib/auth.tsx stores the web session's bearer token under", () => {
    expect(SESSION_STORAGE_KEY).toBe('chatsoon.session');
  });
});

// No module-purity (read-file) test here: packages/shared/tsconfig.json has "types": [] and a
// DOM-less "lib": ["ES2022"] (og.ts documents why — this package also runs in Hermes and
// react-native-web), so neither `node:fs`/`node:url` nor the `URL` / `import.meta.url` globals a
// read-file check needs are available, and `tsc --noEmit` fails on all four. Skipped per WP-C2;
// `describe('connectFormSchema')`'s import from './schemas' above is exempt only because it's the
// test file, not profile-page.ts itself — the real guarantee is still just eyeballing
// profile-page.ts's imports (APP_NAME/ReportReason from constants.ts, OgCard type from og.ts, no zod
// or schemas).
