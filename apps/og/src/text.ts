// Text sanitisation and rendering rules for the personalised card (docs/og-plan.md §2.2, "Rules for
// the text on the image"). Every field the dynamic layer (card.ts) might draw goes through
// `fieldForImage` first; a field that comes back null is left off the image entirely. This is
// independent of `profile-page.ts`, which builds og:title/og:description from the raw, un-sanitised
// profile fields — a name dropped from the image still appears in og:title (accepted for v1, see the
// plan's risk table).

import { isFullyCovered } from './coverage';

// Emoji and emoji-modifier ranges, the ZWJ used to join emoji sequences, regional indicators (flag
// emoji), variation selector-16 (forces the emoji presentation) and the keycap combiner, plus C0/C1
// control characters. Matches docs/og-plan.md §2.2's list exactly.
const STRIP_PATTERN =
  /\p{Extended_Pictographic}|\p{Emoji_Modifier}|\p{Regional_Indicator}|‍|️|⃣|\p{Cc}/gu;

/**
 * Strips emoji and control characters, then collapses and trims whitespace. Whitespace is collapsed
 * both before and after the strip: before, so a tab or newline (itself a control character) becomes a
 * normal space instead of vanishing and fusing the words on either side of it; after, so removing an
 * emoji that had spaces on both sides doesn't leave a doubled-up gap.
 */
export function sanitiseField(value: string): string {
  return value.replace(/\s+/g, ' ').replace(STRIP_PATTERN, '').replace(/\s+/g, ' ').trim();
}

/**
 * Sanitises `value`, then drops it (returns null) unless every remaining character is covered by the
 * card's fonts (coverage.ts) — e.g. a CJK, Arabic or Hebrew field, or one that was emoji-only.
 */
export function fieldForImage(value: string | null | undefined): string | null {
  if (!value) return null;
  const cleaned = sanitiseField(value);
  if (!cleaned) return null;
  return isFullyCovered(cleaned) ? cleaned : null;
}

/**
 * First grapheme of each of the first two words of an already-sanitised display name, upper-cased
 * (§2.2's initials rule). Returns null when there's nothing to take initials from, or when the result
 * isn't covered by the card's fonts — the caller falls back to the bubble mark in that case.
 */
export function initialsFor(cleanedDisplayName: string): string | null {
  const words = cleanedDisplayName.split(' ').filter(Boolean).slice(0, 2);
  if (words.length === 0) return null;
  const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
  const letters = words.map((word) => {
    const first = segmenter.segment(word)[Symbol.iterator]().next();
    return first.done ? '' : first.value.segment;
  });
  const initials = letters.join('').toLocaleUpperCase();
  if (!initials) return null;
  return isFullyCovered(initials) ? initials : null;
}
