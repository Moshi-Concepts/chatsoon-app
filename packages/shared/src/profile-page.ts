// Pure text for the /id/:slug page tags (issue #5, docs/og-plan.md §3.1). Pulled forward from
// Stage C so the web build, the API and chatsoon-og can share one copy instead of three.
//
// `firstName`, `roleLine` and `describeProfile` reproduce, exactly, today's
// `apps/mobile/src/components/web/profile-card.tsx`'s `firstName`, `apps/mobile/src/lib/format.ts`'s
// `roleLine` and `apps/mobile/src/app/id/[slug].tsx`'s `describe()`. Those call sites are NOT
// changed by this file: it's a second, shared copy for code that can't import from apps/mobile.
//
// `REPORT_REASON_LABELS`, `CONNECT_FORM_MAX`, `connectErrorMessage` and `SESSION_STORAGE_KEY` (WP-C2
// remainder) are different: they move the source of truth out of apps/mobile, so those call sites
// (`report-dialog.tsx`, `connect-form.tsx`, `auth.tsx`) now import from here instead of keeping a
// local copy.
//
// No zod, no schemas import: the web Worker deep-imports this module and must not pull in input
// validation. `CONNECT_FORM_MAX` is a plain literal kept in sync with `connectFormSchema` by hand
// (checked in profile-page.test.ts), not derived from the schema.
//
// Deep import only: `@chatsoon/shared/src/profile-page` (see og.ts).

import { APP_NAME, type ReportReason } from './constants';
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

/**
 * Report reasons and their copy, moved from `apps/mobile/src/components/moderation/report-dialog.tsx`
 * (`REASON_LABELS`). Typed as `Record<ReportReason, …>` so it can't fall out of sync with
 * `REPORT_REASONS` in constants.ts.
 */
export const REPORT_REASON_LABELS: Record<ReportReason, { title: string; subtitle: string }> = {
  spam: { title: 'Spam or scam', subtitle: 'Unwanted messages, fake offers or phishing' },
  harassment: { title: 'Harassment or bullying', subtitle: 'Threats, abuse or unwanted contact' },
  impersonation: { title: 'Pretending to be someone else', subtitle: 'A fake profile or a stolen identity' },
  inappropriate: { title: 'Inappropriate content', subtitle: 'Offensive, hateful, violent or sexual content' },
  other: { title: 'Something else', subtitle: 'Tell us what happened below' },
};

/**
 * Max lengths for the public Connect form's fields (`apps/mobile/src/components/web/connect-form.tsx`),
 * matching `connectFormSchema` in schemas.ts: `name` and `contact` are plain `.max()`, `note` is
 * `publicText(1000)`. Kept as a literal, not imported from the schema, so this module stays zod-free;
 * profile-page.test.ts checks the two stay equal.
 */
export const CONNECT_FORM_MAX = { name: 120, contact: 200, note: 1000 } as const;

/**
 * connect-form.tsx's error mapping for `POST /id/:slug/connect` (today's `errorMessage`). `status`
 * and `code` come from `ApiError`, kept as primitives here so this module doesn't depend on
 * apps/mobile's `ApiError` class. Returns null for anything not special-cased below, so the caller
 * falls back to the server's own message (an `ApiError` always has one) or its own generic fallback
 * for a non-`ApiError` failure.
 */
export function connectErrorMessage(status: number, code: string): string | null {
  if (code === 'captcha_failed') return 'The spam check failed. Please complete it again and resend.';
  if (code === 'rate_limited') return 'Too many attempts. Please wait a minute and try again.';
  if (status === 404) return "This profile isn't available any more.";
  return null;
}

/**
 * The web SPA's sign-in session key. On web, `apps/mobile/src/lib/storage.ts`'s `secureGet` /
 * `secureSet` / `secureDelete` read and write `window.localStorage` directly under whatever key
 * they're given (native uses the Keychain/Keystore instead); `apps/mobile/src/lib/auth.tsx` calls
 * them with this key to store the bearer token as a plain string (not JSON). The server-rendered
 * page's inline script reads this same key from `localStorage` to decide whether to hand the visit
 * over to the full app.
 */
export const SESSION_STORAGE_KEY = 'chatsoon.session';
