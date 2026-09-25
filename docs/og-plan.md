# Open Graph plan (#5)

Written 25 Sep 2026 from two independent analyses. Mock-ups and measurements were local scratch files and are not in the repo.
The account is on Workers Paid, so the personalised-card path is the main plan.


Paths are relative to `D:\Claude\chatsoon-app`. Evidence and mock-ups are in `C:\Users\Peter-PC\AppData\Local\Temp\claude\D--Claude-chatsoon-app\b66a9a92-258a-4fa1-a3cc-1c50ce6fb2e2\scratchpad\issue5-scratch\`.

**Checked for this plan (against the code, the scratch files, and one run of my own):**
- **The account is on Workers Paid.** Commit `a441f76` (25 Sep) changed plan §6 to say so. The Paid path is therefore the main plan, and Free is the fallback.
- **Stage B is only partly done.** Found in `apps/web`: `src/render/{layout,home,legal,css,escape,icons}.ts`, `scripts/build.ts` (no og, no `_routes.json`, no `functions/`, no `wrangler.jsonc`), and the untracked `apps/mobile/public/og.png`. `layout.ts:53-67` always emits og:url and uses a `summary` card. `home.ts:235` uses `/og.png`. `legal.ts:77` has no image.
- **`/og.png` was never served as an image in production.** The live path returns HTML, and the old `build-static-pages.mjs` had no og:image. Deleting it is safe.
- **The API host can't serve preview images.** `apps/api/src/index.ts:62` serves `Disallow: /`.
- **The public profile JSON can't feed previews.** `toPublicProfile` adds `contact` only when `opts.contact` is set, but `GET /id/:slug` sets it for `'public'` profiles. Its `avatarUrl` also expires after 7 days (`serialize.ts:111`).
- **Existing rules already handle the new og files.**
  - `deleteUserFiles` deletes everything under `u/<userId>/` (`account.ts:30-42`).
  - `isAvatarKey` (`profiles.ts:74`) and `isCardKey` (`signing.ts:37`) refuse `og/` keys.
- **The miss limiter doesn't run for binding calls.** `limit()` does nothing when there's no `cf-connecting-ip` (`errors.ts:54-58`), so the client IP has to be forwarded.
- **Avatars are JPEG up to 512 px from the app.** `image.ts:124` and `avatar-picker.tsx:15,57` do this. The API also accepts PNG, WebP and HEIC up to 3 MB (`files.ts:16-29`).
- **Field limits:** name 80, headline 120, company 80, role 80 (`schemas.ts:103-106`). `roleLine()` gives "Founder at Moshi Concepts" (`format.ts:10`).
- **satori 0.33.5 depends on `harfbuzzjs`; 0.32.0 doesn't** (checked in the package.json files).
- **I ran the renderer in local workerd** (wrangler 4.136.3, `issue5-scratch/wtest/`):
  - satori 0.32 standalone, resvg-wasm 2.6.2 and jpeg-js, over `plate.jpg`, with the wasm files imported as CompiledWasm.
  - It returned a valid 1200×630 JPEG: 232 ms cold, then 139, 111 and 105 ms warm.
  - jpeg-js's bundled encoder returns `Buffer.from(...)` (`encoder.js:732`), so the Worker needs `nodejs_compat`.
- **The build tools are already installed.** `sharp` 0.35.2 is hoisted in the root `node_modules` (`node-linker=hoisted`), and root `onlyBuiltDependencies` already allows `sharp` and `@resvg/resvg-js`.

---

## 1. Decisions

| # | Decision | Reason (the losing option is named where the two analyses disagreed) |
|---|---|---|
| O1 | **Paid is the main plan.** Free uses the same code with `OG_CARDS_ENABLED="false"` and chatsoon-og not deployed. | Paid is confirmed (commit a441f76). Free differs only in the profile image (see the variants table below). |
| O2 | **Ship two deploys.** Phase 1 (static) goes out right after Stage B lands. Phase 2 (personalised cards) goes out once Peter approves the card previews. | Phase 1 needs no API deploy, secret or Function, so every chatsoon.app link gets a branded card the same day. |
| O3 | **Generic image:** crop Peter's X header at x=356 (1379×724), resize to 1200×630 with lanczos3, save as JPEG q85 mozjpeg progressive (about 56 KB). | The art is raster, and rebuilding it in SVG would lose the look. The crop only scales down. It beats the centre crop at x=397 (tags lens) by removing the right-edge card slivers and giving the bubble about 95 px of margin (`og-home-left356.jpg`). |
| O4 | **JPEG for every OG image; no PNG or WebP.** | PNG measured 1.16 MB for the generic image and 425–740 KB for cards, over WhatsApp's roughly 300 KB limit. WebP isn't reliable on LinkedIn and some other platforms. |
| O5 | **File name carries a content hash,** `/og/chatsoon-<sha256:8>.jpg`, served immutable. The generator writes `DEFAULT_OG_IMAGE` into `apps/web/src/render/og-asset.ts`. | Beats a manual `-v1` (image lens), which someone can forget to bump. Beats hashing in build.ts (tags lens), because the Function needs the URL without a generated module. |
| O6 | **`twitter:card summary_large_image` everywhere, profiles included.** | X large cards show only the image and the domain, so the name has to be in the image. Beats plan §3.3's photo with `summary`. |
| O7 | **Card renderer:** satori **0.32.0** (pinned exactly, `satori/standalone`), `@resvg/resvg-wasm` **2.6.2** (exact) and `jpeg-js` 0.4.4 at q85. It draws over a plate made at build time. | Verified in workerd (above). 0.33.x brings in harfbuzzjs, which needs fs or runtime wasm compilation. Glows, blur and radial gradients cost 180–510 ms, so they go in the plate. |
| O8 | **The renderer is its own Worker, `chatsoon-og`.** It exposes a `WorkerEntrypoint` RPC class `OgRenderer`, with no routes, no bindings and `workers_dev:false`, and the API calls it. | Keeps 2.5 MB of wasm plus fonts off every API cold start and keeps render memory separate. RPC from one Worker to another is standard; only a Pages binding to a *named* entrypoint is unproven. It also keeps Stage C's Function small. |
| O9 | **Cards are stored in R2 at `u/<userId>/og/<ogVersion>.jpg`.** They're rendered on the first request (lazily) and again in `waitUntil` after `PUT /me/profile`, which covers edits from native 1.0 too. | Account deletion already removes the prefix. One render per profile version. |
| O10 | **`ogVersion`** is the first 16 hex characters of SHA-256 over `OG_TEMPLATE_VERSION`, displayName, role, company, headline and avatarKey, joined with `\u0000` (nulls become ''). | Both analyses agree on the inputs. NUL beats newline because no field can contain it. |
| O11 | **og:image is `https://chatsoon.app/id/<slug>/og.jpg?v=<ogVersion>`, same origin.** | It can't be on the API host (robots `Disallow: /`; Twitterbot and LinkedInBot obey robots.txt for images). The signed avatar URL can't be used either: it expires. |
| O12 | **Until Stage C, a Pages Function on `/id/*` adds the tags to the SPA shell** it gets from `context.next()`. | Crawlers see no og tags today. D2 rejected tag injection on PageSpeed grounds, not preview grounds. Stage C replaces the body; the tag builder, DTO and image route stay. |
| O13 | **Splice the tags between build-time `<!--og-->…<!--/og-->` markers; don't use HTMLRewriter.** | The shell is about 1.6 KB, the splice is deterministic, it's testable in Node vitest, and build.ts checks the markers. The HTMLRewriter equivalent, if someone wants it later: remove `title`, `meta[name=description]`, `meta[property^="og:"]`, `meta[name^="twitter:"]`, `link[rel=canonical]`, and insert with `after()` on `meta[charset]`. |
| O14 | **Transport:** a Pages service binding to the API's **default** entrypoint, calling secret-gated `GET /_pages/profile/:slug` and `/_pages/og/:slug` (the plan §3.1 fallback) with an `x-client-ip` header. Responses have the same shape as the RPC result types. | This path is proven. Beats named-entrypoint RPC now (image lens), which the Stage C spike can still switch to without changing the DTO. Beats the public JSON, which carries contact values and would key the limiter on the Pages egress IP. |
| O15 | **One tag builder, `apps/web/src/render/og.ts`,** used by layout (home and legal), build (the shell) and the Function. Stage C's `head.ts` reuses it. | One template for four places. It depends only on `escape.ts` and `og-asset.ts`. |
| O16 | **The SPA shell gets the generic tags with no og:url and no canonical.** | The shell serves every app route. A fixed og:url would merge every share into the home page on Facebook. |
| O17 | **Delete the og:* lines in `page-head.tsx`.** | Crawlers don't run JS, so they only ever produced duplicates. The component returns null on native, so no native-pending row is needed. |
| O18 | **The image gets only `OgCard {displayName, role, company, headline}`,** copied by name and never spread. No links, booking links or contact values. | The privacy promise in §3.6. |
| O19 | **Fonts:** Plus Jakarta Sans (OFL) 400/600/800 in latin, latin-ext and vietnamese, plus Noto Sans cyrillic and greek. WOFF files, one family name per subset. Emoji are stripped from the image only. A field with any character the fonts don't cover is left out of the image; the name still appears in og:title. | satori doesn't fall back between subsets that share a family name (measured). CJK, Arabic and Hebrew fonts would be MBs of parsing. The coverage table is built from the font cmaps, which beats the image lens's "no-text variant" because it's per field. |
| O20 | **`OG_CARDS_ENABLED` (API var) is the kill switch.** Off, or no `OG` binding, gives `ogVersion: null` and the tags use the default image. | The same switch is the Free-plan setting. |
| O21 | **No user-agent gating.** | There's a long tail of preview bots, and iMessage fetches from the sender's device. |
| O22 | **og:title is `{name} – {roleLine ?? headline}`,** or just `{name}` when that is over 70 characters. The `<title>` follows §3.3. | More informative on Facebook, LinkedIn, Slack and WhatsApp. *Peter can override.* |
| O23 | **"Connect on Chatsoon" and `chatsoon.app` are baked into the plate.** | Static text costs nothing per render. *Peter can override.* |
| O24 | **`twitter:site` is `@ChatSoonApp` on every page** (home, legal, SPA shell and profiles); Peter supplied it on 25 Sep 2026. The home Organization JSON-LD gets `"sameAs":["https://x.com/ChatSoonApp"]`. `fb:app_id` stays out until Peter supplies one. | The brand X account attributes shared cards. |

