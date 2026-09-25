// Builds the static plate (docs/og-plan.md §2.2) and regenerates src/coverage.ts. Run from the repo
// root or apps/og:
//   pnpm --filter @chatsoon/og gen-plate
//
// The plate is built in three layers, all static art (no per-profile data):
//   1. the background gradient plus three radial glows, rendered from SVG with sharp;
//   2. the header crop on the right, scaled to the canvas height and faded in from its left edge;
//   3. the brand row and the "Connect on Chatsoon" call to action, drawn with satori + resvg-wasm to a
//      transparent PNG (the same renderer the per-profile cards use) and composited on top.
// The result is flattened and re-encoded as a single mozjpeg q88 JPEG.
//
// coverage.ts is generated in the same run because both outputs come from the same 15 fonts: this
// script is the one place that has fontkit and the font files open at once.

import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { create as createFont } from 'fontkit'; // types: scripts/node-globals.d.ts
import satori, { init as initSatori } from 'satori/standalone';
import { initWasm, Resvg } from '@resvg/resvg-wasm';
import sharp from 'sharp';

import { fontFilePaths, loadNodeFonts, loadNodeWasm } from './node-runtime';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const HEADER_PATH = path.join(ROOT, 'assets/brand/x-header-2172x724.png');
const X_AVATAR_PATH = path.join(ROOT, 'assets/brand/x-avatar.png');
const PLATE_PATH = path.join(ROOT, 'assets/plate.jpg');
const COVERAGE_PATH = path.join(ROOT, 'src/coverage.ts');

const WIDTH = 1200;
const HEIGHT = 630;

// ---------------------------------------------------------------------------------------------------
// Layer 1: background gradient + glows (§2.2 "Background")
// ---------------------------------------------------------------------------------------------------

/**
 * CSS `linear-gradient(135deg, ...)`'s direction vector, in a coordinate system where +y is down:
 * 0deg points "to top" (0,-1), 90deg "to right" (1,0), so a vector at angle `deg` is
 * (sin(deg), -cos(deg)). Centring a unit-length line on that vector inside the unit square gives the
 * `objectBoundingBox` endpoints below — an approximation of the browser's edge-to-edge calculation
 * that's exact for a square and close enough for this canvas's decorative use.
 */
function gradientEndpointsForAngle(deg: number): { x1: number; y1: number; x2: number; y2: number } {
  const rad = (deg * Math.PI) / 180;
  const dx = Math.sin(rad) / 2;
  const dy = -Math.cos(rad) / 2;
  return { x1: 0.5 - dx, y1: 0.5 - dy, x2: 0.5 + dx, y2: 0.5 + dy };
}

