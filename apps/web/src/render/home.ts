// Renders the static home page (chatsoon.app/) per docs/public-pages-plan.md §3.4 and §4 WP-B2. The
// copy comes from apps/mobile/src/content/landing.json (WP-B1); build.ts (WP-B3) reads that file and
// passes it in, so this module has no dependency on apps/mobile.

import { APP_NAME, SUPPORT_EMAIL, WEB_ORIGIN } from '@chatsoon/shared/src/constants';

import { escapeHtml } from './escape';
import { icon, sprite, type IconName } from './icons';
import { page } from './layout';
import { DEFAULT_OG_IMAGE } from './og-asset';

export interface LandingFeature {
  icon: IconName;
  title: string;
  body: string;
}

export interface LandingStep {
  title: string;
  body: string;
}

export interface LandingContent {
  intro: string;
  pitch: string;
  hero: {
    eyebrow: string;
    titleLine1: string;
    titleLine2: string;
    ctaLabel: string;
    ctaCaption: string;
    comingSoon: string;
  };
  mock: {
    qrScreenLabel: string;
    qrName: string;
    qrRole: string;
    qrSlug: string;
    contactName: string;
    contactRole: string;
    newBadge: string;
    contactChips: [string, string];
    contactFootnote: string;
  };
  features: {
    kicker: string;
    title: string;
    subtitle: string;
    items: LandingFeature[];
  };
  steps: {
    kicker: string;
    title: string;
    items: LandingStep[];
  };
  closing: {
    title: string;
    body: string;
    ctaLabel: string;
  };
}

const TITLE = `${APP_NAME}: networking CRM and digital business card for events`;
// Exported so shell.ts (docs/og-plan.md WP-2) can reuse the same copy for the SPA shell's generic
// og:description, instead of carrying a second copy that could drift from this one.
export const DESCRIPTION =
  'Share a digital business card with a QR code, scan business cards and badges with AI, and follow up with everyone you meet at events. Free on the web.';

// try/catch: a blocked storage API (private browsing, a locked-down browser) must never break the
// marketing page for a signed-out visitor. Mirrors apps/mobile/src/lib/auth.tsx's TOKEN_KEY and
// index.tsx:12 (D18, §2.3). Once packages/shared/src/profile-page.ts exists (WP-C2), this literal
// should become that module's SESSION_STORAGE_KEY constant.
const REDIRECT_SIGNED_IN = `try{if(localStorage.getItem('chatsoon.session'))location.replace('/contacts')}catch(e){}`;

function jsonLd(): Record<string, unknown> {
  return {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'WebSite',
        '@id': `${WEB_ORIGIN}/#website`,
        url: `${WEB_ORIGIN}/`,
        name: APP_NAME,
        publisher: { '@id': `${WEB_ORIGIN}/#org` },
      },
      {
        '@type': 'Organization',
        '@id': `${WEB_ORIGIN}/#org`,
        name: 'Moshi Concepts Inc.',
        brand: { '@type': 'Brand', name: APP_NAME },
        url: `${WEB_ORIGIN}/`,
        email: SUPPORT_EMAIL,
        logo: `${WEB_ORIGIN}/logo.png`,
        sameAs: ['https://x.com/ChatSoonApp'], // O24: attributes the brand account on shared cards.
      },
      {
        '@type': 'WebApplication',
        name: APP_NAME,
        url: `${WEB_ORIGIN}/`,
        applicationCategory: 'BusinessApplication',
        operatingSystem: 'Web',
        offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
      },
    ],
  };
}

/** "Alex Rivera" -> "AR", for the decorative phone-mock avatars (no real photo on this static page). */
function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  const first = parts[0]?.[0] ?? '';
  const last = parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? '') : '';
  return (first + last).toUpperCase();
}

function avatar(name: string, size: number): string {
  const fontSize = Math.round(size * 0.38);
  return `<span class="avatar" style="width:${size}px;height:${size}px;font-size:${fontSize}px">${escapeHtml(initials(name))}</span>`;
}

