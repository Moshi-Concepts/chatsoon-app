// Open Graph card contract shared by the API (apps/api), the chatsoon-og renderer (apps/og) and the
// web build/Function (apps/web) (issue #5, docs/og-plan.md §3.1).
//
// Deep import only: `@chatsoon/shared/src/og`. This file is not re-exported from `./index` (Stage B
// owns index.ts), so every consumer outside this package imports it by path.
//
// No zod, no schemas import: this module has to load in workerd (chatsoon-og) without pulling in
// input validation, and it's the whitelist boundary itself, not something validation should widen.
// `OgCard` carries only the 4 fields a card ever draws; `toOgCard` copies them by name so an object
// with extra fields (contact, links, ids, ...) can't leak through it.

/** Bump on any plate, card layout or font change; folded into every `ogVersion` so old renders miss. */
export const OG_TEMPLATE_VERSION = '1';

export const OG_IMAGE_SIZE = { width: 1200, height: 630 } as const;

/** The only profile fields a personalised card (or its text alt) ever draws. */
export interface OgCard {
  displayName: string;
  role: string | null;
  company: string | null;
  headline: string | null;
}

export interface OgAvatar {
  bytes: Uint8Array;
  type: 'image/jpeg' | 'image/png';
}

// `packages/shared/tsconfig.json` has no "dom" lib (this package also runs in Hermes and
// react-native-web) and no ambient "types" (no implicit @types/node globals). `computeOgVersion`
// below is the one function in this deep-import-only module that needs the two Web Crypto globals
// every runtime that actually imports it (workerd, the web build's Node process) provides, so they're
// declared locally here rather than widening the whole package's lib. Module-scoped `declare`s like
// these only affect type-checking inside this file; at runtime they resolve to the real globals.
declare const crypto: { subtle: { digest(algorithm: 'SHA-256', data: Uint8Array): Promise<ArrayBuffer> } };
declare const TextEncoder: new () => { encode(input: string): Uint8Array };

/** RPC surface of the chatsoon-og Worker (`OgRenderer`), called from the API over a service binding. */
export interface OgRendererRpc {
  render(card: OgCard, avatar: OgAvatar | null): Promise<Uint8Array>;
}

/** Copies the 4 card fields by name. Drops anything else on `p` (contact, links, ids, ...), even if
 * present, so a whitelist violation upstream can't reach the renderer or the version hash. */
export function toOgCard(p: OgCard): OgCard {
  return { displayName: p.displayName, role: p.role, company: p.company, headline: p.headline };
}

/**
 * 16 hex characters, stable for the same inputs, and different whenever `OG_TEMPLATE_VERSION`, any
 * of the 4 card fields, or `avatarKey` changes (O10). SHA-256 over those 6 values, `\u0000`-joined
 * (null becomes `''`); none of these fields can contain a NUL, so the join can't collide.
 */
export async function computeOgVersion(card: OgCard, avatarKey: string | null): Promise<string> {
  const input = [
    OG_TEMPLATE_VERSION,
    card.displayName,
    card.role ?? '',
    card.company ?? '',
    card.headline ?? '',
    avatarKey ?? '',
  ].join('\u0000');
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
  return [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
    .slice(0, 16);
}
