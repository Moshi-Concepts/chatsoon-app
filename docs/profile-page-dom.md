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

## Profile card

- **Photo:**
  - With a photo: `<img id="avatar" src="/id/<slug>/photo?v=<avatarVersion>" width="104" height="104" alt="<name>" fetchpriority="high" decoding="async">`. Never lazy-loaded.
  - Without one: `<div class="avatar initials" aria-hidden="true">AB</div>`.
- **Text:** `<h1>` with the name, then the headline and the role line as text.
- **Links:** `<ul class="links">`. Each item is `<a href target="_blank" rel="me noopener noreferrer">`, containing an
  inline SVG icon, the visible label, and `<span class="sr-only">(opens in a new tab)</span>`.
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
  - `<label for="cf-contact">`, then `<input id="cf-contact" name="contact" autocomplete="email" maxlength=CONNECT_FORM_MAX.contact required>`
  - `<label for="cf-note">`, then `<textarea id="cf-note" name="note" maxlength=CONNECT_FORM_MAX.note>`
  - `<div id="turnstile-slot" style="min-height:65px"></div>` (not `id="turnstile"`: an element id becomes a `window` global and would shadow the Turnstile API)
  - `<p id="connect-error" role="alert" hidden></p>`
  - `<button type="submit" class="button primary">Send</button>`
  - A short privacy line linking to `/privacy`.
- `<div id="connect-success" hidden></div>`: the island fills it after a send (the "how to reach {first}" pills, plus
  Save contact with `vcardUrl` when one comes back).

## Other

- **Promo:** a link to `/` reading "Create your free digital business card".
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
- The asset strings come from `functions/_generated/assets.ts`, which the build writes (C5).
