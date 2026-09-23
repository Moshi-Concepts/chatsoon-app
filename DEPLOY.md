# Deploying Chatsoon 1.0

Everything below needs your accounts, so it's run by you (Claude can't log in or enter keys).
Run commands from `D:\Claude\chatsoon-app` unless noted.

## 1. Cloudflare: API Worker (api.chatsoon.app)

```bash
npx wrangler login
npx wrangler d1 create chatsoon
```

Copy the printed `database_id` into `apps/api/wrangler.jsonc` (replace the all-zero id).

```bash
npx wrangler r2 bucket create chatsoon-files
pnpm --filter @chatsoon/api run db:migrate:remote
```

Always apply migrations **before** `wrangler deploy`, including on a database that already exists: run
`pnpm --filter @chatsoon/api run db:migrate:remote` again first. This release needs
`0003_reports_contacts_unlinked.sql`, because the Worker writes `contacts.unlinked_user_id` (blocks, and relinking a
scan) and `reports.contact_id` (reports about Connect form messages). Deployed without it, those requests fail.

Secrets (each command prompts for the value):

```bash
cd apps/api
npx wrangler secret put BETTER_AUTH_SECRET     # 32+ random chars, e.g. `openssl rand -base64 32`
npx wrangler secret put FILE_SIGNING_SECRET    # another 32+ random chars
npx wrangler secret put RESEND_API_KEY         # from resend.com, see step 3
npx wrangler secret put ANTHROPIC_API_KEY      # console.anthropic.com
npx wrangler secret put TURNSTILE_SECRET       # from step 4
npx wrangler secret put REVIEWER_CODE          # 6 digits, goes in the reviewer notes
npx wrangler deploy
```

`wrangler.jsonc` declares rate limit namespaces 1001 to 1010 (1008, 1009 and 1010 are new in this release). Namespace
ids are per Cloudflare account, so check no other Worker in the account uses the same numbers.

`wrangler deploy` attaches the `api.chatsoon.app` custom domain (the zone is already on Cloudflare).
Check it: `https://api.chatsoon.app/health` returns `{"ok":true}`.

`REVIEWER_ENABLED` is `"true"` in `wrangler.jsonc`. Leave it on while a build is in review. Set a new
`REVIEWER_CODE` for each submission (`npx wrangler secret put REVIEWER_CODE`, then update the code in the reviewer
notes, [store/listing.md](store/listing.md)). After approval, set `REVIEWER_ENABLED` to `"false"` and redeploy so the
fixed code stops working, and turn it back on before the next submission.

## 2. Cloudflare Pages: web app and public pages (chatsoon.app)

Do step 4 (Turnstile) first: the web build needs its site key.

```bash
npx wrangler pages project create chatsoon-web --production-branch main
```

The web build takes its values from `apps/mobile/.env.production`, which is committed (both values are public):

```
EXPO_PUBLIC_API_URL=https://api.chatsoon.app
EXPO_PUBLIC_TURNSTILE_SITE_KEY=REPLACE_WITH_TURNSTILE_SITE_KEY
```

Replace `REPLACE_WITH_TURNSTILE_SITE_KEY` with the site key from step 4 and commit the file. The build refuses to
finish while the placeholder is still there.

`expo export` also reads `apps/mobile/.env.local` and `apps/mobile/.env`. `.env.local` wins over `.env.production`,
so never put dev values in it or in `.env`. Local dev values belong in `apps/mobile/.env.development`, which only
`expo start` reads: if you have an old `apps/mobile/.env` with `localhost:8787`, rename it to `.env.development`.
Variables set in the shell win over every file. The syntax depends on the shell: Git Bash
`export EXPO_PUBLIC_API_URL=https://api.chatsoon.app`, PowerShell `$env:EXPO_PUBLIC_API_URL="https://api.chatsoon.app"`,
cmd `set EXPO_PUBLIC_API_URL=https://api.chatsoon.app`. In Git Bash, `set X=Y` exports nothing.

Build and deploy from the repo root:

```bash
pnpm deploy:web
```

This rebuilds `apps/mobile/dist` from scratch. Never deploy a `dist` you didn't just build: the one from local testing
was built with dev values. `export:web` clears the Metro cache (Metro caches the inlined `EXPO_PUBLIC_*` values), so
the export takes longer than a warm one. The build stops if the bundle still contains a localhost or LAN API URL, a
Turnstile test key or the placeholder site key. `CHATSOON_ALLOW_DEV_BUILD=1` skips that check: use it only for a local
test build, never for one you deploy. The deploy
passes `--branch main`, so it is a Production deployment whichever branch you have checked out. Without `--branch`,
wrangler uses the current git branch, and anything other than `main` becomes a Preview that chatsoon.app never
serves. The same steps by hand:

```bash
cd apps/mobile
pnpm run export:web
npx wrangler pages deploy dist --project-name chatsoon-web --branch main
```

Confirm that the wrangler output, or Pages > chatsoon-web > Deployments, lists the deployment under Production,
not Preview.

In the Cloudflare dashboard, Pages > chatsoon-web > Custom domains: add `chatsoon.app` only. Don't add
`www.chatsoon.app` there: Pages would serve the whole app on www, and the API only accepts
`https://chatsoon.app` (CORS and sign-in both fail from www). To send www to the apex instead:
1. DNS: add a proxied record for `www`, for example `AAAA www 100::` with Proxy status on.
2. Rules > Redirect Rules > Create rule (or the "Redirect from WWW to root" template): when
   `http.host eq "www.chatsoon.app"`, dynamic redirect to `concat("https://chatsoon.app", http.request.uri.path)`,
   status 301, Preserve query string on.

