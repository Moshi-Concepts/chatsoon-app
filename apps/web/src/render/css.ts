// The one inline stylesheet every apps/web page ships (home, legal and, from Stage C, the profile
// page): layout.ts puts this straight in <style>, so a page never issues a second request for CSS.
// Colours and type sizes come from packages/shared/src/design.ts (D14), so this can never drift from
// the RN app's own theme.

import { Colors, Radius, Spacing, Type, type ThemeColors, type TypeVariant } from '@chatsoon/shared/src/design';

/** camelCase token name -> kebab-case custom property, e.g. surfaceAlt -> --surface-alt. */
function cssVar(token: string): string {
  return `--${token.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}`;
}

function variables(colors: ThemeColors): string {
  return (Object.keys(colors) as (keyof ThemeColors)[]).map((token) => `${cssVar(token)}:${colors[token]}`).join(';');
}

/** kebab-case class name for a Type variant, e.g. captionStrong -> text-caption-strong. */
function typeClass(variant: string): string {
  return `text-${variant.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}`;
}

function typeClasses(): string {
  return (Object.keys(Type) as TypeVariant[])
    .map((variant) => {
      const t = Type[variant];
      return `.${typeClass(variant)}{font-size:${t.fontSize}px;line-height:${t.lineHeight}px;font-weight:${t.fontWeight}}`;
    })
    .join('');
}

/** Widest content column — mirrors apps/mobile/src/components/web/layout.tsx's SiteWidth. */
const SITE_WIDTH = 1120;
/** Breakpoints mirror apps/mobile/src/components/web/layout.tsx's useBreakpoint(). */
const MEDIUM = 640;
const WIDE = 960;
const FONT_STACK = `system-ui,-apple-system,'Segoe UI',Roboto,sans-serif`;
/** `.phone`'s fixed width, also used to align `.contact-card` and size the hero glow. */
const PHONE_WIDTH = 280;
/** The QR code's rendered size inside `.qr-tile`. The SVG from `qrcode` carries only a `viewBox`
 * (no `width`/`height`), so without this it has no intrinsic size and renders at 0×0. */
const QR_SIZE = 160;

