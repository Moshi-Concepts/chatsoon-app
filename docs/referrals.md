# Referrals (v1.1)

Issue #11. Every user gets a stable referral code and link. They invite people from the app (share sheet,
QR, email, SMS, or straight from their contacts). A referral counts once the invited person has verified
their email, published a profile, connected a social account (Google, Apple, Discord or LinkedIn) and
cleared a 7 day hold. Each qualified referral credits 100 points to
the referrer, and the person who joined gets 1 point the moment they enter a code. Both land in a general
points ledger. Two milestones: at 10 qualified referrals the user becomes a **Founding member**, a
permanent badge on their account and public profile; at 20 they can claim a reward, which hands them off
with a signed one-time token to a destination we configure (bounties.learncardano.io today, anything
later, with no app update).

All paths are relative to the repo root, `D:\Claude\chatsoon-app`.

## Decisions (brainstorm, 26 Sep 2026)

- **Qualified referral** = referred user has `email_verified`, has a `profiles` row, has a social account
  connected, and 7 days have passed since attribution. Not just an account.
- **Social connect is the identity check.** A user "has a social" when `accounts` holds a row for them
  with `provider_id` in `SOCIAL_VALIDATION_PROVIDERS` (`google`, `apple`, `discord`, `linkedin`,
  `twitter`) that is **eligible**. Google, Apple and LinkedIn are eligible as soon as they're linked.
  **Discord counts only if the account is at least `REFERRAL_DISCORD_MIN_AGE_DAYS` (90) old and had 2FA
  on when it was linked.** Discord's OAuth2 user object has no phone field (that's client-session only),
  so account age from the id and `mfa_enabled` are the strongest signals it gives us. **X counts only if
  the account is verified (`verified_type` blue, business or government) or has passed X's ID
  verification (`is_identity_verified`), and has at least `REFERRAL_X_MIN_FOLLOWERS` (50) followers**,
  all as reported when it was linked. X is a new provider for both sign-in and linking (Better Auth's
  `twitter`). Its profile read is billed per call on X's pay-per-use API, so it's read at link time only,
  never from the cron. The eligible check is required for
  a referral to qualify and for the referrer to claim. Email-only accounts can refer and earn, but can't
  cash in until they connect an eligible one. This needs an account-linking flow (below): today social
  is sign-in only.
- **Invite channels**: share sheet (existing), QR (existing QR now carries the code), server-sent email
  via Resend, native SMS composer (we never send SMS ourselves), and a picker over the user's own contacts.
- **Referral code is separate from the slug.** Slugs are stable but a future ADA Handle move-in would
  change the public handle; the code must survive that. Links can still show the slug.
- **Points accrue, spend later.** A generic ledger, not a referral counter. Referrals are the only source
  of points in this change. Milestones check qualified referrals, not points, so later point sources
  can't unlock them.
- **Two tiers.** 10 qualified referrals = a milestone badge, awarded automatically by the sweep, shown
  on the profile card and public page, never removed. 20 qualified referrals = the bounty claim.
  `REFERRAL_FOUNDER_THRESHOLD` and `REFERRAL_CLAIM_THRESHOLD` are config, so the numbers can move. The
  badge needs no claim step and no social account on the referrer's side (the referred people already
  passed the social check); the claim keeps its social requirement.
- **Only 100 Founding members.** The first `REFERRAL_FOUNDER_CAP` (100) people to reach the 10-referral
  milestone get the `founder` badge, numbered 1 to 100 ("Founding member #37"). Everyone after that who
  reaches it gets `early_adopter` ("Early adopter"; the label is one constant in `packages/shared`, so
  renaming it later is a one-line change and the stored badge id stays `early_adopter`). The cap is
  enforced by the database, not by counting in code, so two sweeps can't mint founder #101.
- **Fraud at launch**: no self-referral, one attribution per referred user, device id dedupe, the social
  account requirement, 7 day hold. No manual approval step and **no automatic IP rule**: at Token2049
  one person can meet 100 people a day on the venue wifi, so any per-IP cap breaks the main use case.
  IP and user agent hashes are stored for after-the-fact review only.
- **Referred person gets 1 point** (`referral_joined`) as soon as their attribution is accepted, so there's
  a reason to enter the code at signup. Referrer's 100 points still wait for qualification.
- **Claim handoff**: signed one-time token to `REFERRAL_CLAIM_URL`. The partner verifies and redeems
  through two secret-gated endpoints on our API. Reward logic never lives in Chatsoon.

## What the user sees

**Entry points**
- **Me tab**: a new **Invite friends** section above **Contacts** with one row, "Refer friends, earn
  points", subtitle showing progress toward the next milestone ("3 of 10 to Founding member · 300
  points", then "14 of 20 to your reward"). Opens `/referrals`.
- **QR tab**: the QR now encodes `https://chatsoon.app/id/<slug>?ref=<CODE>`. Under the Share button a
  text link "Invite friends and earn points" opens `/referrals`.
- **Onboarding**: after the profile step, an optional "Did someone invite you?" field with the line
  "Enter their code and you earn a point." Prefilled and read-only-looking (still editable) when the app
  captured a code from a link. Skippable.

**Referral hub** (`/referrals`)
- Header card: progress ring toward the next milestone ("N of 10 to Founding member" while founder
  spots remain, else "N of 10 to Early adopter", then "N of 20 to your reward", then "20 of 20" once
  claimed), Pending count and Points balance. Under it a two-step milestone strip: **10 · Founding
  member** (or **Early adopter**) and **20 · Reward**, each ticked when reached.
- **Badge card**, once `milestoneBadge` is set: the badge, "Founding member #37 since <date>" or "Early
  adopter since <date>", and one line "You helped build Chatsoon. This stays on your profile for good."
  Before that, a smaller line under the strip: "Refer 10 people to become a Founding member. N of 100
  founder spots left." while spots remain (scarcity is the point), else "Refer 10 people to become an
  Early adopter." Someone at 9 of 10 can see the founder line and still land Early adopter if the last
  spot goes first; the copy says "spots left", not "reserved", on purpose.
- The badge pill itself: **Founding member** or **Early adopter**, a small pill with an icon next to the
  display name on the profile card (app and web), on `/id/<slug>` in every mode, and in the referrals
  list of anyone they referred. It's public: that's the point of it. Founder gets the stronger treatment
  (brand magenta); Early adopter the quieter one.
- Your link: `chatsoon.app/r/<CODE>` with **Copy** and **Share** (same share sheet as the QR tab, with
  invite copy). A small QR of the same link.