**Workers Paid vs Free**

| | Paid (confirmed) | Free (10 ms CPU) |
|---|---|---|
| Tags on home, legal, shell and `/id/*` | As planned | Identical (the splice is about 0.2 µs) |
| Profile og:image | Personalised card at `/id/<slug>/og.jpg` | `DEFAULT_OG_IMAGE`. Set `OG_CARDS_ENABLED="false"`, skip chatsoon-og. No code change. |
| Personalised images | satori/resvg in chatsoon-og (`limits.cpu_ms: 2000` guard) | Not possible (46 ms or more even for the smallest variant). The only candidate is the Images binding (`.draw()`, plus the `.text()` added on 2 Sep 2026), and whether it works on Free is **unverified**. Out of scope. |
| Quotas | Billed per request | 100k requests a day, shared between Workers and Functions. Each `/id` view costs one Function call plus one API call. |

---

## 2. Assets

### 2.1 Generic image (WP-1)

- **Source:** Peter's attachment, committed as `apps/og/assets/brand/x-header-2172x724.png`.
- **Script:** `apps/og/scripts/gen-generic.ts`:
  ```ts
  sharp(src).extract({ left: 356, top: 0, width: 1379, height: 724 })
    .resize(1200, 630, { kernel: 'lanczos3' })
    .jpeg({ quality: 85, mozjpeg: true, progressive: true })   // sRGB, metadata stripped
  ```
  - It writes `apps/mobile/public/og/chatsoon-<sha8>.jpg`. `expo export` copies `public/` into `apps/web/dist`, so no copy step is needed.
  - It deletes older `chatsoon-*.jpg` files in that folder.
  - It fails if the output isn't 1200×630 or is 300 KB or larger.
