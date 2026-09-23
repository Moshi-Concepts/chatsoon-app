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

Replace `[FIXED CODE]` with the `REVIEWER_CODE` secret you set on the Worker. The code changes with each
submission: set a new one (`npx wrangler secret put REVIEWER_CODE` in `apps/api`) and paste the new code here before
you submit. Attach `store/reviewer-demo-qr.png`.

> Sign in with review@chatsoon.app: tap "Send code", then enter code [FIXED CODE]. The account has sample contacts. To test the connect flow in the app, scan the attached QR image of a second test profile (Alex Rivera) with the in-app scanner (Add tab > Scan a QR code, or My QR tab > Scan someone). To test the web Connect form that people without the app use, open Me tab > View my public page, fill in the Connect form on the page that opens and tap Send, then close the page and pull down to refresh Contacts: the new contact is there, and its details say "Connected on the web". (A form sent from someone else's page, such as https://chatsoon.app/id/alex-rivera-demo, goes to that person's contacts, as the page says.) Card scanning: Add tab > Photograph a card or badge. Before the first photo, a one-time consent step explains that the photo is sent to Anthropic's Claude AI to read the details: tap Allow and continue, then photograph any business card. Account deletion is in the Me tab > Delete account. Deleting resets this review account: sign in again with the same email and code to get the sample data back. To try report and block, open Maya Lindqvist in Contacts (already connected through Chatsoon): Report and Block are at the bottom of her contact page, and View profile opens her public profile, which has them too. Please keep Alex Rivera for the scan test. A blocked profile offers Unblock. Messages sent with the web Connect form, such as Daniel Okafor's in Contacts, have their own Report option. Public profile text and Connect form messages are filtered for objectionable language; reported content is reviewed and removed within 24 hours.

## App Store Connect

**App Privacy (nutrition labels).** All items: *Linked to the user*, *Not used for tracking*.

| Data type | Collected | Purpose |
|---|---|---|
| Contact Info > Name | Yes (profile display name, names of saved contacts) | App Functionality |
| Contact Info > Email Address | Yes (sign-in, email addresses of saved contacts) | App Functionality |
| Contact Info > Phone Number | Yes (phone numbers the user enters for saved contacts) | App Functionality |
| Contact Info > Other User Contact Info | Yes (profile links: X, Telegram, LinkedIn, website, YouTube) | App Functionality |
| Contacts > Contacts | Yes (saved contacts, connections, web Connect form submissions) | App Functionality |
| User Content > Photos or Videos | Yes (profile photo, card photos) | App Functionality |
| User Content > Other User Content | Yes (profile headline, notes, tags, reports) | App Functionality |
| Identifiers > User ID | Yes | App Functionality |

Not collected: location, browsing history, purchases, usage data, diagnostics, advertising data. The device address
book is never read (the app has no contacts permission), but the contact list users build in the app is declared
above as Contacts.

- Tracking: No.
- Age rating questionnaire: no objectionable content categories. Answer "yes" to user-generated content (public
  profiles, connect form) and note the report and block tools. Note also: "Public profile text and Connect form
  messages are filtered for objectionable language; reported content is reviewed and removed within 24 hours." After answering, choose **Override to Higher Age
  Rating** and select 18+. The Terms and Privacy Policy set a minimum age of 18, and Apple requires the rating to meet
  a minimum age set in the app's terms. This matches the Play target audience (18+). Set it before submitting:
  treat it as fixed once App Review approves the app.
- Export compliance: `ITSAppUsesNonExemptEncryption` is `false` in app.json (standard HTTPS only).
- Sign in with Apple: not required (no third-party sign-in in 1.0).
- Screenshots: **not captured yet.** Capture 4-5 screens from the reviewer account (Contacts, a contact's details,
  My QR, card review, Me) on an iPhone 6.9" simulator (iPhone 16 Pro Max class) running the EAS build, and save them
  under `store/screenshots/ios/`. iPhone 6.9" (1320x2868) is required. 6.5" (1284x2778) is optional, because Apple
  scales the 6.9" set down. iPad screenshots aren't needed (`supportsTablet` is false). App Store Connect won't let
  the build be submitted without them.

## Google Play

**Data safety form**

Every type below is *Collected: Yes*, *Shared: No*, *Processed ephemerally: No*.

| Data type | What it is | Required or optional | Purposes |
|---|---|---|---|
| Personal info > Name | Profile display name, names of saved contacts | Required | App functionality, Account management |
| Personal info > Email address | Sign-in email, email addresses of saved contacts | Required | App functionality, Account management |
| Personal info > User IDs | Account ID | Required | App functionality, Account management |
| Personal info > Phone number | Phone numbers the user enters for saved contacts | Optional | App functionality |
| Personal info > Other info | Profile headline, company, role and links | Optional | App functionality |
| Photos and videos > Photos | Profile photo, card and badge photos | Optional | App functionality |
| Contacts > Contacts | Saved contacts, connections, web Connect form submissions | Optional | App functionality |
| App activity > Other user-generated content | Notes, tags, reports | Optional | App functionality; Fraud prevention, security, and compliance |
| App info and performance > Diagnostics | Google ML Kit (see below): device and app info, performance metrics, API configuration, error codes | Required | Analytics |
| Device or other IDs | Google ML Kit (see below): per-installation identifier | Required | Analytics |

The last two rows come from Google ML Kit barcode scanning, which expo-camera bundles into the Android build for the
QR scanner (`com.google.mlkit:barcode-scanning`). ML Kit sends this data to Google over HTTPS and Google doesn't share
it with third parties. Check https://developers.google.com/ml-kit/android-data-disclosure on the day you fill in the
form, because Google updates that list. The iOS build doesn't include ML Kit.

- All data is encrypted in transit: Yes.
- Users can request deletion: Yes, in the app (Me > Delete account), on the web (sign in at https://chatsoon.app,
  then Me > Delete account) and by email to hello@chatsoon.app. Delete account URL:
  https://chatsoon.app/support#how-do-i-delete-my-account
- Data shared with third parties: No (processors acting on our behalf, such as Cloudflare, Anthropic and Resend,
  aren't "sharing" under Play's definition).

- Graphics (**not made yet**, and required before any track, closed testing included, can roll out): app icon
  512x512 32-bit PNG (export from `apps/mobile/assets/images/icon.png`); feature graphic 1024x500, JPEG or 24-bit PNG
  with no alpha (brand colour #5146E5); at least 2 phone screenshots, 9:16, each side 320-3840 px (for example
  1080x1920), from an Android emulator running the EAS build. Save them under `store/screenshots/android/`.
- Content rating: IARC questionnaire, and mark "users can interact / share content" (public profiles, connect form).
  Public profile text and Connect form messages are filtered for objectionable language, every profile, connection
  and Connect form message can be reported, and reports are reviewed within 24 hours.
- Target audience: 18+.
- Ads: No.
- App access: provide the reviewer login above under "All or some functionality is restricted".
- **Closed testing requirement:** if the Play developer account is a personal account created after November 2023,
  upload to closed testing on 24 September and recruit 12 testers the same day. The 14 day clock ends around
  8 October, then apply for production. Until then Android users use https://chatsoon.app.
