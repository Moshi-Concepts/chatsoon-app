import { sql } from 'drizzle-orm';
import { index, integer, primaryKey, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';

const now = sql`(cast(unixepoch('subsecond') * 1000 as integer))`;
const createdAt = () => integer('created_at', { mode: 'timestamp_ms' }).notNull().default(now);
const updatedAt = () => integer('updated_at', { mode: 'timestamp_ms' }).notNull().default(now);

// ---------------------------------------------------------------------------
// Better Auth tables. JS keys must match Better Auth field names (camelCase).
// Mapped in lib/auth.ts: user -> users, session -> sessions, account -> accounts,
// verification -> verifications.
// ---------------------------------------------------------------------------

export const users = sqliteTable('users', {
  id: text('id').primaryKey(),
  name: text('name').notNull().default(''),
  email: text('email').notNull().unique(),
  emailVerified: integer('email_verified', { mode: 'boolean' }).notNull().default(false),
  image: text('image'),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
  /** Reserved. Account deletion is a hard delete in 1.0. */
  deletedAt: integer('deleted_at', { mode: 'timestamp_ms' }),
});

export const sessions = sqliteTable(
  'sessions',
  {
    id: text('id').primaryKey(),
    expiresAt: integer('expires_at', { mode: 'timestamp_ms' }).notNull(),
    token: text('token').notNull().unique(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    ipAddress: text('ip_address'),
    userAgent: text('user_agent'),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
  },
  (t) => [index('sessions_user_id_idx').on(t.userId)],
);

export const accounts = sqliteTable(
  'accounts',
  {
    id: text('id').primaryKey(),
    accountId: text('account_id').notNull(),
    providerId: text('provider_id').notNull(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    accessToken: text('access_token'),
    refreshToken: text('refresh_token'),
    idToken: text('id_token'),
    accessTokenExpiresAt: integer('access_token_expires_at', { mode: 'timestamp_ms' }),
    refreshTokenExpiresAt: integer('refresh_token_expires_at', { mode: 'timestamp_ms' }),
    scope: text('scope'),
    password: text('password'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('accounts_user_id_idx').on(t.userId)],
);

export const verifications = sqliteTable(
  'verifications',
  {
    id: text('id').primaryKey(),
    identifier: text('identifier').notNull(),
    value: text('value').notNull(),
    expiresAt: integer('expires_at', { mode: 'timestamp_ms' }).notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('verifications_identifier_idx').on(t.identifier)],
);

// ---------------------------------------------------------------------------
// Chatsoon tables. Every private row carries user_id and every query is scoped by it.
// ---------------------------------------------------------------------------

export const profiles = sqliteTable(
  'profiles',
  {
    userId: text('user_id')
      .primaryKey()
      .references(() => users.id, { onDelete: 'cascade' }),
    displayName: text('display_name').notNull(),
    /** Stable once created. Printed QR codes point at it. */
    slug: text('slug').notNull().unique(),
    avatarKey: text('avatar_key'),
    headline: text('headline'),
    company: text('company'),
    role: text('role'),
    /** JSON ProfileLinks */
    links: text('links').notNull().default('{}'),
    /** JSON array of { label, url }, in display order. See lib/serialize.ts parseBookingLinks. */
    bookingLinks: text('booking_links').notNull().default('[]'),
    /** JSON ProfileContact (phone, WhatsApp, Signal), stored as typed. See lib/serialize.ts parseContact. */
    contact: text('contact').notNull().default('{}'),
    /** ContactVisibility. Anything other than 'public' is treated as 'connections' on read (fail closed). */
    contactVisibility: text('contact_visibility').notNull().default('connections'),
    /** "Show my profile in search engines" (Stage D). Off for existing and new profiles until the owner opts in. */
    searchVisible: integer('search_visible', { mode: 'boolean' }).notNull().default(false),
    /** Consent trail: set to now() only when searchVisible actually changes. Null until it's ever been set. */
    searchVisibleAt: integer('search_visible_at', { mode: 'timestamp_ms' }),
    /** Ops kill switch, set only via `wrangler d1 execute`. Never exposed through the API. */
    searchBlocked: integer('search_blocked', { mode: 'boolean' }).notNull().default(false),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('profiles_search_idx').on(t.searchVisible, t.slug)],
);

export const events = sqliteTable('events', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  isPublic: integer('is_public', { mode: 'boolean' }).notNull().default(false),
  /** Null for seeded public events. Private events are visible to their creator only. */
  createdBy: text('created_by').references(() => users.id, { onDelete: 'cascade' }),
  createdAt: createdAt(),
});

/** One row per pair. user_a < user_b (string order) so a pair is unique. */
export const connections = sqliteTable(
  'connections',
  {
    id: text('id').primaryKey(),
    userA: text('user_a')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    userB: text('user_b')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    /** 'accepted' | 'blocked' */
    status: text('status').notNull().default('accepted'),
    eventId: text('event_id').references(() => events.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('connections_pair_idx').on(t.userA, t.userB),
    index('connections_user_b_idx').on(t.userB),
  ],
);

export const contacts = sqliteTable(
  'contacts',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    linkedUserId: text('linked_user_id').references(() => users.id, { onDelete: 'set null' }),
    /**
     * Set on my card of someone who blocked me, in place of linked_user_id. Scanning again after an
     * unblock links this card back instead of adding a second one. Never sent to clients.
     */
    unlinkedUserId: text('unlinked_user_id').references(() => users.id, { onDelete: 'set null' }),
    name: text('name').notNull(),
    company: text('company'),
    role: text('role'),
    email: text('email'),
    phone: text('phone'),
    telegram: text('telegram'),
    xHandle: text('x_handle'),
    linkedinUrl: text('linkedin_url'),
    website: text('website'),
    cardImageKey: text('card_image_key'),
    notes: text('notes'),
    priority: integer('priority'),
    eventId: text('event_id').references(() => events.id, { onDelete: 'set null' }),
    /** ContactSource */
    source: text('source').notNull().default('manual'),
    /** ExtractionStatus */
    extractionStatus: text('extraction_status').notNull().default('none'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('contacts_user_updated_idx').on(t.userId, t.updatedAt),
    index('contacts_user_linked_idx').on(t.userId, t.linkedUserId),
  ],
);

export const tags = sqliteTable(
  'tags',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('tags_user_name_idx').on(t.userId, t.name)],
);

export const contactTags = sqliteTable(
  'contact_tags',
  {
    contactId: text('contact_id')
      .notNull()
      .references(() => contacts.id, { onDelete: 'cascade' }),
    tagId: text('tag_id')
      .notNull()
      .references(() => tags.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
  },
  (t) => [primaryKey({ columns: [t.contactId, t.tagId] }), index('contact_tags_user_idx').on(t.userId)],
);

export const reports = sqliteTable('reports', {
  id: text('id').primaryKey(),
  /** Null for anonymous reports from the public web page. */
  reporterId: text('reporter_id').references(() => users.id, { onDelete: 'set null' }),
  /** Null when the report is about a Connect form message (contact_id), which has no account behind it. */
  targetUserId: text('target_user_id').references(() => users.id, { onDelete: 'cascade' }),
  /** The reporter's web_connect contact the report is about. Its content is copied into details. */
  contactId: text('contact_id'),
  /** ReportReason */
  reason: text('reason').notNull(),
  details: text('details'),
  /** 'open' | 'actioned' | 'dismissed' */
  status: text('status').notNull().default('open'),
  createdAt: createdAt(),
});

export const blocks = sqliteTable(
  'blocks',
  {
    blockerId: text('blocker_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    blockedId: text('blocked_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.blockerId, t.blockedId] }), index('blocks_blocked_idx').on(t.blockedId)],
);

/**
 * A pending, delayed account deletion (issue #8). One row per user: `POST /me/deletion` inserts it,
 * `DELETE /me/deletion` or the token link removes it, and the scheduled job (wrangler.jsonc cron)
 * deletes the account once `delete_after` has passed. While a row exists here, the account's public
 * profile reads as not found everywhere (lib/profiles.ts, pages.ts).
 */
export const accountDeletions = sqliteTable(
  'account_deletions',
  {
    userId: text('user_id')
      .primaryKey()
      .references(() => users.id, { onDelete: 'cascade' }),
    /** The address to send the final "deleted" email to, captured at request time. */
    email: text('email').notNull(),
    requestedAt: integer('requested_at', { mode: 'timestamp_ms' }).notNull().default(now),
    deleteAfter: integer('delete_after', { mode: 'timestamp_ms' }).notNull(),
    /** SHA-256 hex of the (base64url) cancel token emailed to the user. The token itself is never stored. */
    cancelTokenHash: text('cancel_token_hash').notNull(),
  },
  (t) => [index('account_deletions_delete_after_idx').on(t.deleteAfter)],
);

/**
 * A person who opted in to tips emails from the public Connect form (issue #7) without (yet) having
 * a Chatsoon account. `email` is the primary key (always lowercased): one row per address. The
 * scheduled job (lib/sequences.ts `runEmailSequences`) sends up to three "create your profile" tips
 * emails, advancing `step` and `nextSendAt` each time; it stops on `unsubscribedAt` or `convertedAt`
 * (an account with this email now exists). No raw unsubscribe token is stored: the one-click link
 * carries an HMAC of the email instead (lib/unsubscribe.ts), verified by recomputing.
 */
export const emailLeads = sqliteTable(
  'email_leads',
  {
    email: text('email').primaryKey(),
    consentAt: integer('consent_at', { mode: 'timestamp_ms' }).notNull(),
    /** Where consent was captured, e.g. 'connect_form'. */
    consentSource: text('consent_source').notNull(),
    /** The exact checkbox wording shown at consent time, kept for the compliance record. */
    consentText: text('consent_text').notNull(),
    step: integer('step').notNull().default(0),
    /** Null once the sequence is finished (after step 3), unsubscribed, or converted. */
    nextSendAt: integer('next_send_at', { mode: 'timestamp_ms' }),
    unsubscribedAt: integer('unsubscribed_at', { mode: 'timestamp_ms' }),
    /** Set when a Chatsoon account is found (or created) for this email; stops the sequence. */
    convertedAt: integer('converted_at', { mode: 'timestamp_ms' }),
    createdAt: createdAt(),
  },
  (t) => [index('email_leads_next_send_idx').on(t.nextSendAt)],
);

/**
 * A signed-in user's tips-email preferences and new-account nudge sequence (issue #7). One row per
 * user, created when their profile is first saved (onboarding). `nudgeStep`/`nextNudgeAt` drive the
 * two-step "finish your profile" / "share your link" nudge sequence in lib/sequences.ts; a null
 * `nextNudgeAt` means the sequence is finished. `tipsOptOutAt` gates every tips email regardless of
 * where the sequence is (PUT /me/email-prefs, or the one-click unsubscribe link). Like email_leads,
 * no raw unsubscribe token is stored (lib/unsubscribe.ts).
 */
export const emailPrefs = sqliteTable(
  'email_prefs',
  {
    userId: text('user_id')
      .primaryKey()
      .references(() => users.id, { onDelete: 'cascade' }),
    tipsOptOutAt: integer('tips_opt_out_at', { mode: 'timestamp_ms' }),
    nudgeStep: integer('nudge_step').notNull().default(0),
    nextNudgeAt: integer('next_nudge_at', { mode: 'timestamp_ms' }),
    createdAt: createdAt(),
  },
  (t) => [index('email_prefs_next_nudge_idx').on(t.nextNudgeAt)],
);

/** Daily counters for paid calls (card extraction), keyed like 'extract:user:<id>:2026-09-24'. */
export const usageCounters = sqliteTable(
  'usage_counters',
  {
    key: text('key').primaryKey(),
    /** UTC date, YYYY-MM-DD, so old rows can be swept. */
    day: text('day').notNull(),
    count: integer('count').notNull().default(0),
  },
  (t) => [index('usage_counters_day_idx').on(t.day)],
);

export type UserRow = typeof users.$inferSelect;
export type ProfileRow = typeof profiles.$inferSelect;
export type ContactRow = typeof contacts.$inferSelect;
export type TagRow = typeof tags.$inferSelect;
export type EventRow = typeof events.$inferSelect;
export type EmailLeadRow = typeof emailLeads.$inferSelect;
export type EmailPrefsRow = typeof emailPrefs.$inferSelect;
