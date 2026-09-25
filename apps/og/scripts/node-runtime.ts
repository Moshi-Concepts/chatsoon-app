// Loads the wasm modules and card fonts from disk (docs/og-plan.md §2.3: "It loads yoga.wasm and
// index_bg.wasm with WebAssembly.compile(readFileSync(...))"), shared by gen-plate.ts (which renders
// the plate's own static text layer) and preview.ts (which renders full cards). The Worker
// (src/index.ts, src/fonts.ts, src/assets.ts) loads the exact same fonts and wasm through wrangler's
// bundler instead — `render.ts`'s `createRenderer` takes plain buffers/modules either way and never
// knows which loader ran.

import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import type { RendererFont } from '../src/render';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FONTS_DIR = path.join(ROOT, 'fonts');

function toArrayBuffer(buf: Buffer): ArrayBuffer {
  // Node's `Buffer.buffer` is typed as the wider `ArrayBufferLike` (it also covers SharedArrayBuffer,
  // used by worker_threads); a Buffer from `readFileSync` is always backed by a plain ArrayBuffer.
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
}

// Keep this list in sync with src/fonts.ts's file -> {name, weight} mapping (O19's 5 families).
const FONT_FILES: { file: string; name: string; weight: 400 | 600 | 800 }[] = [
  { file: 'pjs-latin-400.woff', name: 'PJS', weight: 400 },
  { file: 'pjs-latin-600.woff', name: 'PJS', weight: 600 },
  { file: 'pjs-latin-800.woff', name: 'PJS', weight: 800 },
  { file: 'pjsx-latin-ext-400.woff', name: 'PJSX', weight: 400 },
  { file: 'pjsx-latin-ext-600.woff', name: 'PJSX', weight: 600 },
  { file: 'pjsx-latin-ext-800.woff', name: 'PJSX', weight: 800 },
  { file: 'pjsv-vietnamese-400.woff', name: 'PJSV', weight: 400 },
  { file: 'pjsv-vietnamese-600.woff', name: 'PJSV', weight: 600 },
  { file: 'pjsv-vietnamese-800.woff', name: 'PJSV', weight: 800 },
  { file: 'nsc-cyrillic-400.woff', name: 'NSC', weight: 400 },
  { file: 'nsc-cyrillic-600.woff', name: 'NSC', weight: 600 },
  { file: 'nsc-cyrillic-800.woff', name: 'NSC', weight: 800 },
  { file: 'nsg-greek-400.woff', name: 'NSG', weight: 400 },
  { file: 'nsg-greek-600.woff', name: 'NSG', weight: 600 },
  { file: 'nsg-greek-800.woff', name: 'NSG', weight: 800 },
];

export function fontFilePaths(): string[] {
  return FONT_FILES.map(({ file }) => path.join(FONTS_DIR, file));
}

export function loadNodeFonts(): RendererFont[] {
  return FONT_FILES.map(({ file, name, weight }) => ({
    name,
    weight,
    data: toArrayBuffer(readFileSync(path.join(FONTS_DIR, file))),
  }));
}

export async function loadNodeWasm(): Promise<{ yoga: WebAssembly.Module; resvgWasm: WebAssembly.Module }> {
  const [yoga, resvgWasm] = await Promise.all([
    WebAssembly.compile(readFileSync(require.resolve('satori/yoga.wasm'))),
    WebAssembly.compile(readFileSync(require.resolve('@resvg/resvg-wasm/index_bg.wasm'))),
  ]);
  return { yoga, resvgWasm };
}
