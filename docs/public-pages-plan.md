# Public pages plan: SEO (#1) and PageSpeed 100 (#2)

Written 25 Sep 2026 from three independent analyses. Stages ship one at a time; progress is logged on issues #1 and #2.
The baseline Lighthouse reports were local files and are not in the repo.


All paths are relative to the repo root, `D:\Claude\chatsoon-app`. Evidence files are in `C:\Users\Peter-PC\AppData\Local\Temp\claude\D--Claude-chatsoon-app\b66a9a92-258a-4fa1-a3cc-1c50ce6fb2e2\scratchpad\`.

**Facts checked for this plan.** Each was checked against the code, node_modules or the live site.

**Pages routing and deploys**
- **Rewrites and fallbacks.** Checked in the Pages asset server bundled with wrangler 4.124 (`node_modules/wrangler/wrangler-dist/cli.js` ~484146–484640):
  - `_redirects` is matched once, against the request path.
  - A `200` rewrite only changes which asset is looked up.
  - An unmatched path is served the nearest `<dir>/404.html`, found by walking up the directories, with status 404.
  - If no 404.html exists at any level, it gets `/index.html` with status 200 (the SPA fallback).
- **Functions and deploy directory.**
  - `wrangler pages deploy` reads `functions/` and the wrangler config from the working directory (cli.js 416044).
  - `pages dev` accepts `--service API=chatsoon-api#Entrypoint` (SERVICE_BINDING_REGEXP).
  - Whether a named entrypoint binding works in a *production* Pages deployment is **not proven** here. Stage C starts with a spike on a preview deployment to test it.
- **`_headers` and Functions.** `_headers` is not applied to Function responses: the template worker returns handler responses directly.

**Lighthouse 13.5.0** (npx cache)
- `ard-schema`: a non-200 response with no discovery signal is marked N/A.
- `llms-txt`: a 4xx response is N/A. `llms-proposed.txt` scores 1.
- `robots-txt`: `robots-proposed.txt` scores 1. Adding `Agentmap:` makes it score 0.
- `is-crawlable` fails only when all four of Googlebot, bingbot, DuckDuckBot and archive.org_bot are blocked.
- **Metric thresholds** (from `lhthresh.mjs`):
  - A metric scores 1.00 at FCP ≤1067 ms, LCP ≤1545 ms, TBT ≤64 ms, CLS ≤0.039 and SI ≤1953 ms.
  - With every other metric perfect, the category still rounds to 100 at FCP ≤1571 ms, LCP ≤1934 ms, TBT ≤91 ms or CLS ≤0.060.

**App code and API**
- **Image alt text.** expo-image on web passes only `accessibilityLabel` to `<img alt>` (`ExpoImage.web.tsx`, currentNode). BrandMark's `alt=""` is therefore dropped, and that is the only image-alt failure on both pages.
- **Anonymous profile JSON.** `GET api/id/:slug` includes `contact` for `'public'` profiles (`public.ts` canSeeContact), so it can't be used to build HTML.
- **Rate limiter key.** The miss limiter is keyed `profile-miss:<cf-connecting-ip>`.

**Live site**
- **Missing files.** `/llms.txt`, `/.well-known/ai-catalog.json` and `/no-such-page` all return 200 text/html.
- **Email obfuscation.** `/privacy` has 7 `__cf_email__` rewrites plus email-decode.min.js, so Cloudflare Email Obfuscation is on.
- **API robots.txt.** `api.chatsoon.app/robots.txt` contains only Cloudflare's content-signal comments.
- **D1 latency.** From SIN, the API profile lookup takes about 180 ms longer than `/health`, which is one D1 round trip. The D1 region is unknown.
- **Peter's profile.** It has a headline, role, company, 5 links, 1 booking link and an avatar, and no contact channels. Its LCP element is text.

**Contrast and colour scheme**
- **Ratios** (computed WCAG): dark `#6B61FF` on `#24224C` is 3.39. White on `#6B61FF` is 4.39. Light `#8A8DA1` on white is 3.28.
- **Colour scheme.** PageSpeed Insights (PSI) renders in light mode. The baseline Lighthouse run was in dark mode.

---

## 1. Decisions

"Beats" names the analysis that lost the disagreement.

| # | Decision | Reason | Peter's input? |
|---|---|---|---|
| D1 | Public pages become plain HTML with no framework. `/` is static; `/id/:slug` is rendered by a Pages Function. The Expo SPA (`web.output "single"`) stays for signed-in use. | Any hydration of React Native Web keeps TBT above the 64 ms needed. All three analyses agree. | – |
| D2 | Reject Expo `static`/`server` output and HTMLRewriter-only meta injection. | Both still load the 805 KB bundle. | – |
| D3 | Keep the Pages SPA fallback: `dist/index.html` stays the SPA shell. Serve the home page with `_redirects` `/ /home 200` and `/home / 301`. **No root 404.html.** Beats the architecture analysis's `_spa.html` rename plus a generated route list. | Verified in the asset server: the rewrite applies only to `/`, and the fallback serves `/index.html` directly. There's no app-route list to maintain, so signed-in routes can't break. | – |
| D4 | Add `/.well-known/404.html`, so every unknown `/.well-known/*` path returns a real 404. `ai-catalog.json` becomes N/A. Beats the SEO analysis's valid empty catalog. | Honest, because there are no agent resources to list. It also covers ARD v0.91's `/.well-known/ard.json`. A published catalog with any schema warning scores 0.9. | – |
| D5 | Publish a static `llms.txt`. | Validated at score 1. | – |
| D6 | Profile data comes over the service binding as RPC to a **named** API entrypoint. The client IP is passed as an argument. Fallback: HTTP over the binding with a shared secret. Beats the SEO analysis's public `GET /id/:slug/page`. | On a public route, a forwarded IP could be spoofed to get around the miss limiter. The page uses `toPublicProfile` defaults per issue3-plan §6. | – |
| D7 | Don't edge-cache profile HTML at first. | The policy promises a deleted profile's link "stops working straight away". An uncached lookup still fits the FCP budget. The Cache API plus a purge token move to Stage F, used only if PSI TTFB needs them. | Only if F is needed |
| D8 | The avatar is served same-origin at `/id/<slug>/photo?v=<version>`: the original bytes, `max-age=3600`. The WebP variant is deferred to F. | The avatar is not LCP on Peter's page. The signed API URL expires after 7 days, which breaks link previews. | – |
| D9 | Signed-in web users: an inline `localStorage['chatsoon.session']` check loads the SPA in place. The server stays anonymous. Beats the SEO analysis's inline-data hydration. | Crawlers and Lighthouse never pay for the SPA. Blocked viewers get the SPA's authenticated 404. | – |
| D10 | Numbers are never in HTML. For `'public'` profiles, the chips are buttons that fetch the numbers on tap. Beats plan §6's auto-fill and the performance analysis's fixed rows. | Keeps numbers out of Google's rendered page even if a robots rule regresses. No CLS. Scraping costs more. | **Yes.** Default: tap to reveal |
| D11 | Search visibility is a per-profile opt-in, off for existing and new profiles. It's in Edit profile on web now and in the next native batch. | The policy says profiles are for "the people you share it with" (legal.json:33); GDPR Art 25(2). | **Yes.** Default: off, no onboarding prompt |
| D12 | robots.txt: `Content-Signal: search=yes, ai-input=yes, ai-train=no`. AI-training crawlers are disallowed from `/id/`. | Opted-in profiles stay findable, including in AI answers, without feeding training. | **Yes.** Default as stated |
| D13 | A new workspace package, `apps/web` (`@chatsoon/web`), owns the renderer, Functions, build and deploy. Beats the performance analysis's approach of extending `build-static-pages.mjs`. | Keeps Worker types and `functions/` out of Metro and the mobile tsconfig (`include: **/*.ts`). Wrangler must run from that directory. | – |
| D14 | Tokens move to `packages/shared/src/design.ts`, and theme.ts re-exports them. New text tokens: `primaryText`, `successText`, `dangerText`. Contrast values are the performance analysis's. | One source for the RN app and the CSS. Values verified above. | – |
| D15 | No WebMCP annotations. | Weight 0, and they would invite automation of a form gated by Turnstile. | – |
| D16 | Cloudflare Web Analytics (RUM beacon): **removed by Peter on 25 Sep 2026.** Budgets allow no third-party requests before load, with no exceptions. | Nothing third-party loads before the page finishes. Field Core Web Vitals come from Search Console (CrUX) instead. | Done |
| D17 | Wrap every generated mailto in `<!--email_off-->…<!--/email_off-->`. | Avoids the injected decoder script, with no dashboard change. | – |
| D18 | Signed-in visitors to `/` still go to `/contacts`, now through an inline head script. | Same behaviour as `index.tsx:12`. | – |
| D19 | Slugs stay as they are. | Printed QR codes, and the protection against guessing slugs. | – |
| D20 | Home headings: the eyebrow "The networking CRM built for events" becomes the h1. Feature titles become "Share your digital business card", "Scan cards and badges with AI", "Organise everyone", "Find anyone fast", "Private by design". | Keyword-bearing and still true. | **Yes.** Default: adopt |
| D21 | Don't add the Mesh With Us credits block to generated HTML. | README.md already carries it, and the pages have a byte budget. | – |
| D22 | Pin Lighthouse 13.5.0 in a repo runner from Stage A. Budgets gate from Stage E. | PSI quota is 0, and Lighthouse 12 (lhci) has no agentic-browsing category. | – |
| D23 | JSON-LD only on indexable profiles. Beats the architecture analysis's "always". | Nothing to gain on noindex pages. | – |
| D24 | A global per-IP Connect limiter of 30/60 s, shipped with Stage D. | Findable profiles plus auto-accept make harvesting cheaper. Turnstile stays the main gate. The binding only supports 10 s or 60 s periods. | **Yes.** Default 30/60 s; the 100/day cap is unchanged |

