import {
  followUpDueAt,
  REVIEWER_EMAIL,
  SEEDED_EVENTS,
  makeSlug,
  type ContactSource,
  type ExtractionStatus,
  type SEEDED_TAGS,
} from '@chatsoon/shared';
import { and, eq, sql } from 'drizzle-orm';
import type { BatchItem } from 'drizzle-orm/batch';

import { blocks, connections, contacts, contactTags, profiles, tags } from '../db/schema';
import type { Env } from '../env';
import { getDb, type DB } from './db';
import { newId, shortSuffix } from './ids';
import { contactFieldsFromProfile, findProfileByUserId, isBlockedEitherWay } from './profiles';
import { seedDefaultTags } from './tags';

// App Store / Google Play reviewer account (spec: "Reviewer login").
// With REVIEWER_ENABLED=true, review@chatsoon.app signs in with the fixed REVIEWER_CODE (no email is
// sent) and the account starts with a profile and sample contacts. With the flag off it is an
// ordinary email address.

/**
 * The second test profile reviewers scan (DEMO_PROFILE_SLUG, store reviewer notes). The reviewer
 * is deliberately not connected to it, so scanning it shows a first connection. Seeded by
 * migrations/0002_demo_profile.sql.
 */
export const DEMO_USER_ID = 'usr_demo_alex';

/**
 * A demo profile the reviewer starts connected to: the sample "connected in the app" contact, and
 * a connected profile to try report and block on without affecting the scan above. Also seeded by
 * migrations/0002_demo_profile.sql.
 */
export const SAMPLE_CONNECTION_USER_ID = 'usr_demo_maya';

const REVIEWER_NAME = 'App Reviewer';
const REVIEWER_HEADLINE = 'Testing Chatsoon';
const EVENT_ID = SEEDED_EVENTS[0].id;

type OtpType = 'sign-in' | 'email-verification' | 'forget-password' | 'change-email';
type SeededTag = (typeof SEEDED_TAGS)[number];

/** The fixed reviewer code, or null when the bypass is off or REVIEWER_CODE is not a 6 digit code. */
export function reviewerCode(env: Env): string | null {
  if (env.REVIEWER_ENABLED !== 'true' || !env.REVIEWER_CODE) return null;
  const code = env.REVIEWER_CODE.trim();
  if (!/^\d{6}$/.test(code)) {
    console.error('REVIEWER_CODE must be exactly 6 digits. Reviewer sign-in is disabled.');
    return null;
  }
  return code;
}

export const isReviewerEmail = (email: string) => email.trim().toLowerCase() === REVIEWER_EMAIL;

/** True when this user is the reviewer and the reviewer bypass is on. */
export const isActiveReviewer = (env: Env, email: string) => isReviewerEmail(email) && reviewerCode(env) !== null;

/** REVIEWER_CODE when the reviewer asks for a sign-in code, otherwise undefined (a random code is used). */
export function reviewerOtp(env: Env, email: string, type: OtpType): string | undefined {
  if (type !== 'sign-in' || !isReviewerEmail(email)) return undefined;
  return reviewerCode(env) ?? undefined;
}

// ---------------------------------------------------------------------------
// Sample data
// ---------------------------------------------------------------------------

interface SampleContact {
  name: string;
  company?: string;
  role?: string;
  email?: string;
  phone?: string;
  telegram?: string;
  xHandle?: string;
  linkedinUrl?: string;
  website?: string;
  notes: string;
  priority: number;
  eventId: string | null;
  source: Exclude<ContactSource, 'app_connect'>;
  extractionStatus?: ExtractionStatus;
  tags: SeededTag[];
  /** Created this long before the reviewer signs in, so the list reads like a real event. */
  hoursAgo: number;
}