Then check:
- https://chatsoon.app/privacy, /terms and /support load as static pages
- https://chatsoon.app/id/alex-rivera-demo shows the demo profile and Connect form, and the Turnstile check
  above the "Send to Alex" button doesn't say "Testing only"
- https://www.chatsoon.app/id/alex-rivera-demo redirects (301) to https://chatsoon.app/id/alex-rivera-demo

## 3. Resend (sign-in emails from hello@chatsoon.app)

1. resend.com > Domains > Add `chatsoon.app`. Add the DNS records it shows in Cloudflare DNS. Resend's DKIM
   record lives alongside your existing SPF/DKIM/DMARC. If you already have an SPF record, merge Resend's include
   into it rather than adding a second SPF record.
2. Create an API key with sending access, then `wrangler secret put RESEND_API_KEY`.

## 4. Turnstile (spam protection on the public Connect form)

Cloudflare dashboard > Turnstile > Add widget, hostname `chatsoon.app`, mode Managed. The **site key** goes into
`EXPO_PUBLIC_TURNSTILE_SITE_KEY` in `apps/mobile/.env.production` (step 2). The **secret** goes into `TURNSTILE_SECRET`.

## 5. Universal links / App Links

- `apps/mobile/public/.well-known/apple-app-site-association`: replace `REPLACE_TEAM_ID` with your Apple Team ID
  (developer.apple.com > Membership).
- `apps/mobile/public/.well-known/assetlinks.json`: replace the fingerprint with the SHA-256 of the **app signing**
  key from Play Console > Setup > App signing (after the first upload).

Redeploy the web app after editing either file. Deep links also work without these through `chatsoon://id/<slug>`,
and scanning inside the app never needs them.

## 6. EAS builds and submission

```bash
cd apps/mobile
npx eas-cli@latest login
npx eas-cli@latest init            # creates the EAS project and writes the projectId into app.json
npx eas-cli@latest build --platform all --profile production
```

- iOS: EAS will offer to create the distribution certificate and provisioning profile. Say yes.
  Bundle ID `app.chatsoon`.
- Android: EAS creates the upload keystore. Package `app.chatsoon` is permanent.

Submit:

```bash
npx eas-cli@latest submit --platform ios --latest
npx eas-cli@latest submit --platform android --latest
```

Fill `appleId` / `ascAppId` in `eas.json` first (the App Store Connect app must exist). For Android the first
upload must be done by hand in Play Console (upload the .aab), then EAS Submit can take over with a service account.

## 7. Monitoring

Set these up before launch (Cloudflare dashboard):

- Workers & Pages > chatsoon-api > Observability: `observability` is on in `wrangler.jsonc`. Save a query and add an
  alert for each of these log lines:
  - `OTP send circuit open`: more than 600 sign-in emails in one clock hour. No more codes are sent until the next
    hour starts, so new sign-ins fail meanwhile. Check the Resend dashboard for abuse.
  - `Reviewer code checks over the daily budget`: over 500 reviewer code checks in one UTC day, so someone may be
    guessing it, and the reviewer can't sign in until the next UTC day. Set a new `REVIEWER_CODE` (and update the
    reviewer notes), or turn `REVIEWER_ENABLED` off if no review is in progress.
- Storage & Databases > D1 > chatsoon: add an alert (Notifications) or check the database size weekly against your
  plan's D1 size limit.

## 8. Moderation

Reports go to `REPORTS_NOTIFY_EMAIL` (hello@chatsoon.app). The Terms promise a review within 24 hours, so check the
inbox every day, including weekends. Each email names the reason, the reported profile's slug and user id (or, for a
Connect form message, the contact, its owner and a copy of the message) and ends with the reporter's own words.

To remove objectionable content without removing the user, clear the field, for example:

```bash
cd apps/api
npx wrangler d1 execute chatsoon --remote --command "UPDATE profiles SET headline = NULL WHERE slug = '<slug>'"
```

To eject a user:

1. Find them by the slug in the report:
   `npx wrangler d1 execute chatsoon --remote --command "SELECT u.id, u.email FROM users u JOIN profiles p ON p.user_id = u.id WHERE p.slug = '<slug>'"`
2. Delete the account (D1 enforces the foreign keys, so their profile, contacts, tags, connections, blocks and
   sessions go with it): `npx wrangler d1 execute chatsoon --remote --command "DELETE FROM users WHERE id = '<user id>'"`
3. Delete their photos: R2 > chatsoon-files, filter by the prefix `u/<user id>/`, select everything and delete.
4. Add their email to `BANNED_EMAILS` in `apps/api/wrangler.jsonc` (comma separated) and redeploy
   (`npx wrangler deploy` in `apps/api`), so they can't sign in again with it.

A Connect form message comes from someone without an account, so there is no user to eject. The message exists only
in the reporter's contacts, and they can delete it in the app. The form is rate limited per IP and behind Turnstile.

## 9. Store listings

All copy, privacy answers and reviewer notes are in [store/listing.md](store/listing.md).

## 10. Pre-submit checks (spec section 6)

- `pnpm --filter @chatsoon/api test` passes (includes "user A cannot see user B's data" and "delete account
  wipes everything").
- On a fresh install: sign in as `review@chatsoon.app` with the reviewer code. The sample contacts are there.
- Scan the demo profile QR (`store/reviewer-demo-qr.png`) from the in-app scanner and you're connected with Alex Rivera.
- Me > Delete account works, and signing in again as the reviewer recreates the sample data.