- **Invite contacts** button (opens the picker below). On web the button is still shown; SMS rows are
  hidden there.
- **Enter a code** row, only while the user is still inside the attribution window and has no attribution.
- **Claim card**, shown once `qualifiedCount >= claimThreshold` (20):
  - No social connected: "Connect Google, Apple, LinkedIn, X or Discord to claim your reward" and a
    **Connect an account** button that opens the Connected accounts screen. The claim button is not shown.
  - Before claim: "You've referred 20 people. Claim your reward on Learn Cardano Bounties." A checkbox
    "Share my name and email with Learn Cardano Bounties so they can process the reward" (required), then
    **Claim reward**. Opens the returned URL in the system browser (`expo-web-browser`).
  - After claim: "Claimed on <date>" and **Open reward page** (re-opens the same URL while the token is
    valid, or issues a fresh one if it expired).
- **Your referrals** list: display name and avatar once they have a profile, otherwise "New sign-up",
  plus a status pill: **Pending**, **Qualified**, **Didn't qualify**. Pending rows carry one line on what's
  outstanding, in this order: "hasn't published a profile yet", "hasn't connected a social account yet",
  "qualifies on <date>". Tapping a qualified row opens their `/id/<slug>`.
- **Invited by** card under the header when the user has an attribution: "Invited by <name> · 1 point
  earned" and a three-item checklist so they know what makes the invite count for their friend: Profile
  published, Social account connected, 7 day wait (with the date). The unticked social item is a button to
  the Connected accounts screen. Hidden once their own referral is qualified or void.