---

## 2. Architecture and file layout

### 2.1 What serves each path

| Path | Served by | Status and headers |
|---|---|---|
| `/` | `dist/home.html` through `_redirects` `/ /home 200` | 200, from `_headers` `/*` |
| `/home` | `_redirects` `/home / 301` | 301 |
| `/privacy`, `/terms`, `/support` | Static HTML from the apps/web renderer | 200 |
| `/id/:slug` | Function `functions/id/[[path]].ts` | 200 / 301 (uppercase or trailing slash) / 404 (invalid or missing) / 429 (miss limiter) / 503 (RPC error) |
| `/id/:slug/photo?v=` | Same Function | 200 streamed / 404 / 429 |
| Other `/id/*` | Same Function | 404 |
| `/sitemap-profiles.xml` | Function (Stage D) | 200 application/xml, `max-age=3600` |
| `/sitemap.xml`, `/robots.txt`, `/llms.txt` | Static, from `apps/mobile/public` | 200 |
| `/.well-known/apple-app-site-association`, `assetlinks.json` | Static, unchanged | 200 |
| Other `/.well-known/*` | `/.well-known/404.html` | **404** |
| App routes (`/sign-in`, `/contacts`, …) | SPA fallback (`dist/index.html`) | 200 plus `X-Robots-Tag: noindex` (`_headers`) |
| Other unknown paths | SPA fallback; `+not-found` sets meta noindex | 200 (accepted soft 404) |
| `api.chatsoon.app/robots.txt` | API route | `Disallow: /` |

`dist/_routes.json`: `{"version":1,"include":["/id/*","/sitemap-profiles.xml"],"exclude":[]}`. Nothing else invokes a Function.

### 2.2 Data flow for `/id/:slug`

1. A browser or crawler requests `chatsoon.app/id/<slug>`.
2. The Pages Function `handle()` validates the slug with `isValidSlug`. An invalid slug gets a 404 without any RPC call.
3. It calls `env.API.profilePage(slug, request.headers.get('cf-connecting-ip'))` over the service binding. This reaches the `chatsoon-api` `PagesEntrypoint`.
4. The entrypoint runs `findProfileBySlug`, then `toPublicProfile(env,row)` with default options (so `contact` is never added), then `toPageProfile` (whitelist). A miss runs `PROFILE_MISS_LIMITER` with key `profile-miss:<ip>`, the same bucket as the HTTP route.
5. `renderProfile(dto, assets)` builds the page as a string template: inline CSS, an inline SVG sprite, system fonts.
6. The HTML carries one module script, `/_p/profile-<hash>.js` (≤10 KB gzip, the "island"). It handles Connect (Turnstile), the booking dialog, the report dialog and number reveal.
7. The inline head script runs the SPA handoff (§2.3).

The island POSTs to `api.chatsoon.app/id/:slug/connect` and `/reports` with `credentials:'omit'`; the existing CORS already allows chatsoon.app. For a `'public'` profile, number reveal fetches `GET api/id/:slug`. The Function sets its own security headers (§3.3).

### 2.3 Signed-in web users and native

- **Head of the profile HTML** (inline, try/catch): `if (localStorage.getItem('chatsoon.session')) document.documentElement.classList.add('spa')`. CSS `.spa #page{display:none}` shows a centred spinner instead, so the anonymous page never flashes.
- **End of body** (inline): in spa mode, inject the expo-reset `<style>`, the SPA CSS `<link>`, `<div id="root">` and the SPA entry `<script>`. The URLs are read from `dist/index.html` at build time and written to `functions/_generated/assets.ts`. Expo Router then renders `id/[slug].tsx` (member actions, own profile, blocked or unblock) exactly as today. The island exits when `html.spa` is set.
- **Home:** the same token check runs `location.replace('/contacts')`.
- **Expired token:** the SPA's 401 handler signs out and shows today's React Native visitor view. That's slower, but correct.
- **Native:** no route, file or module changes. `id/[slug].tsx` keeps every branch, and universal links and the AASA file are untouched. The only native-visible changes arrive with the next batch: token colours (A), a shared-helper move (C, identical output) and the search toggle (D). Each gets a `docs/native-pending.md` row.

### 2.4 Caching

| Resource | Cache-Control | Edge cache |
|---|---|---|
| home, legal, llms.txt, robots.txt | Pages default (`public, max-age=0, must-revalidate`) + ETag | Pages |
| `/id/:slug` 200 | `public, max-age=0, must-revalidate` | none (D7) |
| `/id/:slug` 404 | `public, max-age=60` | none |
| 429 / 503 | `no-store`, `Retry-After: 60/30` | none |
| `/id/:slug/photo` | `public, max-age=3600` when `v` is current, else `public, max-age=60` | none |
| `/_p/*`, `/_expo/static/*` | `public, max-age=31536000, immutable` (`_headers`) | Pages |
| `/sitemap-profiles.xml` | `public, max-age=3600` | none |
| API `GET /id/:slug` JSON | unchanged (`public, max-age=60`) | – |

### 2.5 File layout

```
apps/web/                               @chatsoon/web — the chatsoon-web Pages project; deploy cwd
  package.json  wrangler.jsonc  tsconfig.json  tsconfig.client.json  vitest.config.ts  .gitignore
  functions/id/[[path]].ts              thin onRequest → src/server/handle.ts              [C]
  functions/sitemap-profiles.xml.ts     → src/server/sitemap.ts                           [D]
  functions/_generated/assets.ts        gitignored; written by build (SPA css/js, reset css, island url, site key, API origin) [C]
  src/render/  escape css icons icon-paths layout home legal                             [B]
               profile head status handoff                                               [C]
               json-ld                                                                   [D]
  src/server/  handle headers types                                                     [C]  sitemap [D]
  src/client/  profile turnstile connect booking report reveal dom                       [C]
  scripts/     build.ts  gen-icons.ts
  test/
packages/shared/src/  design.ts [B]  profile-page.ts [C]  types.ts (+PageProfile) [C]
apps/api/src/pages.ts [C]           apps/api/migrations/0007_search_visibility.sql [D]
apps/mobile/public/   llms.txt  .well-known/404.html [A]   og.png  logo.png [B]
deleted: apps/mobile/scripts/build-static-pages.mjs [B]
```