function backgroundSvg(): string {
  const bg = gradientEndpointsForAngle(135);
  // Radii are fractions of the canvas WIDTH (not an objectBoundingBox fraction of each axis), so the
  // glows stay circular on this non-square canvas instead of stretching into ellipses (§2.2's r values).
  const glows = [
    { id: 'glowBL', cx: 0, cy: HEIGHT, r: 0.75 * WIDTH, color: '#E0479E', opacity: 0.75 },
    { id: 'glowTL', cx: 0, cy: 0, r: 0.6 * WIDTH, color: '#720BD6', opacity: 0.85 },
    { id: 'glowTR', cx: WIDTH, cy: 0, r: 0.5 * WIDTH, color: '#A43FFD', opacity: 0.7 },
  ];
  const glowDefs = glows
    .map(
      (g) => `<radialGradient id="${g.id}" gradientUnits="userSpaceOnUse" cx="${g.cx}" cy="${g.cy}" r="${g.r}">
        <stop offset="0%" stop-color="${g.color}" stop-opacity="${g.opacity}"/>
        <stop offset="100%" stop-color="${g.color}" stop-opacity="0"/>
      </radialGradient>`,
    )
    .join('\n');
  const glowRects = glows.map((g) => `<rect width="${WIDTH}" height="${HEIGHT}" fill="url(#${g.id})"/>`).join('\n');

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}">
    <defs>
      <linearGradient id="base" x1="${bg.x1}" y1="${bg.y1}" x2="${bg.x2}" y2="${bg.y2}">
        <stop offset="0%" stop-color="#2A18B8"/>
        <stop offset="50%" stop-color="#1A1188"/>
        <stop offset="100%" stop-color="#1F1399"/>
      </linearGradient>
      ${glowDefs}
    </defs>
    <rect width="${WIDTH}" height="${HEIGHT}" fill="url(#base)"/>
    ${glowRects}
  </svg>`;
}

// ---------------------------------------------------------------------------------------------------
// Layer 2: right-hand header art, faded in from its left edge (§2.2 "Right-hand art")
// ---------------------------------------------------------------------------------------------------

async function rightHandArt(): Promise<{ buffer: Buffer; left: number; width: number }> {
  const cropWidth = 517;
  const cropHeight = 724;
  const artWidth = Math.round((cropWidth * HEIGHT) / cropHeight);
  const left = 750;

  const cropped = await sharp(HEADER_PATH)
    .extract({ left: 2172 - cropWidth, top: 0, width: cropWidth, height: cropHeight })
    .resize(artWidth, HEIGHT)
    .ensureAlpha()
    .toBuffer();

  // A left-to-right alpha ramp from 0% to 22% of the art's width, opaque afterwards, applied with
  // `dest-in` so the art's own alpha is multiplied by the mask's (§2.2: "fades from 0 to 22%").
  const fadeWidth = Math.round(artWidth * 0.22);
  const maskSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="${artWidth}" height="${HEIGHT}">
    <defs>
      <linearGradient id="fade" x1="0" y1="0" x2="1" y2="0">
        <stop offset="0%" stop-color="#fff" stop-opacity="0"/>
        <stop offset="${(fadeWidth / artWidth) * 100}%" stop-color="#fff" stop-opacity="1"/>
        <stop offset="100%" stop-color="#fff" stop-opacity="1"/>
      </linearGradient>
    </defs>
    <rect width="${artWidth}" height="${HEIGHT}" fill="url(#fade)"/>
  </svg>`;
  const mask = await sharp(Buffer.from(maskSvg)).png().toBuffer();

  const faded = await sharp(cropped)
    .composite([{ input: mask, blend: 'dest-in' }])
    .png()
    .toBuffer();

  return { buffer: faded, left, width: artWidth };
}

// ---------------------------------------------------------------------------------------------------
// Layer 3: brand row + call to action, drawn with satori/resvg to a transparent PNG (§2.2 "Static text layer")
// ---------------------------------------------------------------------------------------------------

function dataUriFor(filePath: string, mime: string): string {
  return `data:${mime};base64,${readFileSync(filePath).toString('base64')}`;
}

function staticTextTree(xAvatarDataUri: string) {
  const brandRow = {
    type: 'div',
    props: {
      style: { display: 'flex', position: 'absolute', left: 72, top: 56, alignItems: 'center' },
      children: [
        {
          type: 'img',
          props: { width: 52, height: 52, src: xAvatarDataUri, style: { borderRadius: 14 } },
        },
        {
          type: 'span',
          props: {
            style: {
              display: 'block',
              marginLeft: 14,
              fontFamily: 'PJS',
              fontWeight: 800,
              fontSize: 30,
              color: '#FFFFFF',
            },
            children: 'Chatsoon',
          },
        },
      ],
    },
  };

  const ctaRow = {
    type: 'div',
    props: {
      style: { display: 'flex', position: 'absolute', left: 72, top: 526, height: 52, alignItems: 'center' },
      children: [
        {
          type: 'div',
          props: {
            style: {
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              paddingTop: 12,
              paddingBottom: 12,
              paddingLeft: 24,
              paddingRight: 24,
              borderRadius: 32,
              backgroundImage: 'linear-gradient(90deg, #FF5FA2, #FF8A4C)',
            },
            children: {
              type: 'span',
              props: {
                style: { display: 'block', fontFamily: 'PJS', fontWeight: 800, fontSize: 24, color: '#FFFFFF' },
                children: 'Connect on Chatsoon',
              },
            },
          },
        },
        {
          type: 'span',
          props: {
            style: {
              display: 'block',
              marginLeft: 22,
              fontFamily: 'PJS',
              fontWeight: 600,
              fontSize: 22,
              color: '#B9B3F5',
              letterSpacing: 5,
            },
            children: 'chatsoon.app',
          },
        },
      ],
    },
  };

  return {
    type: 'div',
    props: { style: { display: 'flex', width: WIDTH, height: HEIGHT, position: 'relative' }, children: [brandRow, ctaRow] },
  };
}

// ---------------------------------------------------------------------------------------------------
// coverage.ts (fontkit cmaps, §2.2: "Coverage is checked against src/coverage.ts, which gen-plate.ts
// builds from the 15 font cmaps with fontkit")
// ---------------------------------------------------------------------------------------------------

