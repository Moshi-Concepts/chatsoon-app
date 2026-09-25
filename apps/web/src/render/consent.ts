// Cookie consent banner + opt-in GA4 loader (issue #17). One source used by every apps/web surface:
// layout.ts (static pages, rendered at build time), profile.ts (server-rendered profile, rendered at
// *request* time by a Cloudflare Pages Function — see functions/id/[[path]].ts) and build.ts (injected
// into the exported SPA's dist/index.html). No Google request, script or cookie happens before the
// visitor clicks Accept, and nothing is ever eval'd or injected via innerHTML — the banner is built with
// createElement/textContent only.
//
// Everything below is a hand-written literal, not run through a minifier: profile.ts's renderProfile()
// executes inside the Workers/`workerd` runtime on every live /id/:slug request, which has no
// child_process or worker_threads — esbuild's transformSync (fine in build.ts and in tests, both plain
// Node) throws `__filename is not defined` there. So this file must stay dependency-free at runtime, the
// same constraint escape.ts and handoff.ts already follow.
//
// Storage: `chatsoon.consent` in localStorage, value `granted` or `denied` (docs match this file).
// Every localStorage access is wrapped in try/catch: a blocked store (private browsing, a locked-down
// browser) must never break the page, and worst case just re-shows the banner every visit.

import { GA_MEASUREMENT_ID } from '@chatsoon/shared/src/constants';
import { Colors, type ThemeColors } from '@chatsoon/shared/src/design';

export const CONSENT_STORAGE_KEY = 'chatsoon.consent';
export type ConsentValue = 'granted' | 'denied';

/**
 * Pure decision the inline script (below) makes from whatever it reads out of localStorage at load
 * time. Kept as a real, testable function since the script itself is opaque JS-in-a-string — vitest has
 * no DOM here (apps/web's tests run with `environment: 'node'`, and jsdom/happy-dom aren't installed),
 * so this is what test/consent.test.ts exercises directly. consentScript()'s init logic at the bottom
 * follows exactly this branching; keep them in sync by hand if either changes.
 */
export function consentAction(stored: string | null): 'banner' | 'load' | 'none' {
  if (stored === 'granted') return 'load';
  if (stored === 'denied') return 'none';
  return 'banner';
}

/**
 * Inline, dependency-free IIFE (no `<script>` wrapper — callers add that). Renders nothing by default;
 * shows the banner when there's no stored choice, loads gtag.js only after Accept (or, for a returning
 * `granted` visitor, after `load`/`requestIdleCallback` so it never competes with page rendering), and
 * exposes `window.chatsoonConsent.open()` for the "Cookie settings" control on every surface. Class names
 * here (`cc-*`) match bannerRules() below. Every DOM node is built with `ce()` (a tiny createElement +
 * plain-property-assignment helper) or `document.createTextNode` — never `innerHTML`.
 */
export function consentScript(): string {
  return `(function(){
var K=${JSON.stringify(CONSENT_STORAGE_KEY)},G=${JSON.stringify(GA_MEASUREMENT_ID)};
function get(){try{return localStorage.getItem(K)}catch(e){return null}}
function set(v){try{localStorage.setItem(K,v)}catch(e){}}
function clear(){try{localStorage.removeItem(K)}catch(e){}}
function disable(v){try{window['ga-disable-'+G]=v}catch(e){}}
function ce(t,p){var e=document.createElement(t);for(var k in p)e[k]=p[k];return e}
function loadGA(){
if(window.__ccLoaded)return;
window.__ccLoaded=true;
disable(false);
document.head.appendChild(ce('script',{async:true,src:'https://www.googletagmanager.com/gtag/js?id='+G}));
window.dataLayer=window.dataLayer||[];
window.gtag=function(){window.dataLayer.push(arguments)};
window.gtag('js',new Date());
window.gtag('config',G,{allow_google_signals:false,allow_ad_personalization_signals:false})
}
function deferLoad(){
if(document.readyState==='complete'){if(window.requestIdleCallback)requestIdleCallback(loadGA);else setTimeout(loadGA,0)}
else window.addEventListener('load',deferLoad,{once:true})
}
function wipeCookies(){
var hosts=['','; domain='+location.hostname,'; domain=.chatsoon.app'];
document.cookie.split(';').forEach(function(c){
var n=c.split('=')[0].trim();
if(n==='_ga'||n.indexOf('_ga_')===0)hosts.forEach(function(h){document.cookie=n+'=; path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT'+h})
})
}
var el=null;
function hide(){if(el){el.remove();el=null}}
function show(){
if(el)return;
var text=ce('p',{className:'cc-text'});
text.appendChild(document.createTextNode("We'd like to use analytics cookies to understand how chatsoon.app is used. "));
text.appendChild(ce('a',{href:'/privacy#analytics-cookies',textContent:'Privacy policy'}));
var decline=ce('button',{type:'button',className:'cc-btn',textContent:'Decline',onclick:function(){
set('denied');
disable(true);
hide();
wipeCookies()
}});
var accept=ce('button',{type:'button',className:'cc-btn cc-accept',textContent:'Accept',onclick:function(){
set('granted');
hide();
loadGA()
}});
var row=ce('div',{className:'cc-actions'});
row.appendChild(decline);
row.appendChild(accept);
el=ce('div',{className:'cc-banner'});
el.setAttribute('role','region');
el.setAttribute('aria-label','Cookie consent');
el.appendChild(text);
el.appendChild(row);
document.body.appendChild(el)
}
window.chatsoonConsent={open:function(){clear();disable(false);show()}};
var v=get();
if(v==='granted')deferLoad();
else if(v==='denied')disable(true);
else show();
document.querySelectorAll('[data-consent-open]').forEach(function(b){
b.addEventListener('click',function(){window.chatsoonConsent.open()})
})
})();`;
}