**Build** (`apps/web`, `pnpm build`):
1. `pnpm --filter @chatsoon/mobile exec expo export --platform web --clear --output-dir ../web/dist`
2. `tsx scripts/build.ts`: environment check, home, legal pages, `_redirects`, then from C the island, `_routes.json` and `_generated`.

**Deploy:** from `apps/web`, run `wrangler pages deploy dist --project-name chatsoon-web --branch main`. The root script `pnpm deploy:web` keeps its name and delegates to it.

---

## 3. Contracts

### 3.1 RPC entrypoint (`apps/api/src/pages.ts`, exported from `index.ts` alongside `export default app`)

```ts
// packages/shared/src/types.ts
export interface PageProfile {
  slug: string; displayName: string; headline: string | null; company: string | null; role: string | null;
  links: ProfileLinks; bookingLinks: BookingLink[];
  contactChannels: ProfileContactKey[]; contactVisibility: ContactVisibility;   // never values
  avatarVersion: string | null;   // first 16 hex of SHA-256(avatarKey)
  updatedAt: string;              // ISO
  indexable: boolean;             // Stage C: always false; Stage D: computed
}
export type ProfilePageResult = { status: 'ok'; profile: PageProfile } | { status: 'not_found' } | { status: 'rate_limited' };
export type ProfilePhotoResult =
  | { status: 'ok'; body: ReadableStream; contentType: string; version: string; indexable: boolean }
  | { status: 'not_found' } | { status: 'rate_limited' };

// apps/api/src/pages.ts
export class PagesEntrypoint extends WorkerEntrypoint<Env> {
  profilePage(slug: string, clientIp: string | null): Promise<ProfilePageResult>;
  profilePhoto(slug: string, clientIp: string | null): Promise<ProfilePhotoResult>;
  indexableProfiles(): Promise<{ slug: string; updatedAt: string }[]>;   // Stage D
}
```

- **`toPageProfile(env,row)`** (serialize.ts) calls `toPublicProfile(env,row)` with **no opts**, then copies only the fields above by name. It never spreads the object.
- **Miss limiter.** On a miss, when `clientIp` is set, call `PROFILE_MISS_LIMITER.limit({key:`profile-miss:${clientIp}`})`. If `success` is false, return `rate_limited`.
- **Fallback if the C5 spike shows Pages can't bind a named entrypoint.** Add an HTTP route `GET /_pages/profile/:slug` and `/_pages/photo/:slug` in a separate Hono sub-app. It returns 404 unless `x-pages-key` matches the secret `PAGES_SHARED_SECRET` (constant-time compare), and takes the IP from `x-client-ip`. The Function calls it through `env.API.fetch`.

### 3.2 Database and API (Stage D)

```sql
-- apps/api/migrations/0007_search_visibility.sql (generate via schema.ts + db:generate)
ALTER TABLE profiles ADD search_visible integer DEFAULT 0 NOT NULL;
ALTER TABLE profiles ADD search_visible_at integer;          -- consent trail, set when the value changes
ALTER TABLE profiles ADD search_blocked integer DEFAULT 0 NOT NULL;  -- ops kill switch (wrangler d1 execute)
CREATE INDEX profiles_search_idx ON profiles (search_visible, slug);
```

- **Input schema:** `profileInputSchema.searchVisible: z.boolean().optional()`. `MyProfile.searchVisible: boolean`. `PublicProfile` is unchanged.
- **PUT `/me/profile`:** `searchVisible: keep(input.searchVisible, existing?.searchVisible ?? false)`, so 1.0 native clients can't reset it. Set `searchVisibleAt = new Date()` only when the value changes.
- **`isIndexable`** is true only when all of these hold:
  - `search_visible` is on and `search_blocked` is off;
  - the slug is not `alex-rivera-demo` or `maya-lindqvist-demo`;
  - the owner's email is not `review@chatsoon.app` and doesn't match `demo+%@chatsoon.app`;
  - at least one of headline, role, company or avatarKey is set.
- **`indexableProfiles()`:** the same predicate in SQL (join users), `ORDER BY slug LIMIT 50000`.
- **`CONNECT_ANY_LIMITER`:** `{namespace_id:"1011", simple:{limit:30, period:60}}`, key `connect-any:<ip>`, checked before the per-slug limiter in `POST /id/:slug/connect`.

### 3.3 Profile page head and headers

```html
<title>{profileTitle(p)}</title>   <!-- "{name} – {roleLine ?? headline} · Chatsoon"; if > 65 chars: "{name} · Chatsoon" -->
<meta name="description" content="{describeProfile(p)}">   <!-- today's describe(), capped at 160 chars on a word boundary -->
<link rel="canonical" href="https://chatsoon.app/id/{slug}">
<meta name="robots" content="noindex">                     <!-- D: "max-image-preview:large" when indexable -->
<meta property="og:type" content="profile"><meta property="og:site_name" content="Chatsoon">
<meta property="og:title" content="{name}"><meta property="og:description" content="{describeProfile(p)}">
<meta property="og:url" content="https://chatsoon.app/id/{slug}">
<meta property="og:image" content="https://chatsoon.app/id/{slug}/photo?v={avatarVersion}">  <!-- no avatar: /og.png -->
<meta property="og:image:alt" content="{name} on Chatsoon"><meta name="twitter:card" content="summary">
<meta name="theme-color" content="#5146E5"><link rel="icon" href="/favicon.ico">
```

**Response headers on every Function response:**
- `Content-Type` (the right type for each response);
- `X-Content-Type-Options: nosniff`;
- `Referrer-Policy: strict-origin-when-cross-origin`;
- `X-Frame-Options: DENY`;
- `Permissions-Policy: camera=(self), microphone=(), geolocation=(), payment=()`;
- `X-Robots-Tag: noindex` on everything except indexable profile pages (from Stage D).

The photo endpoint carries `X-Robots-Tag: noindex` unless the profile is indexable.

**Body, in order:**
1. Site header: logo link with `aria-label="Chatsoon home"`, and **Sign in** linking to `/sign-in?next=/id/{slug}`.
2. `<main id="page" data-slug data-api data-sitekey data-first data-visibility>`.
3. Profile card:
   - `<img width=104 height=104 alt="{name}" fetchpriority="high" decoding="async">`, never lazy. Without an avatar, CSS initials with `aria-hidden`.
   - `<h1>` with the name, the headline, and roleLine.
   - Links as `<a target=_blank rel="me noopener noreferrer">`, with visible text plus visually hidden "(opens in a new tab)".
   - Channel chips: `'connections'` shows locked chips and "Connect with {first} to get their number."; `'public'` shows `<button data-reveal>` chips.
   - `<a rel="nofollow" href="https://api.chatsoon.app/id/{slug}/vcard">Save contact</a>`.
4. `<section>` with `<h2>Book a meeting</h2>`. Each row is `<a href="{bookingOpenUrl}" target=_blank rel="nofollow ugc noopener noreferrer" data-embed="{bookingEmbedUrl(link,'chatsoon.app')}">`, and its accessible name is its visible text.
5. `<section>` with `<h2>Connect with {first}</h2>` and a real `<form>`. Fields each have a `<label for>`:
   - `name`: `autocomplete=name`, `maxlength=120`;
   - `contact`: `autocomplete=email`, `maxlength=200`;
   - `note`: textarea, `maxlength=1000`.
   Then a Turnstile slot `min-height:65px`, a `role=alert` error line, the Send button, and the privacy link.
