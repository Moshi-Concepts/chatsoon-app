import { describe, expect, it } from 'vitest';

import { Colors, type ThemeColor } from './design';

// WCAG 2.x relative luminance and contrast ratio, straight from the spec (no colour library needed
// for three-channel hex).
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

const MIN_TEXT_CONTRAST = 4.5;

describe.each(['light', 'dark'] as const)('Colors.%s contrast', (scheme) => {
  const c = Colors[scheme];
  const textOn: ThemeColor[] = ['background', 'surface', 'surfaceAlt'];
  const textColors: ThemeColor[] = ['text', 'textSecondary', 'textTertiary', 'primaryText'];

  it.each(textColors.flatMap((fg) => textOn.map((bg) => [fg, bg] as const)))(
    '%s on %s is at least 4.5:1',
    (fg, bg) => {
      expect(contrast(c[fg], c[bg])).toBeGreaterThanOrEqual(MIN_TEXT_CONTRAST);
    },
  );

  it('onPrimary on primary is at least 4.5:1', () => {
    expect(contrast(c.onPrimary, c.primary)).toBeGreaterThanOrEqual(MIN_TEXT_CONTRAST);
  });

  it('primaryText on primarySoft is at least 4.5:1', () => {
    expect(contrast(c.primaryText, c.primarySoft)).toBeGreaterThanOrEqual(MIN_TEXT_CONTRAST);
  });

  it('successText on successSoft is at least 4.5:1', () => {
    expect(contrast(c.successText, c.successSoft)).toBeGreaterThanOrEqual(MIN_TEXT_CONTRAST);
  });

  it('dangerText on dangerSoft is at least 4.5:1', () => {
    expect(contrast(c.dangerText, c.dangerSoft)).toBeGreaterThanOrEqual(MIN_TEXT_CONTRAST);
  });
});
