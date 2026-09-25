/// <reference lib="dom" />
// Entry point for the profile page island (WP-C4, docs/profile-page-dom.md). Bundled by
// apps/web/scripts/build.ts (esbuild --bundle --format=esm --minify --target=es2020) into
// dist/_p/profile-<hash>.js and loaded by a single `<script type="module">` near the end of <body>.
//
// Reads its config from `#page`'s data attributes and exits immediately for a signed-in visitor
// (`html.spa`, set by the inline head script before this module ever loads) — the SPA takes over and
// none of Connect, booking, report or reveal apply to it.

import { initBooking } from './booking';
import { initConnect } from './connect';
import { initCopy } from './copy';
import { initReport } from './report';
import { initReveal } from './reveal';

export interface PageConfig {
  slug: string;
  api: string;
  sitekey: string;
  first: string;
  visibility: 'connections' | 'public';
}

/** Pulled out for testing: takes anything shaped like the `#page` element's `.dataset`. */
export function readConfig(dataset: DOMStringMap): PageConfig | null {
  const { slug, api, sitekey, first, visibility } = dataset;
  if (!slug || !api || !sitekey || !first) return null;
  return { slug, api, sitekey, first, visibility: visibility === 'public' ? 'public' : 'connections' };
}

function main(): void {
  if (document.documentElement.classList.contains('spa')) return;

  const page = document.getElementById('page');
  const config = page && readConfig(page.dataset);
  if (!config) return;

  initConnect({ api: config.api, slug: config.slug, sitekey: config.sitekey, first: config.first });
  initBooking({ first: config.first });
  initReport({ api: config.api, slug: config.slug, first: config.first });
  if (config.visibility === 'public') initReveal({ api: config.api, slug: config.slug });
  initCopy();
}

// Guarded so this module can be imported under Node (client-profile.test.ts imports `readConfig`)
// without a DOM. The bundle only ever actually runs in a browser.
if (typeof document !== 'undefined') main();