6. A promo link, "Create your free digital business card", to `/`.
7. A `<button>Report profile</button>`, plus a `<noscript>` mailto fallback.
8. Footer with Home, Privacy, Terms and Support, and the email inside `<!--email_off-->`.

### 3.4 JSON-LD

**Profile** (Stage D, only when `indexable`). Escape with `JSON.stringify(x).replace(/</g,'\\u003c').replace(/>/g,'\\u003e').replace(/&/g,'\\u0026').replace(/\u2028/g,'\\u2028').replace(/\u2029/g,'\\u2029')`. Omit any null field.

```json
{"@context":"https://schema.org","@type":"ProfilePage","@id":"https://chatsoon.app/id/{slug}","url":"https://chatsoon.app/id/{slug}",
 "dateModified":"{updatedAt}",
 "isPartOf":{"@type":"WebSite","@id":"https://chatsoon.app/#website","name":"Chatsoon","url":"https://chatsoon.app/"},
 "mainEntity":{"@type":"Person","@id":"https://chatsoon.app/id/{slug}#person","name":"{displayName}","description":"{headline}",
   "jobTitle":"{role}","worksFor":{"@type":"Organization","name":"{company}"},
   "image":"https://chatsoon.app/id/{slug}/photo?v={avatarVersion}","url":"https://chatsoon.app/id/{slug}",
   "sameAs":["{toLinkUrl(k, links[k]) for k in linkedin,x,youtube,telegram,website; utm_* params stripped}"]}}
```

Never include `telephone`, `contactPoint`, `email`, `tel:`, `wa.me`, `signal.me`, vCard or booking URLs.

**Home** (Stage B):

```json
{"@context":"https://schema.org","@graph":[
 {"@type":"WebSite","@id":"https://chatsoon.app/#website","url":"https://chatsoon.app/","name":"Chatsoon","publisher":{"@id":"https://chatsoon.app/#org"}},
 {"@type":"Organization","@id":"https://chatsoon.app/#org","name":"Moshi Concepts Inc.","brand":{"@type":"Brand","name":"Chatsoon"},
  "url":"https://chatsoon.app/","email":"hello@chatsoon.app","logo":"https://chatsoon.app/logo.png"},
 {"@type":"WebApplication","name":"Chatsoon","url":"https://chatsoon.app/","applicationCategory":"BusinessApplication",
  "operatingSystem":"Web","offers":{"@type":"Offer","price":"0","priceCurrency":"USD"}}]}
```

No `aggregateRating`. Don't mention iPhone or Android until the store apps are live.

**Home head:**
- Title: "Chatsoon: networking CRM and digital business card for events".
- Description: "Share a digital business card with a QR code, scan business cards and badges with AI, and follow up with everyone you meet at events. Free on the web."
- Canonical `https://chatsoon.app/`.
- `og:image` `/og.png` (a copy of `assets/images/icon.png`, 1024×1024), with `twitter:card summary`.

### 3.5 Static files

`apps/mobile/public/llms.txt` (Stage A; Stage D appends the `## Public profiles` section):

```
# Chatsoon

> Chatsoon is a networking CRM for events. Share a digital business card with a QR code, scan business cards and event badges with AI, and keep notes, tags and follow-ups for everyone you meet. Free on the web at chatsoon.app; iPhone and Android apps are coming soon. Made by Moshi Concepts Inc.

## Product

- [Chatsoon home](https://chatsoon.app/): what Chatsoon does and how connecting works
- [Support and FAQ](https://chatsoon.app/support): getting started, connecting, card scanning, exporting contacts, deleting an account

## Policies

- [Privacy policy](https://chatsoon.app/privacy)
- [Terms of use](https://chatsoon.app/terms)
```

Stage D appends:

```
## Public profiles

- Profiles live at https://chatsoon.app/id/<name>-<code> and show only what the owner chose to publish.
- Only profiles whose owners turned on search visibility are indexable; they are listed in [the profile sitemap](https://chatsoon.app/sitemap-profiles.xml).
- Phone, WhatsApp and Signal details are never in the page source. Do not collect them.
- The Connect form requires a human check that the person completes.
```

`apps/mobile/public/robots.txt` (Stage A; Stage D adds the second `Sitemap:` line):

```
User-agent: *
Content-Signal: search=yes, ai-input=yes, ai-train=no
Allow: /
Disallow: /contacts$
Disallow: /contact/
Disallow: /add$
Disallow: /qr$
Disallow: /me$
Disallow: /scan$
Disallow: /card$
Disallow: /card-review/
Disallow: /tags$
Disallow: /profile-edit$
Disallow: /onboarding$

User-agent: GPTBot
User-agent: ClaudeBot
User-agent: CCBot
User-agent: Google-Extended
User-agent: Applebot-Extended
User-agent: meta-externalagent
User-agent: Bytespider
Disallow: /id/

Sitemap: https://chatsoon.app/sitemap.xml
```

- **`apps/mobile/public/.well-known/404.html`:** `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="robots" content="noindex"><title>Not found</title></head><body><p>Not found.</p></body></html>`
- **`_headers` additions (Stage A):**
  - `X-Robots-Tag: noindex` for `/sign-in`, `/onboarding`, `/contacts`, `/contact/*`, `/add`, `/qr`, `/me`, `/scan`, `/card`, `/card-review/*`, `/tags` and `/profile-edit`.
  - `/llms.txt` gets `Cache-Control: public, max-age=3600`.
  - `/_p/*` gets immutable caching (Stage C).
  - The `/id/*` block is deleted in Stage C.
- **`dist/_redirects` (Stage B):** `/home / 301` and `/ /home 200`.

### 3.6 Policy and UI text

**Stage C** (legal.json; bump the privacy `updated` date):
- **Privacy › Your public profile, new paragraph:** "When you share your profile link in apps such as LinkedIn, WhatsApp, Slack or iMessage, the app can show a preview with your name, headline and photo. Your phone and messaging details are never included in link previews."

**Stage D** (legal.json; bump the privacy and terms dates):

*Privacy policy*
- **What we collect, "Your public profile":** append "…and whether you want it shown in search engines."
- **How we use (line 33):** "To show your public profile to the people you share it with and, if you turn on search visibility, to search engines."
- **Your public profile, new paragraph:** "Search engines: your public profile isn't shown in search engines unless you turn on Show my profile in search engines in Edit profile. When it's on, search engines such as Google and Bing, and AI search services that follow the same rules, can show your name, photo, headline, role, company and links, and we list your profile in our sitemap. We ask AI companies' training crawlers not to collect public profiles. When you turn it off or delete your account, we tell search engines to drop your profile and take it out of our sitemap straight away. Most search engines drop it within a few weeks, but we can't control copies they or other sites have already made."
- **Line 52:** replace "They're never shown to search engines." with "They're never included in the page we give search engines, in our sitemap or in link previews."

*Terms*
- **Line 161:** "…to show your public profile to the people you share it with, and to search engines if you turn that on…"
- **Line 163:** add "…and anyone searching the web if you turn on search visibility…"

*Support*
- **New FAQ** "How do I show or hide my profile on Google?": Edit profile › Search engines. Removal usually takes days to weeks.

*Edit profile switch* ("Show my profile in search engines")
- **Caption when off:** "Only people with your link or QR code can find your profile."
- **Caption when on:** "Google and other search engines can list your name, photo, headline, role, company and links, so people can find you by searching your name. Your phone and messaging details are never shown to search engines."
- **On turning it off:** "Search engines will be asked to remove your profile. It usually disappears within a few days to a few weeks."
- **When on and contact channels exist:** "Anyone who connects with you can still get your number." For `'public'` visibility: "Anyone with your link can still get your number."
- **Own-profile card status line:** "Your profile is shown in search engines" or "Your profile is only shown to people with your link".

---

## 4. Stages

Each stage ships to production on its own. Within a stage, work packages (WPs) own disjoint files.

