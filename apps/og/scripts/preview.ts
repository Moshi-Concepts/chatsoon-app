// Renders every fixture (src/fixtures.ts) plus, optionally, a real profile, and stamps them into a
// labelled contact sheet for Peter's approval — this is the Phase 2 deploy gate (docs/og-plan.md §2.3).
//
//   pnpm --filter @chatsoon/og preview [-- --slug <slug>]
//
// Uses the exact same code path production does: `render.ts`'s `createRenderer`, loaded here with the
// wasm and fonts read straight off disk (node-runtime.ts) instead of through wrangler's bundler.

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import sharp from 'sharp';

import { toOgCard, type OgAvatar, type OgCard } from '@chatsoon/shared/src/og';
import type { PublicProfile } from '@chatsoon/shared/src/types';

import { FIXTURES, type OgFixture } from '../src/fixtures';
import { loadNodeFonts, loadNodeWasm } from './node-runtime';
import { createRenderer } from '../src/render';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = path.join(ROOT, 'preview');
const PLATE_PATH = path.join(ROOT, 'assets/plate.jpg');
const MOBILE_OG_DIR = path.resolve(ROOT, '../mobile/public/og');
const MAX_BYTES = 300 * 1024; // docs/og-plan.md §2.2/§2.3: "must stay under 300 KB"
const API_ORIGIN = 'https://api.chatsoon.app';

interface RenderedTile {
  id: string;
  label: string;
  buffer: Buffer;
  ms: number;
}

function parseSlugArg(): string | null {
  const args = process.argv.slice(2);
  const flagIndex = args.indexOf('--slug');
  return flagIndex >= 0 ? (args[flagIndex + 1] ?? null) : null;
}

/** Sniffs the handful of avatar types the API ever stores (§2.2's avatar guard covers the rest). */
function guessImageType(bytes: Uint8Array): 'image/jpeg' | 'image/png' | null {
  if (bytes[0] === 0xff && bytes[1] === 0xd8) return 'image/jpeg';
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return 'image/png';
  return null;
}

/** §2.3: "fetches the public JSON, keeps only what toOgCard allows, and downloads the avatar". */
async function fetchSlugFixture(slug: string): Promise<OgFixture | null> {
  const res = await fetch(`${API_ORIGIN}/id/${encodeURIComponent(slug)}`, { signal: AbortSignal.timeout(10_000) });
  if (!res.ok) {
    console.warn(`preview: GET /id/${slug} returned ${res.status}, skipping the --slug fixture`);
    return null;
  }
  const profile = (await res.json()) as PublicProfile;
  const card: OgCard = toOgCard(profile as unknown as OgCard);

  let avatar: OgAvatar | null = null;
  if (profile.avatarUrl) {
    try {
      const avatarRes = await fetch(profile.avatarUrl, { signal: AbortSignal.timeout(10_000) });
      if (avatarRes.ok) {
        const bytes = new Uint8Array(await avatarRes.arrayBuffer());
        const type = guessImageType(bytes);
        if (type) avatar = { type, bytes };
        else console.warn('preview: --slug avatar is neither JPEG nor PNG, rendering without a photo');
      }
    } catch (err) {
      console.warn(`preview: could not download the --slug avatar: ${err instanceof Error ? err.message : err}`);
    }
  }

  return { id: `slug-${slug}`, label: `--slug ${slug}`, card, avatar };
}

function findGenericImage(): { path: string; buffer: Buffer } | null {
  if (!existsSync(MOBILE_OG_DIR)) return null;
  const file = readdirSync(MOBILE_OG_DIR).find((f) => /^chatsoon-[0-9a-f]{8}\.jpg$/.test(f));
  if (!file) return null;
  const full = path.join(MOBILE_OG_DIR, file);
  return { path: full, buffer: readFileSync(full) };
}