function buildCoverageRanges(): [number, number][] {
  const union = new Set<number>();
  for (const file of fontFilePaths()) {
    const font = createFont(readFileSync(file));
    for (const codePoint of font.characterSet) union.add(codePoint);
  }
  const sorted = [...union].sort((a, b) => a - b);
  const ranges: [number, number][] = [];
  for (const codePoint of sorted) {
    const last = ranges[ranges.length - 1];
    if (last && codePoint === last[1] + 1) last[1] = codePoint;
    else ranges.push([codePoint, codePoint]);
  }
  return ranges;
}

function writeCoverageModule(ranges: [number, number][]): void {
  const rangesLiteral = ranges.map(([a, b]) => `[${a}, ${b}]`).join(',\n  ');
  const source = `// Generated by apps/og/scripts/gen-plate.ts — do not hand-edit; re-run \`pnpm gen-plate\` to regenerate.
//
// Union of the Unicode code points covered by the 15 card fonts (fonts/*.woff), built from their
// cmaps with fontkit (docs/og-plan.md O19, §2.2). A card field whose sanitised text has a character
// outside this set is left off the image (text.ts's \`fieldForImage\`/\`initialsFor\`).
//
// Stored as sorted, inclusive [start, end] code point ranges: the 15 fonts share only a few hundred
// code points between them, so this is far smaller than 15 per-font glyph lists, and a binary search
// over it is plenty fast for a handful of short fields per render.

const COVERED_RANGES: readonly [number, number][] = [
  ${rangesLiteral},
];

function isCoveredCodePoint(codePoint: number): boolean {
  let lo = 0;
  let hi = COVERED_RANGES.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const range = COVERED_RANGES[mid];
    if (!range) break;
    const [start, end] = range;
    if (codePoint < start) hi = mid - 1;
    else if (codePoint > end) lo = mid + 1;
    else return true;
  }
  return false;
}

/** True when every code point in \`text\` is drawable with the card's fonts. Empty string is trivially covered. */
export function isFullyCovered(text: string): boolean {
  for (const ch of text) {
    if (!isCoveredCodePoint(ch.codePointAt(0)!)) return false;
  }
  return true;
}
`;
  writeFileSync(COVERAGE_PATH, source);
  console.log(`gen-plate: wrote ${path.relative(ROOT, COVERAGE_PATH)} (${ranges.length} ranges)`);
}

// ---------------------------------------------------------------------------------------------------

async function main(): Promise<void> {
  writeCoverageModule(buildCoverageRanges());

  const { yoga, resvgWasm } = await loadNodeWasm();
  await initSatori(yoga);
  await initWasm(resvgWasm);

  const [background, art] = await Promise.all([
    sharp(Buffer.from(backgroundSvg())).png().toBuffer(),
    rightHandArt(),
  ]);

  const withArt = await sharp(background)
    .composite([{ input: art.buffer, left: art.left, top: 0 }])
    .png()
    .toBuffer();

  const fonts = loadNodeFonts().map((f) => ({ name: f.name, data: f.data, weight: f.weight, style: 'normal' as const }));
  const xAvatarDataUri = dataUriFor(X_AVATAR_PATH, 'image/png');
  const textSvg = await satori(staticTextTree(xAvatarDataUri) as never, { width: WIDTH, height: HEIGHT, fonts });
  const textPng = new Resvg(textSvg).render().asPng();

  const composed = await sharp(withArt)
    .composite([{ input: Buffer.from(textPng), left: 0, top: 0 }])
    .flatten({ background: '#1A1188' })
    .jpeg({ quality: 88, mozjpeg: true, progressive: true })
    .toBuffer();

  if (composed[0] !== 0xff || composed[1] !== 0xd8) {
    throw new Error('gen-plate: output has no JPEG SOI marker');
  }
  const meta = await sharp(composed).metadata();
  if (meta.width !== WIDTH || meta.height !== HEIGHT) {
    throw new Error(`gen-plate: output is ${meta.width}x${meta.height}, expected ${WIDTH}x${HEIGHT}`);
  }

  writeFileSync(PLATE_PATH, composed);
  console.log(`gen-plate: wrote ${path.relative(ROOT, PLATE_PATH)} (${composed.length} bytes)`);

  const sha8 = createHash('sha256').update(composed).digest('hex').slice(0, 8);
  console.log(`gen-plate: plate sha8 ${sha8} — if this changed, bump OG_TEMPLATE_VERSION and re-run the fingerprint test`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
