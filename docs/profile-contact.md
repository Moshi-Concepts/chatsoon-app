# Phone and messaging (v1.1)

People can save your mobile number, WhatsApp and Signal details to their contacts when they connect with you or view your public profile. You choose who can see them: people you connect with, or anyone with your profile link.

## What the user sees

**Edit profile** (app and chatsoon.app): a **Phone and messaging** group between "About you" and "Links".
- Three fields: **Mobile number**, **WhatsApp** and **Signal**. Each accepts a phone number or a messaging link.
- Under WhatsApp and Signal, when the field is empty and the mobile number is valid, a text button **"Use +61 491 570 156"** copies the mobile number in.
- **Who can see these:** two Chips, "People I connect with" and "Anyone with my link". The caption explains which is chosen:
  - "Shown to Chatsoon users you connect with and to people who send you their details with the Connect form on your page."
  - "Shown to anyone who opens your profile link or scans your QR code."
- Inline errors appear under each field.
- The dirty check includes the three fields and the visibility.
- Save sends only the keys that changed.

**Public profile** (`/id/<slug>`, every mode: web visitor, signed in, signed out in the app, and your own profile as a preview): a **Contact** row above the link pills, hidden when there are no channels or when you've blocked the person.
- **Unlocked** (you can see their details):
  - **Call pill:** labelled with the number as typed, `tel:` in the same tab, accessibilityLabel "Call +61 491 570 156".
  - **WhatsApp pill:** opens `https://wa.me/` URL in a new tab.
  - **Signal pill:** opens `https://signal.me/` URL in a new tab.
