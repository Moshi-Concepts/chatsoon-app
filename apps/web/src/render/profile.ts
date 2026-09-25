// Server-rendered public profile page (docs/profile-page-dom.md is the DOM contract; the client island
// in apps/web/src/client/* reads this exact markup). Builds its own document rather than going through
// layout.ts's `page()`: the contract requires attributes on `<main id="page">` itself, an early
// SPA-handoff head script and an end-of-body loader script, none of which `page()`'s single-headScript,
// single-main shape supports. The header, footer and head metadata are still built to look identical to
// every other apps/web page (same CSS classes, same og.ts tag builder), just assembled locally.
//
// Deep imports only (docs/public-pages-plan.md §4): `@chatsoon/shared/src/{constants,design,booking,
// links,profile-contact,profile-page,types}`. No dependency on apps/mobile.

import { APP_NAME, COPYRIGHT, SUPPORT_EMAIL, TAGLINE, WEB_ORIGIN } from '@chatsoon/shared/src/constants';
import { Colors } from '@chatsoon/shared/src/design';
import { bookingEmbedUrl, bookingOpenUrl, bookingProviderName } from '@chatsoon/shared/src/booking';
import { toLinkUrl } from '@chatsoon/shared/src/links';
import { CONTACT_LABELS } from '@chatsoon/shared/src/profile-contact';
import { CONNECT_FORM_MAX, firstName, roleLine } from '@chatsoon/shared/src/profile-page';
import type { BookingLink, LinkKey, PageProfile, ProfileContactKey } from '@chatsoon/shared/src/types';

import { css } from './css';
import { escapeHtml } from './escape';
import { spaBodyScript, spaHeadScript, type SpaAssets } from './handoff';
import { icon, sprite, type IconName } from './icons';
import { profileOgBlock } from './og';

/** What C5's build and Function supply at render time. */
export interface ProfileAssets {
  /** URL of the client island module, e.g. "/_p/profile-<hash>.js". */
  islandUrl: string;
  /** Turnstile site key. */
  siteKey: string;
  /** API origin, e.g. "https://api.chatsoon.app". */
  apiOrigin: string;
  spa: SpaAssets;
}

// ---- Chrome (header/footer/logo): kept identical to layout.ts's page(), duplicated locally because
// this page can't route its <main> through page() (see file banner). Not exported there, so copied
// verbatim; change both places together if the brand mark or footer ever change. ----

const LOGO = `<svg width="32" height="32" viewBox="0 0 64 64" aria-hidden="true"><rect width="64" height="64" rx="17" fill="#5146E5"/><path d="M14 23a8 8 0 0 1 8-8h20a8 8 0 0 1 8 8v12a8 8 0 0 1-8 8H29l-9 7v-7.3A8 8 0 0 1 14 35z" fill="#fff"/><circle cx="24" cy="29" r="3.2" fill="#5146E5"/><circle cx="32" cy="29" r="3.2" fill="#5146E5"/><circle cx="40" cy="29" r="3.2" fill="#FF6B4A"/></svg>`;
const LOGO_SMALL = LOGO.replace('width="32" height="32"', 'width="24" height="24"');

const FOOTER_LINKS = [
  { href: '/privacy', label: 'Privacy' },
  { href: '/terms', label: 'Terms' },
  { href: '/support', label: 'Support' },
];

function headerBlock(slug: string): string {
  return `<header class="site"><div class="wrap">
<a class="brand" href="/" aria-label="${APP_NAME} home">${LOGO}<span>${APP_NAME}</span></a>
<a class="button" href="/sign-in?next=${escapeHtml(`/id/${slug}`)}">Sign in</a>
</div></header>`;
}

function footerBlock(): string {
  return `<footer><div class="wrap">
<div><a class="brand" href="/">${LOGO_SMALL}<span>${APP_NAME}</span></a><p class="tagline">${TAGLINE}</p></div>
<div><nav aria-label="Legal">${FOOTER_LINKS.map((l) => `<a href="${l.href}">${l.label}</a>`).join('')}<!--email_off--><a href="mailto:${SUPPORT_EMAIL}">${SUPPORT_EMAIL}</a><!--/email_off--></nav><p class="copy">© 2026 ${COPYRIGHT}</p></div>
</div></footer>`;
}

// ---- Profile card ----

/** "https://www.peterbui.com/about" -> "peterbui.com". Matches apps/mobile/src/components/web/profile-card.tsx. */
function hostLabel(url: string): string | null {
  try {
    return new URL(url).hostname.replace(/^www\./, '') || null;
  } catch {
    return null;
  }
}

/** "Peter Bui" -> "PB", for a profile with no avatar. Matches home.ts's decorative version. */
function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  const first = parts[0]?.[0] ?? '';
  const last = parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? '') : '';
  return (first + last).toUpperCase();
}

