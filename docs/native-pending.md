# Live on the web, not in the apps yet

The iOS and Android apps stay on 1.0.0 until both are live in the stores. Until then, new features go live on
chatsoon.app and the API first. We'll release them to the apps later, several at a time. Add each web-first
feature here when it deploys, and remove it once it ships in an app release.

`v1.0.0` tags the code of the 1.0 build. A 1.0.x fix (for example after a review rejection) branches from that
tag, not from `main`, because `main` already contains the features below.

## Pending

| Feature | Live on web | Needs a new native build | Store copy |
|---|---|---|---|
| Booking links ([plan](booking-links.md)) | 24 Sep 2026 | Yes: `react-native-webview` is a native module | [store/listing.md](../store/listing.md), "1.1 update" |
| Phone and messaging on profiles ([plan](profile-contact.md)) | 25 Sep 2026 | No: JS only | [store/listing.md](../store/listing.md), "1.1 update" |
| Accessible colour tokens (web now; native appearance changes) | 25 Sep 2026 | No: JS only | — |
| Privacy text: link previews | 25 Sep 2026 | No: policy only | — |
| Search visibility switch (#14) | 25 Sep 2026 | No: JS only | — |
| Delayed account deletion with export prompt (#8) | 26 Sep 2026 | No: JS only, but native must switch off `DELETE /me` to `POST /me/deletion` | — |
| Connect form tips opt-in and Tips emails setting (#7) | 26 Sep 2026 | No: JS only | — |
| Social sign-in: Google, Apple, LinkedIn, Discord (#24) | 26 Sep 2026 | Yes: needs `expo-apple-authentication` (or an `expo-auth-session` browser flow) for each provider, not the web redirect flow | Apple review guideline 4.8 requires Sign in with Apple on iOS whenever another social login is offered, so the native build must ship Apple alongside any other provider, not after it |
| Referral links (`/r/*`), landing page and badge pill (#11) | 26 Sep 2026 | Yes: add `{"/": "/r/*"}` to apple-app-site-association and the `/r/` pathPrefix intent filter in app.json in the same release as the `/r/[code]` screen | — |

## Releasing a batch to the apps

1. **Version:** bump `version` in `apps/mobile/app.json` (and `apps/mobile/package.json`), e.g. 1.1.0.
2. **Build:** run `eas build --platform all --profile production` on the Linux box.
3. **Test on real devices** through TestFlight internal testing and the Play internal track. Check every feature
   in the table, especially anything native:
   - **Booking links:** open a Calendly link in the sheet and make a test booking.
   - Check that Close and Open in browser work.
   - Check that a Google `calendar.app.google` link loads.
   - Check that a `mailto:`/`tel:` link on a booking page goes to the system app.
4. **Store copy:** use the release's store copy for What's New, the description and the reviewer notes.
5. **Submit**, then move the shipped rows out of this table.