function heroVisual(mock: LandingContent['mock'], qrSvg: string): string {
  // The whole visual is decorative and repeats copy that's already in the page (intro/pitch), so it's
  // hidden from the accessibility tree rather than given its own labels.
  return `<div class="hero-visual" aria-hidden="true">
<div class="phone">
<div class="phone-notch"></div>
<p class="text-caption-strong">${escapeHtml(mock.qrScreenLabel)}</p>
${avatar(mock.qrName, 60)}
<p class="text-subheading">${escapeHtml(mock.qrName)}</p>
<p class="text-caption">${escapeHtml(mock.qrRole)}</p>
<div class="qr-tile">${qrSvg}</div>
<p class="text-small">${escapeHtml(mock.qrSlug)}</p>
</div>
<div class="contact-card">
<div class="contact-head">
${avatar(mock.contactName, 40)}
<div class="flex">
<p class="text-body-strong">${escapeHtml(mock.contactName)}</p>
<p class="text-caption">${escapeHtml(mock.contactRole)}</p>
</div>
<span class="badge-success">${escapeHtml(mock.newBadge)}</span>
</div>
<div class="chips">
<span class="pill">${escapeHtml(mock.contactChips[0])}</span>
<span class="pill">${icon('calendar-outline', 14)}${escapeHtml(mock.contactChips[1])}</span>
</div>
<p class="contact-foot text-small">${icon('sparkles', 14)}${escapeHtml(mock.contactFootnote)}</p>
</div>
</div>`;
}

function heroSection(landing: LandingContent, qrSvg: string): string {
  const { hero, intro, pitch } = landing;
  return `<div class="wrap hero">
<div class="hero-copy">
<h1 class="eyebrow">${icon('sparkles', 14)}<span>${escapeHtml(hero.eyebrow)}</span></h1>
<p class="hero-title">${escapeHtml(hero.titleLine1)}<br><span class="accent">${escapeHtml(hero.titleLine2)}</span></p>
<p class="lead">${escapeHtml(intro)}</p>
<p class="pitch">${escapeHtml(pitch)}</p>
<div class="cta-row">
<a class="button button-primary button-lg" href="/sign-in">${escapeHtml(hero.ctaLabel)}</a>
<span class="text-callout">${escapeHtml(hero.ctaCaption)}</span>
</div>
<p class="coming-soon text-callout">${icon('phone-portrait-outline', 16)}<span>${escapeHtml(hero.comingSoon)}</span></p>
</div>
${heroVisual(landing.mock, qrSvg)}
</div>`;
}

function featuresSection(features: LandingContent['features']): string {
  const cards = features.items
    .map(
      (f) => `<div class="feature">
<div class="feature-icon">${icon(f.icon, 24)}</div>
<h3>${escapeHtml(f.title)}</h3>
<p>${escapeHtml(f.body)}</p>
</div>`,
    )
    .join('');
  return `<section class="band" aria-labelledby="features-title"><div class="wrap band-inner">
<div class="section-head">
<p class="kicker">${escapeHtml(features.kicker.toUpperCase())}</p>
<h2 id="features-title" class="section-title">${escapeHtml(features.title)}</h2>
<p class="section-subtitle">${escapeHtml(features.subtitle)}</p>
</div>
<div class="grid">${cards}</div>
</div></section>`;
}

function stepsSection(steps: LandingContent['steps']): string {
  const rows = steps.items
    .map(
      (s, i) => `<div class="step">
<span class="step-number">${i + 1}</span>
<div><p class="step-title">${escapeHtml(s.title)}</p><p>${escapeHtml(s.body)}</p></div>
</div>`,
    )
    .join('');
  return `<section aria-labelledby="steps-title"><div class="wrap band-inner">
<div class="section-head">
<p class="kicker">${escapeHtml(steps.kicker.toUpperCase())}</p>
<h2 id="steps-title" class="section-title">${escapeHtml(steps.title)}</h2>
</div>
<div class="steps">${rows}</div>
</div></section>`;
}

function closingSection(closing: LandingContent['closing']): string {
  return `<div class="wrap closing-wrap"><div class="closing">
<h2>${escapeHtml(closing.title)}</h2>
<p>${escapeHtml(closing.body)}</p>
<a class="button" href="/sign-in">${escapeHtml(closing.ctaLabel)}</a>
</div></div>`;
}

/** Icons used anywhere on the page, for the one `sprite()` call layout.ts's <body> needs. */
function iconNames(landing: LandingContent): IconName[] {
  return ['sparkles', 'phone-portrait-outline', 'calendar-outline', ...landing.features.items.map((f) => f.icon)];
}

export function renderHome(landing: LandingContent, { qrSvg }: { qrSvg: string }): string {
  const main = [
    sprite(iconNames(landing)),
    heroSection(landing, qrSvg),
    featuresSection(landing.features),
    stepsSection(landing.steps),
    closingSection(landing.closing),
  ].join('');

  return page({
    title: TITLE,
    description: DESCRIPTION,
    canonical: `${WEB_ORIGIN}/`,
    og: {
      type: 'website',
      title: TITLE,
      description: DESCRIPTION,
      url: `${WEB_ORIGIN}/`,
      image: DEFAULT_OG_IMAGE,
      card: 'summary_large_image',
    },
    jsonLd: jsonLd(),
    headScript: REDIRECT_SIGNED_IN,
    main,
  });
}