/** The full inline stylesheet for a static apps/web page. */
export function css(): string {
  return `
:root{${variables(Colors.light)};color-scheme:light dark}
@media (prefers-color-scheme:dark){:root{${variables(Colors.dark)}}}
*{box-sizing:border-box}
html{-webkit-text-size-adjust:100%}
body{margin:0;background:var(--background);color:var(--text);font:16px/1.6 ${FONT_STACK};-webkit-font-smoothing:antialiased}
/* --primary-text, not --primary: dark mode's --primary (#5A50F0) is a brand/background tone that only
   reaches ~3:1 on --surface/--background/--primary-soft. --primary-text (#8F88FF) is the token
   design.test.ts holds to 4.5:1 on those same backgrounds — use it anywhere --primary would be a
   foreground colour for text, of any size (this rule, .eyebrow, .kicker, .closing .button,
   .hero-title .accent below). --primary itself stays fine as a background/border/outline colour,
   and as a decorative-icon foreground next to a real text label (.feature-icon, li::marker), which
   needs no contrast at all. */
a{color:var(--primary-text);text-decoration:none}
a:hover{text-decoration:underline}
/* A link inside running text must not rely on colour alone (WCAG 1.4.1, Lighthouse link-in-text-block). */
p a,.legal li a{text-decoration:underline;text-underline-offset:2px}
h1,h2,h3,p,ul{margin:0}
ul{padding-left:1.2em}
${typeClasses()}
.flex{flex:1}
.sr-only{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0}

.wrap{max-width:${SITE_WIDTH + Spacing.six * 2}px;margin:0 auto;padding:0 ${Spacing.six}px}
@media (max-width:${MEDIUM - 1}px){.wrap{padding:0 ${Spacing.four}px}}

/* Icons: aria-hidden decoration next to a real label, so they only need to pick up the ambient text colour. */
.icon{display:inline-block;vertical-align:middle;flex:none;fill:currentColor}

/* Header */
.site{border-bottom:1px solid var(--border)}
.site .wrap{height:64px;display:flex;align-items:center;justify-content:space-between;gap:${Spacing.three}px}
.brand{display:inline-flex;align-items:center;gap:${Spacing.two}px;color:var(--text);font-weight:800;font-size:19px;letter-spacing:-.4px}
.brand:hover{text-decoration:none}
.brand svg{display:block;flex:none}

/* Buttons */
.button{display:inline-flex;align-items:center;justify-content:center;gap:6px;height:36px;padding:0 ${Spacing.three}px;border-radius:${Radius.md}px;border:1.5px solid var(--border);background:var(--surface);color:var(--text);font-weight:600;font-size:13px;cursor:pointer}
.button:hover{text-decoration:none;border-color:var(--primary)}
.button-primary{border-color:var(--primary);background:var(--primary);color:var(--on-primary)}
.button-primary:hover{border-color:var(--primary-pressed);background:var(--primary-pressed)}
.button-lg{height:48px;padding:0 ${Spacing.five}px;border-radius:${Radius.lg}px;font-size:15px}

/* Pills, cards, avatars */
.pill{display:inline-flex;align-items:center;gap:6px;height:32px;padding:0 ${Spacing.three}px;border-radius:${Radius.pill}px;background:var(--surface-alt);font-weight:600;font-size:13px;color:var(--text)}
.card{background:var(--surface);border:1px solid var(--border);border-radius:${Radius.xl}px;padding:${Spacing.five}px}
.avatar{display:inline-flex;align-items:center;justify-content:center;border-radius:${Radius.pill}px;background:var(--primary-soft);color:var(--primary-text);font-weight:700;flex:none}

/* Forms — unused before Stage C's Connect form, kept here so every page shares one stylesheet */
.field{display:flex;flex-direction:column;gap:6px}
.field label{font-size:13px;font-weight:600}
.field input,.field textarea{font:inherit;padding:10px ${Spacing.three}px;border-radius:${Radius.md}px;border:1.5px solid var(--border);background:var(--surface);color:var(--text)}
.field input:focus,.field textarea:focus{outline:2px solid var(--primary);outline-offset:1px}
.form-error{display:flex;align-items:center;gap:${Spacing.two}px;padding:${Spacing.three}px;border-radius:${Radius.md}px;background:var(--danger-soft);color:var(--danger-text)}

/* Native <dialog> — unused before Stage C's booking and report dialogs */
dialog{border:none;border-radius:${Radius.xl}px;padding:${Spacing.five}px;background:var(--surface);color:var(--text)}
dialog::backdrop{background:var(--overlay)}

/* Footer */
footer{border-top:1px solid var(--border);padding:${Spacing.six}px 0;color:var(--text-secondary);font-size:15px}
footer .wrap{display:flex;flex-wrap:wrap;justify-content:space-between;gap:${Spacing.four}px ${Spacing.six}px}
footer nav{display:flex;flex-wrap:wrap;gap:${Spacing.two}px ${Spacing.five}px}
footer nav a{color:var(--text-secondary)}
footer .tagline{margin:6px 0 0;font-size:13px}
footer .copy{color:var(--text-tertiary);font-size:13px;margin:${Spacing.two}px 0 0}
${homeCss()}
${legalCss()}
${profileCss()}
`.trim();
}

