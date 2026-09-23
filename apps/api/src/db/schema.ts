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

export const profiles = sqliteTable('profiles', {
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
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

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
