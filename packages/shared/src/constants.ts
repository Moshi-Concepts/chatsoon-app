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

export const REVIEWER_EMAIL = 'review@chatsoon.app';
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

/** Upload limits for POST /files. */
export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
export const ALLOWED_UPLOAD_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/heic'] as const;
export type UploadPurpose = 'avatar' | 'card';

export const PRIORITY_LABELS: Record<number, string> = {
  1: 'Low',
  2: 'Normal',
  3: 'Medium',
  4: 'High',
  5: 'Top',
};

/** Name given to a card-photo contact until extraction fills in the real one. */
export const CARD_PLACEHOLDER_NAME = 'New card';
