// Turns a card and an optional avatar into a JPEG (docs/og-plan.md §3.2's `render()`): satori lays out
// card.ts's tree into an SVG, resvg-wasm rasterises it, and jpeg-js encodes the pixels. Nothing here is
// Workers-specific — `createRenderer` takes its wasm modules, fonts and plate as plain inputs, so
// src/index.ts (the Worker, loading them via wrangler's Data/CompiledWasm module imports) and
// scripts/preview.ts (Node, loading them with `readFileSync`) call the exact same function, per §2.3.

import { initWasm, Resvg, type InitInput as ResvgInitInput } from '@resvg/resvg-wasm';
import { encode as encodeJpeg } from 'jpeg-js';
import satori, { init as initSatori, type Font as SatoriFont, type FontStyle, type FontWeight } from 'satori/standalone';

import { OG_IMAGE_SIZE, type OgAvatar, type OgCard } from '@chatsoon/shared/src/og';

import { bufferToDataUri } from './avatar-types';
import { buildCardTree } from './card';

export interface RendererFont {
  /** One of the 5 family names card.ts's `FONT_FAMILY` list references: PJS, PJSX, PJSV, NSC, NSG. */
  name: string;
  weight: FontWeight;
  style?: FontStyle;
  data: ArrayBuffer;
}

export interface RendererInputs {
  /** satori's `yoga.wasm`, already compiled (or loadable — satori's `init` accepts either). */
  yoga: Parameters<typeof initSatori>[0];
  /** `@resvg/resvg-wasm`'s `index_bg.wasm`, likewise. */
  resvgWasm: ResvgInitInput | Promise<ResvgInitInput>;
  fonts: RendererFont[];
  /** `plate.jpg`'s bytes — composited as the card's full-bleed static background. */
  plate: ArrayBuffer;
}

export type OgRender = (card: OgCard, avatar: OgAvatar | null) => Promise<Uint8Array>;

const JPEG_QUALITY = 85; // O7/§2.2: q85, verified in workerd at 105-232ms.

/**
 * Runs satori's and resvg-wasm's one-time `init` calls and returns a `render` function closed over the
 * result. Both libraries throw if `init`/`initWasm` run twice, so this must be called exactly once per
 * isolate — the Worker does it at module scope (src/index.ts) and each Node script does it once too.
 */
export async function createRenderer(inputs: RendererInputs): Promise<OgRender> {
  await initSatori(inputs.yoga);
  await initWasm(inputs.resvgWasm);

  const fonts: SatoriFont[] = inputs.fonts.map((f) => ({
    name: f.name,
    data: f.data,
    weight: f.weight,
    style: f.style ?? 'normal',
  }));
  const plateDataUri = bufferToDataUri(inputs.plate, 'image/jpeg');

  return async function render(card, avatar) {
    const tree = buildCardTree(card, avatar, plateDataUri);
    const svg = await satori(tree as never, { ...OG_IMAGE_SIZE, fonts, embedFont: true });
    const resvg = new Resvg(svg);
    const rendered = resvg.render();
    const { data } = encodeJpeg({ width: rendered.width, height: rendered.height, data: rendered.pixels }, JPEG_QUALITY);
    return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  };
}
