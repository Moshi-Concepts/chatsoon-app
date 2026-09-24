# Booking links (v1.1)

People can book a meeting with a Chatsoon user from that user's public profile, without leaving the app or
the page. A user adds up to 5 booking links (Calendly, Google Calendar appointment pages and a few others),
each with its own label, e.g. "Crypto chat" and "30 min meeting".

## What the user sees

**Edit profile** (app and chatsoon.app): a **Booking links** group under Links.
- Each link has two fields: **Booking link** (URL) and **Label**. Up to 5 links, shown in the order they're listed.
- Pasting a link with an empty label fills in a suggested label: `calendly.com/chatwithpete/crypto-chat`
  becomes "Crypto chat", `.../30min` becomes "30 min". A link with no event (`calendly.com/chatwithpete`), a
  Google link and the other providers get "Book a meeting".
- A detected link shows its provider under the field ("Calendly"). An unsupported link shows the error below.
- Rows have **Move up** (not on the first) and **Remove**. **Add booking link** is hidden at 5 links.

**Public profile** (`/id/<slug>`, every mode: web visitor, signed in, signed out in the app, and your own
profile as a preview): a **Book a meeting** card right under the profile card. It has one row per link: a
calendar icon (Google and Microsoft use their logo), the label, the provider name and a chevron. It's hidden when
there are no links, and when `blockedByMe` is set.

**Contact detail**:
- Linked contacts (other Chatsoon users) show the same card, loaded live from their public profile
  (`usePublicProfile(contact.linkedSlug)`). Loading and errors show nothing, so offline is fine.
- For a contact without a linked user whose `website` parses as a booking link (a card or QR with a Calendly
  link on it), the card shows that one link.

**Tapping a row**:
- **Native (iOS/Android)**: a `Modal` sheet (`presentationStyle="pageSheet"` on iOS, full screen on Android)
  with a header (the label, "with <first name>" and the provider, a Close button and an "Open in browser"
  button) and a `react-native-webview` loading `bookingOpenUrl(link)` top-level. All providers work this way.
- **Web, embeddable provider** (Calendly, Google `appointments/schedules` links, HubSpot): the same modal
  overlay with an `<iframe src={bookingEmbedUrl(link)}>` filling it, plus "Open in new tab".
- **Web, anything else**: a plain link that opens in a new tab (`externalLinkProps(url, { newTab: true })`).

We checked the framing headers on 24 Sep 2026:
- Calendly sends `x-frame-options: ALLOWALL`.
- Google `appointments/schedules/<id>?gv=true` and HubSpot `?embed=true` send no framing header.
- A `calendar.app.google` short link can't be checked without a real one, so it opens in a new tab on web.

## Supported providers and parsing (packages/shared/src/booking.ts)

These are plain string helpers, following the rules in `links.ts`: no `URL` class, because React Native's
polyfill is incomplete. A link must be on a known booking host. We don't accept arbitrary URLs, so a booking
link can't be used for phishing.

```ts
export type BookingProvider =
  | 'calendly' | 'google' | 'calcom' | 'hubspot' | 'microsoft' | 'zoom' | 'savvycal' | 'tidycal';
export interface BookingLink { label: string; url: string; provider: BookingProvider }
export const MAX_BOOKING_LINKS = 5;
export const BOOKING_LABEL_MAX = 40;
export const BOOKING_URL_MAX = 500;
export const BOOKING_URL_HINT =
  'Use a booking link from Calendly, Google Calendar, Cal.com, HubSpot, Microsoft Bookings, Zoom, SavvyCal or TidyCal.';

/** Canonical https URL and provider, or null when it isn't a supported booking link. */
export function parseBookingUrl(value: string): { provider: BookingProvider; url: string } | null;
export function bookingProviderName(p: BookingProvider): string; // 'Calendly', 'Google Calendar', 'Cal.com', 'HubSpot', 'Microsoft Bookings', 'Zoom Scheduler', 'SavvyCal', 'TidyCal'
/** Label for a canonical booking URL: last path segment humanised, else 'Book a meeting'. */
export function suggestBookingLabel(url: string): string;
/** URL the app's WebView (and new tabs) load. Today this is the canonical URL. */
export function bookingOpenUrl(link: Pick<BookingLink, 'url' | 'provider'>): string;
/** iframe URL for the web page, or null when the provider isn't embeddable on the web. */
export function bookingEmbedUrl(link: Pick<BookingLink, 'url' | 'provider'>, embedDomain: string): string | null;
```

