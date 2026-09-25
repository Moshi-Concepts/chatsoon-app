import { describe, expect, it } from 'vitest';

import { PLATE } from '../src/assets';
import { FONTS } from '../src/fonts';
import { computeTemplateFingerprint, TEMPLATE_FINGERPRINT } from '../src/version';

describe('TEMPLATE_FINGERPRINT', () => {
  it('matches a hash freshly computed from the running plate, layout and fonts', async () => {
    const actual = await computeTemplateFingerprint(PLATE, FONTS);
    expect(
      actual,
      'card.ts, plate.jpg or the font list changed since TEMPLATE_FINGERPRINT was recorded (src/version.ts) — ' +
        'bump OG_TEMPLATE_VERSION (packages/shared/src/og.ts) and update TEMPLATE_FINGERPRINT to the value ' +
        'this test just computed',
    ).toBe(TEMPLATE_FINGERPRINT);
  });

  it('changes when the plate bytes change', async () => {
    const tamperedPlate = PLATE.slice(0, PLATE.byteLength - 1);
    const withOriginal = await computeTemplateFingerprint(PLATE, FONTS);
    const withTampered = await computeTemplateFingerprint(tamperedPlate, FONTS);
    expect(withTampered).not.toBe(withOriginal);
  });

  it('changes when the font list changes', async () => {
    const withAllFonts = await computeTemplateFingerprint(PLATE, FONTS);
    const withFewerFonts = await computeTemplateFingerprint(PLATE, FONTS.slice(1));
    expect(withFewerFonts).not.toBe(withAllFonts);
  });
});