const PROFILE_LINKS: { key: LinkKey; label: string; icon: IconName }[] = [
  { key: 'linkedin', label: 'LinkedIn', icon: 'logo-linkedin' },
  { key: 'x', label: 'X', icon: 'logo-x' },
  { key: 'telegram', label: 'Telegram', icon: 'paper-plane-outline' },
  { key: 'youtube', label: 'YouTube', icon: 'logo-youtube' },
  { key: 'website', label: 'Website', icon: 'globe-outline' },
];

const CHANNEL_ICON: Record<ProfileContactKey, IconName> = {
  phone: 'call-outline',
  whatsapp: 'logo-whatsapp',
  signal: 'chatbubble-ellipses-outline',
};

function avatarBlock(p: PageProfile): string {
  if (p.avatarVersion) {
    const src = `/id/${encodeURIComponent(p.slug)}/photo?v=${encodeURIComponent(p.avatarVersion)}`;
    return `<img id="avatar" src="${escapeHtml(src)}" width="104" height="104" alt="${escapeHtml(p.displayName)}" fetchpriority="high" decoding="async">`;
  }
  return `<div class="avatar initials" aria-hidden="true">${escapeHtml(initials(p.displayName))}</div>`;
}

function linksBlock(p: PageProfile): string {
  const items = PROFILE_LINKS.flatMap((l) => {
    const url = toLinkUrl(l.key, p.links[l.key]);
    if (!url) return [];
    const label = l.key === 'website' ? (hostLabel(url) ?? l.label) : l.label;
    return [
      `<li><a href="${escapeHtml(url)}" target="_blank" rel="me noopener noreferrer">${icon(l.icon, 16)}<span>${escapeHtml(label)}</span><span class="sr-only"> (opens in a new tab)</span></a></li>`,
    ];
  });
  return items.length ? `<ul class="links">${items.join('')}</ul>` : '';
}

/**
 * Phone/WhatsApp/Signal chips (docs/profile-page-dom.md "Profile card"). Reads only `contactChannels`
 * (which keys exist) and `contactVisibility` — never a `contact` values object, which `PageProfile`
 * doesn't even carry. `'connections'` shows locked chips; `'public'` shows tap-to-reveal buttons the
 * island fills in later.
 */
function contactChipsBlock(p: PageProfile): string {
  if (!p.contactChannels.length) return '';
  const channelsAttr = escapeHtml(p.contactChannels.join(' '));

  if (p.contactVisibility === 'connections') {
    const chips = p.contactChannels
      .map(
        (key) =>
          `<span class="chip locked">${icon('lock-closed-outline', 16)}<span>${escapeHtml(CONTACT_LABELS[key])}</span></span>`,
      )
      .join('');
    return (
      `<div id="contact-chips" data-channels="${channelsAttr}">${chips}</div>` +
      `<p class="chips-note">Connect with ${escapeHtml(firstName(p.displayName))} to get their number.</p>`
    );
  }

  const chips = p.contactChannels
    .map(
      (key) =>
        `<button type="button" class="chip" data-reveal="${escapeHtml(key)}">${icon(CHANNEL_ICON[key], 16)}<span>${escapeHtml(CONTACT_LABELS[key])}</span></button>`,
    )
    .join('');
  return `<div id="contact-chips" data-channels="${channelsAttr}">${chips}</div>`;
}

function profileCardBlock(p: PageProfile, assets: ProfileAssets): string {
  const role = roleLine(p.role, p.company);
  const vcardUrl = `${assets.apiOrigin}/id/${encodeURIComponent(p.slug)}/vcard`;
  return `<div class="card profile-card">
${avatarBlock(p)}
<h1>${escapeHtml(p.displayName)}</h1>
${p.headline ? `<p class="profile-headline">${escapeHtml(p.headline)}</p>` : ''}
${role ? `<p class="profile-role">${icon('briefcase-outline', 15)}<span>${escapeHtml(role)}</span></p>` : ''}
${contactChipsBlock(p)}
${linksBlock(p)}
<a class="button button-block" rel="nofollow" href="${escapeHtml(vcardUrl)}">${icon('download-outline', 18)}Save contact</a>
</div>`;
}

// ---- Book a meeting ----

function bookingIcon(link: BookingLink): IconName {
  if (link.provider === 'google') return 'logo-google';
  if (link.provider === 'microsoft') return 'logo-microsoft';
  return 'calendar-outline';
}

