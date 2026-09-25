// Renders the /r/<code> referral landing page (issue #11, docs/referrals.md "Landing page", "Web
// files") onto layout.ts, the same way home.ts and legal.ts do — this page needs no SPA handoff
// (profile.ts's own reason for building its document by hand), so `page()` is a straight fit.
//
// Deep imports only, per CLAUDE.md: `@chatsoon/shared/src/{constants,referrals}`.

import { APP_NAME, APP_STORE_URL, AVATAR_WIDTHS, PLAY_STORE_URL, TAGLINE, WEB_ORIGIN } from '@chatsoon/shared/src/constants';
import type { PublicReferralProfile } from '@chatsoon/shared/src/referrals';

import { escapeHtml } from './escape';
import { icon, sprite } from './icons';
import { page } from './layout';
import { DEFAULT_OG_IMAGE } from './og-asset';

/** What the build and the Pages Function supply at render time — just the island's own URL: this page
 * carries no Turnstile, no API origin (it makes no client-side API calls) and no SPA handoff. */
export interface ReferralAssets {
  /** URL of the referral island module, e.g. "/_p/referral-<hash>.js". */
  islandUrl: string;
}

/** "Peter Bui" -> "PB", for an inviter with no avatar. Matches profile.ts's and home.ts's own copies. */
function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  const first = parts[0]?.[0] ?? '';
  const last = parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? '') : '';
  return (first + last).toUpperCase();
}

const AVATAR_SIZE = 96;

/**
 * The inviter's avatar, sized down from the profile page's own 208px (this card is a supporting
 * visual here, not the page's whole focus). Same `srcset`/`sizes` reasoning as profile.ts's
 * `avatarBlock`: `avatarVersion` builds `/id/<slug>/photo?v=` directly rather than a signed R2 URL
 * (docs/referrals.md "Web files": the referral payload carries `avatarVersion`, not `avatarUrl`).
 */
function avatarBlock(r: PublicReferralProfile): string {
  if (r.avatarVersion) {
    const v = encodeURIComponent(r.avatarVersion);
    const photoUrl = (w?: number) => `/id/${encodeURIComponent(r.slug)}/photo?v=${v}${w ? `&w=${w}` : ''}`;
    const src = photoUrl();
    const srcset = AVATAR_WIDTHS.map((w) => `${photoUrl(w)} ${w}w`).join(', ');
    return `<img class="referral-avatar" src="${escapeHtml(src)}" srcset="${escapeHtml(srcset)}" sizes="${AVATAR_SIZE}px" width="${AVATAR_SIZE}" height="${AVATAR_SIZE}" alt="${escapeHtml(r.displayName)}" fetchpriority="high" decoding="async">`;
  }
  const fontSize = Math.round(AVATAR_SIZE * 0.38);
  return `<span class="avatar" style="width:${AVATAR_SIZE}px;height:${AVATAR_SIZE}px;font-size:${fontSize}px" aria-hidden="true">${escapeHtml(initials(r.displayName))}</span>`;
}

/**
 * App Store / Google Play buttons, shown only once the store URLs are set (docs/referrals.md "Landing
 * page"; PR 3: both are `null` in `packages/shared/src/constants.ts` until v1.0 actually ships). Until
 * then this is exactly the home page's "Coming soon" line — same markup and class, so the two pages
 * read as one product.
 */
function storeButtonsBlock(): string {
  if (APP_STORE_URL || PLAY_STORE_URL) {
    const buttons = [
      APP_STORE_URL ? `<a class="button button-block" href="${escapeHtml(APP_STORE_URL)}">App Store</a>` : '',
      PLAY_STORE_URL ? `<a class="button button-block" href="${escapeHtml(PLAY_STORE_URL)}">Google Play</a>` : '',
    ].join('');
    return `<div class="store-buttons">${buttons}</div>`;
  }
  return `<p class="coming-soon text-callout">${icon('phone-portrait-outline', 16)}<span>Coming soon to the App Store and Google Play</span></p>`;
}

/**
 * The "your invite code" row: the code, in the copy `data-copy` reads verbatim, plus a Copy button
 * that reuses the same island handler as the profile page's Discord chip (src/client/copy.ts).
 */
function codeRowBlock(code: string): string {
  return `<div class="referral-code-row">
<p>Your invite code is <strong>${escapeHtml(code)}</strong>. Enter it when you sign up.</p>
<button type="button" class="button" data-copy="${escapeHtml(code)}" aria-label="Copy invite code ${escapeHtml(code)}"><span>Copy</span></button>
</div>`;
}

/** Renders the complete `/r/<code>` document for a known code (docs/referrals.md "Landing page"). Always
 * `noindex` (the meta tag here; the Function sets `X-Robots-Tag` too, per src/server/referral.ts) —
 * these pages aren't for search engines, and each one is only ever meaningful to the one person who
 * followed that exact link. */
export function renderReferral(code: string, r: PublicReferralProfile, assets: ReferralAssets): string {
  const title = `${r.displayName} invited you to ${APP_NAME}`;
  const description = `${r.displayName} invited you to join ${APP_NAME}. ${TAGLINE}`;
  const canonical = `${WEB_ORIGIN}/r/${code}`;
  const alt = `${r.displayName} on ${APP_NAME}`;
  const image = r.ogVersion
    ? { ...DEFAULT_OG_IMAGE, path: `/id/${r.slug}/og.jpg?v=${r.ogVersion}`, alt }
    : { ...DEFAULT_OG_IMAGE, alt };

  const main =
    sprite(['phone-portrait-outline']) +
    `<div class="wrap referral-wrap">
<div class="card referral-card" id="referral" data-code="${escapeHtml(code)}">
${avatarBlock(r)}
<h1>${escapeHtml(title)}</h1>
${r.headline ? `<p class="profile-headline">${escapeHtml(r.headline)}</p>` : ''}
<p class="referral-tagline">${escapeHtml(TAGLINE)}</p>
<a class="button button-primary button-block" href="/sign-in">Continue on web</a>
${storeButtonsBlock()}
${codeRowBlock(code)}
</div>
</div>
<script type="module" src="${escapeHtml(assets.islandUrl)}"></script>`;

  return page({
    title,
    description,
    canonical,
    robots: 'noindex',
    og: { type: 'website', title, description, url: canonical, image, card: 'summary_large_image' },
    main,
  });
}

/**
 * The 404 page for an invalid or unknown code (docs/referrals.md "Landing page": "Unknown or disabled
 * code: a plain 404 page with the normal store buttons, no cookie"). Same shell as
 * render/status.ts's `renderNotFound`, plus the store/coming-soon line so a bad or expired link still
 * points a visitor at the apps.
 */
export function renderReferralNotFound(path: string): string {
  const title = `Invite not found · ${APP_NAME}`;
  const message = "This invite link doesn't exist or has expired.";
  const canonical = `${WEB_ORIGIN}${path}`;
  const main =
    sprite(['phone-portrait-outline']) +
    `<div class="wrap status">
<h1>Invite not found</h1>
<p>${escapeHtml(message)}</p>
${storeButtonsBlock()}
<a class="button button-primary" href="/">Go to Chatsoon</a>
</div>`;

  return page({
    title,
    description: message,
    canonical,
    robots: 'noindex',
    og: { type: 'website', title, description: message, image: DEFAULT_OG_IMAGE, card: 'summary_large_image' },
    main,
  });
}