The parser works as follows.
- **Clean up:** `cleanText`, then reject values with inner whitespace or longer than `BOOKING_URL_MAX`.
- **Scheme:**
  - Allow no scheme, `https://` or `http://` (any case); the output is always `https://`.
  - Reject any other scheme (`javascript:`, `data:`, `mailto:`) and protocol-relative `//`.
- **Host:**
  - The authority runs up to the first `/`, `?` or `#`.
  - Reject it if it contains `@` (credentials) or `:` (a port).
  - Lowercase it and drop a leading `www.`.
  - Match hosts **exactly** (never by suffix), so `calendly.com.evil.com` and `evilcalendly.com` fail.
- **Path:**
  - Split on `/` and drop empty segments.
  - A segment may only contain `[A-Za-z0-9._~@+-]` and `%XX`.
  - Drop the query and fragment, except for Microsoft, which keeps a query made of `[A-Za-z0-9=&_.%-]` only.
  - No trailing slash.

| Provider | Hosts | Accepted paths | Canonical form |
|---|---|---|---|
| calendly | `calendly.com` | 1 to 3 segments, first not reserved\* | `https://calendly.com/<segments>` |
| google | `calendar.app.google` | exactly 1 segment `[A-Za-z0-9]+` | `https://calendar.app.google/<id>` |
| google | `calendar.google.com` | `calendar/[u/<n>/]appointments/schedules/<id>`, id `[A-Za-z0-9_-]+` | `https://calendar.google.com/calendar/appointments/schedules/<id>` (`/u/<n>` dropped) |
| calcom | `cal.com` | 1 to 3 segments, first not reserved\* | `https://cal.com/<segments>` |
| hubspot | `meetings.hubspot.com`, `meetings-<region>.hubspot.com` (e.g. `meetings-eu1`) | 1 or 2 segments | same host + segments |
| microsoft | `outlook.office365.com`, `outlook.office.com` | `book/<page>[/...]` (2 to 4 segments) or `bookwithme/user/<id>[/...]` (3 to 5 segments) | same host + path (+ query) |
| zoom | `scheduler.zoom.us` | 1 or 2 segments | same host + segments |
| savvycal | `savvycal.com` | 1 or 2 segments, first not reserved\* | same host + segments |
| tidycal | `tidycal.com` | 1 or 2 segments, first not reserved\* | same host + segments |

\* Reserved first segments are the product's own pages, not people. Compare them case-insensitively.
- **Calendly:** app, login, signup, pages, blog, resources, integrations, help, pricing, enterprise, event_types,
  dashboard, about, legal, privacy, terms, features, solutions, customers, careers, partners, apps, api, oauth,
  cookies, security, contact, sales.
- **Cal.com:** login, signup, auth, pricing, blog, docs, apps, enterprise, settings, bookings, event-types,
  availability, workflows, insights, api, embed, about, privacy, terms, security, careers, features.
- **SavvyCal and TidyCal:** login, signup, register, pricing, blog, features, about, privacy, terms, help, api,
  dashboard.

Both of Peter's links must come out like this:
- `https://calendly.com/chatwithpete/crypto-chat?back=1&month=2026-09` becomes
  `https://calendly.com/chatwithpete/crypto-chat` with the label "Crypto chat".
- `https://calendly.com/chatwithpete/30min?back=1&month=2026-09` becomes
  `https://calendly.com/chatwithpete/30min` with the label "30 min".

**Suggested label:** take the last path segment and decode it. Replace `-` and `_` with spaces, and put a space
between digits and letters (`30min` becomes `30 min`). Capitalise the first letter, lowercase nothing else, and
cap it at `BOOKING_LABEL_MAX`. Use "Book a meeting" instead in these cases:
- a single-segment Calendly, Cal.com, SavvyCal or TidyCal link, or any HubSpot or Zoom link with 1 segment (it's the user's page, not an event)
- any Google or Microsoft link
- a segment that looks like an opaque id (longer than 24 characters with no `-` or `_`)

**Embed URLs (web only):**
- Calendly: `<url>?embed_domain=<embedDomain>&embed_type=Inline`
- Google (the `calendar.google.com` form only): `<url>?gv=true`
- HubSpot: `<url>?embed=true`
- Everything else: `null`

**No prefill.** We deliberately don't pass the viewer's name or email to the provider. That would send personal
data to a third party before the person chooses to book, and the App Store privacy answers would need to change.

## Data and API

- `profiles.booking_links` is TEXT NOT NULL DEFAULT `'[]'`, holding a JSON array of `{ label, url }` in display
  order. Add it in migration `0005` (`pnpm --filter @chatsoon/api db:generate`).