**Every WP must:**
- use `pnpm`;
- run `pnpm -r typecheck`;
- put no hex literals in screens (use `useTheme()`);
- use `showAlert`/`confirm` from `src/lib/dialogs.ts`, never `Alert.alert`;
- use only deep imports of `@chatsoon/shared/src/<module>` from `apps/web`, never the index, which pulls in zod.

### Stage A: quick wins on the current SPA (web and API; no native build)

**Expected Lighthouse** (mobile, production):

| Page | Performance | Accessibility | Best practices | SEO | Agentic |
|---|---|---|---|---|---|
| Home | 73 (unchanged) | 89 → 100 | 100 | 92 → 100 | 50 → 100 |
| Profile | 53 → about 65 | 94 → 100 | 100 | 58 → 66 | 37 → 100 |

On the profile page, CLS goes from 0.257 to about 0.037 (limit 0.039) and SEO stays at 66 because of noindex. Accessibility is 100 in both colour schemes.

- **WP-A1 Agent and robots files.** Owns `apps/mobile/public/llms.txt` (new), `apps/mobile/public/.well-known/404.html` (new), `apps/mobile/public/robots.txt`, `apps/mobile/public/_headers`.
  - Write the §3.5 contents exactly, and add the `_headers` noindex blocks.
  - Remove `Disallow: /sign-in`, so Google can see the noindex. Keep the `/id/*` block for now.
  - Test: after `pnpm build:web`, check that `apps/mobile/dist/llms.txt` and `dist/.well-known/404.html` exist.
- **WP-A2 Contrast, alt text, CLS.** Owns `apps/mobile/src/constants/theme.ts`, `apps/mobile/src/components/ui/text.tsx`, `apps/mobile/src/components/web/brand-mark.tsx`, `apps/mobile/src/app/id/[slug].tsx`, `docs/native-pending.md`.
  - **Light tokens:** `textTertiary #686B7F`. Add `primaryText #5146E5`, `successText #0E7A3E`, `dangerText #B42D2D`.
  - **Dark tokens:** `textTertiary #8A8DA1`, `primary #5A50F0`, `primaryPressed #4C42D9`. Add `primaryText #8F88FF`, `successText #34C372`, `dangerText #FF6464`.
  - **Text component:** `const TEXT_ALIAS = {primary:'primaryText', success:'successText', danger:'dangerText'} as const`, then `color: theme[TEXT_ALIAS[color] ?? color]`.
  - **Direct text colours:** grep `apps/mobile/src` for text styles set to `theme.primary` and switch them to `theme.primaryText`, in this WP's owned files only. List any others in the PR for a follow-up.
  - **BrandMark:** replace `alt=""` with `accessibilityLabel=""`.
  - **ProfileLoading:** on web, add `minHeight: useWindowDimensions().height`. The footer then starts below the fold and can't shift.
  - **native-pending row:** "Accessible colour tokens (web now; native appearance changes)".
  - Test: typecheck, then the §5 Lighthouse runs.
- **WP-A3 API robots.** Owns `apps/api/src/index.ts`, `apps/api/test/health.test.ts`.
  - Add `app.get('/robots.txt', c => c.text('User-agent: *\nDisallow: /\n', 200, {'Cache-Control':'public, max-age=86400'}))`.
  - Test: 200, text/plain, and the body contains `Disallow: /`.
- **WP-A4 Lighthouse runner.** Owns root `package.json` (devDeps `lighthouse@13.5.0`, `chrome-launcher`; scripts `"lh"`), `pnpm-lock.yaml`, `scripts/lighthouse.mjs` (new).
  - CLI: `pnpm lh <url…> [--runs 3] [--scheme light|dark|both] [--out dir] [--budgets file]`.
  - Launch Chrome with chrome-launcher (`CHROME_PATH` honoured, `--headless=new`) and connect puppeteer-core, which Lighthouse depends on.
  - Call `page.emulateMediaFeatures([{name:'prefers-color-scheme',value}])` before `lighthouse(url,{output:'json'},undefined,page)`.
  - After each run, evaluate `matchMedia('(prefers-color-scheme: dark)').matches` and fail if it's wrong.
  - Print median category scores, FCP, LCP, TBT, CLS, SI, document bytes, total bytes, request count, third-party requests before load, and failing audits with weight > 0. Save the JSON reports.
  - Test: one run against `https://chatsoon.app/` completes and prints the table.

### Stage B: `apps/web` package and static home page

**Expected:** home 100 on all five categories in both schemes, with LCP about equal to FCP (≈0.9 s) and TBT about 0. Legal pages unchanged or better. Profile as after A.

WPs run in order: B1, then B2, then B3.

- **WP-B1 Shared tokens and landing copy.** Owns `packages/shared/src/design.ts` (new), `packages/shared/src/design.test.ts` (new), `packages/shared/src/index.ts`, `packages/shared/package.json`, `apps/mobile/src/constants/theme.ts`, `apps/mobile/src/content/landing.json` (new), `apps/mobile/src/components/web/landing.tsx`.
  - Move `Colors`, `Spacing`, `Radius` and `Type`, with the post-A values, into `design.ts` unchanged (`as const`, no React Native imports). theme.ts re-exports them and keeps `Fonts` and its types.
  - Add `"sideEffects": false` to the shared package.
  - `landing.json` holds every visible string in `landing.tsx`: INTRO, PITCH, FEATURES, STEPS, hero, mock and CTA. Apply the D20 titles. `landing.tsx` renders from the JSON; the eyebrow gets `role="heading" aria-level={1}`, and the hero title loses its heading role.
  - Test: `design.test.ts` asserts contrast ≥4.5 in both schemes for:
    - text, textSecondary, textTertiary and primaryText on background, surface and surfaceAlt;
    - onPrimary on primary;
    - primaryText on primarySoft;
    - successText on successSoft;
    - dangerText on dangerSoft.
- **WP-B2 Renderer.** Owns `apps/web/src/render/{escape,css,icons,icon-paths,layout,home,legal}.ts`, `apps/web/scripts/gen-icons.ts`, `apps/web/test/render-home.test.ts`, `apps/web/test/render-legal.test.ts`.
  - **`css.ts`:** generate `:root{--token:…}` from `Colors.light`, plus a `@media (prefers-color-scheme:dark)` block from `Colors.dark`. Font stack `system-ui,-apple-system,'Segoe UI',Roboto,sans-serif`. Breakpoints at 640 and 960 px, matching `layout.tsx` `useBreakpoint`. Include classes for header, footer, card, pill, button, form, dialog and visually hidden text.
  - **`gen-icons.ts`:** reads `ionicons/dist/svg/<name>.svg` (devDependency `ionicons@^7`) for the names used by the public components (grep `components/web`, `components/booking` and `components/moderation`). It writes `icon-paths.ts`, which is committed.
  - **`icons.ts`:** `sprite(names)` and `icon(name,size)`. Icons render with `aria-hidden="true" focusable="false"` and a fixed width and height.
  - **`layout.ts`:** `page({title, description, canonical, robots, og, jsonLd, headScript, main, headerAction})`. Output: `<html lang="en">`, inline CSS, a header with the inline SVG logo (the LOGO from `build-static-pages.mjs`, with `aria-label="Chatsoon home"`), and a footer with the mailto inside email_off.
  - **`home.ts`:** `renderHome(landing, {qrSvg})`.
    - Head per §3.4.
    - Inline head script: the `/contacts` redirect.
    - h1 is the eyebrow. Section heads are h2 and feature titles h3.
    - The phone mock is HTML and CSS, including the "New" badge in successText.
    - The decorative QR is inline SVG with `aria-hidden`.
  - **`legal.ts`:** `renderLegal(key, doc)`, a port of today's markup onto `layout.ts`.
  - **Tests:**
    - exactly one h1;
    - meta description and canonical present;
    - no external `<script src>` or stylesheet on home;
    - gzip ≤14 KB (`zlib.gzipSync`);
    - every `<a>` has text or an aria-label;
    - JSON-LD parses;
    - email_off wrapper present;
    - no `localhost`;
    - legal pages keep every section heading and anchor.
