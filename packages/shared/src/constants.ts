export const APP_NAME = 'Chatsoon';
export const TAGLINE = 'Meet people. Follow up.';
export const COPYRIGHT = 'Moshi Concepts Inc.';

export const WEB_ORIGIN = 'https://chatsoon.app';
export const API_ORIGIN = 'https://api.chatsoon.app';
export const APP_SCHEME = 'chatsoon';
export const SUPPORT_EMAIL = 'hello@chatsoon.app';

/** All public profiles live under /id/ so top-level routes stay free for the product. */
export const PROFILE_PATH_PREFIX = '/id/';
export const profileUrl = (slug: string) => `${WEB_ORIGIN}${PROFILE_PATH_PREFIX}${slug}`;

/** GA4 property for chatsoon.app (issue #17). Loaded on apps/web only, and only after the visitor
 * accepts the cookie consent banner (apps/web/src/render/consent.ts) — never on native. */
export const GA_MEASUREMENT_ID = 'G-9JPQ94MJLZ';

export const REVIEWER_EMAIL = 'review@chatsoon.app';

/**
 * Store listing URLs for the `/r/<code>` referral landing page (issue #11, docs/referrals.md "Landing
 * page"). Both `null` until the apps are actually public: v1.0 hasn't shipped to either store yet
 * (CLAUDE.md, docs/native-pending.md), so a store button would 404. `renderReferral` (apps/web) shows
 * the store buttons only when set, and the home page's "Coming soon" line otherwise.
 */
export const APP_STORE_URL: string | null = null;
export const PLAY_STORE_URL: string | null = null;

/**
 * Social sign-in providers (issue #24), in the fixed order GET /auth-providers returns them and the
 * sign-in page shows their buttons. A provider only appears once its secrets are configured on the API.
 */
export const SOCIAL_PROVIDERS = ['apple', 'google', 'linkedin', 'discord'] as const;
export type SocialProvider = (typeof SOCIAL_PROVIDERS)[number];
/** Second test profile the App Store / Play reviewer can scan or open in a browser. */
export const DEMO_PROFILE_SLUG = 'alex-rivera-demo';

/** Tags every new account starts with (user scoped, can be deleted). */
export const SEEDED_TAGS = [
  'Sponsor',
  'Investor',
  'Advisor',
  'Collab',
  'YouTube guest',
  'Cardano',
  'Midnight',
  'Media',
  'VC',
  'Founder',
] as const;

/** Public events seeded by migration. */
export const SEEDED_EVENTS = [{ id: 'evt_token2049', name: 'Token2049' }] as const;

export const REPORT_REASONS = ['spam', 'harassment', 'impersonation', 'inappropriate', 'other'] as const;
export type ReportReason = (typeof REPORT_REASONS)[number];

export const CAMERA_PERMISSION_TEXT = 'Used to scan QR codes and photograph business cards';

/** Upload limits for POST /files. The app re-encodes photos to well under this before uploading. */
export const MAX_UPLOAD_BYTES = 3 * 1024 * 1024;
export const ALLOWED_UPLOAD_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/heic'] as const;
export type UploadPurpose = 'avatar' | 'card';

/**
 * Allowed widths for GET /id/:slug/photo?w= and GET /_pages/photo/:slug?w= (issue #23): the sizes the
 * profile page's `srcset` offers, plus 416 (the pre-existing default, kept for every URL with no `w`
 * at all). No arbitrary size is ever accepted — each distinct width is its own Cloudflare Images
 * transform, and those cost money.
 */
export const AVATAR_WIDTHS = [208, 368, 416, 512] as const;
export type AvatarWidth = (typeof AVATAR_WIDTHS)[number];
export const DEFAULT_AVATAR_WIDTH: AvatarWidth = 416;

/**
 * Normalises a `?w=` value to one of `AVATAR_WIDTHS`, falling back to `DEFAULT_AVATAR_WIDTH` for
 * anything else — missing, non-numeric, or not one of the allowed sizes. Shared by the API's own
 * validation (apps/api/src/pages.ts) and the web Function's pass-through (apps/web/src/server/
 * profile-source.ts) so the two always agree on what counts as valid.
 */
export function normalizeAvatarWidth(w: string | number | null | undefined): AvatarWidth {
  const n = typeof w === 'number' ? w : w === null || w === undefined || w === '' ? NaN : Number(w);
  return (AVATAR_WIDTHS as readonly number[]).includes(n) ? (n as AvatarWidth) : DEFAULT_AVATAR_WIDTH;
}

export const PRIORITY_LABELS: Record<number, string> = {
  1: 'Low',
  2: 'Normal',
  3: 'Medium',
  4: 'High',
  5: 'Top',
};

/** Name given to a card-photo contact until extraction fills in the real one. */
export const CARD_PLACEHOLDER_NAME = 'New card';
