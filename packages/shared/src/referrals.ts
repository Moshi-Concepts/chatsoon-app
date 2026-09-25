// Referrals (issue #11, PR 2, docs/referrals.md): plain types, constants and helpers shared by the
// API and the app. Zod schemas live in schemas.ts instead (CLAUDE.md: apps/web imports
// `@chatsoon/shared/src/<module>` directly, never the index, since the index pulls in zod). Nothing
// here needs the DOM or a `URL` class, so this module stays safe for that direct import too.

import { WEB_ORIGIN } from './constants';

/** Permanent account badges (docs/referrals.md "Decisions"). Once earned, never removed. */
export const BADGES = ['founder', 'early_adopter'] as const;
export type Badge = (typeof BADGES)[number];

/** The one place to rename the "early adopter" label; the stored badge id (`early_adopter`) never changes. */
export const BADGE_LABELS: Record<Badge, string> = {
  founder: 'Founding member',
  early_adopter: 'Early adopter',
};

/** points_ledger.event. 'adjustment' is ops-only (`wrangler d1 execute`), never written by the API itself. */
export type PointsEvent = 'referral_qualified' | 'referral_joined' | 'adjustment';

/**
 * The referrer-facing status on the wire (docs/referrals.md "API"): `rejected` and `flagged` both
 * read as `pending` (a farmer must learn nothing from the API), `void` reads as `didnt_qualify`.
 */
export type ReferralStatus = 'pending' | 'qualified' | 'didnt_qualify';

/**
 * 8 chars, an even 32-symbol alphabet — Crockford base32 with `0`, `O`, `1` and `I` also removed
 * (docs/referrals.md "Specifics and decisions"), always uppercase. Created lazily on first
 * `GET /me/referral`, unique, retried on collision.
 */
export const REFERRAL_CODE_LENGTH = 8;
export const REFERRAL_CODE_ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
const REFERRAL_CODE_PATTERN = new RegExp(`^[${REFERRAL_CODE_ALPHABET}]{${REFERRAL_CODE_LENGTH}}$`);

/** True for exactly 8 uppercase characters, every one from `REFERRAL_CODE_ALPHABET`. */
export const isValidReferralCode = (value: string): boolean => REFERRAL_CODE_PATTERN.test(value);

/** `chatsoon.app/r/<CODE>`. Plain string concatenation (no `URL` class) per docs/referrals.md "Config". */
export const referralLink = (code: string): string => `${WEB_ORIGIN}/r/${code}`;

/** The prefilled SMS body for "Invite contacts" > Text (docs/referrals.md "Invite contacts"). */
export const inviteMessage = (firstName: string, link: string): string =>
  `Hi ${firstName}, I'm using Chatsoon to keep track of people I meet. Set up your profile here: ${link}`;

// ---------------------------------------------------------------------------
// DTOs (docs/referrals.md "API")
// ---------------------------------------------------------------------------

export interface MilestoneBadge {
  badge: Badge;
  /** Founder number, 1..REFERRAL_FOUNDER_CAP. Absent for early_adopter. */
  seq?: number;
  awardedAt: string;
}

export interface ReferralChecklist {
  profile: boolean;
  social: boolean;
  /** ISO timestamp: present once the referral is accepted and has a known hold-expiry. */
  holdUntil?: string;
}

/** The "Invited by" card: present only while the caller's own referral is still pending. */
export interface ReferralAttribution {
  referrerName: string;
  referrerSlug: string;
  status: ReferralStatus;
  checklist: ReferralChecklist;
}

export interface ReferralListItem {
  id: string;
  status: ReferralStatus;
  displayName?: string;
  slug?: string;
  avatarUrl?: string;
  createdAt: string;
  qualifiesAfter?: string;
  qualifiedAt?: string;
  /** Only for a 'pending' row: what's still outstanding, in display order. */
  outstanding?: 'profile' | 'social' | 'hold';
}

export interface ReferralClaimInfo {
  status: 'issued' | 'redeemed';
  milestone: number;
  /** Only ever present right after POST /me/referral/claims issues or re-issues a token; GET
   * /me/referral never carries it back, since the raw token itself is never stored. */
  url?: string;
  expiresAt?: string;
}

/** GET /me/referral. */
export interface GetReferralResponse {
  code: string;
  link: string;
  founderThreshold: number;
  claimThreshold: number;
  founderSpotsLeft: number;
  milestoneBadge: MilestoneBadge | null;
  qualifiedCount: number;
  pendingCount: number;
  pointsBalance: number;
  hasSocial: boolean;
  canClaim: boolean;
  claim: ReferralClaimInfo | null;
  attribution: ReferralAttribution | null;
  canEnterCode: boolean;
  referrals: ReferralListItem[];
}

/** POST /me/referral/attribute. */
export interface AttributeReferralResponse {
  attributed: boolean;
}

/** POST /me/referral/invites. */
export interface SendInvitesResponse {
  sent: number;
  skipped: number;
}

/** POST /me/referral/claims. */
export interface ClaimReferralResponse {
  url: string;
  expiresAt: string;
}

/** GET /referral/:code and GET /_pages/referral/:code. */
export interface PublicReferralProfile {
  displayName: string;
  slug: string;
  avatarUrl?: string | null;
  headline?: string | null;
}

export type ReferralPageResult = { status: 'ok'; referral: PublicReferralProfile } | { status: 'not_found' };

/** GET /referral/claims/verify (partner, bearer REFERRAL_PARTNER_SECRET). */
export type VerifyClaimResponse =
  | {
      valid: true;
      milestone: number;
      status: 'issued' | 'redeemed';
      issuedAt: string;
      expiresAt: string;
      user: { id: string; displayName: string; email: string };
    }
  | { valid: false; reason: 'unknown' | 'expired' | 'redeemed' };

/** POST /referral/claims/redeem (partner). Idempotent: a second call returns the same redeemedAt. */
export interface RedeemClaimResponse {
  ok: true;
  redeemedAt: string;
}
