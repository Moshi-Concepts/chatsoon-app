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

`wrangler deploy` attaches the `api.chatsoon.app` custom domain (the zone is already on Cloudflare).
Check it: `https://api.chatsoon.app/health` returns `{"ok":true}`.

`REVIEWER_ENABLED` is `"true"` in `wrangler.jsonc`. Leave it on during review. After approval you can set it to
`"false"` and redeploy, but keep it on for every later submission.

## 2. Cloudflare Pages: web app and public pages (chatsoon.app)

Do step 4 (Turnstile) first: the web build needs its site key.

```bash
npx wrangler pages project create chatsoon-web --production-branch main
```

The web build takes its values from `apps/mobile/.env.production` (both are public, so the file can be committed).
Create it if it isn't there:

```
EXPO_PUBLIC_API_URL=https://api.chatsoon.app
EXPO_PUBLIC_TURNSTILE_SITE_KEY=<site key from step 4>
```

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
was built with dev values. The build stops if the bundle still contains a localhost or LAN API URL or a Turnstile test key. The deploy
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

## 7. Store listings

All copy, privacy answers and reviewer notes are in [store/listing.md](store/listing.md).

## 8. Pre-submit checks (spec section 6)

- `pnpm --filter @chatsoon/api test` passes (includes "user A cannot see user B's data" and "delete account
  wipes everything").
- On a fresh install: sign in as `review@chatsoon.app` with the reviewer code. The sample contacts are there.
- Scan the demo profile QR (`store/reviewer-demo-qr.png`) from the in-app scanner and you're connected with Alex Rivera.
- Me > Delete account works, and signing in again as the reviewer recreates the sample data.