- The shared zod schema `bookingLinksSchema` is an array of at most `MAX_BOOKING_LINKS` items.
  - Each item is `{ label?: string | null, url: string }`.
  - **url:** trimmed, 1 to `BOOKING_URL_MAX` characters, must pass `parseBookingUrl` (message `BOOKING_URL_HINT`)
    and the objectionable-language check. It's transformed to the canonical URL.
  - **label:** trimmed, at most `BOOKING_LABEL_MAX` characters, objectionable-language check. An empty or missing
    label becomes `suggestBookingLabel(url)`.
  - Duplicate canonical URLs are an issue at `[i, 'url']`: "You've added this booking link already".
- `profileInputSchema.bookingLinks = bookingLinksSchema.optional()`.
  - `undefined` keeps the current links.
  - An array replaces the list, and `[]` clears it.
- On the wire, `PublicProfile.bookingLinks: BookingLink[]` is always present, so `MyProfile` inherits it.
  - Serialising re-parses each stored URL, drops anything that no longer parses, adds `provider` and caps the list
    at `MAX_BOOKING_LINKS`.
  - It lives in `parseBookingLinks(json)` in `apps/api/src/lib/serialize.ts`.
- `PUT /me/profile` saves `bookingLinks`.
- The vCard (`GET /id/:slug/vcard`, `buildVCard`) adds one labelled URL per booking link after the profile URL:
  `itemN.URL:<url>` followed by `itemN.X-ABLabel:<label>`, numbered from `item2`.
- Contacts don't copy booking links when two users connect. The contact page reads them live from the profile,
  so new links show up for people who connected earlier.
- The account data export needs no change: the contacts CSV already links to the profile.

The change is backwards compatible. Build 1 (1.0.0) never sends `bookingLinks`, so its saves keep the links, and
it ignores the new response field.

## Mobile files

- `src/components/booking/`, all new:
  - `booking-links-card.tsx`
  - `booking-sheet.tsx`
  - `booking-embed.tsx` (native, uses `react-native-webview`)
  - `booking-embed.web.tsx` (iframe; the only file web bundles)
  - `index.ts`
- `src/app/id/[slug].tsx` shows the card under `ProfileCard`.
- `src/app/(app)/contact/[id]/index.tsx` shows the card for linked contacts and for booking-link websites.
- `src/components/profile/profile-form.tsx` gets the values, compare, parse and error mapping for `bookingLinks`,
  and renders `booking-links-editor.tsx` (new) inside the `withLinks` group.
- `react-native-webview` 13.16.1 is installed (`npx expo install`). It's a native module, so it needs a new EAS
  build; OTA won't do.

**WebView (native):**
- Set `setSupportMultipleWindows={false}`, so `target=_blank` links stay in the view.
- `onShouldStartLoadWithRequest`: allow `http(s)` and `about:`. Anything else (`mailto:`, `tel:`, `zoommtg:`,
  `intent:`) goes to `Linking.openURL` and returns false.
- Show a loading indicator until the first load ends.
- On an error, show "Couldn't load the booking page" with Try again and Open in browser.
- Set `allowsBackForwardNavigationGestures` on iOS.

**iframe (web):**
- Render `<iframe title="Booking calendar: <label>" src=... style={{ border: 0, width: '100%', height: '100%' }}>`.
- No `sandbox`, because providers need scripts, forms and popups.
- `_headers` has no CSP and only denies framing *of* chatsoon.app, so embedding third parties already works.

## Compliance

- **Privacy policy** (`src/content/legal.json`, "Your public profile" section):
  - Booking links you add are shown on your public profile.
  - Booking happens on that provider's page, under its own terms and privacy policy.
  - Chatsoon doesn't see or store the bookings.
  - Bump the `updated` date.
- The App Store privacy answers don't change. No new data type is collected: booking links are profile content the
  user types, and we send nothing to the providers.
- Content moderation: labels and URLs pass the objectionable-language check. URLs are limited to the known booking
  hosts, and reports already cover profiles.
- Store copy (`store/listing.md`):
  - Add 1.1 "What's New" text.
  - Add a description line.
  - Add a reviewer-notes line: "Edit profile → Booking links → paste https://calendly.com/chatwithpete/30min".

## Release

- **Web (chatsoon.app) and API:** live as soon as they're deployed (additive migration). People can add links on
  chatsoon.app and visitors can book straight away.
- **iOS and Android:** need a new build with `react-native-webview`, shipped as 1.1.0 after 1.0 is approved (or as
  a replacement build if 1.0 hasn't been submitted for review yet).

## Later (not in this change)

- Mark the booking as done using Calendly's `calendly.event_scheduled` postMessage, and offer a note on the contact.
- Resolve `calendar.app.google` short links on the server, so Google can embed on the web too.
- Drag to reorder.