// Fictional people. The phone number is in the 555-01xx range reserved for fiction, and handles
// are company-specific so a reviewer tapping one is unlikely to reach a stranger.
const SAMPLE_CONTACTS: SampleContact[] = [
  {
    name: 'Marcus Chen',
    company: 'Blockhaus Ventures',
    role: 'Partner',
    telegram: 'marcus_blockhaus',
    notes:
      'Scanned his Telegram QR at the Blockhaus booth. Leads their seed-stage infrastructure fund and asked for our deck. Send it before Friday.',
    priority: 5,
    eventId: EVENT_ID,
    source: 'qr_scan',
    tags: ['VC', 'Investor'],
    hoursAgo: 3,
  },
  {
    name: 'Sofia Almeida',
    company: 'Orbital Media',
    role: 'Head of Content',
    email: 'sofia@orbitalmedia.co',
    phone: '+1 415 555 0132',
    website: 'https://orbitalmedia.co',
    linkedinUrl: 'https://www.linkedin.com/in/sofia-almeida-orbitalmedia',
    notes:
      'Business card from the media lounge. Runs their podcast network and is looking for founders to interview. Pitch a crossover episode.',
    priority: 3,
    eventId: EVENT_ID,
    source: 'card_photo',
    extractionStatus: 'confirmed',
    tags: ['Media', 'YouTube guest'],
    hoursAgo: 22,
  },
  {
    name: 'Daniel Okafor',
    email: 'daniel@stakehouse.io',
    notes:
      'Sent through my profile page: "Great chatting after the Cardano panel. Keen to compare notes on staking dashboards." Reply with times for a call.',
    priority: 3,
    eventId: EVENT_ID,
    source: 'web_connect',
    tags: ['Cardano', 'Founder'],
    hoursAgo: 26,
  },
  {
    name: 'Priya Natarajan',
    company: 'Lumen Pay',
    role: 'Co-founder & CEO',
    email: 'priya@lumenpay.io',
    telegram: 'priya_lumenpay',
    notes:
      'Met at the opening night party. Building stablecoin payroll for teams in Southeast Asia and raising a pre-seed round. Intro her to Marcus.',
    priority: 4,
    eventId: EVENT_ID,
    source: 'manual',
    tags: ['Founder', 'Collab'],
    hoursAgo: 30,
  },
  {
    name: 'Hana Sato',
    company: 'Kestrel Labs',
    role: 'Developer Advocate',
    xHandle: 'hana_kestrellabs',
    linkedinUrl: 'https://www.linkedin.com/in/hana-sato-kestrel-labs',
    notes:
      'Explains zero-knowledge privacy really clearly. Invite her on the channel to talk about building on Midnight.',
    priority: 2,
    eventId: null,
    source: 'manual',
    tags: ['YouTube guest', 'Midnight'],
    hoursAgo: 24 * 9,
  },
];

/** The reviewer's card for the connected demo profile, as if they had swapped QR codes in the app. */
const CONNECTED_SAMPLE: Pick<SampleContact, 'notes' | 'priority' | 'tags' | 'hoursAgo'> = {
  notes: 'Swapped cards in the app after the community meetup. Keen to co-host a builders night next quarter.',
  priority: 4,
  tags: ['Collab', 'Sponsor'],
  hoursAgo: 5,
};

const HOUR_MS = 60 * 60 * 1000;
const enc = new TextEncoder();

/**
 * Sample contact ids are derived from the user id, so two sign-ins seeding at the same moment
 * conflict on the primary key (and the second batch rolls back) instead of writing every sample
 * twice. Keyed with the auth secret so nobody can take the ids first. Formatted as a v4 UUID,
 * like every other contact id.
 */
async function sampleIds(env: Env, userId: string, count: number): Promise<string[]> {
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(env.BETTER_AUTH_SECRET),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  return Promise.all(
    Array.from({ length: count }, async (_, n) => {
      const mac = await crypto.subtle.sign('HMAC', key, enc.encode(`reviewer-sample:${userId}:${n}`));
      const b = new Uint8Array(mac, 0, 16);
      b[6] = (b[6]! & 0x0f) | 0x40;
      b[8] = (b[8]! & 0x3f) | 0x80;
      const hex = Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
      return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
    }),
  );
}

async function freeSlug(db: DB, displayName: string): Promise<string> {
  for (let attempt = 0; attempt < 5; attempt++) {
    const slug = makeSlug(displayName, shortSuffix());
    const [taken] = await db.select({ userId: profiles.userId }).from(profiles).where(eq(profiles.slug, slug)).limit(1);
    if (!taken) return slug;
  }
  // Five collisions in a row is practically impossible. A 16 char suffix can't clash with an 8 char one.
  return makeSlug(displayName, `${shortSuffix()}${shortSuffix()}`);
}