/** Structural + colour rules shared by every surface. Colours come in as CSS custom properties so
 * callers can point them at the site's own tokens (consentCss) or hard-coded hex (consentCssStandalone). */
function bannerRules(): string {
  return `.cc-banner{position:fixed;left:16px;right:16px;bottom:16px;z-index:2147483000;display:flex;flex-wrap:wrap;align-items:center;gap:12px;padding:14px 16px;border:1px solid var(--cc-border);border-radius:12px;background:var(--cc-bg);color:var(--cc-text);font:14px/1.4 system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;box-shadow:0 12px 28px -12px rgba(0,0,0,.35)}
@media (min-width:640px){.cc-banner{right:auto;max-width:420px}}
.cc-text{margin:0;flex:1 1 220px}
.cc-text a{color:var(--cc-link);text-decoration:underline}
.cc-actions{display:flex;gap:8px;flex:none;margin-left:auto}
.cc-btn{font:inherit;font-size:13px;font-weight:600;padding:8px 14px;border-radius:8px;cursor:pointer;border:1.5px solid var(--cc-border);background:transparent;color:var(--cc-text)}
.cc-accept{background:var(--cc-primary);border-color:var(--cc-primary);color:var(--cc-on-primary)}
.cc-btn:focus-visible{outline:2px solid var(--cc-primary);outline-offset:2px}
.cookie-settings-link{background:none;border:none;padding:0;margin:0;font:inherit;color:inherit;cursor:pointer;text-decoration:none}
.cookie-settings-link:hover{text-decoration:underline}`;
}

/** For pages that already carry css.ts's tokens (home, legal, profile): point the banner's custom
 * properties straight at the existing `--surface`/`--border`/etc. variables so it stays theme-aware
 * without duplicating any colour. */
export function consentCss(): string {
  return `:root{--cc-bg:var(--surface);--cc-border:var(--border);--cc-text:var(--text);--cc-link:var(--primary-text);--cc-primary:var(--primary);--cc-on-primary:var(--on-primary)}
${bannerRules()}`;
}

/** For the exported SPA shell (dist/index.html), which never loads css.ts's stylesheet: the same rules,
 * with the custom properties set from `Colors` directly (light default, dark override), per
 * `prefers-color-scheme` — there's no `:root` token set to borrow from there. */
export function consentCssStandalone(): string {
  const v = (c: ThemeColors) =>
    `--cc-bg:${c.surface};--cc-border:${c.border};--cc-text:${c.text};--cc-link:${c.primaryText};--cc-primary:${c.primary};--cc-on-primary:${c.onPrimary}`;
  return `:root{${v(Colors.light)};color-scheme:light dark}
@media (prefers-color-scheme:dark){:root{${v(Colors.dark)}}}
${bannerRules()}`;
}

/** "Cookie settings" control: a footer link/button on the static and profile pages. Wired up by the
 * delegated click listener at the end of consentScript(), so it needs no extra script of its own. */
export function cookieSettingsLinkHtml(): string {
  return `<button type="button" class="cookie-settings-link" data-consent-open>Cookie settings</button>`;
}

/**
 * Splices the standalone CSS and the script into an already-exported SPA shell (dist/index.html), for
 * an anonymous visit that lands straight on the SPA rather than a static or profile page (e.g.
 * /sign-in). build.ts's `injectConsentIntoShell` is a thin read/write wrapper around this pure function
 * — kept separate and exported so it's testable without a real Expo export (mirrors shell.ts's
 * `injectShellOg`/`injectSpaShellOg` split). Runs after the shell's own `<script src=…>` entry point and
 * `<div id="root">` already exist in the markup, so the consent script (which only ever calls
 * `document.body.appendChild`, never touching `#root`) is always a sibling of it, never inside it.
 */
export function injectConsentIntoIndexHtml(html: string): string {
  if (!html.includes('</head>')) throw new Error('injectConsentIntoIndexHtml: no </head> tag');
  if (!html.includes('</body>')) throw new Error('injectConsentIntoIndexHtml: no </body> tag');
  return html
    .replace('</head>', `<style>${consentCssStandalone()}</style></head>`)
    .replace('</body>', `<script>${consentScript()}</script></body>`);
}
