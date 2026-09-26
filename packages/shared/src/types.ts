// API contract shared by the Worker (apps/api) and the app (apps/mobile).
// JSON is camelCase on the wire; the database uses snake_case.

import type { SocialProvider } from './constants';
import type { FollowUpChannel } from './follow-up';
import type { Badge } from './referrals';
import type { SocialIneligibleReason, SocialValidationProvider } from './social';

export type LinkKey = 'x' | 'telegram' | 'discord' | 'linkedin' | 'website' | 'youtube';

/** Profile links. Values are stored as the user typed them, normalised to full URLs by `toLinkUrl`. */
export type ProfileLinks = Partial<Record<LinkKey, string>>;

export type BookingProvider =
  | 'calendly'
  | 'google'
  | 'calcom'
  | 'hubspot'
  | 'microsoft'
  | 'zoom'
  | 'savvycal'
  | 'tidycal';

/** One booking link on a profile: the label the user chose and the provider `parseBookingUrl` detected. */
export interface BookingLink {
  label: string;
  url: string;
  provider: BookingProvider;
}

export type ProfileContactKey = 'phone' | 'whatsapp' | 'signal';

/** Phone and messaging details, stored as typed. `contactUrl` (profile-contact.ts) normalises them. */
export type ProfileContact = Partial<Record<ProfileContactKey, string>>;

/** Who can see a profile's `contact` fields. Defaults to 'connections' (private by default). */
export type ContactVisibility = 'connections' | 'public';

export interface PublicProfile {
  slug: string;
  displayName: string;
  headline: string | null;
  company: string | null;
  role: string | null;
  links: ProfileLinks;
  /** Signed, time-limited URL to the avatar in R2, or null. */
  avatarUrl: string | null;
  /** Booking links shown on the "Book a meeting" card, in display order. Always present, possibly empty. */
  bookingLinks: BookingLink[];
  /** Only on GET /id/:slug when signed in: true if I have blocked this person (the page offers Unblock). */
  blockedByMe?: boolean;
  /**
   * Keys with a usable value, in CONTACT_KEYS order. Never values. Optional only because profiles cached
   * by older builds lack it; the API always sends it.
   */
  contactChannels?: ProfileContactKey[];
  /** Optional only because profiles cached by older builds lack it; the API always sends it. */
  contactVisibility?: ContactVisibility;
  /** Present only when this viewer may see it (owner, or allowed by contactVisibility). Usable values only, except for the owner. */
  contact?: ProfileContact;
  /** Signed, time-limited URL to /id/:slug/vcard. Present only alongside `contact` on a 'connections' profile. */
  vcardUrl?: string;
  /**
   * Permanent milestone badges (issue #11, docs/referrals.md), read from `badges`. `[]` for nobody
   * with one yet. Public: the pill shows on the profile card (app and web) and here, in every mode.
   */
  badges: { badge: Badge; seq?: number }[];
}

export interface MyProfile extends PublicProfile {
  userId: string;
  avatarKey: string | null;
  /** "Show my profile in search engines" (off by default). Owner-only: never on PublicProfile or PageProfile. */
  searchVisible: boolean;
}

/**
 * Whitelisted fields for the server-rendered public page and its link-preview tags
 * (docs/public-pages-plan.md §3.1, docs/og-plan.md §3.1). The API builds it field by field from
 * `toPublicProfile` with default options, so it never carries `contact` values, `avatarUrl` or anything
 * else a page or preview shouldn't see.
 */
export interface PageProfile {
  slug: string;
  displayName: string;
  headline: string | null;
  company: string | null;
  role: string | null;
  links: ProfileLinks;
  bookingLinks: BookingLink[];
  /** Which channels exist. Never their values. */
  contactChannels: ProfileContactKey[];
  contactVisibility: ContactVisibility;
  /** Permanent milestone badges (issue #11). See PublicProfile.badges. */
  badges: { badge: Badge; seq?: number }[];
  /** First 16 hex of SHA-256(avatarKey), or null without a photo. */
  avatarVersion: string | null;
  /** ISO timestamp. */
  updatedAt: string;
  /** True only when the owner turned on search visibility and the profile passes `isIndexable` (Stage D). */
  indexable: boolean;
  /** Version of the personalised share card (16 hex), or null when cards are off, so the default image is used. */
  ogVersion: string | null;
}

