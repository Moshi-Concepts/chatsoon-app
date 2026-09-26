# Server-rendered profile page: DOM contract (Stage C)

`apps/web/src/render/profile.ts` (C3) writes this markup. `apps/web/src/client/*` (C4, the island) reads it. Both
sides must follow this file. Change it first if the contract changes.

## Root

- `<html lang="en">`. The inline head script adds the class `spa` when the visitor is signed in (see Handoff below).
  - In that case CSS hides `#page` and shows a centred spinner `#spa-loading`, and the island exits straight away.
- `<main id="page">` carries these data attributes:
  - `data-slug`: the profile slug.
  - `data-api`: the API origin, e.g. `https://api.chatsoon.app`.
  - `data-sitekey`: the Turnstile site key.
  - `data-first`: the first name, from `firstName()`.
  - `data-visibility`: `connections` or `public` (contact visibility).
- One `<script type="module" src="/_p/profile-<hash>.js">` near the end of `<body>`. Nothing else external loads at
  page load: no fonts, no Turnstile, no third-party requests.
- **Referral attribution (issue #11):** the island calls `captureReferralFromSearch(location.search)`
  (`src/client/referral.ts`) before anything else in `main()`, regardless of `spa` mode. A valid `?ref=`
  writes the `cs_ref` cookie (`document.cookie`, same attributes as the `/r/<code>` landing page's own
  Set-Cookie) and `localStorage.cs_ref`; a missing or invalid one is a silent no-op. This changes no
  markup and no Function-level caching — the page renders identically either way.

## Profile card

- **Photo:**
  - With a photo: `<img id="avatar" src="/id/<slug>/photo?v=<avatarVersion>" srcset="/id/<slug>/photo?v=<avatarVersion>&w=208 208w, /id/<slug>/photo?v=<avatarVersion>&w=368 368w, /id/<slug>/photo?v=<avatarVersion>&w=416 416w, /id/<slug>/photo?v=<avatarVersion>&w=512 512w" sizes="208px" width="208" height="208" alt="<name>" fetchpriority="high" decoding="async">` (issue #23: `src` is the plain, no-`w` URL — the API's own 416 default, kept as the fallback for anything that ignores `srcset`; the `&` in each URL is escaped to `&amp;`). Never lazy-loaded. JSON-LD's `image` and the OG image keep the plain `src` URL, with no `w` at all.
  - Without one: `<div class="avatar initials" aria-hidden="true">AB</div>`.
- **Text:** `<h1>` with the name, then the headline and the role line as text.
- **Badge pill (issue #11, docs/referrals.md "Referral hub"):** when `p.badges` carries one (at most one
  in practice), a pill sits next to the name inside a `<div class="profile-name-row">` wrapping the
  `<h1>`: `<span class="badge-pill badge-pill-founder" aria-label="Founding member number 37">` (or
  `badge-pill-early`, `aria-label="Early adopter"`) containing the `ribbon-outline` icon and a `<span>`
  with the visible label — `Founding member #37` (founder, when `seq` is present) or `Early adopter`.
  `aria-label` on the pill replaces its whole accessible name (icon included), so "#37" is never spoken
  literally. Labels come from `BADGE_LABELS` (`packages/shared/src/referrals.ts`). Founder is styled
  `--primary-soft`/`--primary-text` (the closest token to the spec's brand magenta that clears 4.5:1 in
  both colour schemes — the design system has no magenta); early adopter is `--surface-alt`/
  `--text-secondary`. Matches the app's `ProfileCard` (`apps/mobile/src/components/web/profile-card.tsx`).
- **Links:** `<ul class="links">`. Each item is `<a href target="_blank" rel="me noopener noreferrer">`, containing an
  inline SVG icon, the visible label, and `<span class="sr-only">(opens in a new tab)</span>`.
  - **Discord (issue #21):** a numeric user id renders like every other link above. A username or legacy
    discriminator has no URL at all, so it renders `<li><button type="button" class="chip" data-copy="<username>"
    aria-label="Copy Discord username <username>">`, containing the icon and the username as visible text. The
    island (`copy.ts`) copies `data-copy` to the clipboard on tap, swaps the label `<span>` (and the aria-label) to
    "Copied" for about 1.5s, and falls back to selecting the label text when the Clipboard API is unavailable.
- **Phone and messaging chips:** `<div id="contact-chips" data-channels="phone whatsapp signal">`, listing the keys
  that exist. It's omitted when there are none.
  - `connections` visibility: each chip is `<span class="chip locked">` with a lock icon and the label (Mobile,
    WhatsApp, Signal). After the chips comes `<p class="chips-note">Connect with {first} to get their number.</p>`.
  - `public` visibility: each chip is `<button type="button" class="chip" data-reveal="<key>">` with the label. The
    island fetches the numbers on tap and swaps the chips for links.
- **Save contact:** `<a class="button" rel="nofollow" href="<api>/id/<slug>/vcard">Save contact</a>`.

## Book a meeting

Present only when there are booking links.

- `<section id="booking" aria-labelledby="booking-h"><h2 id="booking-h">Book a meeting</h2>`
- Each row is `<a class="booking-row" href="<bookingOpenUrl>" target="_blank" rel="nofollow ugc noopener noreferrer" data-embed="<bookingEmbedUrl or empty>" data-label="<label>" data-provider="<provider name>">`.
- Each row shows an icon, the label, the provider name, and `<span class="sr-only">(opens in a new tab)</span>`.

## Connect form

- `<section id="connect" aria-labelledby="connect-h"><h2 id="connect-h">Connect with {first}</h2>`
- `<form id="connect-form" novalidate>` holds:
  - `<label for="cf-name">`, then `<input id="cf-name" name="name" autocomplete="name" maxlength=CONNECT_FORM_MAX.name required>`
  - `<label for="cf-contact">Email</label>`, then `<input id="cf-contact" name="contact" type="email" inputmode="email" autocomplete="email" autocapitalize="off" spellcheck="false" maxlength=CONNECT_FORM_MAX.contact required>` (issue #10: email address only, still named `contact` on the wire)
  - `<label for="cf-note">`, then `<textarea id="cf-note" name="note" maxlength=CONNECT_FORM_MAX.note>`
  - a tips opt-in checkbox (issue #7): `<div class="checkbox-row"><input type="checkbox" id="cf-tips" name="tipsOptIn"><label for="cf-tips">Email me tips to set up my own free Chatsoon profile</label></div>`, unticked by default, 20px box with `accent-color` primary, 44px tall tap target. Followed by `<p class="tips-note">Optional. Unsubscribe any time. <a href="/privacy#emails-we-send" target="_blank" rel="noopener noreferrer">Privacy policy<span class="sr-only"> (opens in a new tab)</span></a>.</p>`.
  - `<div id="turnstile-slot" style="min-height:65px"></div>` (not `id="turnstile"`: an element id becomes a `window` global and would shadow the Turnstile API)
  - `<p id="connect-error" role="alert" hidden></p>`
  - `<button type="submit" class="button primary">Send</button>`
  - A short privacy line linking to `/privacy`.
- `<div id="connect-success" hidden><div class="success-badge">{checkmark-circle icon}</div></div>`: a green tick
  badge (issue #30). After a send the island hides `#connect-form`, appends the "Sent." heading after the badge (then,
  when a contact comes back, the "how to reach {first}" pills and Save contact with `vcardUrl`), shows the card and
  scrolls it into view.

## Other

- **Promo:** `<section id="promo" class="card promo-card" aria-labelledby="promo-h">`, a solid brand-purple card
  (never green — green means success elsewhere in the app), holding:
  1. a decorative icon badge (`qr-code-outline`).
  2. `<h2 id="promo-h">Get your own free profile</h2>`, sized like the other section h2s.
  3. a paragraph: "Share your QR, scan business cards and follow up with everyone you meet at events."
  4. the primary action: `<a class="button button-block promo-cta" href="/sign-in">Create your free profile</a>`
     (white background, brand-purple bold text).
  5. a small underlined text link: `<a class="promo-more" href="/">See how it works</a>`.
  It stays visible after the Connect form is sent — the island only hides `#connect-form`, never `#promo`.
- **Report:** `<button type="button" id="report">Report profile</button>`, plus
  `<noscript><a href="mailto:hello@chatsoon.app?subject=Report%20profile%20<slug>">Report profile</a></noscript>`
  (inside `email_off`).
- **Dialogs:** the island creates the booking and report `<dialog>` elements in JavaScript when they are first
  needed. The renderer emits no dialog markup.

## Handoff to the full app (signed-in visitors)

- **Head:** an inline, try/catch-wrapped script that runs
  `if (localStorage.getItem(SESSION_STORAGE_KEY)) document.documentElement.classList.add('spa')`.
  `SESSION_STORAGE_KEY` is `'chatsoon.session'`, from `@chatsoon/shared/src/profile-page`.
- **End of `<body>`:** an inline script that, only in spa mode:
  1. adds the SPA's inline `<style>` blocks (Expo reset plus the `<style data-href=…>` blocks from
     `dist/index.html`);
  2. appends `<div id="root">`;
  3. loads the SPA entry script.
- In spa mode, CSS hides `#page`, the site header and the footer. The app's reset sets `body{overflow:hidden}`, so
  anything left in `<body>` pushes the app off-screen. `#spa-loading` fills the screen until the body script removes
  it on the app's first render into `#root` (a MutationObserver).
- The asset strings come from `functions/_generated/assets.ts`, which the build writes (C5).
