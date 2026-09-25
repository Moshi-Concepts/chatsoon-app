// Template fingerprint (docs/og-plan.md §3.2's "Fingerprint" test): a hash over the plate image, the
// dynamic layout card.ts produces and the font list. `TEMPLATE_FINGERPRINT` is a value checked in by
// hand below; test/version.test.ts recomputes it fresh from the running code and the built plate, and
// fails with "bump OG_TEMPLATE_VERSION and update TEMPLATE_FINGERPRINT" on any mismatch — so a plate,
// layout or font change can't ship without also bumping `OG_TEMPLATE_VERSION`
// (packages/shared/src/og.ts). Without that bump, a profile's already-cached `ogVersion` would keep
// matching a card that no longer renders the same way, and R2 would keep serving the stale JPEG.
//
// Hashing card.ts's raw source text isn't possible from inside a Worker (no filesystem at runtime), so
// this hashes its *output* for a fixed sample card instead — its structure and every style value it
// sets — plus each font's name, weight and byte length, plus the plate's own bytes. That's everything a
// plate, layout or font change could actually do to a rendered card.

import { buildCardTree } from './card';
import type { RendererFont } from './render';

// packages/shared/tsconfig.json's pattern (see og.ts): no "dom" lib and no ambient "types" here either
// for the two Web Crypto globals every runtime that imports this module (workerd, Node 19+) provides.
declare const crypto: { subtle: { digest(algorithm: 'SHA-256', data: Uint8Array): Promise<ArrayBuffer> } };
declare const TextEncoder: new () => { encode(input: string): Uint8Array };

/** Recomputed by test/version.test.ts on every run; update this after a deliberate plate/layout/font change. */
export const TEMPLATE_FINGERPRINT = '221cc2498158c665ef9e0806a86c5413993c50c83f8d7f7be879dc44ed9edee3';

const SAMPLE_CARD = {
  displayName: 'Ada Lovelace',
  role: 'Founder',
  company: 'Analytical Engines',
  headline: 'Building the future of computing, one card at a time',
} as const;

// A stand-in data URI, never rendered — the fingerprint only cares about the tree's shape and styles,
// not the plate pixels reaching card.ts through this argument (the plate's own bytes are hashed below).
const PLACEHOLDER_PLATE_URI = 'data:image/jpeg;base64,';

async function sha256Hex(data: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function fontManifest(fonts: RendererFont[]): string {
  return fonts
    .map((f) => `${f.name}:${f.weight}:${f.style ?? 'normal'}:${f.data.byteLength}`)
    .sort()
    .join('|');
}

export async function computeTemplateFingerprint(plate: ArrayBuffer, fonts: RendererFont[]): Promise<string> {
  const tree = buildCardTree(SAMPLE_CARD, null, PLACEHOLDER_PLATE_URI);
  const plateHash = await sha256Hex(new Uint8Array(plate));
  const summary = [plateHash, JSON.stringify(tree), fontManifest(fonts)].join('\u0000');
  return sha256Hex(new TextEncoder().encode(summary));
}