/** GET /_pages/profile/:slug response body (apps/api/src/routes/pages.ts), and later the Stage C RPC result. */
export type ProfilePageResult = { status: 'ok'; profile: PageProfile } | { status: 'not_found' } | { status: 'rate_limited' };

/** GET /_pages/sitemap response body: every indexable profile, ordered by slug (at most 50,000). */
export interface SitemapProfilesResult {
  profiles: { slug: string; updatedAt: string }[];
}

export interface Me {
  user: {
    id: string;
    email: string;
    createdAt: string;
    /** From a social sign-in (issue #24). Null when signed in with email only, or not set. */
    name?: string | null;
    /** Provider avatar URL from a social sign-in (issue #24). Not an R2 key: fetch it server-side
     * with POST /me/avatar/from-provider to use it as the profile photo. */
    image?: string | null;
  };
  /** Null until onboarding has created the profile. */
  profile: MyProfile | null;
  /** ISO timestamp of a pending account deletion (issue #8), or null. See POST/DELETE /me/deletion. */
  deletionScheduledFor: string | null;
  /**
   * "Tips" emails (issue #7: new-account nudges to finish the profile and share the link). True
   * unless the account opted out, whether by PUT /me/email-prefs or the one-click unsubscribe link.
   * Optional only because older cached responses lack it; the API always sends it.
   */
  tipsEmails?: boolean;
  /** Details picked up from a social sign-in (issue #24) that onboarding can offer to prefill. */
  socialPrefill?: {
    /** Discord username, kept from `mapProfileToUser` since Better Auth's `accounts` table doesn't
     * store it. Prefills the Discord profile link. */
    discord?: string;
  };
}

/** PUT /me/email-prefs response (issue #7): the value actually saved. */
export interface EmailPrefsResponse {
  tipsEmails: boolean;
}

/** POST /me/deletion (issue #8): schedules (or, for the reviewer account, immediately runs) deletion. */
export type ScheduleDeletionResponse = { status: 'deleted' } | { status: 'scheduled'; deleteAfter: string };
/** DELETE /me/deletion. */
export interface CancelDeletionResponse {
  status: 'cancelled';
}
/** POST /account-deletion/cancel (no auth): cancels by the token from the "scheduled" email. */
export interface CancelDeletionByTokenResponse {
  status: 'cancelled';
  /** The account's email, masked (e.g. "p***@example.com"). */
  email: string;
}

export type ContactSource =
  | 'manual'
  | 'app_connect' // both users connected by scanning a Chatsoon QR in the app
  | 'qr_scan' // parsed from a non-Chatsoon QR (vCard, Telegram, LinkedIn, X, URL)
  | 'card_photo' // business card or badge photo, AI extracted
  | 'web_connect'; // non-user submitted the Connect form on the public profile page

export type ExtractionStatus =
  | 'none' // not a card photo
  | 'pending' // photo uploaded, extraction not run yet (e.g. queued offline)
  | 'processing'
  | 'needs_review' // fields extracted, user has not confirmed
  | 'confirmed'
  | 'failed';