- **WP-B3 Package, build, deploy.** Owns `apps/web/{package.json,tsconfig.json,vitest.config.ts,.gitignore}`, `apps/web/scripts/build.ts`, root `package.json` (`build:web`, `deploy:web`), `apps/mobile/package.json` (`export:web` becomes `expo export --platform web --clear`), `apps/mobile/scripts/build-static-pages.mjs` (delete), `apps/mobile/public/og.png` and `logo.png` (copies of `assets/images/icon.png` and `favicon.png`), `DEPLOY.md`, and the Layout and Commands lines in `CLAUDE.md`.
  - `build.ts` runs these steps:
    - the `DEV_VALUE` production check, copied verbatim, over `dist/_expo/static/js/**` (with the `CHATSOON_ALLOW_DEV_BUILD=1` bypass kept);
    - `qrcode.toString(WEB_ORIGIN,{type:'svg',margin:0})`;
    - writes `dist/home.html`;
    - writes `dist/{privacy,terms,support}.html` and `dist/<key>/index.html`;
    - writes `dist/_redirects`;
    - fails if `home.html` is over 14 KB gzipped.
  - Scripts: `"build"` is the export plus `tsx scripts/build.ts`. `"deploy"` is `pnpm run build && wrangler pages deploy dist --project-name chatsoon-web --branch main`. `wrangler` is a devDependency (`^4.136.3`).
  - Root: `deploy:web` becomes `pnpm --filter @chatsoon/web run deploy`.
  - Test: `pnpm build:web` produces the files in §2.1. Grep `dist/_redirects`.

### Stage C: server-rendered profile page (all profiles stay noindex)

**Expected** on `/id/peter-bui-5ec50167`: performance about 65 → 100, with LCP (the headline text) about 1.0–1.3 s, TBT about 0 and CLS 0. Accessibility 100, best practices 100, SEO 66 (noindex by design until Stage D), agentic 100. Link previews show name, headline and photo.

WP order: C1 and C2 first; then C3, C4 and C5 in parallel; C6 at any point.

**Deploy order:** API, then a web preview spike, then web main.

- **WP-C1 API entrypoint.** Owns `apps/api/src/pages.ts` (new), `apps/api/src/index.ts`, `apps/api/src/lib/serialize.ts`, `packages/shared/src/types.ts`, `apps/api/test/pages.test.ts` (new).
  - Implement §3.1 (without `indexableProfiles`). Leave the HTTP routes unchanged.
  - `profilePhoto` reads `env.FILES.get(avatarKey)` and returns `obj.body` and `httpMetadata.contentType`.
  - **Tests** (`cloudflare:test` env; `new PagesEntrypoint(createExecutionContext(), env)`):
    - the DTO has exactly the whitelist keys;
    - for a `'public'` profile with phone `+61491570156`, WhatsApp `+61491570157` and a Signal username, `JSON.stringify(result)` contains none of `491570156`, `491570157`, the username, `tel:`, `wa.me` or `signal.me`;
    - `avatarVersion` is 16 hex characters, stable, changes with the key, and is null without one;
    - an invalid slug returns `not_found`;
    - 61 misses from one IP return `rate_limited`, and a null IP is never limited;
    - the photo endpoint returns `ok` or `not_found` as appropriate.
- **WP-C2 Shared page helpers.** Owns `packages/shared/src/profile-page.ts` (new) and its `.test.ts`, `packages/shared/src/index.ts`, `apps/mobile/src/lib/format.ts`, `apps/mobile/src/components/web/profile-card.tsx`, `apps/mobile/src/components/moderation/report-dialog.tsx`, `apps/mobile/src/components/web/connect-form.tsx`, `apps/mobile/src/app/id/[slug].tsx`, `apps/mobile/src/lib/auth.tsx`.
  - Exports:
    - `firstName`, `roleLine`;
    - `describeProfile`: same output as today's `describe()`, capped at 160 characters;
    - `profileTitle`;
    - `REPORT_REASON_LABELS`: moved from report-dialog.tsx:36-42;
    - `CONNECT_FORM_MAX = {name:120, contact:200, note:1000}`;
    - `connectErrorMessage(status, code)`: the strings from connect-form.tsx `errorMessage`;
    - `SESSION_STORAGE_KEY = 'chatsoon.session'`.
  - Mobile call sites import these. Keep re-exports of `firstName` from profile-card and `roleLine` from format.
  - Tests:
    - output matches today's for 3 fixtures;
    - the module doesn't import `schemas` or `zod` (a read-file assertion).
- **WP-C3 Profile renderer.** Owns `apps/web/src/render/{profile,head,status,handoff}.ts`, `apps/web/test/render-profile.test.ts`.
  - Implement §3.3.
  - `status.ts` covers 404, 429 and 503, all noindex.
  - `handoff.ts` produces the head check and body loader from §2.3.
  - **Tests** use fixtures: with and without avatar, 5 links, 5 booking links, and channels set to connections, public or none. Assert:
    - exactly one h1 containing the name;
    - `img` has alt, width, height and `fetchpriority="high"`, and no `loading="lazy"`;
    - passing the DTO with an injected `contact` (cast) leaks none of its values;
    - every `target=_blank` has `noopener`;
    - booking hrefs equal `bookingOpenUrl`;
    - the vCard link has `rel="nofollow"`;
    - each `label[for]` matches an input id;
    - the Turnstile slot has `min-height:65px`;
    - the page is ≤14 KB gzipped;
    - `<script>`, `"` and `&` in the name or headline are escaped;
    - robots meta is noindex and there is no JSON-LD.
- **WP-C4 Island.** Owns `apps/web/src/client/{profile,turnstile,connect,booking,report,reveal,dom}.ts`, `apps/web/tsconfig.client.json`, `apps/web/test/client-*.test.ts`.
  - **Config:** read from `#page` data attributes. Exit when `html.spa` is set.
  - **Turnstile:**
    - Inject `https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit` on the first `focusin` or `pointerdown` in the form, or on submit.
    - Render `size:'flexible'`, or `'compact'` below 300 px.
    - Send is always enabled. Submit waits for the token and shows "Checking you're human…".
    - Reset the widget after every submit.
  - **Submit:** POST JSON with `credentials:'omit'`. Map errors with `connectErrorMessage`.
  - **Success:** render the pills with `contactUrl` and `displayContact`. `tel:` opens in the same tab; wa.me and signal.me open in a new tab with `noopener noreferrer`. Add a `vcardUrl` link if one is returned.
  - **Booking:** a plain primary click with no modifier, on a row with `data-embed`, opens a native `<dialog>`. The dialog has the label, "with {first} · {provider}", an iframe created on open and removed on close, "Open in new tab" and Close.
  - **Report:** a dialog with a radiogroup built from `REPORT_REASONS` and the labels, and details with `maxlength=1000`. It sends an anonymous `POST /reports {targetSlug, reason, details}`.
  - **Reveal:** fetch `GET /id/:slug`, then replace the chips with links. Swallow failures, so the console stays clean.
  - Tests: unit tests on the pure parts (payload validation, `shouldOpenInDialog(event)`, error mapping, pill building).