- **Connected accounts** (`/connected-accounts`, also reached from the Me tab's Account section): one row
  per provider in `SOCIAL_VALIDATION_PROVIDERS` with **Connected** (and the linked email or username where
  the provider gives one) or a **Connect** button. Connecting reuses the existing social sign-in flow per
  provider (`lib/auth.tsx`) but calls Better Auth's `linkSocial` for a signed-in user instead of
  `signIn.social`. Providers whose secrets aren't set (`GET /auth-providers`) are hidden, same as sign-in.
  A connected Discord or X that isn't eligible shows **Connected, not yet eligible** with the reason under
  it ("Discord account needs to be 90+ days old", "Turn on two-factor authentication in Discord, then
  reconnect", "X account needs to be verified or ID verified", "X account needs 50+ followers") and a
  **Reconnect** button that runs the link flow again to refresh the check. The screen's intro line says
  which providers count and the Discord and X conditions, so nobody links one expecting it to work on a
  fresh account.
- **Contacts tab banner**, shown once after attribution while the user has no social connected: "Connect a
  social account so <name>'s invite counts (and yours will too)". Dismissable, opens Connected accounts.
- Empty state: "No referrals yet. Share your link to get started."

**Invite contacts** (`/referrals/invite`)
- Lists the user's contacts in three groups:
  1. **Can invite**: `linked_user_id` is null and the contact has an email or phone. Each row has
     **Email** (when an email exists) and **Text** (phone, native only). A row already invited by email
     shows an **Invited** pill instead of the Email button. A row texted this session shows **Texted**.
  2. **Already on Chatsoon**: `linked_user_id` set. No actions.
  3. **Add details to invite**: no email and no phone. Greyed, tapping opens the contact's edit screen.
- Select-all for email: a checkbox per row in group 1 with an email, and a **Send N invites** button.
  Cap shown as "20 invites per day".
- **Text** opens the SMS composer (`expo-sms`, `SMS.sendSMSAsync([phone], message)`) prefilled:
  `Hi <first name>, I'm using Chatsoon to keep track of people I meet. Set up your profile here:
  https://chatsoon.app/r/<CODE>`. We only know the composer was opened, never that it was sent, so this
  is recorded locally for the pill and nothing else.
- An **Invite by email** field at the top for an address that isn't a contact yet.

**Landing page** (`chatsoon.app/r/<CODE>`, web, anonymous)
- Server-rendered like `/id/<slug>`: inviter's avatar, "<Display name> invited you to Chatsoon", the
  tagline, then **App Store**, **Google Play** and **Continue on web** buttons.
- "Your invite code is <CODE>. Enter it when you sign up." with a copy button, because a store install
  can't carry the code through.
- Sets the attribution cookie and localStorage (below). Unknown or disabled code: a plain 404 page with
  the normal store buttons, no cookie.
- `/id/<slug>?ref=<CODE>` behaves as today plus the same cookie/localStorage write.

**Emails**
- **Invite** (to the invitee, from `EMAIL_FROM`, reply-to unset): subject "<Display name> invited you to
  Chatsoon". Body: inviter's name, headline and company, two lines on what Chatsoon is, one button to
  `/r/<CODE>`, then "You were sent this because <name> entered your address in Chatsoon. We won't email
  you again unless you sign up." and a one-click unsubscribe link. Plain text and HTML, RFC 8058
  `List-Unsubscribe` headers, same as tips emails. No follow-ups, ever.
- **Qualified** (to the referrer, tips-email gated via `email_prefs.tips_opt_out_at`): "<Name> just
  qualified as your referral. N of 10 to Founding member" (or "to Early adopter", or "N of 20 to your
  reward"). Sent from the qualification sweep, one per referral, skipped on the two milestone referrals
  below.
- **Milestone badge** (to the referrer, always sent, it's transactional): sent once when the 10th
  qualifies. Either "You're Chatsoon Founding member #37" or "You're a Chatsoon Early adopter", with the
  badge, date and what it shows on their profile.
- **Claim ready** (to the referrer, always sent, it's transactional): sent once when the 20th qualifies.

## How attribution works

The code travels three ways and lands in one endpoint, `POST /me/referral/attribute { code }`.

1. **App installed, link tapped**: universal link / app link opens the app at `/r/<CODE>` (new mobile
   route) or `/id/<slug>?ref=<CODE>`. The route stores the code in `storage.ts` under `pendingReferralCode`
   with a captured-at timestamp, then continues to the profile page or sign-in as it does today.
2. **Web**: `/r/<CODE>` and `/id/<slug>?ref=` write cookie `cs_ref=<CODE>` (`Path=/`, `SameSite=Lax`,
   `Secure`, 30 days) and `localStorage.cs_ref`. The signed-in web app reads localStorage at onboarding.
3. **Typed**: the onboarding field or the hub's "Enter a code" row.

Whatever the source, the client calls `POST /me/referral/attribute` once, right after onboarding saves the
profile (or immediately from "Enter a code"), then clears the stored code. Server rules, in order:
- `REFERRAL_ENABLED` is true.
- Caller has no `referrals` row as `referred_user_id`. One attribution per user, first one wins.
- Caller's `users.created_at` is within `REFERRAL_ATTRIBUTION_DAYS` (14). Older accounts get
  `referral_window_closed`.
- Code exists, its owner isn't the caller (`referral_self`), isn't in `BANNED_EMAILS`, and has no
  `account_deletions` row.
- Device dedupe: the caller's `X-Chatsoon-Device` id must not appear on any other `referrals` row (any
  referrer). Match: insert the row with `status = 'rejected'`, `reason = 'device_dup'`. The response is
  still `{ attributed: true }` and the referrer sees it as pending: a farmer must learn nothing from the
  API. It sits there until the sweep voids it.
- Otherwise insert `status = 'pending'`, `qualifies_after = now + REFERRAL_HOLD_DAYS`. Nothing looks at
  `ip_hash` or `ua_hash` on the way in. They exist so ops can run one query later ("referrals for user X
  grouped by ip_hash") and, if something is plainly a farm, set `status = 'flagged'` on those rows with
  `wrangler d1 execute` (like `search_blocked`). Flagged rows never qualify until `flag_cleared_at` is
  set. The social account requirement is the real identity check; a farmer needs a fresh Google, Apple,
  LinkedIn or Discord account per fake signup.
- Any accepted attribution (pending or rejected, same reason as above) inserts one
  `points_ledger` row for the referred user: `amount = REFERRAL_POINTS_FOR_JOINING` (1),
  `event = 'referral_joined'`, `ref_id = referral id`. Never reversed; it's one point and points don't
  spend.

`X-Chatsoon-Device` is a random UUID generated once per install (`expo-secure-store` on native,
`localStorage` on web), sent by `src/lib/api.ts` on every request. Only `POST /me/referral/attribute`
reads it. `ip_hash` and `ua_hash` are `hmacHex(REFERRAL_HASH_SECRET, value)`, never the raw values.

## Qualification and fraud rules

`runReferralQualification(env, db)` in `apps/api/src/lib/referrals.ts`, called from `scheduled` in
`index.ts` each 10 minute tick after `runEmailSequences`, same per-row try/catch shape. Per run, up to
200 rows where `status = 'pending'` and `qualifies_after <= now`:
- Load the referred user. Missing (deleted, cascade removed the row anyway), `account_deletions` row
  present, or email in `BANNED_EMAILS`: set `status = 'void'`, `reason = 'account_gone'`.
- A `rejected` row past `REFERRAL_MAX_PENDING_DAYS` becomes `void` (keeps `reason`), so the referrer's
  list eventually shows "Didn't qualify" instead of pending forever. Select `status IN ('pending',
  'rejected')` for this run.
- `email_verified` false, no `profiles` row, or no eligible social account (`hasEligibleSocial(db, env,
  userId)`, below): leave pending, bump `qualifies_after` by 1 day, and after `REFERRAL_MAX_PENDING_DAYS`
  (60) since attribution set `status = 'void'`, `reason = 'never_qualified'`.

`hasEligibleSocial` in `lib/referrals.ts`: true if `accounts` has a row for the user with `provider_id`
in `google`, `apple` or `linkedin`; or a `discord` row whose `social_checks` record (below) passes
`discordEligible(...)`; or a `twitter` row whose record passes `xEligible(...)`. Both helpers live in
`packages/shared/src/social.ts`:
```ts
/** Discord ids are snowflakes: ms since the Discord epoch (2015-01-01) in the top 42 bits. */
export const DISCORD_EPOCH_MS = 1420070400000;
export const discordCreatedAt = (id: string) => Number(BigInt(id) >> 22n) + DISCORD_EPOCH_MS;
export function discordEligible(check: { providerAccountId: string; mfaEnabled: boolean }, minAgeDays: number, now = Date.now()) {
  return check.mfaEnabled && discordCreatedAt(check.providerAccountId) <= now - minAgeDays * 86_400_000;
}
/** X: verified (any verified_type but 'none') or ID verified, and a follower floor. */
export function xEligible(check: { verified: boolean; identityVerified: boolean; followersCount: number }, minFollowers: number) {
  return (check.verified || check.identityVerified) && check.followersCount >= minFollowers;
}
```
Discord age is computed live from the id, so it needs no refresh. 2FA, X verification and the follower
count are whatever the provider reported the last time the account was linked, and Reconnect refreshes
them. Never re-read X from the sweep: every X profile read is billed.
- Otherwise: `status = 'qualified'`, `qualified_at = now`, insert a `points_ledger` row
  (`amount = REFERRAL_POINTS_PER_REFERRAL`, `event = 'referral_qualified'`, `ref_id = referral id`), send
  the Qualified email. Then count the referrer's qualified rows: at exactly `REFERRAL_FOUNDER_THRESHOLD`
  award the milestone badge (below) and send the Milestone badge email instead of Qualified; at exactly
  `REFERRAL_CLAIM_THRESHOLD` send Claim ready instead. If the thresholds are ever lowered, a referrer
  already past them gets the badge on their next qualified referral, which is fine.

Awarding the milestone badge, `awardMilestoneBadge(db, env, userId, referralId)` in `lib/referrals.ts`:
skip if the user already has `founder` or `early_adopter`. Otherwise try the founder insert as one
statement so the cap is atomic (D1 is single-writer, and the unique index on `(badge, seq)` is the
backstop):
```sql
INSERT INTO badges (user_id, badge, seq, ref_id, awarded_at)
SELECT ?, 'founder', (SELECT COUNT(*) + 1 FROM badges WHERE badge = 'founder'), ?, ?
WHERE (SELECT COUNT(*) FROM badges WHERE badge = 'founder') < ?;   -- REFERRAL_FOUNDER_CAP
```
If that changed no rows (cap reached, or the unique index rejected a race), insert `early_adopter` with
`seq` null. Return which badge was awarded and its `seq` so the email and the response can say so.

Points are credited exactly once per referral: `points_ledger` has a unique index on `(event, ref_id)`.

## Points

`points_ledger` is append-only. Balance is `SUM(amount)` per user (`GET /me/referral` returns it; a
cached column can come later if it's ever hot). `event` is a string enum in `packages/shared`:
`'referral_qualified' | 'referral_joined' | 'adjustment'`. `adjustment` is ops-only (`wrangler d1 execute`) for corrections,
with `note` required. Nothing spends points in this change.

## Data (`apps/api/src/db/schema.ts`)

Add to `profiles`:
```ts
/** 8 chars, Crockford base32 (no 0/O/1/I), uppercase. Created lazily on first GET /me/referral. Never changes. */
referralCode: text('referral_code'),
```
with `uniqueIndex('profiles_referral_code_idx').on(t.referralCode)`.

New tables (every private row carries a user id and every query is scoped by it, per CLAUDE.md):
```ts
export const referrals = sqliteTable('referrals', {
  id: text('id').primaryKey(),
  referrerId: text('referrer_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  referredUserId: text('referred_user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  /** 'pending' | 'qualified' | 'rejected' | 'flagged' | 'void' */
  status: text('status').notNull().default('pending'),
  /** 'device_dup' | 'account_gone' | 'never_qualified' | 'ops_flag' | null */
  reason: text('reason'),
  /** 'link' | 'typed' | 'web' as reported by the client. Informational. */
  source: text('source').notNull().default('typed'),
  deviceId: text('device_id'),
  ipHash: text('ip_hash'),
  uaHash: text('ua_hash'),
  qualifiesAfter: integer('qualifies_after', { mode: 'timestamp_ms' }),
  qualifiedAt: integer('qualified_at', { mode: 'timestamp_ms' }),
  /** Ops only. 'flagged' is only ever set by hand (reason 'ops_flag'); set this to let the row qualify again. */
  flagClearedAt: integer('flag_cleared_at', { mode: 'timestamp_ms' }),
  createdAt: createdAt(),
}, (t) => [
  uniqueIndex('referrals_referred_idx').on(t.referredUserId),
  index('referrals_referrer_status_idx').on(t.referrerId, t.status),
  index('referrals_qualifies_idx').on(t.status, t.qualifiesAfter),
  index('referrals_device_idx').on(t.deviceId),
]);

export const pointsLedger = sqliteTable('points_ledger', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  amount: integer('amount').notNull(),
  /** PointsEvent */
  event: text('event').notNull(),
  /** The row this entry is about (a referral id for 'referral_qualified'). */
  refId: text('ref_id'),
  note: text('note'),
  createdAt: createdAt(),
}, (t) => [
  index('points_ledger_user_idx').on(t.userId, t.createdAt),
  uniqueIndex('points_ledger_event_ref_idx').on(t.event, t.refId),
]);

/** Permanent account badges. Never deleted except with the account; ops never revoke. */
export const badges = sqliteTable('badges', {
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  /** Badge: 'founder' | 'early_adopter' */
  badge: text('badge').notNull(),
  /** Founder number, 1..REFERRAL_FOUNDER_CAP. Null for other badges. */
  seq: integer('seq'),
  awardedAt: integer('awarded_at', { mode: 'timestamp_ms' }).notNull().default(now),
  /** What earned it: the 10th referral's id. */
  refId: text('ref_id'),
}, (t) => [
  primaryKey({ columns: [t.userId, t.badge] }),
  uniqueIndex('badges_badge_seq_idx').on(t.badge, t.seq),
]);

export const referralInvites = sqliteTable('referral_invites', {
  id: text('id').primaryKey(),
  referrerId: text('referrer_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  /** Always lowercased. */
  email: text('email').notNull(),
  sentAt: integer('sent_at', { mode: 'timestamp_ms' }).notNull().default(now),
  /** Set by the one-click link. Suppresses every future invite to this address from anyone. */
  unsubscribedAt: integer('unsubscribed_at', { mode: 'timestamp_ms' }),
  /** Set by the qualification sweep when an account with this email is attributed to this referrer. */
  convertedAt: integer('converted_at', { mode: 'timestamp_ms' }),
}, (t) => [
  uniqueIndex('referral_invites_pair_idx').on(t.referrerId, t.email),
  index('referral_invites_email_idx').on(t.email),
]);

export const referralClaims = sqliteTable('referral_claims', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  /** The qualified-referral count this claim is for (20 today). One claim per user per milestone. */
  milestone: integer('milestone').notNull(),
  /** SHA-256 hex of the base64url token in the URL. The token itself is never stored. Rotated on re-issue. */
  tokenHash: text('token_hash').notNull(),
  tokenExpiresAt: integer('token_expires_at', { mode: 'timestamp_ms' }).notNull(),
  /** The destination the token was issued for, captured at issue time. */
  destination: text('destination').notNull(),
  /** Consent trail for sharing name + email with the partner: timestamp and the exact checkbox wording. */
  shareConsentAt: integer('share_consent_at', { mode: 'timestamp_ms' }).notNull(),
  shareConsentText: text('share_consent_text').notNull(),
  /** 'issued' | 'redeemed' */
  status: text('status').notNull().default('issued'),
  redeemedAt: integer('redeemed_at', { mode: 'timestamp_ms' }),
  createdAt: createdAt(),
}, (t) => [
  uniqueIndex('referral_claims_user_milestone_idx').on(t.userId, t.milestone),
  uniqueIndex('referral_claims_token_idx').on(t.tokenHash),
]);
```

One migration via `pnpm --filter @chatsoon/api db:generate`. No data backfill: codes are created lazily.

Account deletion (`lib/deletion.ts`): cascades cover everything. Add `referral_invites` rows where
`email` equals the deleted account's email to the deletion (the invitee is now gone too). The CSV export
(`GET /me/export.csv`) is contacts only and doesn't change.

## API (`apps/api/src/routes/referrals.ts`)

Signed-in (bearer), all under `/me/referral`:
- `GET /me/referral` → `{ code, link, founderThreshold, claimThreshold, founderSpotsLeft, milestoneBadge:
  { badge, seq?, awardedAt } | null, qualifiedCount, pendingCount, pointsBalance, hasSocial, canClaim,
  claim: { status, milestone, url? , expiresAt? } | null, attribution: { referrerName, referrerSlug,
  status, checklist: { profile, social, holdUntil } } | null, canEnterCode, referrals: [{ id, status,
  displayName?, slug?, avatarUrl?, createdAt, qualifiesAfter?, qualifiedAt?, outstanding?: 'profile' |
  'social' | 'hold' }] }`. `canClaim` is false without a social account even at threshold. Creates `referral_code` if null. `status` on the wire is the
  user-facing one: `rejected` and `flagged` both read as `pending` to the referrer (a farmer learns
  nothing), `void` reads as `didnt_qualify`. `link` is `${WEB_ORIGIN}/r/${code}`.
- `POST /me/referral/attribute { code, source }` → `{ attributed: boolean }`. Rules above. Errors:
  `referral_self`, `referral_window_closed`, `referral_already_attributed`, `not_found` for an unknown
  code. Rate limit: `REFERRAL_ATTRIBUTE_LIMITER`, 10 per minute per IP (code guessing).
- `POST /me/referral/invites { emails: string[] }` (1 to 20) → `{ sent: number, skipped: number }`.
  Per address: lowercase; skip if any `referral_invites` row for it has `unsubscribed_at`; skip if this
  referrer already invited it; skip if a `users` row exists with this email (don't say which: skipped is
  one number); skip if 3 or more invites from anyone in the last 90 days. Daily cap via `usage_counters`
  key `refinvite:user:<id>:<day>` against `REFERRAL_INVITE_DAILY_PER_USER` (20), error
  `referral_invite_limit`. Sends happen in `waitUntil` like the connect email. Rate limit:
  `WRITE_LIMITER`.
- `POST /me/referral/claims { shareConsent: true, consentText }` → `{ url, expiresAt }`. Requires
  `qualifiedCount >= claimThreshold`, `hasSocial` (else `referral_claim_needs_social`), referrer not banned,
  no `account_deletions` row. If a claim row for this
  milestone exists and is `redeemed`, error `referral_already_claimed`. If it exists and is `issued`
  with a live token, error `referral_claim_open` with the same `url` so the client can just open it.
  If it exists and the token expired, rotate: new token, new hash, new expiry, same row. Token: 32
  random bytes base64url, `token_expires_at = now + 30 days`. URL: `${REFERRAL_CLAIM_URL}?token=<token>`.
  Rate limit: `WRITE_LIMITER`.

Public profiles: `toPublicProfile` in `lib/profiles.ts` and `GET /me` gain `badges: { badge: Badge, seq?:
number }[]` (`[{ badge: 'founder', seq: 37 }]`, `[{ badge: 'early_adopter' }]` or `[]`), read from
`badges`. It goes wherever the profile DTO goes today, including `/_pages/profile/:slug` for the web
render and the OG card if there's room for a small "Founding member" line on it.

Anonymous:
- `GET /referral/:code` → `{ displayName, slug, avatarUrl?, headline? }` of the code owner, for the
  mobile `/r/[code]` route. Same not-found handling and `PROFILE_MISS_LIMITER` as `/id/:slug`.
  Hidden when the owner has an `account_deletions` row.
- `GET /_pages/referral/:code` → the same, secret-gated with `PAGES_SHARED_SECRET` for the web landing
  page (mirror `/_pages/profile/:slug`).
- `GET/POST /email/unsubscribe` gains kind `invite`, token is `hmacHex` of the invitee email with the
  existing secret, sets `referral_invites.unsubscribed_at` on every row for that address.

Account linking (`lib/auth.ts`): enable Better Auth account linking for a signed-in user
(`account.accountLinking` in the config; check the exact option names and `linkSocial` behaviour in
`node_modules/better-auth` for the installed version before writing anything). Rules: link only to the
signed-in user, never auto-merge into another account with the same email, and require the provider's
email to be verified where the provider reports it. Emails do not have to match: a signed-in user
connecting a LinkedIn on their work address or an Apple relay address is the normal case, not a red flag,
so set `allowDifferentEmails: true` (the session already proves who they are). Keep automatic linking at
sign-in (someone signs in with a social whose email matches an existing user) limited to
`trustedProviders` that verify emails: `google`, `apple`, `linkedin`, `discord`, never `twitter`. Confirm
in the installed version which of these two flows each option governs. On the sign-in screen, under the
social buttons: "Already have an account? Sign in with the email you used, then add socials from Me >
Connected accounts", so a social on a different address doesn't create a duplicate person. Add `GET /me/connected-accounts` →
`[{ provider, connectedAt, label?, eligible, reason?: 'discord_age' | 'discord_mfa' | 'x_not_verified' |
'x_followers' }]` (label is the Discord username, the X handle or the provider email, never a token). Apple on native goes through the same native
flow the Apple sign-in uses today. Unlinking is not in this change (Better Auth supports it; add later if
anyone asks).

Capturing the checks: on every Discord or X sign-in or link, write one row to `social_checks` from the
provider profile. `mapProfileToUser` in `lib/auth.ts` already sees the Discord profile for
`discordUsername`; check in the installed Better Auth whether it also runs on `linkSocial`, and if not
use the account-create or account-update database hook so a Reconnect refreshes the row. Better Auth's
Discord scopes are `identify email` by default, which is all `mfa_enabled` needs. Schema:
```ts
export const socialChecks = sqliteTable('social_checks', {
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  /** 'discord' | 'twitter'. Google, Apple and LinkedIn are eligible without a check. */
  provider: text('provider').notNull(),
  providerAccountId: text('provider_account_id').notNull(),
  /** Discord mfa_enabled. Always false for other providers. */
  mfaEnabled: integer('mfa_enabled', { mode: 'boolean' }).notNull().default(false),
  /** X: verified && verified_type !== 'none'. */
  verified: integer('verified', { mode: 'boolean' }).notNull().default(false),
  /** X is_identity_verified. */
  identityVerified: integer('identity_verified', { mode: 'boolean' }).notNull().default(false),
  /** X public_metrics.followers_count. */
  followersCount: integer('followers_count').notNull().default(0),
  checkedAt: integer('checked_at', { mode: 'timestamp_ms' }).notNull().default(now),
}, (t) => [primaryKey({ columns: [t.userId, t.provider] })]);
```

Adding X (`lib/auth.ts`): enable Better Auth's `twitter` provider (OAuth 2.0 with PKCE) with
`TWITTER_CLIENT_ID` and `TWITTER_CLIENT_SECRET`, optional like the others so `GET /auth-providers` and
the sign-in screen pick it up. X's `users.read` scope requires `tweet.read` alongside it; add `email` only
if we ever want `confirmed_email`, we don't today. Better Auth's default X profile fetch asks for a
minimal `user.fields`, so override `getUserInfo` (or wrap it) to request
`user.fields=username,name,profile_image_url,verified,verified_type,is_identity_verified,public_metrics`
from `https://api.x.com/2/users/me` and map: `verified = data.verified && data.verified_type !== 'none'`,
`identityVerified = data.is_identity_verified === true`, `followersCount = data.public_metrics.followers_count`.
Check the field names against https://docs.x.com/x-api/users/get-my-user before relying on them; X
renames things. The X app needs a Developer Console project with a credit balance and a spending limit
set, and `https://api.chatsoon.app/auth/callback/twitter` (confirm the exact path Better Auth uses in the
installed version) registered as a callback URL. Treat a 402 or credit error from X as `link failed, try
again later`, never as ineligible.

Partner (bearer `REFERRAL_PARTNER_SECRET`, `timingSafeEqual`, 401 otherwise; `REPORT_LIMITER` shape,
20 per minute per IP):
- `GET /referral/claims/verify?token=` → `{ valid: true, milestone, status, issuedAt, expiresAt, user:
  { id, displayName, email } }` or `{ valid: false, reason: 'unknown' | 'expired' | 'redeemed' }`.
  Look up by `sha256(token)`. `email` is included only because the user ticked the consent box, which
  is required to issue a claim at all.
- `POST /referral/claims/redeem { token }` → `{ ok: true, redeemedAt }`. Idempotent: a second call
  returns the same `redeemedAt`. Expired token: `referral_claim_expired`.

Every referrer-facing value is scoped by the caller's user id. `referred_user_id` lookups for display
names go through `lib/profiles.ts` so blocks and deletions are honoured the same way as everywhere else.

## Partner side (bounties.learncardano.io, separate repo)

Not in this change, but the contract above is all it needs:
1. A `/claim/chatsoon` page that reads `?token=`, calls `GET /referral/claims/verify` with the shared
   secret, and shows the reward with the user's display name.
2. The user completes whatever the bounties platform requires (sign in, wallet address).
3. On completion the platform calls `POST /referral/claims/redeem`. It should treat a token as spent
   after its own record is written, so a page refresh can't double-pay.
Whether the bounties platform has an API of its own doesn't matter for this contract: it only needs to
make two HTTPS calls to `api.chatsoon.app`.

## Mobile files (`apps/mobile`)

- `src/app/(app)/referrals/index.tsx`, `src/app/(app)/referrals/invite.tsx`: the hub and the picker.
- `src/app/r/[code].tsx`: universal link target. Stores the code (`storage.ts`), then `router.replace`
  to `/id/<slug>` if signed in and outside the attribution window, else to `/sign-in`. Loads inviter via
  `GET /referral/:code` for the sign-in screen's "Invited by <name>" line.
- `src/app/id/[slug].tsx`: read `ref` from `useLocalSearchParams`, store it, render as today.
- `src/app/onboarding.tsx`: the optional code field, calls `attribute` after the profile save succeeds.
- `src/app/(app)/(tabs)/me.tsx`: the Invite friends section. `qr.tsx`: `?ref=` on the QR payload and
  the text link. Check `src/app/(app)/scan.tsx` and `scanConnectSchema` still parse a profile URL with
  a query string; printed QR codes without `?ref` keep working.
- `src/lib/api.ts`: `X-Chatsoon-Device` header; `referrals` client functions. `src/lib/queries.ts`:
  `useReferral()`, `useAttributeReferral()`, `useSendInvites()`, `useClaimReferral()`,
  `useConnectedAccounts()`, `useLinkSocial(provider)`.
- `src/app/(app)/connected-accounts.tsx`: the linking screen. `me.tsx` Account section gains a "Connected
  accounts" row above Sign out. `contacts.tsx`: the one-time banner (dismissal flag in `storage.ts`).
- `src/components/ProfileCard` (and wherever the display name is rendered on `/id/[slug].tsx` and the Me
  tab): the **Founding member** or **Early adopter** pill from `badges`. This is a visible change to
  `ProfileCard`, so per CLAUDE.md the server render in `apps/web/src/render/profile.ts` gets the matching
  markup and `docs/profile-page-dom.md` is updated in the same PR.
- `src/lib/storage.ts`: `pendingReferralCode`, `deviceId`, `textedContactIds` (session only is fine).
- `packages/shared`: `attributeReferralSchema` (code: 8 chars, uppercase, Crockford alphabet, trimmed and
  uppercased on parse), `inviteEmailsSchema`, `claimReferralSchema`, `PointsEvent`, `ReferralStatus`,
  `Badge` (`'founder' | 'early_adopter'`), `BADGE_LABELS` (`founder: 'Founding member'`, `early_adopter:
  'Early adopter'`, the one place to rename), `SOCIAL_VALIDATION_PROVIDERS`, `discordCreatedAt`, `discordEligible` (`src/social.ts`, plain string
  and BigInt helpers, no `URL` class; `apps/web` imports the module path directly),
  the `Referral*` DTO types, `referralLink(code)`, `inviteMessage(firstName, link)`.
- Packages: `npx expo install expo-sms expo-secure-store expo-web-browser` from `apps/mobile`. Check
  each against Expo SDK 57 types before use, per CLAUDE.md. `expo-sms` `isAvailableAsync()` gates the
  Text button; it is always false on web.
- Colours via `useTheme()`, dialogs via `showAlert`/`confirm`, as always.
- `app.json`: Android intent filter gains a second `data` entry with `pathPrefix: "/r/"`. iOS
  `applinks:chatsoon.app` already covers the domain. The link files themselves are in the next section.
  Either way this needs a new native build and store submission.

## Universal links (iOS) and app links (Android)

Referral links only open the app if `chatsoon.app` serves the two association files. `app.json` already
declares `applinks:chatsoon.app` and an `autoVerify` intent filter, but at the time of writing no
`apple-app-site-association` or `assetlinks.json` was found in `apps/web`, so the links are probably not
live. **Check first, then build if missing. Don't skip this: without it the `/r/<code>` route in the app
never runs and every referral falls back to typing the code.**

**Check** (do both, the repo and the live site can disagree):
- `curl -sI https://chatsoon.app/.well-known/apple-app-site-association` and
  `curl -sI https://chatsoon.app/.well-known/assetlinks.json`. Both must be `200`, `content-type:
  application/json`, served directly with no redirect (Apple refuses redirects). Then `curl -s` each and
  read the body.
- Search `apps/web` for the files, a `_headers` rule for `/.well-known/*`, and anything in
  `scripts/build.ts` that copies them. Check the Pages `_routes.json` doesn't route `/.well-known/*` to a
  Function.

**If either is missing, build it as part of PR 3 before the landing page**, following
https://docs.expo.dev/linking/ios-universal-links/ and https://docs.expo.dev/linking/android-app-links/:
- `apps/web/public/.well-known/apple-app-site-association` (no extension). Contents:
  `{ "applinks": { "details": [ { "appIDs": ["<TEAM_ID>.app.chatsoon"], "components": [ { "/": "/id/*" },
  { "/": "/r/*" } ] } ] } }`. Ask Peter for the Apple Team ID (Apple Developer account, Membership
  details); never guess it. Exclude `/privacy`, `/terms`, `/support` and `/` by leaving them out: only
  listed paths open the app.
- `apps/web/public/.well-known/assetlinks.json`. Contents: one entry with `"relation":
  ["delegate_permission/common.handle_all_urls"]`, `"package_name": "app.chatsoon"` and
  `"sha256_cert_fingerprints"`. Ask Peter for the fingerprints: the Play App Signing key from Play
  Console (Setup, App signing) for store builds, plus the EAS build credential (`eas credentials`) if
  local builds should verify too. Both can be listed. Never guess them.
- Make sure the build copies `public/.well-known/` into `apps/web/dist` untouched (check how
  `scripts/build.ts` handles static assets; add the copy if it doesn't) and add a `_headers` rule:
  `/.well-known/apple-app-site-association` → `Content-Type: application/json` and the same for
  `assetlinks.json`. Cloudflare Pages serves extension-less files as `application/octet-stream` without it.
- Deploy web (`pnpm deploy:web`, a Production deployment) and re-run the two curls. Apple fetches the
  AASA through its CDN when the app is installed, so a wrong file can take a day to fix; get it right
  before the store build.

**Verify after the next native build**: on Android, `adb shell pm get-app-links app.chatsoon` shows
`chatsoon.app: verified`. On iOS, `curl https://app-site-association.cdn-apple.com/a/v1/chatsoon.app`
returns the file, and a fresh install opens `https://chatsoon.app/r/<CODE>` from Notes or Messages in
the app rather than Safari. Log the result on issue #11. If anything here is blocked on values only Peter
has, say so in the PR and carry on with the rest of PR 3; the landing page works in a browser without
the app either way.

## Web files (`apps/web`)

- `functions/r/[code].ts`: Pages Function (same pattern as the `/id/*` one) that fetches
  `/_pages/referral/:code` through the service binding, renders `src/render/referral.ts`, and sets the
  `cs_ref` cookie in the response. Add `/r/*` to `_routes.json` in `scripts/build.ts`.
- `src/render/referral.ts`: the landing page. Reuse `layout.ts`, `shell.ts`, the profile avatar
  rendering and the store badges from `home.ts`. `noindex`: these pages aren't for search engines.
- `src/client/referral.ts`: copies the code, writes `localStorage.cs_ref`. Also loaded on `/id/<slug>`
  when `?ref=` is present (write cookie and localStorage client-side there; the profile Function doesn't
  need to change its caching for a query string).
- OG: reuse the profile's card via the `OG` binding for the `/r/` page's `og:image` (the inviter's face
  is the point of the preview). Falls back to the default share image like everywhere else.
- `src/render/profile.ts`: the badge pill next to the name when the profile DTO carries one, labelled
  from `BADGE_LABELS`, matching the app's `ProfileCard` (contract in `docs/profile-page-dom.md`).

## Config (`apps/api/wrangler.jsonc`)

Vars:
```
"REFERRAL_ENABLED": "true",              // kill switch: attribute, invites and claims return referral_disabled; GET /me/referral still works
"REFERRAL_FOUNDER_THRESHOLD": "10",
"REFERRAL_FOUNDER_CAP": "100",
"REFERRAL_CLAIM_THRESHOLD": "20",
"REFERRAL_POINTS_PER_REFERRAL": "100",
"REFERRAL_POINTS_FOR_JOINING": "1",
"REFERRAL_DISCORD_MIN_AGE_DAYS": "90",
"REFERRAL_X_MIN_FOLLOWERS": "50",
"REFERRAL_HOLD_DAYS": "7",
"REFERRAL_ATTRIBUTION_DAYS": "14",
"REFERRAL_MAX_PENDING_DAYS": "60",
"REFERRAL_INVITE_DAILY_PER_USER": "20",
"REFERRAL_CLAIM_URL": "https://bounties.learncardano.io/claim/chatsoon"
```
Secrets: `REFERRAL_PARTNER_SECRET`, `REFERRAL_HASH_SECRET`. Rate limiter: `REFERRAL_ATTRIBUTE_LIMITER`
(namespace 1012, 10 per 60 s). `env.ts` gets the typed additions; `test/env.d.ts` and `test/setup.ts`
the test values.

## Tests (`apps/api/test/referrals.test.ts`)

- `GET /me/referral` creates a code once; two calls return the same code; the code is 8 Crockford chars.
- Attribute: happy path is pending with `qualifies_after` 7 days out and one `referral_joined` ledger row
  of 1 point for the referred user; self-referral, unknown code, second attribution, account older than
  14 days each fail with the named error and credit nothing; a repeat device id inserts `rejected` and
  still returns `attributed: true`; 100 signups from one IP hash for one referrer all insert `pending`; the
  referrer's list shows rejected rows as `pending`.
- Sweep: nothing before `qualifies_after`; unverified, profile-less or social-less user stays pending and
  moves `qualifies_after`; a user with only an email-OTP `accounts` row does not count, one with a
  `google` row does; a `discord` row counts only with a `social_checks` row where `mfa_enabled` is true
  and the id decodes to 90+ days old (one test each for young id, mfa off, and both good); a `twitter`
  row counts only with `verified` or `identity_verified` true and `followers_count >= 50` (one test each
  for unverified, verified with 10 followers, ID-verified with 50, verified with 50); void after 60 days;
  qualified inserts exactly one ledger row even when the sweep
  runs twice; the 10th qualification inserts the `founder` badge with `seq` 1 and sends the Milestone
  badge email (not Qualified), and running the sweep again never inserts a second badge; the 20th sends
  Claim ready; `GET /me` and `GET /id/:slug` carry `badges: [{ badge: 'founder', seq: 1 }]` after the
  10th and `[]` before; a row set to `flagged` by hand is skipped until `flag_cleared_at`.
- Founder cap: with `REFERRAL_FOUNDER_CAP` set to 3 in the test env, the first three users to hit 10 get
  `founder` with `seq` 1, 2, 3 and the fourth gets `early_adopter` with `seq` null; `founderSpotsLeft`
  counts down 3, 2, 1, 0; a duplicate `(badge, seq)` insert is rejected by the index and the code falls
  through to `early_adopter` rather than throwing.
- Invites: daily cap, unsubscribe suppression, existing-account skip counted but not named, the 90 day
  cross-referrer cap, the email carries List-Unsubscribe and the `/r/` link.
- Claims: refused under the claim threshold, including at 10 with the badge held; refused at 20 without
  a social account
  (`referral_claim_needs_social`), allowed after a `linkedin` row is added; issued once; `referral_claim_open` returns the same URL; expired token
  rotates; verify returns the user and consent-gated email; redeem is idempotent; wrong partner secret
  is 401; verify after redeem is `valid: false, reason: 'redeemed'`.
- Deletion: deleting the referrer removes referrals, claims, badges and invites; deleting the referred user
  removes their referral row and leaves the referrer's already-credited points alone.
- Pages: `GET /_pages/referral/:code` mirrors the profile page gating.
- Linking (`test/social-auth.test.ts`): a signed-in email user links Google and gets an `accounts` row on
  their own user id; linking a provider account whose email belongs to a different user is refused, not
  merged; a signed-in user links a LinkedIn whose email differs from their own and it attaches to them;
  `GET /me/connected-accounts` never returns tokens; a Discord link writes `social_checks` and
  relinking updates `mfa_enabled` and `checked_at`; `eligible` and `reason` come back right for young,
  no-2FA and good Discord accounts.
- Shared (`packages/shared`): `discordCreatedAt` decodes a known snowflake to the right date;
  `discordEligible` boundary at exactly 90 days; `xEligible` boundary at exactly `minFollowers`, and
  `verified_type: 'none'` never counts as verified.
- X provider (`test/social-auth.test.ts`): a mocked `users/me` with `verified_type: 'blue'` and 120
  followers writes `social_checks` with `verified` true; `is_identity_verified` alone also writes
  `identity_verified` true; a 402 from X fails the link with a retryable error and writes nothing.

Run `pnpm -r typecheck` and `pnpm test`. Migration drift check must pass in CI.

## Compliance

- **Privacy policy** (`/privacy`, both the web render and the app screen): new paragraphs for referral
  codes and who-invited-whom records, invite email addresses (held 12 months or until unsubscribed or
  converted, then deleted by the cron), the per-install device id and hashed IP/user agent used for
  fraud checks, and sharing name and email with the reward partner on the user's explicit consent. State
  that connecting a social account is used to confirm the account is held by a real person and that we
  store only the provider, its id and the email or username it returns (already true of social sign-in),
  plus, for Discord, whether two-factor authentication was on when it was connected, and for X, its
  verification status and follower count at the time.
- **Invite emails**: sent at the user's request to an address they supplied. Australian Spam Act 2003
  and CAN-SPAM both want a clear sender, the inviter's identity, a working unsubscribe and no repeat
  sends. That is why there are no follow-ups, why the inviter's name is in the subject, and why an
  unsubscribe suppresses the address globally. Do not add a sequence later without revisiting this.
- **App Store / Play**: describe the reward in-app as "points" and "a reward on Learn Cardano Bounties".
  Don't state ADA or dollar amounts inside the app. The reward is issued off-platform by a third party
  after the handoff, nothing is purchased, so IAP rules don't apply; keeping crypto amounts out of the
  binary avoids a review conversation. The claim flow opens the system browser, not a webview.
- **Nothing in this change touches the wallet.** CLAUDE.md scope stands.

## Release

1. API and web first, `REFERRAL_ENABLED: "false"`. Apply the migration remotely, set the two secrets,
   turn on Better Auth account linking, deploy `chatsoon-api`, deploy web with `/r/*` and the well-known
   files. X sign-in goes live only when `TWITTER_CLIENT_ID`/`TWITTER_CLIENT_SECRET` are set, so it can
   follow later without a code change once the X developer account has credits.
2. Flip `REFERRAL_ENABLED` on. Existing users get codes on first visit; nothing else changes for them.
3. Mobile build with the new routes, the intent filter and the packages. Submit to both stores.
4. Partner page on bounties.learncardano.io can ship any time after step 1; test with a manually issued
   claim (`wrangler d1 execute` to seed 20 qualified rows on a test account).
5. Log progress on issue #11.

## Later (not in this change)

- Android Play Install Referrer (`&referrer=ref%3DCODE` on the Play link) to attribute store installs
  without typing. iOS has no equivalent without a third-party SDK.
- More milestones (30, 50) or repeat claims: `referral_claims.milestone` and `badges` are already
  there for it.
- Spending points, leaderboards, points for connections or profile completeness: the ledger takes new
  `event` values without a schema change.
- An ops screen for the ip_hash review query and flagging rows, instead of `wrangler d1 execute`.
- Referrer-side reminder ("3 people signed up but haven't published yet") as a tips email, and a
  referred-side nudge ("connect a social account so <name>'s invite counts") as a third step of the
  new-account nudge sequence in `lib/sequences.ts`. The in-app checklist and banner cover launch.
- Unlinking a social account from Connected accounts.

## Open items for Peter

- Confirm `bounties.learncardano.io/claim/chatsoon` as the landing path, or give a different one.
- Confirm that returning the user's email to the partner on verify is what the bounties platform needs to
  pay out. If it can key on a wallet address the user enters there instead, drop `email` from verify and
  the consent box becomes "share my name".
- An X developer account on pay-per-use with credits loaded and a spending limit set, plus the app's
  client id and secret. Until then X simply doesn't appear as a provider.
- Whether 50 is the right follower floor (`REFERRAL_X_MIN_FOLLOWERS`). It's a default, not a decision.
- The Apple Team ID and the Play App Signing SHA-256 fingerprint(s), when Claude Code asks for them. It
  checks whether the link files are live and builds them if not (see Universal links above); those two
  values are the only part it can't do alone.

## Handing this to Claude Code

Save this file as `docs/referrals.md` in `D:\Claude\chatsoon-app`, then in Claude Code:

```
Read CLAUDE.md and docs/referrals.md. Implement docs/referrals.md for issue #11 in this order, one PR
each, squash-merged with ci-ok: (1) Better Auth account linking, the X (twitter) provider, social_checks
capture for Discord and X, GET /me/connected-accounts and tests; (2) schema, migration, lib/referrals.ts, routes/referrals.ts, config and tests; (3) apps/web:
first check whether chatsoon.app serves the apple-app-site-association and assetlinks.json files as the
"Universal links" section says, and if either is missing build and deploy them before the landing page
(ask me for the Apple Team ID and Play signing fingerprint, don't guess); then the /r/<code> landing
page and cookie; (4) mobile screens including Connected accounts, routes, onboarding field, device
header, app.json. Before writing any Expo code check the SDK 57 types in node_modules.
Follow every rule in CLAUDE.md (user_id scoping, ApiError, camelCase on the wire, useTheme, showAlert).
Where the doc and the code disagree, stop and ask before changing the doc. Don't touch wallet features.
```
