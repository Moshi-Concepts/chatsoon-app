import { describe, expect, it } from 'vitest';

import { Colors, type ThemeColor } from '@chatsoon/shared/src/design';

import { css } from '../src/render/css';

// WCAG 2.x relative luminance and contrast ratio (same maths as packages/shared/src/design.test.ts).
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

/** Selectors allowed to use `--primary` (not `--primary-text`) as a foreground colour: a decorative
 * mark next to a real text label (needs no contrast at all). `.hero-title .accent` (the "Follow up."
 * hero accent) used to be here as a large-text (>=24px bold, needs only 3:1) exception, but it now
 * uses `--primary-text` like normal-size text, so it's covered by the `pairs` contrast check below
 * instead. Any other selector using `--primary` as `color` would repeat the dark-mode contrast bug
 * this test guards against — see the comment above `a{...}` in css.ts. */
const PRIMARY_AS_TEXT_ALLOWED = new Set<string>(['.feature-icon', '.legal section li::marker']);

/** Every top-level-ish `selector{declarations}` block in the generated stylesheet. Good enough here:
 * it also picks up the two `:root{...}` variable blocks (light and the one nested in the dark
 * `@media` query) as their own entries, which this test simply ignores. */
function rules(cssText: string): { selector: string; declarations: string }[] {
  const found: { selector: string; declarations: string }[] = [];
  const re = /([^{}]+)\{([^{}]*)\}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(cssText))) {
    found.push({ selector: (m[1] ?? '').trim(), declarations: m[2] ?? '' });
  }
  return found;
}

const sheet = css();

describe('css() dark-mode text contrast (regression for the --primary/--primary-text mix-up)', () => {
  it('never uses --primary as a `color` outside the large-text/decorative exceptions', () => {
    for (const { selector, declarations } of rules(sheet)) {
      // Split on `;` and match a whole declaration, so `border-color:var(--primary)` (a different
      // property, unaffected by this bug) doesn't get caught by a substring match on `color:`.
      const usesPrimaryAsText = declarations.split(';').some((decl) => decl.trim() === 'color:var(--primary)');
      if (usesPrimaryAsText) {
        expect(PRIMARY_AS_TEXT_ALLOWED.has(selector), `${selector} uses --primary as text colour: ${declarations}`).toBe(
          true,
        );
      }
    }
  });

  // The pairs css.ts actually wires up to --primary-text, against every background it puts behind them.
  const pairs: [label: string, fg: ThemeColor, bg: ThemeColor][] = [
    ['a (legal-page links)', 'primaryText', 'background'],
    ['a (inside .toc)', 'primaryText', 'surface'],
    ['.eyebrow', 'primaryText', 'primarySoft'],
    ['.kicker (Features band)', 'primaryText', 'surface'],
    ['.kicker (Steps section)', 'primaryText', 'background'],
    ['.closing .button', 'primaryText', 'surface'],
    ['.hero-title .accent', 'primaryText', 'background'],
  ];

  describe.each(['light', 'dark'] as const)('in %s mode', (scheme) => {
    const c = Colors[scheme];
    it.each(pairs)('%s is at least 4.5:1', (_label, fg, bg) => {
      expect(contrast(c[fg], c[bg])).toBeGreaterThanOrEqual(4.5);
    });
  });
});
