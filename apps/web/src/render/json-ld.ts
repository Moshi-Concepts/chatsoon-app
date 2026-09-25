// §3.4 ProfilePage JSON-LD, built only for indexable profiles (D23: never on a noindex page). The
// object is embedded by profile.ts with `escapeJsonLd` (render/escape.ts), which already implements the
// exact §3.4 escaping (<, >, &, U+2028, U+2029) — this module only builds the plain object and omits
// every null field itself, since `JSON.stringify` would otherwise print `"description":null` etc.
//
// Deep imports only (docs/public-pages-plan.md §4): `@chatsoon/shared/src/{constants,links,types}`.

import { APP_NAME } from '@chatsoon/shared/src/constants';
import { toLinkUrl } from '@chatsoon/shared/src/links';
import type { LinkKey, PageProfile } from '@chatsoon/shared/src/types';

/** §3.4's `sameAs` list: exactly these 6 kinds, in this order. Never phone/whatsapp/signal — those
 * aren't LinkKeys and PageProfile never carries their values in the first place. Discord only ever
 * contributes a URL for the numeric-id form (issue #21): `toLinkUrl` already returns null for a
 * username or legacy discriminator, so those are silently left out here, same as any other kind. */
const SAME_AS_KEYS: readonly LinkKey[] = ['linkedin', 'x', 'youtube', 'telegram', 'discord', 'website'];

/** Removes every `utm_*` query parameter (case-insensitive), keeping every other parameter and the
 * rest of the URL untouched. Falls back to the raw url on anything `URL` can't parse (never expected
 * for what `toLinkUrl` returns, but this must never throw the whole page down). */
function stripUtmParams(url: string): string {
  try {
    const u = new URL(url);
    const toDelete = [...u.searchParams.keys()].filter((key) => key.toLowerCase().startsWith('utm_'));
    for (const key of toDelete) u.searchParams.delete(key);
    return u.toString();
  } catch {
    return url;
  }
}

/** `sameAs`: only the link kinds above, only when `toLinkUrl` accepts the stored value, with
 * `utm_*` stripped. Never includes phone, WhatsApp, Signal, email, tel:, wa.me or signal.me — none of
 * those are ever read here, and `PageProfile` doesn't carry contact values at all. */
function sameAs(p: PageProfile): string[] {
  return SAME_AS_KEYS.flatMap((key) => {
    const url = toLinkUrl(key, p.links[key]);
    return url ? [stripUtmParams(url)] : [];
  });
}

/**
 * The §3.4 ProfilePage JSON-LD object for an indexable profile. `origin` is passed in rather than
 * imported (same choice as `profileOgBlock`), so this stays a pure, easily testable function —
 * production always calls it with WEB_ORIGIN. `isPartOf`'s `@id` matches home.ts's WebSite node exactly
 * so the two pages describe the same site.
 *
 * Reads only `slug`, `displayName`, `updatedAt`, `headline`, `role`, `company`, `avatarVersion` and
 * `links`, copied by name — never `contactChannels`, `bookingLinks` or anything else, so an object that
 * picked up extra fields upstream (an injected `contact`, say) can't leak through here either. Never
 * emits `telephone`, `contactPoint`, `email`, `tel:`, `wa.me`, `signal.me`, a vCard or a booking URL.
 */
export function profileJsonLd(p: PageProfile, origin: string): Record<string, unknown> {
  const url = `${origin}/id/${p.slug}`;

  const person: Record<string, unknown> = { '@type': 'Person', '@id': `${url}#person`, name: p.displayName };
  if (p.headline) person.description = p.headline;
  if (p.role) person.jobTitle = p.role;
  if (p.company) person.worksFor = { '@type': 'Organization', name: p.company };
  if (p.avatarVersion) person.image = `${origin}/id/${p.slug}/photo?v=${p.avatarVersion}`;
  person.url = url;
  const links = sameAs(p);
  if (links.length) person.sameAs = links;

  return {
    '@context': 'https://schema.org',
    '@type': 'ProfilePage',
    '@id': url,
    url,
    dateModified: p.updatedAt,
    isPartOf: { '@type': 'WebSite', '@id': `${origin}/#website`, name: APP_NAME, url: `${origin}/` },
    mainEntity: person,
  };
}