/** Home page only: hero, phone mock, feature grid, steps and the closing band. */
function homeCss(): string {
  return `
.hero{padding-top:${Spacing.seven}px;padding-bottom:${Spacing.seven}px}
@media (min-width:${WIDE}px){.hero{display:flex;align-items:center;gap:${Spacing.seven}px;padding-top:72px;padding-bottom:96px}}
.hero-copy{display:flex;flex-direction:column;gap:${Spacing.five}px}
@media (min-width:${WIDE}px){.hero-copy{flex:1.1}}
.eyebrow{display:inline-flex;align-self:flex-start;align-items:center;gap:6px;padding:6px ${Spacing.three}px;border-radius:${Radius.pill}px;background:var(--primary-soft);color:var(--primary-text);font-size:13px;font-weight:700}
.hero-title{font-size:42px;line-height:1.05;font-weight:800;letter-spacing:-1.5px;margin:0}
.hero-title .accent{color:var(--primary-text)}
@media (min-width:${MEDIUM}px){.hero-title{font-size:56px}}
@media (min-width:${WIDE}px){.hero-title{font-size:68px}}
.lead{font-size:19px;line-height:1.4;font-weight:600;margin:0}
@media (min-width:${MEDIUM}px){.lead{font-size:22px;line-height:1.36}}
.pitch{max-width:560px;color:var(--text-secondary);font-size:17px;line-height:1.55;margin:0}
.cta-row{display:flex;flex-wrap:wrap;align-items:center;gap:${Spacing.four}px}
.coming-soon{display:flex;align-items:center;gap:${Spacing.two}px;color:var(--text-secondary);margin:0}

.hero-visual{position:relative;width:100%;max-width:480px;margin:${Spacing.four}px auto 0;display:flex;flex-direction:column;align-items:center}
@media (min-width:${WIDE}px){.hero-visual{flex:1;margin-top:0}}
/* Soft circular glow behind the phone. Clamped to the container's own width (never a fixed px
 * value alone) so it can never push the page wider than the viewport on small phones. */
.hero-visual::before{content:'';position:absolute;top:50%;left:50%;width:min(${PHONE_WIDTH + 120}px,100%);aspect-ratio:1;transform:translate(-50%,-50%);border-radius:${Radius.pill}px;background:var(--primary-soft);filter:blur(36px);opacity:.7}
.phone{position:relative;width:${PHONE_WIDTH}px;border-radius:36px;border:1px solid var(--border);background:var(--surface);box-shadow:0 28px 60px -28px var(--overlay);padding:${Spacing.three}px ${Spacing.five}px ${Spacing.five}px;display:flex;flex-direction:column;align-items:center;gap:${Spacing.three}px}
.phone-notch{width:88px;height:6px;border-radius:3px;background:var(--surface-alt)}
.qr-tile{padding:${Spacing.three}px;border-radius:${Radius.lg}px;border:1px solid var(--border);background:#fff;line-height:0}
.qr-tile svg{display:block;width:${QR_SIZE}px;height:${QR_SIZE}px}
.contact-card{position:relative;width:260px;margin-top:-${Spacing.four}px;margin-left:-${Spacing.four}px;border-radius:${Radius.lg}px;border:1px solid var(--border);background:var(--surface);box-shadow:0 28px 60px -28px var(--overlay);padding:${Spacing.four}px;display:flex;flex-direction:column;gap:${Spacing.three}px}
/* Like the live page: the card hangs off the phone's lower-left, clear of the QR code. */
@media (min-width:${MEDIUM}px){.contact-card{position:absolute;left:calc(50% - ${PHONE_WIDTH / 2 + 100}px);bottom:-${Spacing.six}px;margin:0}}
.contact-head{display:flex;align-items:center;gap:${Spacing.three}px}
.badge-success{padding:2px ${Spacing.two}px;border-radius:${Radius.pill}px;background:var(--success-soft);color:var(--success-text);font-size:12px;font-weight:600}
.chips{display:flex;flex-wrap:wrap;gap:${Spacing.two}px}
.contact-foot{display:flex;align-items:center;gap:6px;color:var(--text-secondary);margin:0}

.band{border-top:1px solid var(--border);border-bottom:1px solid var(--border);background:var(--surface)}
.band-inner{padding-top:72px;padding-bottom:72px;display:flex;flex-direction:column;gap:${Spacing.six}px}
.section-head{display:flex;flex-direction:column;align-items:center;gap:${Spacing.three}px;max-width:640px;margin:0 auto;text-align:center}
.kicker{color:var(--primary-text);letter-spacing:1.2px;font-size:13px;font-weight:700;margin:0}
.section-title{font-size:30px;line-height:1.2;font-weight:800;letter-spacing:-.8px;margin:0}
@media (min-width:${MEDIUM}px){.section-title{font-size:40px;line-height:1.15}}
.section-subtitle{color:var(--text-secondary);font-size:17px;line-height:1.55;margin:0}

.grid{display:flex;flex-wrap:wrap;gap:${Spacing.three}px}
.feature{flex:1 1 100%;border:1px solid var(--border);border-radius:${Radius.xl}px;padding:${Spacing.five}px;display:flex;flex-direction:column;gap:${Spacing.three}px}
@media (min-width:${MEDIUM}px){.feature{flex-basis:calc(50% - ${Spacing.three}px)}}
@media (min-width:${WIDE}px){.feature{flex-basis:calc(33.333% - ${Spacing.three}px)}}
.feature-icon{width:48px;height:48px;border-radius:${Radius.lg}px;background:var(--primary-soft);color:var(--primary);display:flex;align-items:center;justify-content:center}
.feature h3{font-size:20px;line-height:1.3;font-weight:600}
.feature p{color:var(--text-secondary);line-height:1.45;margin:0}

.steps{display:flex;flex-direction:column;gap:${Spacing.five}px}
@media (min-width:${MEDIUM}px){.steps{flex-direction:row;gap:${Spacing.six}px}}
.step{display:flex;align-items:flex-start;gap:${Spacing.four}px}
@media (min-width:${MEDIUM}px){.step{flex:1}}
.step-number{width:36px;height:36px;flex:none;border-radius:${Radius.pill}px;background:var(--primary);color:var(--on-primary);display:flex;align-items:center;justify-content:center;font-weight:700}
.step-title{font-weight:600;font-size:17px;margin:0 0 2px}
.step p{color:var(--text-secondary);margin:0}

.closing-wrap{padding-bottom:72px}
.closing{border-radius:${Radius.xl}px;background:var(--primary);color:var(--on-primary);padding:${Spacing.seven}px ${Spacing.five}px;text-align:center;display:flex;flex-direction:column;align-items:center;gap:${Spacing.four}px}
.closing h2{font-size:30px;line-height:1.2;font-weight:800;letter-spacing:-.8px}
@media (min-width:${MEDIUM}px){.closing h2{font-size:40px;line-height:1.15}}
.closing p{max-width:520px;opacity:.9;font-size:17px;line-height:1.55;margin:0}
.closing .button{border-color:transparent;background:var(--surface);color:var(--primary-text)}
`;
}

