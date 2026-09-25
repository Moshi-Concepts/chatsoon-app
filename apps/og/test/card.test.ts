import yoga from 'satori/yoga.wasm';
import satori, { init as initSatori } from 'satori/standalone';
import { beforeAll, describe, expect, it } from 'vitest';

import { OG_IMAGE_SIZE, type OgCard } from '@chatsoon/shared/src/og';

import { PLATE } from '../src/assets';
import { bufferToDataUri } from '../src/avatar-types';
import { buildCardTree } from '../src/card';
import { FONTS } from '../src/fonts';

// satori decodes every <img> it's given (even one sized explicitly), so this needs to be a real JPEG —
// version.ts's fingerprint helper can get away with an empty stub because it never calls satori.
const PLATE_STUB = bufferToDataUri(PLATE, 'image/jpeg');

// Each test file in the workerd pool gets its own isolate, so satori's one-time `init` (called inside
// render.ts's `createRenderer` for render.test.ts) has to run again here — this file calls `satori`
// directly instead of going through `createRenderer`.
beforeAll(async () => {
  await initSatori(yoga);
});

const card: OgCard = {
  displayName: 'Priya Natarajan',
  role: 'Founder',
  company: 'Analytical Engines',
  headline: 'Building the future of computing',
};

// embedFont: false keeps satori's <text> elements as real characters instead of glyph paths, so the
// output SVG string can be inspected directly (docs/og-plan.md §4 WP-3's "satori with embedFont: false" test).
async function renderSvg(input: OgCard, avatar: Parameters<typeof buildCardTree>[1] = null): Promise<string> {
  const tree = buildCardTree(input, avatar, PLATE_STUB);
  return satori(tree as never, { ...OG_IMAGE_SIZE, fonts: FONTS.map((f) => ({ ...f, style: 'normal' as const })), embedFont: false });
}

/** satori wraps text into one <text> element per word (and per space between them, as its own node),
 * so a phrase never appears as one contiguous string in the SVG — concatenating every <text> node's
 * content, in document order, reconstructs it. */
function textContent(svg: string): string {
  return [...svg.matchAll(/<text[^>]*>([^<]*)<\/text>/g)].map((m) => m[1]).join('');
}

describe('buildCardTree', () => {
  it('draws the name, role/company and headline as text', async () => {
    const text = textContent(await renderSvg(card));
    expect(text).toContain('Priya Natarajan');
    expect(text).toContain('Founder at Analytical Engines');
    expect(text).toContain('Building the future of computing');
  });

  it('never leaks fields outside the OgCard whitelist, even when the input object carries them', async () => {
    const contaminated = {
      ...card,
      contact: { phone: '+61491570156', whatsapp: '+61491570157', signal: 'priya.signal' },
      links: { x: 'https://x.com/priya', website: 'https://priya.example.com' },
      slug: 'priya-natarajan-abc123',
      userId: 'user_should_not_appear',
    } as OgCard & Record<string, unknown>;

    const svg = await renderSvg(contaminated);

    for (const leaked of [
      '491570156',
      '491570157',
      'priya.signal',
      'x.com/priya',
      'priya.example.com',
      'priya-natarajan-abc123',
      'user_should_not_appear',
    ]) {
      expect(svg).not.toContain(leaked);
    }
  });

  it('drops the name from the image (but not initials/role/headline) when it has no covered characters', async () => {
    const svg = await renderSvg({ displayName: '田中太郎', role: 'Founder', company: 'Acme', headline: null });
    expect(svg).not.toContain('田中太郎');
    expect(textContent(svg)).toContain('Founder at Acme');
  });

  it('falls back from initials to the bubble mark when initials are not covered either', async () => {
    const withInitials = buildCardTree({ displayName: 'Marcus Chen', role: null, company: null, headline: null }, null, PLATE_STUB);
    const withBubble = buildCardTree({ displayName: '田中太郎', role: null, company: null, headline: null }, null, PLATE_STUB);
    expect(JSON.stringify(withInitials)).toContain('"MC"');
    expect(JSON.stringify(withBubble)).not.toContain('田中太郎');
    expect(JSON.stringify(withBubble)).toContain('image/svg+xml');
  });
});
