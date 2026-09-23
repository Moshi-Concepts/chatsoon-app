<!--

███╗   ███╗███████╗███████╗██╗  ██╗    ██╗    ██╗██╗████████╗██╗  ██╗    ██╗   ██╗███████╗
████╗ ████║██╔════╝██╔════╝██║  ██║    ██║    ██║██║╚══██╔══╝██║  ██║    ██║   ██║██╔════╝
██╔████╔██║█████╗  ███████╗███████║    ██║ █╗ ██║██║   ██║   ███████║    ██║   ██║███████╗
██║╚██╔╝██║██╔══╝  ╚════██║██╔══██║    ██║███╗██║██║   ██║   ██╔══██║    ██║   ██║╚════██║
██║ ╚═╝ ██║███████╗███████║██║  ██║    ╚███╔███╔╝██║   ██║   ██║  ██║    ╚██████╔╝███████║
╚═╝     ╚═╝╚══════╝╚══════╝╚═╝  ╚═╝     ╚══╝╚══╝ ╚═╝   ╚═╝   ╚═╝  ╚═╝     ╚═════╝ ╚══════╝

Built by Mesh With Us
https://meshwithus.com.au

-->

# Chatsoon

Meet people. Follow up.

A networking CRM built for events: share your profile with a QR code, capture people in seconds
(QR scan, business card photo with AI, or by hand), then tag, note and find them later.

## Monorepo

| Path | What |
|---|---|
| `apps/mobile` | Expo (SDK 57, expo-router) app for iOS, Android and the web fallback at chatsoon.app |
| `apps/api` | Cloudflare Worker (Hono) at api.chatsoon.app with D1, R2, Better Auth (email OTP) and Claude Haiku card extraction |
| `packages/shared` | Types, zod schemas, QR / vCard / link parsers shared by both |

pnpm workspaces with `node-linker=hoisted` (required for React Native).

## Local development

```bash
pnpm install
cp apps/api/.dev.vars.example apps/api/.dev.vars
pnpm --filter @chatsoon/api db:migrate:local
pnpm dev:api          # http://localhost:8787
pnpm dev:mobile       # Expo dev server, press w for web
```

With `EMAIL_PROVIDER=log` the sign-in code is printed in the `wrangler dev` console.
To test on a phone, set `EXPO_PUBLIC_API_URL` in `apps/mobile/.env` to your PC's LAN IP.

See [DEPLOY.md](DEPLOY.md) for production setup and store submission.