/** Legal pages only: intro, table of contents and dated sections. Ported from the CSS in
 * apps/mobile/scripts/build-static-pages.mjs (deleted in WP-B3), which this replaces. */
function legalCss(): string {
  return `
.legal h1{font-size:32px;line-height:1.15;letter-spacing:-.8px;margin:0 0 8px}
@media (min-width:${MEDIUM}px){.legal h1{font-size:40px}}
.legal .updated{color:var(--text-tertiary);font-size:13px;margin:0}
.legal .intro{color:var(--text-secondary);font-size:18px;line-height:1.6;margin:16px 0 0}
.toc{margin:${Spacing.six}px 0 0;padding:20px ${Spacing.five}px;background:var(--surface);border:1px solid var(--border);border-radius:${Radius.lg}px}
.toc h2{font-size:13px;letter-spacing:1px;text-transform:uppercase;color:var(--text-secondary);margin:0 0 8px}
.toc ol{margin:0;padding-left:20px;columns:2;column-gap:${Spacing.six}px}
@media (max-width:${MEDIUM - 1}px){.toc ol{columns:1}}
.toc li{margin:4px 0;break-inside:avoid}
.legal section{margin-top:${Spacing.six}px}
.legal section h2{font-size:21px;line-height:1.3;margin:0 0 ${Spacing.three}px;scroll-margin-top:16px}
.legal section p{color:var(--text-secondary);margin:0 0 ${Spacing.three}px}
.legal section ul{color:var(--text-secondary);margin:0 0 ${Spacing.three}px}
.legal section li{margin:0 0 10px}
.legal section li::marker{color:var(--primary)}
`;
}

/** The profile page only (Stage C, WP-C3): the card, links, contact chips, booking rows, connect form
 * and the SPA-handoff spinner. Ported from apps/mobile/src/components/{web/profile-card,web/contact-
 * pills,web/connect-form,booking/booking-links-card}.tsx onto plain HTML and this file's shared
 * `.card`/`.button`/`.pill`/`.field` classes, so the profile page looks like the app it replaces. */
