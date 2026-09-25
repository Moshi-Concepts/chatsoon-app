// Inline ionicons for apps/web pages. Every icon is decorative: the visible label sitting next to it
// always carries the meaning, so both helpers render aria-hidden and unfocusable, matching the plan
// (§4 WP-B2) and the mobile app's own Icon component (apps/mobile/src/components/ui/icon.tsx), which
// never gives an icon its own accessible name either.

import { ICON_PATHS, type IconName } from './icon-paths';

export type { IconName };

/**
 * Hidden `<symbol>` definitions for the icons a page actually uses, so a name repeated on the page
 * (e.g. two "sparkles") only ships its path data once. Call this exactly once per page, with every
 * name the page's `icon()` calls use.
 */
export function sprite(names: IconName[]): string {
  const unique = [...new Set(names)];
  const symbols = unique
    .map((name) => `<symbol id="icon-${name}" viewBox="${ICON_PATHS[name].viewBox}">${ICON_PATHS[name].body}</symbol>`)
    .join('');
  return `<svg aria-hidden="true" focusable="false" style="position:absolute;width:0;height:0" xmlns="http://www.w3.org/2000/svg">${symbols}</svg>`;
}

/** A fixed-size reference into the sprite. `sprite()` must already have been rendered on the page. */
export function icon(name: IconName, size = 20): string {
  return `<svg class="icon" width="${size}" height="${size}" aria-hidden="true" focusable="false"><use href="#icon-${name}"></use></svg>`;
}
