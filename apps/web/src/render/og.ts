// Open Graph / Twitter Card tag builder shared by every apps/web page that needs one: layout.ts
// (home, legal), shell.ts (the SPA shell) and, from Stage C, the profile Function
// (docs/og-plan.md O15, §3.4). One template lives here so those places can't drift from each other.
//
// Deep imports only, per docs/og-plan.md §4: `@chatsoon/shared/src/{og,profile-page,types}`. This
// module has no dependency on apps/mobile.

import { APP_NAME, WEB_ORIGIN } from '@chatsoon/shared/src/constants';
import { describeProfile, profileOgTitle, profileTitle, roleLine } from '@chatsoon/shared/src/profile-page';
import type { PageProfile } from '@chatsoon/shared/src/types';

import { escapeHtml } from './escape';
import { DEFAULT_OG_IMAGE } from './og-asset';

/**
 * Shape every og:image comes in: a same-origin path plus the dimensions a crawler wants up front.
 * `DEFAULT_OG_IMAGE` satisfies this; `profileOgBlock` below builds one with a per-profile `path`
 * and `alt`, which is why this is a plain interface rather than `typeof DEFAULT_OG_IMAGE` itself.
 */
export interface OgImage {
  path: string;
  width: number;
  height: number;
  type: string;
  alt: string;
}

/** The brand X account (O24): attributes every shared card, profiles included. */
const TWITTER_SITE = '@ChatSoonApp';

export interface OgTagsMeta {
  /** "website" for home, legal and the SPA shell; "profile" for /id/:slug. */
  type: 'website' | 'profile';
  title: string;
  description: string;
  /** Omit on the SPA shell (O16): a fixed og:url there would merge every app route's share into one card. */
  url?: string;
  image: OgImage;
  card: 'summary' | 'summary_large_image';
}

/**
 * Renders the tags in the fixed order from docs/og-plan.md §3.4: type, site_name, title, description,
 * url (if given), the 5 image tags, then the 3 twitter tags. Every value is escaped. `image.path` is
 * always resolved against WEB_ORIGIN: the image itself only ever lives on the production domain,
 * whatever origin the page carrying these tags was served from.
 */
export function ogTags(meta: OgTagsMeta): string {
  const url = meta.url ? `<meta property="og:url" content="${escapeHtml(meta.url)}">` : '';
  const imageUrl = `${WEB_ORIGIN}${meta.image.path}`;
  return (
    `<meta property="og:type" content="${escapeHtml(meta.type)}">` +
    `<meta property="og:site_name" content="${escapeHtml(APP_NAME)}">` +
    `<meta property="og:title" content="${escapeHtml(meta.title)}">` +
    `<meta property="og:description" content="${escapeHtml(meta.description)}">` +
    url +
    `<meta property="og:image" content="${escapeHtml(imageUrl)}">` +
    `<meta property="og:image:type" content="${escapeHtml(meta.image.type)}">` +
    `<meta property="og:image:width" content="${meta.image.width}">` +
    `<meta property="og:image:height" content="${meta.image.height}">` +
    `<meta property="og:image:alt" content="${escapeHtml(meta.image.alt)}">` +
    `<meta name="twitter:card" content="${meta.card}">` +
    `<meta name="twitter:site" content="${TWITTER_SITE}">` +
    `<meta name="twitter:image:alt" content="${escapeHtml(meta.image.alt)}">`
  );
}

/**
 * The marker-delimited tag block for /id/:slug (docs/og-plan.md §3.4), spliced over the SPA shell by
 * a Pages Function until Stage C replaces the body outright (WP-5; not wired up by this WP). `origin`
 * is passed in rather than imported so this stays a pure, easily testable function — production always
 * calls it with WEB_ORIGIN.
 *
 * `indexable` (default `false`, Stage D) controls the robots meta only: `false` emits the original
 * `noindex`; `true` emits `max-image-preview:large` instead (§3.3). og-inject.ts's SPA-shell fallback —
 * an error state — always passes `false` regardless of `p.indexable`, so a lookup failure never
 * accidentally indexes the shell.
 *
 * Only `slug`, `ogVersion` and the 4 OgCard-shaped fields are ever read off `p`, copied by name, so an
 * object that picked up extra fields upstream (contact, links, ids, ...) can't leak through here either.
 */
export function profileOgBlock(p: PageProfile, origin: string, indexable = false): string {
  const description = describeProfile(p);
  const canonical = `${origin}/id/${p.slug}`;
  const line = roleLine(p.role, p.company);
  const alt = line ? `${p.displayName}, ${line}, on ${APP_NAME}` : `${p.displayName} on ${APP_NAME}`;
  // ogVersion null (cards disabled, or none rendered yet) falls back to the generic image (O11).
  const image: OgImage = p.ogVersion
    ? { ...DEFAULT_OG_IMAGE, path: `/id/${p.slug}/og.jpg?v=${p.ogVersion}`, alt }
    : { ...DEFAULT_OG_IMAGE, alt };
  const robots = indexable ? 'max-image-preview:large' : 'noindex';

  return (
    `<!--og-->` +
    `<title>${escapeHtml(profileTitle(p))}</title>` +
    `<meta name="description" content="${escapeHtml(description)}">` +
    `<link rel="canonical" href="${escapeHtml(canonical)}">` +
    `<meta name="robots" content="${robots}">` +
    ogTags({ type: 'profile', title: profileOgTitle(p), description, url: canonical, image, card: 'summary_large_image' }) +
    `<!--/og-->`
  );
}