function bookingRow(link: BookingLink): string {
  const embedDomain = WEB_ORIGIN.replace(/^https?:\/\//, '');
  const openUrl = bookingOpenUrl(link);
  const embedUrl = bookingEmbedUrl(link, embedDomain) ?? '';
  const providerName = bookingProviderName(link.provider);
  return `<a class="booking-row" href="${escapeHtml(openUrl)}" target="_blank" rel="nofollow ugc noopener noreferrer" data-embed="${escapeHtml(embedUrl)}" data-label="${escapeHtml(link.label)}" data-provider="${escapeHtml(providerName)}">${icon(bookingIcon(link), 20)}<span class="booking-row-body"><span class="booking-row-label">${escapeHtml(link.label)}</span><span class="booking-row-provider">${escapeHtml(providerName)}</span></span><span class="sr-only"> (opens in a new tab)</span>${icon('chevron-forward', 18)}</a>`;
}

function bookingSection(p: PageProfile): string {
  if (!p.bookingLinks.length) return '';
  return `<section id="booking" aria-labelledby="booking-h" class="card">
<h2 id="booking-h">Book a meeting</h2>
<p class="section-caption">Pick a time with ${escapeHtml(firstName(p.displayName))}</p>
${p.bookingLinks.map(bookingRow).join('')}
</section>`;
}

// ---- Connect form ----

function connectSection(p: PageProfile): string {
  const first = escapeHtml(firstName(p.displayName));
  return `<section id="connect" aria-labelledby="connect-h" class="card">
<h2 id="connect-h">Connect with ${first}</h2>
<p class="section-caption">Share your details and they'll land straight in ${first}'s contacts. You don't need the app.</p>
<form id="connect-form" novalidate>
<div class="field">
<label for="cf-name">Your name</label>
<input id="cf-name" name="name" autocomplete="name" maxlength="${CONNECT_FORM_MAX.name}" required>
</div>
<div class="field">
<label for="cf-contact">Email or handle</label>
<input id="cf-contact" name="contact" autocomplete="email" maxlength="${CONNECT_FORM_MAX.contact}" required>
</div>
<div class="field">
<label for="cf-note">Note (optional)</label>
<textarea id="cf-note" name="note" maxlength="${CONNECT_FORM_MAX.note}"></textarea>
</div>
<div id="turnstile" style="min-height:65px"></div>
<p id="connect-error" role="alert" hidden></p>
<button type="submit" class="button button-primary button-block">Send</button>
<p class="connect-privacy">By sending, you agree to share these details with ${first}. See our <a href="/privacy" target="_blank" rel="noopener noreferrer">Privacy Policy<span class="sr-only"> (opens in a new tab)</span></a>.</p>
</form>
<div id="connect-success" hidden></div>
</section>`;
}

// ---- Promo and report ----

function promoBlock(): string {
  return `<p class="promo"><a href="/">Create your free digital business card</a></p>`;
}

function reportBlock(slug: string): string {
  const mailtoHref = `mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent(`Report profile ${slug}`)}`;
  return (
    `<p class="report-wrap"><button type="button" id="report">${icon('flag-outline', 16)}Report profile</button></p>` +
    `<!--email_off--><noscript><a href="${escapeHtml(mailtoHref)}">Report profile</a></noscript><!--/email_off-->`
  );
}

// ---- Icon sprite ----

/** Only the icons this particular profile actually renders, so the hidden sprite carries no unused paths. */
function iconNames(p: PageProfile): IconName[] {
  const names = new Set<IconName>(['download-outline', 'flag-outline']);
  if (roleLine(p.role, p.company)) names.add('briefcase-outline');
  for (const l of PROFILE_LINKS) if (toLinkUrl(l.key, p.links[l.key])) names.add(l.icon);
  if (p.contactChannels.length) {
    if (p.contactVisibility === 'connections') names.add('lock-closed-outline');
    else for (const key of p.contactChannels) names.add(CHANNEL_ICON[key]);
  }
  if (p.bookingLinks.length) {
    names.add('chevron-forward');
    for (const link of p.bookingLinks) names.add(bookingIcon(link));
  }
  return [...names];
}

/** Renders the complete `/id/:slug` document (docs/profile-page-dom.md, docs/public-pages-plan.md §3.3). */
export function renderProfile(p: PageProfile, assets: ProfileAssets): string {
  // profileOgBlock supplies the exact head tags (title, description, canonical, robots noindex, og:*,
  // twitter:*) the live SPA-shell splice used, so they never drift from what #5 already shipped. Its
  // `<!--og-->`/`<!--/og-->` markers were only needed for that splice; this page has no shell to splice
  // into, so they're stripped.
  const head = profileOgBlock(p, WEB_ORIGIN).replace(/<!--\/?og-->/g, '');

  const main = [
    sprite(iconNames(p)),
    profileCardBlock(p, assets),
    bookingSection(p),
    connectSection(p),
    promoBlock(),
    reportBlock(p.slug),
  ].join('');

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<script>${spaHeadScript()}</script>
${head}
<meta name="theme-color" content="${Colors.light.primary}">
<link rel="icon" href="/favicon.ico">
<style>${css()}</style>
</head>
<body>
${headerBlock(p.slug)}
<main id="page" data-slug="${escapeHtml(p.slug)}" data-api="${escapeHtml(assets.apiOrigin)}" data-sitekey="${escapeHtml(assets.siteKey)}" data-first="${escapeHtml(firstName(p.displayName))}" data-visibility="${escapeHtml(p.contactVisibility)}">
<div class="wrap profile-wrap">${main}</div>
</main>
<div id="spa-loading" aria-hidden="true"><span class="spinner"></span></div>
${footerBlock()}
<script>${spaBodyScript(assets.spa)}</script>
<script type="module" src="${escapeHtml(assets.islandUrl)}"></script>
</body>
</html>
`;
}