/** Inserts for the sample contacts, their tags and the connection with the connected demo profile. */
async function sampleContactWrites(env: Env, db: DB, userId: string): Promise<BatchItem<'sqlite'>[]> {
  await seedDefaultTags(db, userId);
  const tagRows = await db.select({ id: tags.id, name: tags.name }).from(tags).where(eq(tags.userId, userId));
  const tagIdByName = new Map(tagRows.map((t) => [t.name.trim().toLowerCase(), t.id]));

  const connected = await findProfileByUserId(db, SAMPLE_CONNECTION_USER_ID);
  if (!connected) {
    console.warn(`Demo profile ${SAMPLE_CONNECTION_USER_ID} is missing (migration 0002). No sample connection.`);
  }
  // A reviewer who blocked the demo profile doesn't get it back.
  const linkable = connected && !(await isBlockedEitherWay(db, userId, SAMPLE_CONNECTION_USER_ID));

  const ids = await sampleIds(env, userId, SAMPLE_CONTACTS.length + 1);
  const now = Date.now();
  const at = (hoursAgo: number) => new Date(now - hoursAgo * HOUR_MS);

  const rows: (typeof contacts.$inferInsert)[] = [];
  const tagLinks: (typeof contactTags.$inferInsert)[] = [];
  const addTags = (contactId: string, names: SeededTag[]) => {
    for (const name of names) {
      const tagId = tagIdByName.get(name.toLowerCase());
      if (tagId) tagLinks.push({ contactId, tagId, userId });
    }
  };

  SAMPLE_CONTACTS.forEach((sample, n) => {
    const id = ids[n]!;
    const { tags: tagNames, hoursAgo, extractionStatus, ...fields } = sample;
    const createdAt = at(hoursAgo);
    rows.push({
      ...fields,
      id,
      userId,
      extractionStatus: extractionStatus ?? 'none',
      // Issue #33: seeded the same way a real creation would be, so the reviewer sees the follow-up
      // feature working with realistic sample data.
      followUpDueAt: followUpDueAt(fields.priority, createdAt),
      createdAt,
      updatedAt: createdAt,
    });
    addTags(id, tagNames);
  });

  const writes: BatchItem<'sqlite'>[] = [];
  if (linkable) {
    const id = ids[SAMPLE_CONTACTS.length]!;
    const connectedCreatedAt = at(CONNECTED_SAMPLE.hoursAgo);
    rows.push({
      // The same card POST /connections/scan saves.
      ...contactFieldsFromProfile(connected),
      id,
      userId,
      linkedUserId: SAMPLE_CONNECTION_USER_ID,
      notes: CONNECTED_SAMPLE.notes,
      priority: CONNECTED_SAMPLE.priority,
      eventId: EVENT_ID,
      source: 'app_connect',
      extractionStatus: 'none',
      followUpDueAt: followUpDueAt(CONNECTED_SAMPLE.priority, connectedCreatedAt),
      createdAt: connectedCreatedAt,
      updatedAt: connectedCreatedAt,
    });
    addTags(id, CONNECTED_SAMPLE.tags);

    // One row per pair, user_a < user_b.
    const [userA, userB] = [userId, SAMPLE_CONNECTION_USER_ID].sort() as [string, string];
    writes.push(
      db
        .insert(connections)
        .values({
          id: newId(),
          userA,
          userB,
          status: 'accepted',
          eventId: EVENT_ID,
          createdAt: at(CONNECTED_SAMPLE.hoursAgo),
        })
        .onConflictDoUpdate({ target: [connections.userA, connections.userB], set: { status: 'accepted' } }),
    );
  }

  // One insert per contact keeps every statement under D1's 100 bound parameter limit
  // (12 tag links x 3 columns is well under it too).
  return [
    ...rows.map((row) => db.insert(contacts).values(row)),
    // A stale link can't block the seed; the contact ids above are what guard against doubles.
    ...(tagLinks.length > 0 ? [db.insert(contactTags).values(tagLinks).onConflictDoNothing()] : []),
    ...writes,
  ];
}

/**
 * Gives the reviewer account a profile, the default tags, sample contacts from every source and an
 * accepted connection with a demo profile. Runs on each reviewer sign-in:
 * - the profile is created when missing, so a deleted account starts over;
 * - the samples are added when the account has no contacts at all, so the next reviewer always
 *   finds some, while a few deleted contacts stay deleted.
 * Everything is written in one atomic batch. Returns true when it wrote any of it.
 *
 * It also lifts the reviewer's block on the profile the review notes say to scan (DEMO_USER_ID):
 * Apple and Google share this account across reviews, and a block left by an earlier reviewer
 * would make that scan fail. A block on the connected sample profile stays (see
 * sampleContactWrites).
 */
export async function ensureReviewerData(env: Env, userId: string): Promise<boolean> {
  const db = getDb(env);
  await db.delete(blocks).where(and(eq(blocks.blockerId, userId), eq(blocks.blockedId, DEMO_USER_ID)));
  const [profile, [contactCount]] = await Promise.all([
    findProfileByUserId(db, userId),
    db.select({ n: sql<number>`count(*)` }).from(contacts).where(eq(contacts.userId, userId)),
  ]);
  const needsProfile = !profile;
  const needsContacts = (contactCount?.n ?? 0) === 0;
  if (!needsProfile && !needsContacts) return false;

  const writes: BatchItem<'sqlite'>[] = [];
  if (needsProfile) {
    const slug = await freeSlug(db, REVIEWER_NAME);
    // First in the batch: a concurrent sign-in that already created it conflicts here.
    writes.push(db.insert(profiles).values({ userId, displayName: REVIEWER_NAME, slug, headline: REVIEWER_HEADLINE }));
  }
  if (needsContacts) writes.push(...(await sampleContactWrites(env, db, userId)));

  const [first, ...rest] = writes;
  if (first) await db.batch([first, ...rest]);
  return true;
}