export interface Contact {
  id: string;
  /** Set when this contact is another Chatsoon user (connected via QR). */
  linkedUserId: string | null;
  /** Public slug of the linked user, when there is one. */
  linkedSlug: string | null;
  name: string;
  company: string | null;
  role: string | null;
  email: string | null;
  phone: string | null;
  telegram: string | null;
  xHandle: string | null;
  linkedinUrl: string | null;
  website: string | null;
  cardImageKey: string | null;
  /** Signed, time-limited URL for cardImageKey. */
  cardImageUrl: string | null;
  notes: string | null;
  /** 1 (low) to 5 (high), or null. */
  priority: number | null;
  eventId: string | null;
  source: ContactSource;
  extractionStatus: ExtractionStatus;
  tagIds: string[];
  /** Issue #33: when this contact was last marked followed up, or null. Updates to the latest time
   * on every follow-up (an earlier one is not kept). */
  followedUpAt: string | null;
  /** How the last follow-up was sent. Null until followedUpAt is set. */
  followUpChannel: FollowUpChannel | null;
  /** When this contact is next due for a follow-up, or null (not due, or never followed up and
   * not yet computed - existing contacts before #33 are never backfilled). Set on creation from
   * priority, recalculated if priority changes before the first follow-up, cleared by a follow-up
   * unless a "Remind me again" option sets a future date. */
  followUpDueAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Tag {
  id: string;
  name: string;
}

export interface ChatsoonEvent {
  id: string;
  name: string;
  isPublic: boolean;
}

/** Fields the card extractor can fill. Every field is optional. */
export interface ExtractedCard {
  name: string | null;
  company: string | null;
  role: string | null;
  email: string | null;
  phone: string | null;
  telegram: string | null;
  xHandle: string | null;
  linkedinUrl: string | null;
  website: string | null;
}

// ---- Responses ----

export interface ContactsResponse {
  contacts: Contact[];
}
export interface TagsResponse {
  tags: Tag[];
}
export interface EventsResponse {
  events: ChatsoonEvent[];
}
export interface UploadResponse {
  key: string;
  /** Signed URL for immediate display. */
  url: string;
}
export interface ScanConnectResponse {
  /** The other person's card, now in my contacts. */
  contact: Contact;
  alreadyConnected: boolean;
}
/** POST /id/:slug/connect. `contact` is sent when the owner has at least one usable channel. */
export interface ConnectFormResponse {
  ok: true;
  contact?: ProfileContact;
  vcardUrl?: string;
}
export interface ExtractCardResponse {
  contact: Contact;
  extracted: ExtractedCard;
}
export interface SignInResponse {
  token: string;
  user: { id: string; email: string };
}

/**
 * GET /auth-providers response. `providers` (issue #24) are the sign-in buttons the sign-in screen
 * shows, in display order; unchanged shape, so it stays backward compatible. `linkProviders` (issue
 * #11) is every configured provider the Connected accounts screen can offer to link, including
 * `twitter` (X): X never returns an email, so it can't sign anyone in and never appears in
 * `providers`, but once `TWITTER_CLIENT_ID`/`TWITTER_CLIENT_SECRET` are set it can be linked.
 */
export interface AuthProvidersResponse {
  providers: SocialProvider[];
  linkProviders: SocialValidationProvider[];
}

/** POST /me/avatar/from-provider response (issue #24): the new avatar's key, same shape as an upload. */
export interface AvatarFromProviderResponse {
  avatarKey: string;
}

/**
 * GET /me/connected-accounts response (issue #11): one row per linked account whose provider is in
 * `SOCIAL_VALIDATION_PROVIDERS` (never the email-OTP `credential` row). `label` is the Discord
 * username, the X handle, or the provider email where the account or `users` row gives one, and
 * never a token. `eligible` is always true for google/apple/linkedin; for discord/twitter it reflects
 * `discordEligible`/`xEligible` against the last captured `social_checks` row (missing row: not
 * eligible), with `reason` set only when ineligible.
 */
export type ConnectedAccountsResponse = {
  provider: SocialValidationProvider;
  connectedAt: string;
  label?: string;
  eligible: boolean;
  reason?: SocialIneligibleReason;
}[];

/** Error body for every non-2xx response from the API (except Better Auth's own routes). */
export interface ApiErrorBody {
  error: {
    code: ApiErrorCode;
    message: string;
    /** Only on `referral_claim_open`: the still-live claim link, so the client can just open it. */
    url?: string;
  };
}

export type ApiErrorCode =
  | 'bad_request'
  | 'unauthorized'
  | 'forbidden'
  | 'not_found'
  | 'conflict'
  | 'rate_limited'
  | 'captcha_failed'
  | 'payload_too_large'
  | 'extraction_failed'
  | 'invalid_token'
  | 'internal'
  // Referrals (issue #11, docs/referrals.md "API")
  | 'referral_disabled'
  | 'referral_self'
  | 'referral_window_closed'
  | 'referral_already_attributed'
  | 'referral_invite_limit'
  | 'referral_claim_needs_social'
  | 'referral_already_claimed'
  | 'referral_claim_open'
  | 'referral_claim_expired';