/** A grid of labelled thumbnails, one per rendered tile, for a single glance-able approval image. */
async function buildContactSheet(tiles: RenderedTile[]): Promise<Buffer> {
  const cols = 3;
  const thumbW = 400;
  const thumbH = Math.round((thumbW * 630) / 1200);
  const labelH = 42;
  const cellW = thumbW;
  const cellH = thumbH + labelH;
  const rows = Math.ceil(tiles.length / cols);
  const sheetW = cellW * cols;
  const sheetH = cellH * rows;

  const composites: { input: Buffer; left: number; top: number }[] = [];
  const labelSvgParts: string[] = [];
  for (const [i, tile] of tiles.entries()) {
    const col = i % cols;
    const row = Math.floor(i / cols);
    const x = col * cellW;
    const y = row * cellH;
    const thumb = await sharp(tile.buffer).resize(thumbW, thumbH).toBuffer();
    composites.push({ input: thumb, left: x, top: y });
    const kb = Math.round(tile.buffer.length / 1024);
    // ~6.3px/char at this font size and weight; truncate so a long label can't run into the next
    // column (there's no text wrapping in a hand-built SVG string).
    const maxChars = Math.floor((cellW - 12) / 6.3);
    const label = tile.label.length > maxChars ? `${tile.label.slice(0, maxChars - 1)}…` : tile.label;
    labelSvgParts.push(
      `<text x="${x + 6}" y="${y + thumbH + 17}" font-family="sans-serif" font-size="13" fill="#111">${escapeXml(label)}</text>`,
      `<text x="${x + 6}" y="${y + thumbH + 33}" font-family="sans-serif" font-size="12" fill="#666">${kb}KB, ${tile.ms}ms</text>`,
    );
  }
  const labelsSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="${sheetW}" height="${sheetH}">${labelSvgParts.join('')}</svg>`;
  const labelsPng = await sharp(Buffer.from(labelsSvg)).png().toBuffer();

  return sharp({ create: { width: sheetW, height: sheetH, channels: 3, background: '#F2F2F5' } })
    .composite([...composites, { input: labelsPng, left: 0, top: 0 }])
    .jpeg({ quality: 90 })
    .toBuffer();
}

function escapeXml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[c]!);
}

async function main(): Promise<void> {
  mkdirSync(OUT_DIR, { recursive: true });

  const slug = parseSlugArg();
  const fixtures: OgFixture[] = [...FIXTURES];
  if (slug) {
    const slugFixture = await fetchSlugFixture(slug);
    if (slugFixture) fixtures.push(slugFixture);
  }

  const { yoga, resvgWasm } = await loadNodeWasm();
  const fonts = loadNodeFonts();
  const plate = readFileSync(PLATE_PATH).buffer as ArrayBuffer;
  const render = await createRenderer({ yoga, resvgWasm, fonts, plate });

  const tiles: RenderedTile[] = [];
  let overLimit = false;

  for (const fixture of fixtures) {
    const start = performance.now();
    const bytes = await render(fixture.card, fixture.avatar);
    const ms = Math.round(performance.now() - start);
    const buffer = Buffer.from(bytes);
    writeFileSync(path.join(OUT_DIR, `${fixture.id}.jpg`), buffer);
    const kb = (buffer.length / 1024).toFixed(1);
    const flag = buffer.length >= MAX_BYTES ? '  !! 300KB LIMIT' : '';
    console.log(`preview: ${fixture.id.padEnd(24)} ${String(ms).padStart(4)}ms  ${kb.padStart(6)}KB${flag}`);
    if (buffer.length >= MAX_BYTES) overLimit = true;
    tiles.push({ id: fixture.id, label: fixture.label, buffer, ms });
  }

  const generic = findGenericImage();
  if (generic) {
    tiles.push({ id: 'generic', label: `Generic image (${path.basename(generic.path)})`, buffer: generic.buffer, ms: 0 });
    console.log(`preview: generic                    n/a  ${(generic.buffer.length / 1024).toFixed(1).padStart(6)}KB`);
  } else {
    console.warn('preview: no apps/mobile/public/og/chatsoon-*.jpg found; the sheet will skip the generic image');
  }

  const sheet = await buildContactSheet(tiles);
  writeFileSync(path.join(OUT_DIR, 'sheet.jpg'), sheet);
  console.log(`preview: wrote ${path.relative(ROOT, path.join(OUT_DIR, 'sheet.jpg'))} (${(sheet.length / 1024).toFixed(1)}KB)`);

  if (overLimit) {
    console.error('preview: at least one fixture is 300 KB or larger');
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? (err.stack ?? err.message) : err);
  process.exit(1);
});
