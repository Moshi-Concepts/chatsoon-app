// Splices generic Open Graph tags into the exported SPA shell (dist/index.html), so every app route
// gets a branded link preview until Stage C replaces the shell's body with a real profile page for
// /id/:slug (docs/og-plan.md O12, O13, §3.4 "SPA shell"). build.ts calls `injectShellOg` once, right
// after `expo export` has written dist/. A Pages Function (WP-5) later replaces this same
// `<!--og-->...<!--/og-->` block with `profileOgBlock`'s output for /id/:slug requests only.

import { APP_NAME, TAGLINE } from '@chatsoon/shared/src/constants';

import { escapeHtml } from './escape';
import { DESCRIPTION as HOME_DESCRIPTION } from './home';
import { ogTags } from './og';
import { DEFAULT_OG_IMAGE } from './og-asset';

const SHELL_TITLE = `${APP_NAME}: ${TAGLINE}`;

const CHARSET_RE = /<meta charset="utf-8"\s*\/?>/;

// Some preview bots fetch only the first few KB of a document. 2048 bytes covers every documented
// limit with margin, and the block itself is under 700 bytes today.
const MARKER_BYTE_LIMIT = 2048;
const MARKER_END = '<!--/og-->';

function shellBlock(): string {
  const tags = ogTags({
    type: 'website',
    title: SHELL_TITLE,
    description: HOME_DESCRIPTION,
    // No url (O16): a fixed og:url here would merge every app route's share into the home page.
    image: DEFAULT_OG_IMAGE,
    card: 'summary_large_image',
  });
  return (
    `<!--og-->` +
    `<title>${escapeHtml(SHELL_TITLE)}</title>` +
    `<meta name="description" content="${escapeHtml(HOME_DESCRIPTION)}">` +
    tags +
    MARKER_END
  );
}

/**
 * Removes the exported shell's `<title>` and `<meta name="description">`, then inserts the marker
 * block right after `<meta charset="utf-8" />` (docs/og-plan.md WP-2). Throws if the shell doesn't
 * carry exactly one charset tag, or if the block would end after byte 2048.
 */
export function injectShellOg(html: string): string {
  const charsetCount = (html.match(new RegExp(CHARSET_RE, 'g')) ?? []).length;
  if (charsetCount !== 1) {
    throw new Error(`injectShellOg: expected exactly one <meta charset="utf-8"> tag, found ${charsetCount}`);
  }

  const withoutTitle = html.replace(/<title>[\s\S]*?<\/title>/, '');
  const withoutDescription = withoutTitle.replace(/<meta name="description"[^>]*>\s*/, '');
  const injected = withoutDescription.replace(CHARSET_RE, (m) => `${m}${shellBlock()}`);

  const endIndex = injected.indexOf(MARKER_END);
  if (endIndex === -1) throw new Error('injectShellOg: marker block was not inserted');
  const byteEnd = Buffer.byteLength(injected.slice(0, endIndex + MARKER_END.length), 'utf8');
  if (byteEnd > MARKER_BYTE_LIMIT) {
    throw new Error(`injectShellOg: marker block ends at byte ${byteEnd}, over the ${MARKER_BYTE_LIMIT} limit`);
  }

  return injected;
}
