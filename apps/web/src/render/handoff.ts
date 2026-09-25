// The signed-in handoff (docs/profile-page-dom.md "Handoff to the full app", docs/public-pages-plan.md
// §2.3): an inline head script that adds the `spa` class to <html> when a session token is already in
// localStorage, and an inline end-of-body script that, only in spa mode, splices in the SPA's own
// styles, mounts #root and loads its entry script. Both are trusted, build-authored source (never user
// data), so neither needs HTML escaping — only the `<script>`-close guard below.
//
// CSS in css.ts hides `#page` and shows `#spa-loading` while `.spa` is set, so the anonymous page never
// flashes before this script's classList.add runs. profile.ts places the head script as early as
// possible in <head> and the body script right before the island's own module script.

import { SESSION_STORAGE_KEY } from '@chatsoon/shared/src/profile-page';

/** The SPA assets `functions/_generated/assets.ts` (C5) writes: dist/index.html's inline <style> blocks
 * and the SPA's compiled entry script, read at build time so this module has no dependency on Expo. */
export interface SpaAssets {
  /** Raw, trusted `<style>` tag(s) copied verbatim from dist/index.html: Expo's reset plus its
   * `<style data-href=…>` blocks (docs/public-pages-plan.md §2.3). */
  styles: string;
  /** URL of the SPA's compiled entry script, loaded as `type="module"`. */
  entryScriptSrc: string;
}

/**
 * JSON-quotes `value` for embedding inside a `<script>` body, then breaks up any `</script` substring
 * so it can't prematurely close the surrounding tag when the result is spliced into HTML.
 */
function jsString(value: string): string {
  return JSON.stringify(value).replace(/<\/(script)/gi, '<\\/$1');
}

/**
 * Inline, try/catch-wrapped source for the <head> script (no `<script>` wrapper): sets `html.spa` when
 * a session token already exists, so a signed-in visitor's anonymous flash is as short as possible. A
 * blocked storage API (private browsing, a locked-down browser) must never break the page.
 */
export function spaHeadScript(): string {
  return `try{if(localStorage.getItem(${jsString(SESSION_STORAGE_KEY)}))document.documentElement.classList.add('spa')}catch(e){}`;
}

/**
 * Inline source for the end-of-body script (no `<script>` wrapper). A no-op outside spa mode — the
 * island (which also checks `html.spa`) is the only thing that runs for an anonymous visitor. In spa
 * mode it copies in the SPA's inline styles, mounts `#root`, and loads the SPA's entry script, handing
 * the visit over to Expo Router exactly as docs/public-pages-plan.md §2.3 describes.
 */
export function spaBodyScript(spa: SpaAssets): string {
  return (
    `if(document.documentElement.classList.contains('spa')){` +
    `document.head.insertAdjacentHTML('beforeend',${jsString(spa.styles)});` +
    `document.body.insertAdjacentHTML('beforeend','<div id="root"></div>');` +
    // The spinner holds the screen until the app's first render into #root, then goes.
    `var r=document.getElementById('root'),l=document.getElementById('spa-loading');` +
    `if(l)new MutationObserver(function(m,o){if(r.firstChild){l.remove();o.disconnect()}}).observe(r,{childList:true});` +
    `var s=document.createElement('script');s.type='module';s.src=${jsString(spa.entryScriptSrc)};` +
    `document.body.appendChild(s);` +
    `}`
  );
}
