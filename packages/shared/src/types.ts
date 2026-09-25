// API contract shared by the Worker (apps/api) and the app (apps/mobile).
// JSON is camelCase on the wire; the database uses snake_case.

export type LinkKey = 'x' | 'telegram' | 'linkedin' | 'website' | 'youtube';

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
  user: { id: string; email: string; createdAt: string };
  /** Null until onboarding has created the profile. */
  profile: MyProfile | null;
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

/** Error body for every non-2xx response from the API (except Better Auth's own routes). */
export interface ApiErrorBody {
  error: {
    code: ApiErrorCode;
    message: string;
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
  | 'internal';
