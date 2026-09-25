/// <reference lib="dom" />
// Attribution storage (issue #11, docs/referrals.md "How attribution works" step 2, "Landing page").
// Loaded two ways:
//  - standalone, as the /r/<code> landing page's own tiny island (this file's bottom-of-module
//    `main()`): the page's own Pages Function (src/server/referral.ts) already sets the `cs_ref`
//    cookie in its response headers, so this only ever needs to write localStorage and wire the page's
//    Copy button.
//  - imported by src/client/profile.ts for `/id/<slug>?ref=<CODE>`, which has no Function-level cookie
//    write of its own (docs/referrals.md "Web files": "the profile Function doesn't need to change its
//    caching for a query string"), so the profile island calls `captureReferralFromSearch` itself,
//    writing both the cookie and localStorage client-side.
//
// `main()` only acts when `#referral` is actually on the page, so importing this module for
// `captureReferralFromSearch` (profile.ts's bundle also pulls in this whole file) can never
// double-register the Copy button handler or do anything else the profile page doesn't ask for.

import { isValidReferralCode } from '@chatsoon/shared/src/referrals';

import { initCopy } from './copy';

const COOKIE_NAME = 'cs_ref';
const STORAGE_KEY = 'cs_ref';
/** 30 days — matches src/server/referral.ts's own Set-Cookie for the /r/<code> response. */
const COOKIE_MAX_AGE_S = 60 * 60 * 24 * 30;

/** Same attributes as the landing page's own Set-Cookie header. A blocked cookie API (locked-down
 * browser, some in-app browsers) must never break the page it's called from. */
export function writeReferralCookie(code: string): void {
  try {
    document.cookie = `${COOKIE_NAME}=${code}; Path=/; Max-Age=${COOKIE_MAX_AGE_S}; SameSite=Lax; Secure`;
  } catch {
    // Nothing actionable a visitor can do about a blocked cookie API.
  }
}

/** Mirrors the cookie in localStorage so the signed-in app can read it at onboarding
 * (docs/referrals.md "How attribution works" step 2). Private browsing, a locked-down browser, etc —
 * nothing actionable, same as every other try/catch in apps/web/src/client. */
export function writeReferralLocalStorage(code: string): void {
  try {
    localStorage.setItem(STORAGE_KEY, code);
  } catch {
    // See writeReferralCookie.
  }
}

/** Trims and uppercases `code`, then validates it against the Crockford alphabet/length. Returns null
 * for anything that isn't a real referral code, so a stray or tampered `?ref=` is never stored. */
export function normalizeReferralCode(code: string | null | undefined): string | null {
  if (!code) return null;
  const trimmed = code.trim().toUpperCase();
  return isValidReferralCode(trimmed) ? trimmed : null;
}

/**
 * Reads `ref` off a query string (e.g. `location.search`) and, only when it's a real code, writes both
 * the cookie and localStorage. Used by the profile island for `/id/<slug>?ref=<CODE>`
 * (docs/referrals.md "Web files"); a missing or invalid `ref` is a silent no-op.
 */
export function captureReferralFromSearch(search: string): void {
  const code = normalizeReferralCode(new URLSearchParams(search).get('ref'));
  if (!code) return;
  writeReferralCookie(code);
  writeReferralLocalStorage(code);
}

/** The /r/<code> landing page's own entry point. Reads the code from the page's own `#referral`
 * element (data-code, render/referral.ts) rather than the URL, so it always stores exactly the code
 * the page actually rendered. No-ops when `#referral` isn't present — i.e. whenever this module is
 * only loaded for its exports above (bundled into the profile island), never as the /r/<code> page's
 * own entry script. */
function main(): void {
  const el = document.getElementById('referral');
  const code = el?.dataset.code;
  if (!code) return;
  initCopy(); // the page's own "Copy" button (data-copy), same handler as the profile page's chips.
  writeReferralLocalStorage(code);
}

// Guarded so this module can be imported under Node (a test file, and the profile island's bundle)
// without a DOM. The bundle only ever actually runs in a browser.
if (typeof document !== 'undefined') main();
