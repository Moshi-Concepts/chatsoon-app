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

```bash
npx wrangler pages project create chatsoon-web --production-branch main
```

Build with the production env and deploy:

```bash
cd apps/mobile
set EXPO_PUBLIC_API_URL=https://api.chatsoon.app
set EXPO_PUBLIC_TURNSTILE_SITE_KEY=<site key from step 4>
pnpm run export:web
npx wrangler pages deploy dist --project-name chatsoon-web
```

(PowerShell: `$env:EXPO_PUBLIC_API_URL="https://api.chatsoon.app"` etc.)

In the Cloudflare dashboard, Pages > chatsoon-web > Custom domains: add `chatsoon.app` (and `www.chatsoon.app`
with a redirect to the apex if you like). Then check:
- https://chatsoon.app/privacy, /terms and /support load as static pages
- https://chatsoon.app/id/alex-rivera-demo shows the demo profile and Connect form

## 3. Resend (sign-in emails from hello@chatsoon.app)

1. resend.com > Domains > Add `chatsoon.app`. Add the DNS records it shows in Cloudflare DNS. Resend's DKIM
   record lives alongside your existing SPF/DKIM/DMARC. If you already have an SPF record, merge Resend's include
   into it rather than adding a second SPF record.
2. Create an API key with sending access, then `wrangler secret put RESEND_API_KEY`.

## 4. Turnstile (spam protection on the public Connect form)

Cloudflare dashboard > Turnstile > Add widget, hostname `chatsoon.app`, mode Managed. The **site key** goes into
`EXPO_PUBLIC_TURNSTILE_SITE_KEY` when building the web app (step 2). The **secret** goes into `TURNSTILE_SECRET`.

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
- Settings > Delete account works, and signing in again as the reviewer recreates the sample data.
