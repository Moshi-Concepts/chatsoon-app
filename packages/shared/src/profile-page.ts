// Pure text for the /id/:slug page tags (issue #5, docs/og-plan.md §3.1). Pulled forward from
// Stage C so the web build, the API and chatsoon-og can share one copy instead of three.
//
// `firstName`, `roleLine` and `describeProfile` reproduce, exactly, today's
// `apps/mobile/src/components/web/profile-card.tsx`'s `firstName`, `apps/mobile/src/lib/format.ts`'s
// `roleLine` and `apps/mobile/src/app/id/[slug].tsx`'s `describe()`. Those call sites are NOT
// changed by this file: it's a second, shared copy for code that can't import from apps/mobile.
//
// Deep import only: `@chatsoon/shared/src/profile-page` (see og.ts).

import { APP_NAME } from './constants';
import type { OgCard } from './og';

/** First word of a display name, or the whole name if it's one word. Matches profile-card.tsx. */
export function firstName(displayName: string): string {
  return displayName.trim().split(/\s+/)[0] || displayName;
}

/** "Founder at Acme", "Founder", "Acme", or null. Matches apps/mobile/src/lib/format.ts. */
export function roleLine(role?: string | null, company?: string | null): string | null {
  if (role && company) return `${role} at ${company}`;
  return role || company || null;
}

const MAX_DESCRIPTION = 160;

/** Cuts `s` to at most `max` characters on a word boundary (no trailing partial word). Falls back to
 * a hard cut only when there's no space to break on. */
function truncateOnWord(s: string, max: number): string {
  if (s.length <= max) return s;
  const cut = s.slice(0, max);
  const lastSpace = cut.lastIndexOf(' ');
  return (lastSpace > 0 ? cut.slice(0, lastSpace) : cut).trimEnd();
}

/**
 * Today's `describe()` (apps/mobile/src/app/id/[slug].tsx), capped at 160 characters on a word
 * boundary so it's safe to use as `<meta name="description">`.
 */
export function describeProfile(p: OgCard): string {
  const about = [p.headline, roleLine(p.role, p.company)].filter(Boolean).join(' · ');
  const cta = `Connect with ${firstName(p.displayName)} on Chatsoon.`;
  const full = about ? `${p.displayName}: ${about}. ${cta}` : cta;
  return truncateOnWord(full, MAX_DESCRIPTION);
}

/** `<title>` for /id/:slug: "{name} · Chatsoon", the same pattern PageHead and the legal pages use. */
export function profileTitle(p: Pick<OgCard, 'displayName'>): string {
  return `${p.displayName} · ${APP_NAME}`;
}

const MAX_OG_TITLE = 70;

/** og:title: "{name} – {roleLine ?? headline}", or just the name when that's over 70 characters (O22). */
export function profileOgTitle(p: OgCard): string {
  const suffix = roleLine(p.role, p.company) ?? p.headline;
  const full = suffix ? `${p.displayName} – ${suffix}` : p.displayName;
  return full.length > MAX_OG_TITLE ? p.displayName : full;
}
