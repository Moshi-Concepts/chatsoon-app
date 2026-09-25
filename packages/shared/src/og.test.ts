import { describe, expect, it } from 'vitest';

import { OG_TEMPLATE_VERSION, computeOgVersion, toOgCard, type OgCard } from './og';

// See og.ts's own comment: packages/shared/tsconfig.json has neither "dom" nor "types", so the two
// Web Crypto globals this file's reference implementation needs are declared locally.
declare const crypto: { subtle: { digest(algorithm: 'SHA-256', data: Uint8Array): Promise<ArrayBuffer> } };
declare const TextEncoder: new () => { encode(input: string): Uint8Array };

const card: OgCard = {
  displayName: 'Peter Bui',
  role: 'Founder',
  company: 'Moshi Concepts',
  headline: 'Building Chatsoon',
};

/** Re-implements the O10 formula independently, so tests don't just echo the source under test. */
async function referenceOgVersion(templateVersion: string, c: OgCard, avatarKey: string | null): Promise<string> {
  const input = [templateVersion, c.displayName, c.role ?? '', c.company ?? '', c.headline ?? '', avatarKey ?? ''].join(
    '\u0000',
  );
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
  return [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
    .slice(0, 16);
}

describe('toOgCard', () => {
  it('copies exactly the 4 card fields, dropping anything else on the input', () => {
    const withExtra = {
      ...card,
      contact: { phone: '+61491570156' },
      links: { x: 'https://x.com/peter' },
    } as OgCard & Record<string, unknown>;

    const result = toOgCard(withExtra);

    expect(Object.keys(result).sort()).toEqual(['company', 'displayName', 'headline', 'role']);
    expect(result).toEqual(card);
  });
});

describe('computeOgVersion', () => {
  it('returns 16 lowercase hex characters', async () => {
    expect(await computeOgVersion(card, 'u/123/avatar.jpg')).toMatch(/^[0-9a-f]{16}$/);
  });

  it('is stable for the same inputs', async () => {
    const a = await computeOgVersion(card, 'avatar-key');
    const b = await computeOgVersion(card, 'avatar-key');
    expect(a).toBe(b);
  });

  it('matches the documented formula (O10)', async () => {
    const actual = await computeOgVersion(card, 'avatar-key');
    const expected = await referenceOgVersion(OG_TEMPLATE_VERSION, card, 'avatar-key');
    expect(actual).toBe(expected);
  });

  it('changes when OG_TEMPLATE_VERSION changes', async () => {
    const real = await computeOgVersion(card, 'avatar-key');
    const bumped = await referenceOgVersion(`${OG_TEMPLATE_VERSION}-next`, card, 'avatar-key');
    expect(bumped).not.toBe(real);
  });

  it.each([
    ['displayName', { ...card, displayName: 'Someone Else' }],
    ['role', { ...card, role: 'CEO' }],
    ['company', { ...card, company: 'Acme' }],
    ['headline', { ...card, headline: 'Something else entirely' }],
  ] satisfies [string, OgCard][])('changes when %s changes', async (_field, changed) => {
    const base = await computeOgVersion(card, 'avatar-key');
    const next = await computeOgVersion(changed, 'avatar-key');
    expect(next).not.toBe(base);
  });

  it('changes with avatarKey, null included', async () => {
    const withKey = await computeOgVersion(card, 'avatar-key');
    const withOtherKey = await computeOgVersion(card, 'other-key');
    const withNoKey = await computeOgVersion(card, null);
    expect(withOtherKey).not.toBe(withKey);
    expect(withNoKey).not.toBe(withKey);
    expect(withNoKey).not.toBe(withOtherKey);
  });
});