- **Generated, committed `apps/web/src/render/og-asset.ts`:**
  ```ts
  export const DEFAULT_OG_IMAGE = { path: '/og/chatsoon-<sha8>.jpg', width: 1200, height: 630, type: 'image/jpeg',
    alt: 'Chatsoon: Meet people. Follow up. The networking CRM for events.' } as const;
  ```
- **What it looks like:** `og-home-left356.jpg`. A centred square thumbnail shows half the bubble and "Meet peo…", which is acceptable.

### 2.2 Personalised card (WP-3)

The canvas is 1200×630, opaque, sRGB, JPEG q85, and must stay under 300 KB (the mock-ups were 87–125 KB).

**Plate** (`apps/og/assets/plate.jpg`, about 35 KB, made by `scripts/gen-plate.ts`, all static art):
- **Background:** a linear gradient at 135°: `#2A18B8` → `#1A1188` → `#1F1399`. Three radial glows on top:
  - bottom-left `#E0479E` at 0.75, r 0.75;
  - top-left `#720BD6` at 0.85, r 0.6;
  - top-right `#A43FFD` at 0.7, r 0.5.
  - sharp renders this SVG (it has no text).
- **Right-hand art:** the header's crop x 1655–2172 (517×724), scaled to 630 px high (≈450 px wide), placed at x=750. Its left edge fades from 0 to 22% (see `issue5-scratch/plate.mjs`).
- **Static text layer**, drawn with the renderer's own satori and resvg-wasm in Node to a transparent PNG, then composited with sharp:
  - **Brand row at (72, 56):** the official mark `apps/og/assets/brand/x-avatar.png` (Peter's 400×400 X profile image, added 25 Sep 2026), scaled to 52×52 with a 14 px corner radius, then "Chatsoon" in 800 at 30 px, white, 14 px gap. It replaces the drawn bubble mark, which is still used as the initials fallback where needed.
  - **Call-to-action row, bottom edge 52 px up (y ≈ 526–578):**
    - a pill reading "Connect on Chatsoon": 800, 24 px, white, padding 12/24, radius 32, fill a 90° gradient `#FF5FA2` → `#FF8A4C` (the header's "Follow up." gradient);
    - then "chatsoon.app": 600, 22 px, `#B9B3F5`, letter-spacing 5 px, 22 px left margin.
- **Output:** mozjpeg q88.

**Dynamic layer** (satori, per profile; solid fills, one linear gradient, border radius, one `<img>` and text only):

| Element | Spec |
|---|---|
| Content box | x 72–740, y 132–506, a flex column centred vertically; empty rows are dropped. x ≥ 750 belongs to the plate art. |
| Photo | A 164×164 circle, `objectFit: cover`, inside a 5 px ring of `rgba(255,255,255,0.92)` (174 px outside). |
| Initials fallback | A 164 disc with a 135° gradient `#6B61FF` → `#C04BF2`, 800 at 64 px, white. It uses the first grapheme of each of the first two words (`Intl.Segmenter`), upper-cased with `toLocaleUpperCase`. If those aren't covered by the fonts, it shows a 96 px bubble mark instead. |
| Text column | 34 px right of the ring, 460 px wide. |
| Name | 800, 54 px, line height 1.08, letter-spacing −1, `#FFFFFF`, `lineClamp: 2`. |
| Role line | `roleLine(role, company)` ("Founder at Moshi Concepts"): 600, 28 px, line height 1.25, `#D4CEFF`, 12 px top margin, `lineClamp: 2`. |
| Headline | Full width (668), 30 px top margin: 400, 26 px, line height 1.3, `rgba(255,255,255,0.82)`, `lineClamp: 2`. |
| Text styles | `display: 'block'` (lineClamp needs it) and `wordBreak: 'break-word'` on every text node. No box-shadow, filters or radial gradients. |

**Rules for the text on the image:**
- **Sanitise each field** before drawing: remove `\p{Extended_Pictographic}`, `\p{Emoji_Modifier}`, `\p{Regional_Indicator}`, U+200D, U+FE0F, U+20E3 and control characters, collapse whitespace and trim.
- **Drop any field that isn't fully covered by the fonts.** Coverage is checked against `src/coverage.ts`, which gen-plate.ts builds from the 15 font cmaps with `fontkit`. If no field is left, the card shows the photo or initials plus the plate's CTA.
- **Fonts:** load the 15 WOFF files from Fontsource into `apps/og/fonts/` (committed, with `OFL.txt`). They load once at module scope. Families are `PJS`, `PJSX` and `PJSV` (latin, latin-ext, vietnamese) and `NSC` and `NSG` (Noto cyrillic, greek), and the tree uses `fontFamily: 'PJS, PJSX, PJSV, NSC, NSG'`.
- **Avatar guard** (runs in the API before the RPC). The avatar is used only when **all** of these hold; otherwise the card uses initials:
  - R2 `contentType` is `image/jpeg` or `image/png`, **and** the magic bytes match;
  - the file is 1 MB or less;
  - the SOF or IHDR header gives each side as 2048 px or less.

  WebP renders blank in resvg-wasm (measured), and a 4000×3000 PNG decodes to 48 MB.

### 2.3 Previews for Peter's approval (they gate the Phase 2 deploy)

- **Command:** `pnpm --filter @chatsoon/og preview [-- --slug peter-bui-5ec50167]` runs `apps/og/scripts/preview.ts` with tsx.
- **Same code as production.** It loads `yoga.wasm` and `index_bg.wasm` with `WebAssembly.compile(readFileSync(...))`, then calls the same `createRenderer()` the Worker uses.
- **Fixtures:**
  - `--slug` (optional): fetches the public JSON, keeps only what `toOgCard` allows, and downloads the avatar;
  - photo, with role, company and headline;
  - initials, no headline;
  - every field at its maximum length (80/80/80/120);
  - no role, company or headline;
  - Vietnamese, Cyrillic and Greek;
  - a CJK name (the field is dropped);
  - an emoji name;
  - a PNG avatar;
  - a WebP avatar (falls back to initials).
- **Output:** one `apps/og/preview/<fixture>.jpg` per fixture (gitignored), plus `preview/sheet.jpg`. The sheet is a labelled sharp contact sheet that also includes the generic image.
- **Checks:** it prints ms and bytes for each fixture and exits 1 if any file is 300 KB or larger.
- **Handover:** the orchestrator sends `sheet.jpg` and the generic JPEG to Peter with SendUserFile. Phase 1 may deploy with the crop, since it is his art unchanged, but show it to him.

---

## 3. Contracts

### 3.1 Shared (`packages/shared/src/og.ts`; deep import, no zod)

```ts
export const OG_TEMPLATE_VERSION = '1';               // bump on any plate/card/font change (fingerprint test enforces)
export const OG_IMAGE_SIZE = { width: 1200, height: 630 } as const;
export interface OgCard { displayName: string; role: string | null; company: string | null; headline: string | null }
export interface OgAvatar { bytes: Uint8Array; type: 'image/jpeg' | 'image/png' }
export interface OgRendererRpc { render(card: OgCard, avatar: OgAvatar | null): Promise<Uint8Array> }
export function toOgCard(p: OgCard): OgCard;          // copies the 4 fields by name
export function computeOgVersion(card: OgCard, avatarKey: string | null): Promise<string>; // 16 hex, crypto.subtle
```

- **`profile-page.ts`** (pulled forward from C2; pure functions only; no changes to mobile call sites):
  - `firstName` and `roleLine`;
  - `describeProfile`: today's `describe()`, capped at 160 characters on a word boundary;
  - `profileTitle`: per §3.3;
  - `profileOgTitle`: per O22.
- **`types.ts`:**
  - `PageProfile`: exactly the §3.1 fields plus `ogVersion: string | null`;
  - `ProfilePageResult`, as in §3.1.

### 3.2 `chatsoon-og` Worker (`apps/og`)

- **`wrangler.jsonc`:**
  ```jsonc
  {"name":"chatsoon-og","main":"src/index.ts","compatibility_date":"2026-08-20","compatibility_flags":["nodejs_compat"],
   "workers_dev":false,"preview_urls":false,"observability":{"enabled":true},"limits":{"cpu_ms":2000},
   "rules":[{"type":"Data","globs":["**/*.woff","**/*.jpg"],"fallthrough":true}]}
  ```
- **Wasm imports:** `import yoga from 'satori/yoga.wasm'` and `import resvgWasm from '@resvg/resvg-wasm/index_bg.wasm'`. Both packages export these subpaths, and wrangler's default CompiledWasm rule handles them.
- **`src/index.ts`:**
  - `export class OgRenderer extends WorkerEntrypoint implements OgRendererRpc`;
  - `export default { fetch: () => new Response('Not found', { status: 404 }) }`.
- **`render()`:**
  - Setup runs once per isolate, as a promise: `init(yoga)`, `initWasm(resvgWasm)`, the fonts array, and the plate as a data URI.
  - Per call: `satori(tree)` → `new Resvg(svg).render().pixels` → `jpeg-js` at q85 → `Uint8Array`.

### 3.3 API

- **`GET /_pages/profile/:slug`**, in a separate Hono sub-app, `routes/pages.ts`:
  - **Key check:** `x-pages-key` is compared with `timingSafeEqual` against `PAGES_SHARED_SECRET`. If the secret is unset or doesn't match, the route returns 404 with the normal `not_found` body.
  - **Client IP:** `x-client-ip` is trusted only after the key check.
  - **Response:** 200 with `ProfilePageResult` JSON and `Cache-Control: no-store`.
  - **Misses:** `PROFILE_MISS_LIMITER` with key `profile-miss:<x-client-ip>`, the same bucket as the public route.
  - **Building the DTO:** `toPageProfile(env, row)` calls `toPublicProfile(env, row)` with **no options**, then copies the §3.1 fields by name (`indexable: false`). `ogVersion` is null when the cards are disabled or `env.OG` is missing.
- **`GET /_pages/og/:slug?v=`**, same key and IP handling:
  - **Validation:** `v` must match `/^[0-9a-f]{16}$/`, otherwise it is ignored.
  - **Order of work:**
    1. Look up the profile. A miss goes through the limiter and returns 404 or 429.
    2. If cards are disabled, return 503 `og_unavailable`.
    3. Compute `cur`. If `If-None-Match` equals `"cur"`, return 304 without touching R2.
    4. `FILES.get('u/<userId>/og/<cur>.jpg')`.
    5. On a miss: load the avatar (with the guard), call `env.OG.render(toOgCard(row), avatar)`, then `FILES.put(key, bytes, {httpMetadata:{contentType:'image/jpeg'}, customMetadata:{purpose:'og'}})`.
  - **Response headers:** `Content-Type: image/jpeg`, `Content-Length`, `ETag: "<cur>"`, and `Cache-Control: public, max-age=3600` when `v === cur`, otherwise `public, max-age=300`.
  - **On any render or R2 error:** 503 `og_unavailable`. Nothing is written.
- **`PUT /me/profile`:** after the save, `c.executionCtx.waitUntil(refreshOgCard(env, row))`:
  - if cards are enabled and the current key is missing, render and put it;
  - then list `u/<userId>/og/` and delete every key except the current one;
  - log errors and never fail the save.
- **Env and config:**
  - `OG?: OgRendererRpc`, with `"services":[{"binding":"OG","service":"chatsoon-og","entrypoint":"OgRenderer"}]`;
  - var `OG_CARDS_ENABLED: "true"`;
  - secret `PAGES_SHARED_SECRET`.
- **Core functions** live in `apps/api/src/pages.ts`: `profilePage(env, slug, ip)` and `profileOgImage(env, ctx, slug, v, ip, ifNoneMatch)`. They're independent of the transport, so Stage C's `PagesEntrypoint` can wrap the same functions.

### 3.4 Web

| Path | Served by | Response |
|---|---|---|
| `/og/chatsoon-<sha8>.jpg` | Static | `_headers` `/og/*`: `Cache-Control: public, max-age=31536000, immutable` |
| `/id/:slug` (GET) | Function → `og-inject.ts` | The SPA shell with personalised tags, or the untouched shell on any failure |
| `/id/:slug/og.jpg` (GET, HEAD) | Function → `og-image.ts` | 200 image/jpeg, 304, 404, 429, or a fallback to the default image |
| Other `/id/*`, and HEAD `/id/:slug` | `context.next()` | Unchanged; Stage C adds the 404s |

- **`dist/_routes.json`** is `{"version":1,"include":["/id/*"],"exclude":[]}`. build.ts writes it only when `functions/` exists.
- **`apps/web/wrangler.jsonc`:**
  ```jsonc
  {"name":"chatsoon-web","pages_build_output_dir":"./dist","compatibility_date":"2026-08-20","services":[{"binding":"API","service":"chatsoon-api"}]}
  ```
  Add the secret with `wrangler pages secret put PAGES_SHARED_SECRET --project-name chatsoon-web`.
- **Tags handler:**
  1. Validate with `isValidSlug`; if the slug is invalid, return `next()`.
  2. Copy the request without `If-None-Match` and `If-Modified-Since`.
  3. Run `Promise.all([context.next(copy), lookup(slug)])`. The lookup is `env.API.fetch('https://api.chatsoon.app/_pages/profile/<slug>', { headers: { 'x-pages-key', 'x-client-ip': cf-connecting-ip } })` with a 1.5 s timeout; it gives null on any error.
  4. If the asset response isn't a 200 `text/html`, or there's no `ok` profile, return the asset response untouched.
  5. Otherwise replace the text between the markers and return 200 with the asset's headers, minus `ETag`, `Content-Length` and `Content-Encoding`.
  6. Never fetch `/index.html` from ASSETS: it 308s to `/`, and `/` serves home.
- **Image handler:**
  - Forward to `/_pages/og/<slug>?v=` with the key, the client IP and `If-None-Match`, with a 10 s timeout.
  - **Headers on every response from this handler:** `X-Content-Type-Options: nosniff`, `X-Robots-Tag: noindex` and `Content-Security-Policy: default-src 'none'; sandbox` (`_headers` doesn't apply to Function responses).
  - **200 and 304:** pass through the body (none on HEAD), `Content-Type`, `Content-Length`, `ETag` and `Cache-Control`.
  - **404:** `public, max-age=60`.
  - **429:** `no-store` and `Retry-After: 60`.
  - **503, a timeout, or anything else:** the default image bytes from `env.ASSETS.fetch(new URL(DEFAULT_OG_IMAGE.path, request.url))`, with `public, max-age=60`.

**Tag templates.** `ogTags()` emits them in this order: og:type, og:site_name, og:title, og:description, og:url (if set), og:image, og:image:type, og:image:width, og:image:height, og:image:alt, twitter:card, twitter:site (`@ChatSoonApp`), twitter:image:alt. Every value is escaped with `escapeHtml`.

```html
<!-- Home (layout.ts; canonical already there) -->
og:type=website  og:title="Chatsoon: networking CRM and digital business card for events"  og:description=DESCRIPTION
og:url=https://chatsoon.app/  og:image=https://chatsoon.app/og/chatsoon-<sha8>.jpg (jpeg, 1200, 630, DEFAULT alt)
twitter:card=summary_large_image
<!-- Legal: og:type=website, og:title="{doc.title} · Chatsoon", og:url=page url, description as today, default image, summary_large_image -->

<!-- SPA shell, inserted by build.ts right after <meta charset="utf-8" />; original <title> and meta description removed -->
<!--og--><title>Chatsoon: Meet people. Follow up.</title><meta name="description" content="{home DESCRIPTION}">
og:type=website og:site_name=Chatsoon og:title="Chatsoon: Meet people. Follow up." og:description=DESCRIPTION
default image ×5 fields, twitter:card=summary_large_image, twitter:image:alt   (NO og:url, NO canonical)<!--/og-->

<!-- /id/:slug, replaces the marker block -->
<!--og--><title>{profileTitle(p)}</title><meta name="description" content="{describeProfile(p)}">
<link rel="canonical" href="https://chatsoon.app/id/{p.slug}"><meta name="robots" content="noindex">
og:type=profile og:site_name=Chatsoon og:title="{profileOgTitle(p)}" og:description="{describeProfile(p)}"
og:url=https://chatsoon.app/id/{p.slug}
og:image=https://chatsoon.app/id/{p.slug}/og.jpg?v={p.ogVersion}   (ogVersion null → DEFAULT_OG_IMAGE)
og:image:type=image/jpeg og:image:width=1200 og:image:height=630
og:image:alt="{name}, {roleLine}, on Chatsoon" (no roleLine: "{name} on Chatsoon")
twitter:card=summary_large_image twitter:image:alt=(same)<!--/og-->
```

**Handover to Stage C.** C1 wraps `pages.ts` in `PagesEntrypoint`, and C5 replaces `og-inject.ts` with `handle.ts` plus `renderProfile`. `og.ts`, `og-image.ts`, the DTO, the image route and the key format stay as they are.

---

## 4. Work packages

**Rules for every WP:**
- Use pnpm, and run `pnpm -r typecheck`.
- In `apps/web`, use only deep imports of `@chatsoon/shared/src/<module>`.
- Only the WPs named below touch `pnpm-lock.yaml`, and in order: WP-3 first (its first step), then WP-5.
- Don't touch `packages/shared/{index.ts,package.json}`: Stage B owns them.

**Wave 0: start now (no Stage B files, no package installs)**

- **WP-0 Shared contracts**
  - **Owns:** `packages/shared/src/{og.ts, og.test.ts, profile-page.ts, profile-page.test.ts, types.ts}`.
  - **Build:** §3.1.
  - **Tests:**
    - `toOgCard` on an object with an injected `contact` and `links` returns exactly 4 keys;
    - `computeOgVersion` returns 16 hex characters, is stable, and changes with each of the 5 inputs and with `OG_TEMPLATE_VERSION`;
    - `describeProfile` gives the same output as today's `describe()` for 3 fixtures, and is ≤160 characters;
    - `profileOgTitle` falls back to the name when over 70 characters;
    - reading the source files shows no `zod` or `schemas` import.
- **WP-1 Generic image**
  - **Owns:** `apps/og/assets/brand/x-header-2172x724.png` (copy of the attachment), `apps/og/scripts/gen-generic.ts`, `apps/mobile/public/og/chatsoon-<sha8>.jpg`, `apps/web/src/render/og-asset.ts`.
  - **Build:** §2.1. Run it with `npx tsx` using the hoisted sharp; don't create `package.json` and don't install.
  - **Tests:** the script checks 1200×630, the JPEG SOI marker and ≤300 KB, and a second run gives identical bytes.
  - **Hand the JPEG to the orchestrator.**

**Gate: Stage B is committed.**

**Wave 1: these run in parallel**

- **WP-2 Web tags, Phase 1**
  - **Owns:**
    - `apps/web/src/render/{og.ts (new), shell.ts (new), layout.ts, home.ts, legal.ts}`;
    - `apps/web/scripts/build.ts`;
    - `apps/web/test/{og.test.ts, shell.test.ts (new), render-home.test.ts, render-legal.test.ts}`;
    - `apps/mobile/public/_headers` (add the `/og/*` block);
    - `apps/mobile/src/components/web/page-head.tsx` (remove the 3 og:* lines);
    - `apps/mobile/public/og.png` (delete).
  - **`og.ts`:**
    - `ogTags(meta: { type: 'website' | 'profile'; title; description; url?; image: OgImage; card })`;
    - `OgImage = typeof DEFAULT_OG_IMAGE`-shaped;
    - `profileOgBlock(p: PageProfile, origin)`.
  - **Layout, home and legal:** `layout.ts` uses `ogTags`, and `PageOgOptions` requires the image. Home and legal follow the templates in §3.4.
  - **`shell.ts`:** `injectShellOg(html)` does the following:
    - throws unless there is exactly one `<meta charset="utf-8" />`;
    - removes the existing `<title>` and `<meta name="description">`;
    - inserts the marker block;
    - throws if `<!--/og-->` ends after byte 2048.
  - **`build.ts`:**
    - calls `injectShellOg` on `dist/index.html`;
    - checks that `dist${DEFAULT_OG_IMAGE.path}` exists, starts with `FF D8 FF` and is ≤300 KB;
    - writes `_routes.json` only if `functions/` exists;
    - keeps the 14 KB home budget.
  - **Tests:**
    - `"<>&` in values is escaped;
    - all URLs are absolute https;
    - width, height and type are present with `summary_large_image`;
    - omitting `url` means no og:url;
    - a DTO with an injected `contact` leaks nothing;
    - the shell ends up with exactly one og:image and no og:url or canonical, and throws when the marker is missing;
    - home and legal have a single og:image and `summary_large_image`.
  - **Deploy Phase 1:** `pnpm deploy:web`.
- **WP-3 `chatsoon-og` Worker and card assets** (after WP-0 and WP-1)
  - **Owns:**
    - everything under `apps/og/**` except WP-1's files;
    - root `package.json` (a `deploy:og` script);
    - `pnpm-lock.yaml` (installs first).
  - **Dependencies:**
    - dependencies: `satori` `0.32.0` (exact), `@resvg/resvg-wasm` `2.6.2` (exact), `jpeg-js` `0.4.4`, `@chatsoon/shared`;
    - devDependencies: `sharp`, `fontkit`, `@fontsource/plus-jakarta-sans`, `@fontsource/noto-sans`, `wrangler`, `vitest`, `@cloudflare/vitest-pool-workers`, `@cloudflare/workers-types`, `typescript`, `tsx`.
  - **Files:**
    - `wrangler.jsonc` (§3.2), `tsconfig.json`, `vitest.config.ts` (workerd pool);
    - `src/{index, render, card, text, avatar-types, coverage (generated), version}.ts`;
    - `fonts/*.woff` and `OFL.txt`;
    - `assets/plate.jpg`;
    - `scripts/{gen-plate, preview}.ts`;
    - `.gitignore` (`preview/`).
  - **Build:** §2.2, §2.3 and §3.2. `createRenderer({ yoga, resvgWasm, fonts, plate })` must run unchanged in both Node and workerd.
  - **Tests:**
    - **In workerd:** every fixture returns a JPEG whose SOF says 1200×630, under 300 KB.
    - **satori with `embedFont: false`:** name, role and headline appear as text. A card object carrying extra `contact` and `links` fields (cast) leaks none of its values, digits included.
    - **Text rules:** sanitising and coverage drop the CJK and emoji-only fields; the initials cases pass.
    - **Fingerprint:** `version.ts` records the SHA-256 of `plate.jpg`, `card.ts` and the font list. A mismatch fails with "bump OG_TEMPLATE_VERSION and update TEMPLATE_FINGERPRINT".
    - **Speed:** a warm render takes under 250 ms in Node.
  - **Deliver `preview/sheet.jpg` for Peter** (this is the approval gate).
- **WP-4 API** (after WP-0)
  - **Owns:**
    - `apps/api/src/{pages.ts (new), routes/pages.ts (new), lib/og.ts (new: avatar guard, key helpers, `refreshOgCard`), index.ts, env.ts, lib/serialize.ts, routes/profile.ts}`;
    - `apps/api/wrangler.jsonc`;
    - `apps/api/vitest.config.ts`: an auxiliary `chatsoon-og` stub Worker in `miniflare.workers` whose `OgRenderer.render` returns a fixed small JPEG, so the binding resolves;
    - `apps/api/test/{pages.test.ts (new), account.test.ts}`.
  - **Build:** §3.3.
  - **Tests:**
    - the DTO has exactly the whitelisted keys;
    - for a `'public'` profile with phone `+61491570156`, WhatsApp `+61491570157` and a Signal username, neither `/_pages/profile` nor `/_pages/og` returns any of: `491570156`, `491570157`, the username, `tel:`, `wa.me`, `signal.me`;
    - a bad or missing key, or an unset secret, returns 404;
    - 61 misses with one `x-client-ip` return `rate_limited`, and a missing IP is never limited;
    - the first request renders once and puts the file; the second doesn't render;
    - a stale `v` gets `max-age=300`, the current one `3600`, and a matching `If-None-Match` gets 304;
    - a WebP or oversized avatar reaches the renderer as `avatar === null`;
    - disabled cards, or a missing binding, give 503 and `ogVersion: null`;
    - a PUT that changes the headline pre-renders the new key and deletes the old one; a PUT that only changes links doesn't render;
    - deleting the account removes `u/<id>/og/*`.
- **WP-6 Docs and policy**
  - **Owns:** `apps/mobile/src/content/legal.json`, `docs/public-pages-plan.md`, `DEPLOY.md`, `CLAUDE.md` (Layout: `apps/og`; Commands: `pnpm deploy:og`), `docs/native-pending.md`.
  - **legal.json, privacy, "Your public profile":** add this paragraph, which replaces the §3.6 Stage C line: "When you share your profile link in apps such as LinkedIn, WhatsApp, Slack, X or iMessage, the app shows a link preview made from your public profile: an image with your name, photo, role, company and headline, and the same details as text. Your phone, WhatsApp and Signal details are never included in link previews. When you change your profile, new previews show the change, but apps that already made a preview may keep showing their copy for a while, and we can't remove copies they've made."
  - **legal.json, line 94:** after "including profile and card photos", add "and the link preview images made from your profile". Bump `privacy.updated`.
  - **Plan doc:**
    - §2.1: add the `/og/*` and `/id/:slug/og.jpg` rows;
    - §3.3: the og lines become §3.4 of this plan;
    - §3.6: the line above;
    - Stage C: note that C1, C2 and C5 files now exist and that the transport is the §3.1 fallback.
  - **DEPLOY.md:** the Phase 2 runbook (below).
  - **native-pending:** add a row "Privacy text: link previews (web now, native at the next batch)".

**Wave 2**

- **WP-5 Web Function** (after WP-2 is merged and after WP-3's install step)
  - **Owns:**
    - `apps/web/{package.json (+@cloudflare/workers-types), tsconfig.json (include functions), wrangler.jsonc, .dev.vars.example}`;
    - `apps/web/functions/id/[[path]].ts` (a thin `onRequest`);
    - `apps/web/src/server/{og-inject.ts, og-image.ts, profile-source.ts, headers.ts, types.ts}`;
    - `apps/web/test/{og-inject.test.ts, og-image.test.ts}`.
  - **Build:** the §3.4 handlers.
  - **Tests** (Node vitest, with a fake `next`, a fake `env.API` and a fake `env.ASSETS`):
    - the generic block is removed, there is exactly one og:image, and the tags end before byte 2048;
    - the untouched shell comes back on not_found, rate_limited, a throw or a timeout;
    - conditional request headers are stripped and ETag and Content-Length are dropped;
    - an invalid slug makes no API call;
    - `/index.html` is never fetched;
    - for the image: the pass-through headers plus the 3 security headers, HEAD with no body, 404, 429 and the default-image fallback on 503 or timeout;
    - the injected `contact` leak test.

**Order:** WP-0 and WP-1 now. Then [Stage B] → WP-2 ∥ WP-3 ∥ WP-4 ∥ WP-6 → WP-5 → Peter approves the previews → Phase 2 deploy.

**Phase 2 deploy:**
1. Run `npx wrangler pages download config chatsoon-web` and merge it, so that `wrangler.jsonc` becoming the source of truth drops no dashboard settings.
2. Deploy the renderer: `pnpm deploy:og`. Check that the reported startup time is under 1 s.
3. Create the secret with `openssl rand -hex 32`, then set it with `wrangler secret put PAGES_SHARED_SECRET` in `apps/api` and `wrangler pages secret put PAGES_SHARED_SECRET --project-name chatsoon-web` in `apps/web`.
4. `pnpm deploy:api`.
5. `pnpm deploy:web`.
6. Warm Peter's card: `curl -s -o /dev/null https://chatsoon.app/id/peter-bui-5ec50167/og.jpg`.

---

## 5. Verification

- **Unit tests:** `pnpm -r typecheck`, then `pnpm --filter @chatsoon/shared test`, `pnpm --filter @chatsoon/api test`, `pnpm --filter @chatsoon/web test` and `pnpm --filter @chatsoon/og test` (workerd).
- **Local:**
  - **API plus renderer in one session:** `cd apps/api && npx wrangler dev -c wrangler.jsonc -c ../og/wrangler.jsonc`, with `PAGES_SHARED_SECRET` in both `.dev.vars` files.
  - **Web:** `cd apps/web && CHATSOON_ENV_FILE=../mobile/.env.development CHATSOON_ALLOW_DEV_BUILD=1 pnpm build && npx wrangler pages dev dist --port 8788`.
  - **Checks:**
    ```sh
    for ua in 'facebookexternalhit/1.1' 'Twitterbot/1.0' 'LinkedInBot/1.0' 'WhatsApp/2.23.20.0' 'Slackbot-LinkExpanding 1.0' 'Discordbot/2.0' 'TelegramBot (like TwitterBot)'; do
      curl -s -A "$ua" localhost:8788/id/<local-slug> | grep -oE '<meta (property|name)="(og|twitter):[^>]*>'; done
    curl -s localhost:8788/id/<local-slug> | head -c 2048 | grep -c 'og:image"'        # 1
    curl -s localhost:8788/id/<local-slug> | grep -c 'og:title'                       # 1 (generic block gone)
    curl -sI -A Twitterbot/1.0 "localhost:8788/id/<local-slug>/og.jpg?v=<v>"          # 200 image/jpeg, <300000, nosniff, noindex
    curl -s localhost:8788/contacts | grep -c 'og:url'                                # 0
    curl -s localhost:8788/id/<public-test-slug> | grep -cE '491570156|tel:|wa\.me|signal\.me'   # 0
    ```
- **Production after Phase 1:**
  - `curl -sI https://chatsoon.app/og/chatsoon-<sha8>.jpg` returns `image/jpeg`, immutable (not `text/html`);
  - `/`, `/privacy`, `/terms` and `/support` contain `summary_large_image`;
  - `/contacts` has the og tags and no og:url;
  - `pnpm lh https://chatsoon.app/ --runs 3` still scores 100.
- **Production after Phase 2:**
  - repeat the user-agent loop against `https://chatsoon.app/id/peter-bui-5ec50167`;
  - `og:url` must be present, otherwise the secret or binding is broken;
  - the image returns 200 `image/jpeg`, under 300 KB;
  - a wrong `v` gets `max-age=300`;
  - a nonexistent slug's `og.jpg` returns 404;
  - the leak grep on a `'public'` test profile returns 0.
  - **Workers Observability:** chatsoon-og CPU p99 under about 500 ms, and no errors from `chatsoon-api` on `/_pages/*`.
- **Debuggers:**
  - Facebook Sharing Debugger (Scrape Again), which also covers WhatsApp and Messenger;
  - LinkedIn Post Inspector;
  - opengraph.xyz or metatags.io;
  - Telegram @WebpageBot;
  - X: paste the link into a DM or a draft (the card validator is gone);
  - iMessage, WhatsApp, Slack and Discord: send the link to yourself.
  - Check the home page, a legal page, Peter's profile and a profile with initials.

---

## 6. Risks

| Risk | Mitigation |
|---|---|
| Stage B and C ownership overlap: #5 creates C1, C2 and C5 files early | Wave 1 starts only after Stage B commits. The plan doc (WP-6) records which files now exist, so Stage C edits them instead of rewriting them. |
| Phone or messaging values reach a preview (platforms cache it and it can't be recalled) | Whitelist by field name at three layers (toPageProfile, toOgCard, the card tree). Leak tests in shared, API, og and web. |
| Edge CPU for rendering wasn't measured on Cloudflare (local workerd: 232 ms cold, 105 ms warm) | `cpu_ms: 2000` cap, pre-rendering on save, an Observability check. A failed render serves the generic image and isn't cached. |
| A profile that always fails to render retries on every request (no negative cache) | CPU cap plus logs. Add a negative cache only if it shows up. |
| satori is pinned at 0.32.0 | Upgrading needs a harfbuzz shim. The workerd test and the fingerprint test catch regressions. |
| A missing static file returns 200 `text/html` | build.ts checks every referenced image (magic bytes and size). |
| The secret or binding is misconfigured | Fails safe to the generic tags, but silently. The post-deploy og:url curl is mandatory. |
| Platform caches (Facebook, LinkedIn about 7 days, WhatsApp per chat) keep old or deleted previews | Policy text (WP-6). Scrape Again or Post Inspector for Peter's own profile. |
| Names in CJK, Arabic, Hebrew or Devanagari lose that field on the image | The name stays in og:title. Accepted for v1. |
| Centred-square crops (small WhatsApp or Telegram thumbnails) cut off the left-aligned photo | Peter judges it from the preview sheet. |
| `/id/*` HTML is about 200–250 ms slower until Stage C (lookup is in parallel with `next()`) | Stage C does the lookup anyway. Acceptable. |
| `apps/web/wrangler.jsonc` overrides the dashboard config | Run `pages download config` first. |
| Headline text in a branded image can impersonate ("Verified by Chatsoon") | The existing Report flow. The image is regenerated when the profile is edited. |
| JPEG banding on the dark gradients at q85 | q90 if Peter notices; it still fits under 300 KB. |
| The account is ever downgraded to Free | Set `OG_CARDS_ENABLED="false"`. Profiles fall back to the default image with no code change. |

**Questions for Peter** (each has a default already applied):
- Is the crop at x=356 fine for the generic image?
- The card's call to action: "Connect on Chatsoon", or "Connect with {first}"?
- og:title format (O22).
- Should the headline appear on the card?
- Is there a brand X handle for `twitter:site`?
- Should users be able to opt out of personalised previews? Default: no.