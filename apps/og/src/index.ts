// The chatsoon-og Worker (docs/og-plan.md §3.2, O8): a `WorkerEntrypoint` RPC class with no routes, no
// bindings and `workers_dev: false` (wrangler.jsonc). The API calls `env.OG.render(...)` over a service
// binding; nothing here is reachable over HTTP, hence the 404-everything `fetch` handler.

// types for the two `.wasm` imports below: wasm-assets.d.ts
import resvgWasm from '@resvg/resvg-wasm/index_bg.wasm';
import yoga from 'satori/yoga.wasm';

import { WorkerEntrypoint } from 'cloudflare:workers';

import type { OgAvatar, OgCard, OgRendererRpc } from '@chatsoon/shared/src/og';

import { PLATE } from './assets';
import { FONTS } from './fonts';
import { createRenderer, type OgRender } from './render';

// Runs once per isolate: `createRenderer` calls satori's and resvg-wasm's one-time `init`, which throw
// if called twice, so this promise (not a fresh call per request) is what every `render()` awaits.
let renderer: Promise<OgRender> | undefined;

function getRenderer(): Promise<OgRender> {
  renderer ??= createRenderer({ yoga, resvgWasm, fonts: FONTS, plate: PLATE });
  return renderer;
}

export class OgRenderer extends WorkerEntrypoint implements OgRendererRpc {
  async render(card: OgCard, avatar: OgAvatar | null): Promise<Uint8Array> {
    const render = await getRenderer();
    return render(card, avatar);
  }
}

export default {
  fetch: () => new Response('Not found', { status: 404 }),
};