- **Locked** (channels listed, but you can't see their details): dimmed, non-link chips with the channel labels and a lock icon, plus the caption "Connect with {first} to get their number."
- **Save contact** uses `profile.vcardUrl ?? api.profiles.vcardUrl(slug)`.
- **Own profile card** (on your own profile page): a caption states whether "Your number is shown only to people you connect with." or "Your number is shown to anyone with your link."

**Web Connect form**: the hint becomes "Email, phone, Telegram, X or LinkedIn. Only {first} will see it."
- When the response includes contact details, the success card adds "Here's how to reach {first}:", the same contact pills, and a Save contact button that uses `vcardUrl`.

**Contact detail**: Phone comes from `contact.phone`, falling back to the linked profile's phone. WhatsApp and Signal come from the linked profile's contact details and show as quick-action pills, placed after Call. Values that are numbers copy as shown. Link-only values copy the URL.

**Connecting copies:** the phone lands in `contacts.phone` as typed, only if it passes validation. The refresh fills an empty field only and never overwrites an edit.

## Supported channels and parsing (packages/shared/src/profile-contact.ts)

These are plain string helpers, with no `URL` class (React Native's polyfill is incomplete).

```ts
export type ProfileContactKey = 'phone' | 'whatsapp' | 'signal';
export type ProfileContact = Partial<Record<ProfileContactKey, string>>;
export type ContactVisibility = 'connections' | 'public';

export const CONTACT_KEYS = ['phone', 'whatsapp', 'signal'];
export const CONTACT_LABELS = { phone: 'Mobile', whatsapp: 'WhatsApp', signal: 'Signal' };
export const CONTACT_MAX = { phone: 40, whatsapp: 200, signal: 300 };
export const CONTACT_HINTS = {
  phone: 'Include your country code, like +61 491 570 156.',
  whatsapp: 'Enter your WhatsApp number with your country code, like +61 491 570 156, or paste your wa.me link.',
  signal: 'Enter your Signal number with your country code, or paste your Signal username link (signal.me/#eu/…).',
};

export function parseIntlPhone(v: string): string | null;
export function contactUrl(key: ProfileContactKey, v: string): string | null;
export function displayContact(key: ProfileContactKey, v: string): string | null;
export function profileContactChannels(contact: ProfileContact): ProfileContactKey[];
```

### Phone number parsing (`parseIntlPhone`)

1. Treat empty as null, apply `cleanText`, then `.normalize('NFKC')`. Reject anything over 64 characters.
2. Strip a leading `tel:` (any case), then remove every `(0)`.
3. Remove the characters `[\s().\- ​-‍⁠﻿]`.
4. The result must match `/^\+[1-9]\d{6,14}$/`. Return it as E.164.

Valid examples (all become `+61491570156` or the E.164 shown):
- `+61 491 570 156`, `(+61) 491 570 156`, `+61 (0) 491 570 156`, `+61-491.570.156`, `tel:+61491570156`
- `+1 415 555 0132` → `+14155550132`
- `+39 06 1234 5678` → `+390612345678`
- `+290 1234` (7 digits, the minimum)

Rejected:
- `''`, `0491 570 156`, `0061 491 570 156`, `000`, `+61 000`, `+0 123 4567`
- 16 digits or more
- `+61 491 570 156 ext 12`, `+1 800 FLOWERS`, `*21*+61491570156#`
- `++61…`, `+61 491 +570`, `+61/491570156`
- `javascript:alert(1)` and 65+ characters

Why these limits? International dialling prefixes differ by country, so `00` can't be mapped to `+` safely. The 7-digit minimum rejects `000` and `+61 000`, which fixes the emergency-number risk.

### WhatsApp link parsing (`contactUrl('whatsapp')`)

- A number → `https://wa.me/<digits without +>`
- `(https://)(www.)wa.me/(+)<digits>(/)(?…)` → digits are re-checked with `parseIntlPhone` and the query is dropped
- `(https://)(api|web|www).whatsapp.com/send(/)?…phone=<v>` → take the digits of `phone`, decode `%2B` and re-check
- `(https://)(www.)wa.me/(message|qr)/<[A-Za-z0-9]{4,64}>` → `https://wa.me/<kind lower-case>/<code>`
- Anything else is null: `chat.whatsapp.com`, `whatsapp.com/channel`, `wa.link`, `wa.me.evil.com`, `evilwa.me`, and anything with `@` or whitespace inside

Query strings like `?text=Hi` are dropped.

### Signal link parsing (`contactUrl('signal')`)

- A number → `https://signal.me/#p/<E164>`
- `sgnl://` is rewritten to `https://`
- `(https://)signal.me/#p/<v>` → decode, then `parseIntlPhone`
- `(https://)signal.me/#eu/<[A-Za-z0-9_-]{20,300}>` → `https://signal.me/#eu/<id>`
- Anything else is null: bare usernames, `signal.group`, `signal.art` and lookalike hosts

### Display format (`displayContact`)

Shows the value in a user-friendly way:
- Phone: as typed, without `tel:`
- WhatsApp or Signal with a typed number: as typed
- WhatsApp or Signal with a pasted link: as `+<digits>`
- `wa.me/message` and `wa.me/qr`: "WhatsApp link"
- `signal.me/#eu`: "Signal username link"

## Data and API

- `profiles.contact` is TEXT NOT NULL DEFAULT `'{}'`, holding a JSON object of `{ phone?, whatsapp?, signal? }` as typed.
- `profiles.contact_visibility` is TEXT NOT NULL DEFAULT `'connections'`, one of `'connections'` or `'public'`.
- The shared zod schema `contactInputSchema` validates each field:
  - Empty string becomes null.
  - Values up to `CONTACT_MAX[key]` characters.
  - Must pass `contactUrl(key, v) !== null` or be empty, with message `CONTACT_HINTS[key]`.
  - Unknown keys are stripped. Merging works per key: `undefined` keeps the value, `null` or `''` removes it.
- `profileInputSchema.contact = contactInputSchema.optional()`.
- `profileInputSchema.contactVisibility = z.enum(['connections', 'public']).optional()`.

### Endpoints

- **`GET /me`, `PUT /me/profile`:** return `contact` (raw), `contactVisibility` and `contactChannels`.
- **`GET /id/:slug`:**
  - `contactChannels` and `contactVisibility` are always present.
  - `contact` is added when: the viewer is the owner; visibility is `'public'`; or the viewer is signed in with an `accepted` connection and hasn't blocked the owner.
  - `vcardUrl` is added when `contact` is included and visibility is `'connections'`.
- **`GET /id/:slug/vcard[?exp&sig]`:**
  - Includes the contact when the signature is valid for this slug, or when visibility is `'public'`.
  - A valid signature gets `Cache-Control: private, no-store`. Otherwise the existing headers apply.
  - Always sends `X-Robots-Tag: noindex`.
- **`POST /id/:slug/connect`:** returns `{ ok: true, contact?, vcardUrl? }`.
  - `contact` is sent when the owner has at least one usable channel, whatever the visibility.
  - `vcardUrl` is sent when visibility is `'connections'`.
- **`POST /connections/scan`:** copies the phone, and returns 429 `rate_limited` on the 101st new connection of the day per user ("You've connected with a lot of people today. Try again tomorrow."). Scanning someone you're already connected with is never capped.

### vCard (`buildVCard`, `VCardProfile.contact?: ProfileContact`)

- Add `TEL;TYPE=CELL:<E164>` right after NOTE.
- After the X-SOCIALPROFILE lines, add `item<n>.URL:<wa.me…>` with `item<n>.X-ABLabel:WhatsApp`, then the Signal pair. Keep counting from the booking links' `item` counter; don't restart it.
- Only values that pass `contactUrl` are written.

### Signed vCard URL

`signedVcardUrl(env, slug, ttl = 3600)` returns a signed URL valid for 1 hour (rounded up to the hour). The signature is an HMAC over `vcard:${slug}:${exp}`. A bad or expired signature returns the plain card with no number, never an error.

## Visibility rules

- **Connections:** the owner, signed-in users with an `accepted` connection who haven't been blocked, and web Connect-form senders (they get the number in the success response).
- **Public:** anyone with the profile link or QR code. Signed vCard URLs are treated as public.

The rules follow the booking-links pattern: the server doesn't pre-render the contact pills, because the visibility changes over time (blocking, connecting). Pills are rendered client-side on `GET /id/:slug`.

## Compliance

- **Privacy policy** (`src/content/legal.json`): the policy explains what the user chooses to share and who can see it.
- **App Store and Play data safety forms** (`store/listing.md`): the contact details are declared as collected.
- **Robots tag:** `/id/:slug/vcard` always sends `X-Robots-Tag: noindex`, even when the profile is public (numbers could be indexed before `/id/*` is removed from the noindex list in #1).

## Release

- **Web (chatsoon.app) and API:** live as soon as they're deployed (additive migration).
- **iOS and Android:** need a new build, shipped as 1.1.0 after 1.0 is approved. Requires no new native modules.

## Known limits

- `+61 0491…` (a leftover trunk zero) is accepted but may not dial.
- A Signal `#p` link fails if the owner's "Who can find me by number" setting is Nobody.
- Copies already in other people's contacts, and signed vCard URLs for up to 1 hour, can't be taken back.
- The anonymous `contactChannels` shows that someone has WhatsApp or Signal. That's deliberate and low risk.
- The visibility is per-profile: there's no per-channel setting, so WhatsApp can't be public while Signal is private.

## Later (not in this change)

- A "Show number" reveal endpoint with Turnstile, when #1 makes profiles indexable.
- Drag to reorder contact details.
- Revisit the 100-a-day connection cap when #1 makes slugs findable without a link.