- **WP-C5 Function, config, build.** Owns `apps/web/functions/id/[[path]].ts`, `apps/web/src/server/{handle,headers,types}.ts`, `apps/web/wrangler.jsonc`, `apps/web/scripts/build.ts`, `apps/web/package.json` (esbuild, `@cloudflare/workers-types`), `apps/mobile/public/_headers`, `apps/web/test/handle.test.ts`.
  - **wrangler.jsonc:** `{"name":"chatsoon-web","pages_build_output_dir":"./dist","compatibility_date":"2026-08-20","services":[{"binding":"API","service":"chatsoon-api","entrypoint":"PagesEntrypoint"}]}`.
  - **Handler:** the §2.1 statuses and the §3.3 headers. It returns 405 for anything but GET or HEAD, and HEAD responses have no body.
  - **Build additions:**
    - esbuild the island into `dist/_p/profile-[hash].js` (`--bundle --format=esm --minify --target=es2020`); fail if it is over 10 KB gzipped;
    - parse `dist/index.html` for the SPA CSS, the entry JS and the `#expo-reset` CSS;
    - read `apps/mobile/.env.production` (override with `CHATSOON_ENV_FILE`) for the site key and API origin;
    - write `functions/_generated/assets.ts`;
    - write `dist/_routes.json`;
    - extend the `DEV_VALUE` scan to `dist/_p/**` and `functions/_generated/**`.
  - **`_headers`:** delete the `/id/*` block and add the `/_p/*` immutable block.
  - **Spike first:** `wrangler pages deploy dist --project-name chatsoon-web --branch rpc-spike`, then `curl <preview>/id/alex-rivera-demo` must return 200 HTML containing "Alex Rivera". If the binding is rejected, implement the §3.1 fallback; C1 adds the route.
  - Tests: every row of the status table, the security headers on every response, and no RPC call for an invalid slug.
- **WP-C6 Documentation and policy.** Owns `apps/mobile/src/content/legal.json`, `docs/public-pages.md` (new), `docs/profile-contact.md`.
  - Add the Stage C policy line from §3.6.
  - The new doc covers the architecture (§2), the runbook, and "any visual change to ProfileCard, ConnectForm, BookingLinksCard or ReportDialog needs the matching `apps/web/src/render` change".

### Stage D: search visibility and sitemap (SEO for the person)

**Expected:** once Peter turns search visibility on for his own profile, `/id/peter-bui-5ec50167` scores SEO 100, so all five categories are 100. Profiles that aren't opted in stay at SEO 66 by design.

Order: D1, then D2 and D3 in parallel, with D4. Deploy the API (migration remote, then deploy) before web.

- **WP-D1 API and DB.** Owns `apps/api/src/db/schema.ts`, `apps/api/migrations/0007_*` and meta, `packages/shared/src/schemas.ts`, `packages/shared/src/types.ts`, `apps/api/src/routes/profile.ts`, `apps/api/src/lib/{serialize,profiles}.ts`, `apps/api/src/pages.ts`, `apps/api/src/routes/public.ts`, `apps/api/src/env.ts`, `apps/api/wrangler.jsonc`, `apps/api/test/{profile,pages,public}.test.ts`.
  - Implement §3.2.
  - Tests:
    - a PUT without `searchVisible` keeps it;
    - a change sets `search_visible_at`, and no change leaves it;
    - `indexable` is false for demo and reviewer profiles, thin profiles and `search_blocked`;
    - `indexableProfiles` excludes those;
    - a 31st connect from one IP across slugs returns 429.
- **WP-D2 Web SEO output.** Owns `apps/web/src/render/{profile,head,json-ld}.ts`, `apps/web/src/server/{handle,sitemap}.ts`, `apps/web/functions/sitemap-profiles.xml.ts`, `apps/web/scripts/build.ts` (`_routes.json` include), `apps/mobile/public/robots.txt`, `apps/mobile/public/llms.txt`, `apps/web/test/*`.
  - **Indexable pages:** meta robots `max-image-preview:large`, no `X-Robots-Tag`, and the §3.4 JSON-LD. The photo is noindex unless indexable.
  - **Sitemap:** a `urlset` of `<loc>` and `<lastmod>` entries, escaped.
  - Add `Sitemap: https://chatsoon.app/sitemap-profiles.xml` to robots.txt and the §3.5 section to llms.txt.
  - Tests:
    - indexable: no "noindex" anywhere;
    - JSON-LD has no `telephone`, `contactPoint`, `tel:`, `wa.me`, `signal.me` or `/vcard`;
    - `sameAs` holds only the 5 link kinds, with `utm_` removed;
    - non-indexable: noindex in both meta and header, and no JSON-LD;
    - the sitemap XML parses.
- **WP-D3 Mobile UI.** Owns `apps/mobile/src/components/profile/profile-form.tsx`, `apps/mobile/src/app/id/[slug].tsx`, `docs/native-pending.md`.
  - Add a "Search engines" group with a Switch and the §3.6 captions. It renders only when `withLinks` (Edit profile). It sends `searchVisible` only when changed, the same pattern as `contactVisibility` (lines 107-109).
  - Add the own-profile status line.
  - Add a native-pending row.
- **WP-D4 Policy.** Owns `apps/mobile/src/content/legal.json`. Apply the §3.6 Stage D text.
- **Peter's steps after the deploy:**
  1. Turn on search visibility for your own profile.
  2. Add a Search Console Domain property for chatsoon.app (DNS TXT record) and submit both sitemaps.
  3. Use URL Inspection's live test on `/` and your profile, then request indexing.
  4. Check the profile in the Rich Results Test (ProfilePage).
  5. Refresh the preview in LinkedIn Post Inspector.
  6. Import the property into Bing Webmaster Tools.
  7. Link your Chatsoon profile from your LinkedIn, X and YouTube profiles and from moshiconcepts.com.

### Stage E: Lighthouse budgets and a regression gate

- **WP-E1** owns `scripts/lighthouse.mjs`, `scripts/lh-budgets.json` (new), `scripts/lh-local.sh` (new), `apps/web/test/fixtures/lh-seed.sql` (new), root `package.json` (`lh:local`, `lh:prod`), and the runbook section of `docs/public-pages.md`.
  - **Budgets:**
    - every category 1.00;
    - FCP ≤1000 ms, LCP ≤1400 ms, TBT ≤30 ms, CLS ≤0.02, SI ≤1600 ms;
    - document ≤14 KB gzipped;
    - script ≤10 KB gzipped (excluding SPA assets, which never load anonymously);
    - 0 fonts;
    - 0 third-party requests before load (the Cloudflare beacon was removed on 25 Sep 2026);
    - total ≤30 KB for home and ≤80 KB for the profile (the original avatar is about 50 KB).
  - **`lh-local.sh`:**
    - apply the local D1 migrations and the seed, which adds an opted-in fixture `lh-fixture-0000aaaa` with a headline, links, a booking link and a `'public'` phone;
    - `wrangler r2 object put --local` a fixture avatar;
    - start `pnpm --filter @chatsoon/api dev` and, in `apps/web`, `wrangler pages dev dist --port 8788`;
    - run 3 runs per scheme on `/`, `/id/lh-fixture-0000aaaa` and `/privacy`;
    - `--budgets` exits non-zero on any breach.
  - **`lh:prod`:** the same against `https://chatsoon.app/` and `/id/peter-bui-5ec50167`.
  - Document: run `pnpm lh:local` before `pnpm deploy:web` and `pnpm lh:prod` after it.

### Stage F: only if production PSI medians are below 100 after C and D

1. **TTFB.**
   - Run `wrangler d1 info chatsoon` to find the D1 region.
   - Options, in order:
     - `"placement":{"mode":"smart"}` on chatsoon-api;
     - D1 read replication with the Sessions API;
     - Cache API HTML with a 60 s TTL plus a global purge-by-URL from `PUT /me/profile` and `DELETE /me`. The purge needs a token scoped to Zone › Cache Purge; ask Peter to create it.
2. **Avatar.** A 208 px WebP variant made at upload with the Images binding and backfilled lazily. Check the account's Images allowance first.
3. **Beacon.** Turn off Web Analytics, only if Peter wants a report with no warnings.

---

## 5. Verification per stage

**Every stage:** `pnpm -r typecheck`, `pnpm --filter @chatsoon/shared test` and `pnpm --filter @chatsoon/api test`; from B on, also `pnpm --filter @chatsoon/web test`.

