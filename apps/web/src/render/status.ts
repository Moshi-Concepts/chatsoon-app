// 404, 429 and 503 pages for /id/:slug (docs/public-pages-plan.md §2.1, WP-C3), all noindex and built
// on the same shell every other apps/web page uses. handle.ts (C5) picks which one to serve; the actual
// HTTP status code and headers (Retry-After, etc.) are its responsibility, not this module's.

import { APP_NAME, WEB_ORIGIN } from '@chatsoon/shared/src/constants';

import { escapeHtml } from './escape';
import { page } from './layout';
import { DEFAULT_OG_IMAGE } from './og-asset';

interface StatusCopy {
  title: string;
  heading: string;
  message: string;
}

function renderStatus(path: string, copy: StatusCopy): string {
  const title = `${copy.title} · ${APP_NAME}`;
  const canonical = `${WEB_ORIGIN}${path}`;
  const main = `<div class="wrap status">
<h1>${escapeHtml(copy.heading)}</h1>
<p>${escapeHtml(copy.message)}</p>
<a class="button button-primary" href="/">Go to Chatsoon</a>
</div>`;

  return page({
    title,
    description: copy.message,
    canonical,
    robots: 'noindex',
    og: {
      type: 'website',
      title,
      description: copy.message,
      image: DEFAULT_OG_IMAGE,
      card: 'summary_large_image',
    },
    main,
  });
}

/** A missing or invalid slug (docs/profile-page-dom.md, docs/public-pages-plan.md §2.1 row `/id/:slug` 404). */
export function renderNotFound(path: string): string {
  return renderStatus(path, {
    title: 'Profile not found',
    heading: 'Profile not found',
    message: "This profile doesn't exist or was removed.",
  });
}

/** The miss limiter tripped (§2.1 row 429). */
export function renderRateLimited(path: string): string {
  return renderStatus(path, {
    title: 'Too many requests',
    heading: 'Too many requests',
    message: 'Too many attempts. Please wait a minute and try again.',
  });
}

/** The profile source RPC failed or timed out (§2.1 row 503). */
export function renderServiceUnavailable(path: string): string {
  return renderStatus(path, {
    title: 'Temporarily unavailable',
    heading: 'Temporarily unavailable',
    message: "We couldn't load this page. Please try again shortly.",
  });
}