function profileCss(): string {
  return `
.profile-wrap{max-width:520px;padding-top:${Spacing.six}px;padding-bottom:${Spacing.six}px;display:flex;flex-direction:column;gap:${Spacing.five}px}
.profile-card{align-items:center;text-align:center;display:flex;flex-direction:column;gap:${Spacing.four}px;padding:${Spacing.six}px ${Spacing.five}px}
#avatar{width:208px;height:208px;border-radius:${Radius.pill}px;object-fit:cover;display:block}
.avatar.initials{width:208px;height:208px;font-size:79px}
.profile-card h1{font-size:26px;line-height:1.25;font-weight:700;margin:0}
.profile-headline{color:var(--text-secondary);font-size:16px;line-height:1.4;margin:0}
.profile-role{display:flex;align-items:center;justify-content:center;gap:6px;color:var(--text-secondary);font-size:15px;margin:0}

#contact-chips{display:flex;flex-wrap:wrap;justify-content:center;gap:${Spacing.two}px}
.chip{display:inline-flex;align-items:center;gap:6px;height:36px;padding:0 ${Spacing.three}px;border:none;border-radius:${Radius.pill}px;background:var(--surface-alt);color:var(--text);font:inherit;font-weight:600;font-size:13px;appearance:none;cursor:pointer}
.chip.locked{color:var(--text-tertiary);cursor:default}
.chips-note{color:var(--text-secondary);font-size:13px;margin:0}

.links{display:flex;flex-wrap:wrap;justify-content:center;gap:${Spacing.two}px;list-style:none;margin:0;padding:0}
.links a{display:inline-flex;align-items:center;gap:6px;height:36px;padding:0 ${Spacing.three}px;border-radius:${Radius.pill}px;background:var(--surface-alt);color:var(--text);font-weight:600;font-size:13px}
.links a:hover{text-decoration:none;background:var(--primary-soft)}

.button-block{align-self:stretch;width:100%;height:48px;font-size:15px}

#booking{padding:0;overflow:hidden}
#booking h2,#connect h2{margin:0}
#booking h2{padding:${Spacing.four}px ${Spacing.four}px 0}
.section-caption{color:var(--text-secondary);font-size:13px;margin:2px 0 0}
#booking .section-caption{margin:2px ${Spacing.four}px ${Spacing.three}px}
.booking-row{display:flex;align-items:center;gap:${Spacing.three}px;padding:14px ${Spacing.four}px;border-top:1px solid var(--border);color:var(--text)}
.booking-row:hover{text-decoration:none;background:var(--surface-alt)}
.booking-row-body{flex:1;display:flex;flex-direction:column;gap:2px;text-align:left}
.booking-row-label{font-size:16px}
.booking-row-provider{color:var(--text-secondary);font-size:13px}

#connect{display:flex;flex-direction:column;gap:${Spacing.three}px}
#connect-form{display:flex;flex-direction:column;gap:${Spacing.four}px}
.connect-privacy{color:var(--text-tertiary);font-size:13px;margin:0;text-align:center}
#connect-error{display:flex;align-items:center;gap:${Spacing.two}px;padding:${Spacing.three}px;border-radius:${Radius.md}px;background:var(--danger-soft);color:var(--danger-text)}
#connect-error[hidden],#connect-success[hidden]{display:none}

.promo,.report-wrap{text-align:center;margin:0}
#report{display:inline-flex;align-items:center;gap:6px;height:36px;padding:0 ${Spacing.three}px;border:none;border-radius:${Radius.pill}px;background:transparent;color:var(--text-secondary);font:inherit;font-weight:600;font-size:13px;appearance:none;cursor:pointer}
#report:hover{background:var(--surface-alt)}

#spa-loading{display:none}
/* Signed-in handoff: the app mounts #root at the end of <body> and its reset sets body{overflow:hidden},
   so everything else in <body> has to go or the app lands below the fold. The spinner fills the screen
   until the handoff script removes it on the app's first render. */
.spa #page,.spa header.site,.spa body>footer{display:none}
.spa #spa-loading{display:flex;height:100%;align-items:center;justify-content:center}
.spinner{width:32px;height:32px;border-radius:${Radius.pill}px;border:3px solid var(--border);border-top-color:var(--primary);animation:spin .8s linear infinite}
@keyframes spin{to{transform:rotate(360deg)}}

.status{padding:${Spacing.seven}px 0;text-align:center;display:flex;flex-direction:column;align-items:center;gap:${Spacing.four}px}
.status h1{font-size:28px;line-height:1.3;margin:0}
.status p{color:var(--text-secondary)}
`;
}