**A**
- `pnpm build:web`, then `pnpm deploy:web`, then `pnpm deploy:api`.
- **Production checks:**
  - `curl -s -o /dev/null -w "%{http_code} %{content_type}\n"` on `https://chatsoon.app/llms.txt` returns `200 text/plain`.
  - `/.well-known/ai-catalog.json` and `/.well-known/ard.json` return `404`.
  - `/.well-known/apple-app-site-association` returns `200 application/json`.
  - `curl -sI https://chatsoon.app/sign-in | grep -i x-robots-tag` finds noindex.
  - `curl -s https://api.chatsoon.app/robots.txt | grep "Disallow: /"`.
- **Lighthouse:** `pnpm lh https://chatsoon.app/ https://chatsoon.app/id/peter-bui-5ec50167 --runs 3 --scheme both` gives the expected table, and the profile's layout-shifts total is ≤0.039.

**B**
- `pnpm build:web`, then `ls apps/web/dist/{home.html,privacy.html,_redirects}`.
- **Local:** `cd apps/web && npx wrangler pages dev dist`. Then:
  - `curl -s localhost:8788/ | grep "<h1"` shows the static h1;
  - `curl -sI localhost:8788/home` returns 301 to `/`;
  - `curl -s localhost:8788/contacts | grep 'id="root"'` shows the SPA fallback is intact;
  - `curl -s -o /dev/null -w "%{http_code}" localhost:8788/.well-known/x` returns 404.
- `pnpm lh http://localhost:8788/ --scheme both`.
- **Production:** repeat the curls, then `pnpm lh https://chatsoon.app/ --runs 3 --scheme both` shows 100 on all five. Sign in on web, open `/`, and check it lands on `/contacts`.

**C**
- **API:** `pnpm --filter @chatsoon/api test` (pages.test.ts), then `pnpm deploy:api`.
- **Spike:** the preview deploy `curl` (WP-C5).
- **Local:** API `wrangler dev` with `.dev.vars` `EXTRA_ORIGINS=http://localhost:8788`, and `CHATSOON_ENV_FILE=../mobile/.env.development CHATSOON_ALLOW_DEV_BUILD=1 pnpm build`. Then from `apps/web`: `npx wrangler pages dev dist --port 8788`. It reads the service binding from wrangler.jsonc; otherwise add `--service API=chatsoon-api#PagesEntrypoint`.
- **Status and leak curls** (production after deploy):
  - `/id/Peter-Bui-5ec50167` returns 301;
  - `/id/zz-not-a-profile-00000000` returns 404;
  - `/id/bad_slug!` returns 404;
  - `/id/peter-bui-5ec50167/photo?v=<v>` returns 200 `image/*`;
  - `curl -sI …/id/peter-bui-5ec50167 | grep -iE "x-frame-options|x-robots-tag|referrer-policy|permissions-policy"` finds all 4;
  - for a `'public'` test profile, `curl -s …/id/<slug> | grep -cE "491570156|tel:|wa\.me|signal\.me"` returns 0.
- **Manual in a browser:**
  - Connect from focus to success; Turnstile loads only after focus.
  - The booking dialog opens and closes; a middle-click opens a new tab.
  - Report sends.
  - Tap-to-reveal works.
  - Signed-in: the SPA loads in place, with no anonymous flash. Member actions, own profile, and blocked → not found all behave.
- **Link previews:** the LinkedIn Post Inspector preview shows name and photo.
- **Lighthouse:** `pnpm lh https://chatsoon.app/id/peter-bui-5ec50167 --runs 3 --scheme both` gives 100, 100, 100, 66 and 100.

**D**
- **Migration:** `pnpm --filter @chatsoon/api db:generate`, then `db:migrate:local`, the tests, then `db:migrate:remote` and `deploy:api`, then `deploy:web`.
- **Checks:**
  - opted out: `curl -sI …/id/<slug>` shows `x-robots-tag: noindex`;
  - opted in: no noindex header or meta, and a JSON-LD `<script>` is present;
  - `curl -s https://chatsoon.app/sitemap-profiles.xml | xmllint --noout -`;
  - the reviewer and demo profiles don't appear even when toggled.
- **Rich Results Test** passes for ProfilePage.
- **Lighthouse:** `pnpm lh …/id/peter-bui-5ec50167 --runs 3` gives 100 on all five after Peter opts in.
- **Native check:** a 1.0 build's `PUT /me/profile` leaves the flag intact (API test covers it).

**E**
- `pnpm lh:local` passes the budgets; a deliberate regression, such as adding a web font to the CSS, fails them.
- `pnpm lh:prod` passes.
- **Done:** the median of 3 runs of PSI mobile in the web UI (Peter) scores 100 on all five categories for `/` and his opted-in profile. CrUX field data "No data" is expected and not part of the score.

---

## 6. Risks and what might not reach 100

| Risk | Impact | Mitigation |
|---|---|---|
| Pages may not bind a **named** entrypoint in production (only `pages dev` support is verified) | Stage C blocked | Spike on a preview deployment first. The fallback is secret-gated HTTP over the binding (§3.1). |
| PSI runs from US locations, and a far D1 region raises TTFB | FCP and LCP drift past 1067/1545 ms. The category is still 100 up to about FCP 1571 ms / LCP 1934 ms if TBT and CLS are perfect. | Budgets keep headroom. Stage F: Smart Placement, D1 read replication, or cache plus a purge token. |
| SEO 100 on a profile needs the owner's opt-in | Profiles that aren't opted in stay at 66, on purpose | Peter opts in his own profile. Don't game `is-crawlable` with per-bot rules. |
| Two UIs (React Native and HTML) drift | Visual or copy mismatch | Shared tokens, helpers and landing.json; render tests; a rule in docs/public-pages.md. |
| Lighthouse's agentic category is "under development" (N/A handling, the ard.json path, WebMCP weights) | A future score drop | Pinned 13.5.0 runner. Re-check on each PSI Lighthouse bump. The nested 404 already covers ard.json. |
| A future edit spreads PublicProfile into the template, or passes raw JSON | Numbers leak into indexed HTML | Whitelisted DTO type, leak tests in both the API and web, API `robots.txt` Disallow, and tap-to-reveal. |
| Dark and light results differ | Local runs pass, PSI fails, or the reverse | Token contrast test in both schemes; the runner asserts the emulated scheme. |
| The Cloudflare beacon and Email Obfuscation are zone features | Zero-weight warnings; an extra script | email_off comments. The beacon was removed (D16). |
| Turnstile loads only after interaction | First submit takes 1–3 s longer | Load on first focus; show "Checking you're human…"; Send stays enabled. |
| Handoff edge cases: an expired token, blocked storage, or cross-tab sign-out on static pages | A slow page, or an anonymous view for a signed-in user | Acceptable. The SPA's 401 handler recovers. The header has a Sign in link. |
| Unknown top-level paths stay soft 200 | Minor crawl noise | The SPA `+not-found` sets meta noindex. A root 404.html would mean maintaining a route list, which D3 rejects. |
| Free plan: every `/id` view invokes a Function plus the API; 10 ms CPU | Quota or CPU limits at big events | String templates only; deep imports (no zod); `sideEffects:false`. Monitor Workers analytics. |
| Search removal takes days to weeks; findable profiles make harvesting easier | Privacy complaints | Honest policy text, noindex and sitemap removal straight away, `search_blocked`, the global Connect limiter, Turnstile. |
| Token changes in A (dark primary, textTertiary) restyle native at the next batch | Unexpected visual change | native-pending row; check on devices during the batch release. |
| The deploy moves to `apps/web` | Linux-box runbook drift | Root `pnpm deploy:web` keeps its name; DEPLOY.md and CLAUDE.md updated in B3. The `DEV_VALUE` check scans every bundle. |