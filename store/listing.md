# Chatsoon 1.0: store listing

## Both stores

| Field | Value |
|---|---|
| App name | Chatsoon: Networking CRM (24 of 30) |
| iOS subtitle | Meet people. Follow up. (23 of 30) |
| iOS keywords | networking,business card,card scanner,crm,contacts,conference,event,qr code,follow up,leads,connect |
| iOS promotional text | Scan a card, share your QR, and let AI turn every hello into a relationship worth keeping. |
| Play short description | Share your QR, scan cards and follow up with everyone you meet at events. |
| Category | Business (secondary: Productivity) |
| Privacy policy URL | https://chatsoon.app/privacy |
| Support URL | https://chatsoon.app/support |
| Marketing URL | https://chatsoon.app |
| Copyright | 2026 Moshi Concepts Inc. |
| Icon | `apps/mobile/assets/images/icon.png` (1024x1024) |

### Description

Meet hundreds of people at a conference and remember every one of them.

Chatsoon is a networking CRM built for events. Share your profile with a QR code, capture the people you meet in seconds, and keep every conversation going long after the event ends.

SHARE YOUR PROFILE
Show your QR code. Anyone can scan it and connect with you, even if they don't have the app. Their details land straight in your contacts.

CAPTURE IN SECONDS
Snap a business card or event badge and Chatsoon fills in the details for you. Scan QR codes from Telegram, LinkedIn, X or a digital business card. Or type a name and move on.

ORGANISE EVERYONE
Tag people as sponsors, investors, advisors, collaborators or anything you like. Add notes, set priority, and group contacts by the event where you met.

FIND ANYONE FAST
Search by name, company, tag or notes. Tap to message on Telegram, email, LinkedIn or X.

PRIVATE BY DESIGN
Your notes and tags are yours alone. Connections only see your public profile. Export your data or delete your account anytime.

Meet people. Follow up. Chatsoon.

## Reviewer notes (App Store and Play)

Replace `[FIXED CODE]` with the `REVIEWER_CODE` secret you set on the Worker. Attach `store/reviewer-demo-qr.png`.

> Sign in with review@chatsoon.app: tap "Send code", then enter code [FIXED CODE]. The account has sample contacts. To test the connect flow, scan the attached QR image of a second test profile with the in-app scanner (Add tab > Scan a QR code, or My QR tab > Scan someone), or open https://chatsoon.app/id/alex-rivera-demo in a browser and submit the Connect form. Card scanning: Add tab > Photograph a card or badge, then photograph any business card. Account deletion is in the Me tab > Delete account. Report and block are on every connected profile (open a contact connected via Chatsoon, or any public profile).

## App Store Connect

**App Privacy (nutrition labels).** All items: *Linked to the user*, *Not used for tracking*.

| Data type | Collected | Purpose |
|---|---|---|
| Contact Info > Name | Yes (profile display name) | App Functionality |
| Contact Info > Email Address | Yes (sign-in) | App Functionality |
| Contact Info > Phone Number | Only if the user adds it to a contact | App Functionality |
| User Content > Photos or Videos | Yes (profile photo, card photos) | App Functionality |
| User Content > Other User Content | Yes (contacts, notes, tags, reports) | App Functionality |
| Identifiers > User ID | Yes | App Functionality |

Not collected: location, contacts (address book), browsing history, purchases, usage data, diagnostics, advertising data.

- Tracking: No.
- Age rating questionnaire: no objectionable content categories. Answer "yes" to user-generated content (public
  profiles, connect form) and note the report and block tools. Use whatever rating the questionnaire returns.
- Export compliance: `ITSAppUsesNonExemptEncryption` is `false` in app.json (standard HTTPS only).
- Sign in with Apple: not required (no third-party sign-in in 1.0).
- Screenshots: iPhone 6.9" (1320x2868) and 6.5" (1284x2778), see `store/screenshots/`.

## Google Play

**Data safety form**

- Data collected: Personal info (Name, Email address, Phone number*), Photos, Other user-generated content, App
  activity: none, Device or other IDs: none (user ID is account data).
- All data is encrypted in transit: Yes.
- Users can request deletion: Yes, in the app (Me > Delete account) and via hello@chatsoon.app.
- Data shared with third parties: No (processors acting on our behalf, such as Cloudflare, Anthropic and Resend,
  aren't "sharing" under Play's definition).
- Purpose for all: App functionality, Account management.

\* Only when the user adds it to a contact.

- Content rating: IARC questionnaire, and mark "users can interact / share content" (public profiles, connect form).
- Target audience: 18+.
- Ads: No.
- App access: provide the reviewer login above under "All or some functionality is restricted".
- **Closed testing requirement:** if the Play developer account is a personal account created after November 2023,
  upload to closed testing on 24 September and recruit 12 testers the same day. The 14 day clock ends around
  8 October, then apply for production. Until then Android users use https://chatsoon.app.
