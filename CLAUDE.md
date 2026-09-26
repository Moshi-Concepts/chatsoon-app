# Chatsoon: working notes for Claude

Spec: v1.0 MVP ships to the App Store and Google Play. Scope is fixed: accounts, profile, My QR, connect,
contacts (manual, QR scan, card photo with AI), tags, notes, search, follow-up reminders (issue #33) and store
compliance. Wallet, voice notes and similar still come later. Do not add them.

## Layout
- `apps/api`: Cloudflare Worker, Hono, Drizzle on D1, R2 (private, HMAC-signed URLs via `GET /files/*`), Better Auth email OTP + bearer plugin.
- `apps/mobile`: Expo SDK 57, expo-router, routes in `src/app`. UI kit in `src/components/ui`, tokens in `src/constants/theme.ts`.
- `packages/shared`: API types (`types.ts`), zod input schemas (`schemas.ts`), constants, parsers. Both apps import `@chatsoon/shared`.
- `apps/web`: Cloudflare Pages project (`@chatsoon/web`) that builds and deploys the public pages — home, `/privacy`, `/terms`, `/support` today, `/id/:slug` from Stage C. Renderer in `src/render`, build script in `scripts/build.ts`; import `@chatsoon/shared/src/<module>` directly here, never the index (it pulls in zod). See `docs/public-pages-plan.md`.
- `apps/og`: Cloudflare Worker that renders personalised link preview cards (`chatsoon-og`). Satori 0.32.0 with resvg-wasm, fonts from Fontsource, a static plate image. No routes or bindings; the API calls it via RPC. See `docs/og-plan.md`.

## Rules
- Every private query is scoped by `user_id`. Client-sent R2 keys must pass `ownsKey(userId, key)`.
- API errors use `ApiError` / helpers in `apps/api/src/lib/errors.ts` and the `{ error: { code, message } }` body.
- JSON is camelCase on the wire, snake_case in D1. Row to DTO mapping lives in `apps/api/src/lib/serialize.ts`.
- D1 allows at most 100 bound parameters per statement. Chunk `inArray` lists (`chunk()` in `lib/contacts.ts`).
- Mobile: colours only via `useTheme()`, never hex literals in screens. Use `showAlert` / `confirm` from `src/lib/dialogs.ts` (Alert.alert does nothing on web).
- Mobile: data access through `src/lib/api.ts` and hooks in `src/lib/queries.ts`.
- Expo APIs change every SDK. Check the types in `node_modules` or https://docs.expo.dev/versions/v57.0.0/ before using one. Install packages with `npx expo install` from `apps/mobile`.
- Mobile env: local dev values (localhost API, Turnstile test key) go only in `apps/mobile/.env.development`, which
  `expo start` reads. Production web values live in `apps/mobile/.env.production`. Never create `apps/mobile/.env` or
  `.env.local`: `expo export` reads both, and dev values would ship to chatsoon.app.
- On the web, anonymous visitors to `/id/:slug` get `apps/web/src/render/profile.ts` (server-rendered) plus the island in
  `apps/web/src/client`, not the React screens; signed-in visitors get the app. Any visible change to `ProfileCard`,
  `ConnectForm`, `ContactPills`, `BookingLinksCard` or `ReportDialog` needs the matching change there (markup
  contract: `docs/profile-page-dom.md`). Never render phone, WhatsApp or Signal values into server HTML or tags.
- Web deploys must be Production deployments: `wrangler pages deploy ... --branch main` (`pnpm deploy:web` does this).
- Camera permission text is exactly: "Used to scan QR codes and photograph business cards". Never request photo library permission.

## Commands
- CI (`.github/workflows/ci.yml`) runs typecheck, tests, the web build and a migration drift check on every PR. `main`
  only takes squash-merged PRs whose `ci-ok` check passed on a branch up to date with `main`.
- Typecheck: `pnpm -r typecheck`. Tests: `pnpm test` (all packages) or `pnpm --filter @chatsoon/api test`, `pnpm --filter @chatsoon/shared test`, `pnpm --filter @chatsoon/web test`, `pnpm --filter @chatsoon/og test`.
- New migration: edit `apps/api/src/db/schema.ts`, then `pnpm --filter @chatsoon/api db:generate`.
- Web build: `pnpm build:web` (writes `apps/web/dist`); deploy with `pnpm deploy:web` (see DEPLOY.md).
- OG Worker: deploy with `pnpm deploy:og` (see DEPLOY.md).
