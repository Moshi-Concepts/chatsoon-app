import resvgWasm from '@resvg/resvg-wasm/index_bg.wasm';
import { decode as decodeJpeg } from 'jpeg-js';
import yoga from 'satori/yoga.wasm';
import { beforeAll, describe, expect, it } from 'vitest';

import { PLATE } from '../src/assets';
import { FIXTURES } from '../src/fixtures';
import { FONTS } from '../src/fonts';
import { createRenderer, type OgRender } from '../src/render';

const MAX_BYTES = 300 * 1024; // docs/og-plan.md §2.2: "must stay under 300 KB"

let render: OgRender;

beforeAll(async () => {
  render = await createRenderer({ yoga, resvgWasm, fonts: FONTS, plate: PLATE });
});

describe('createRenderer (workerd)', () => {
  it.each(FIXTURES.map((f) => [f.id, f] as const))('renders %s as a 1200x630 JPEG under 300 KB', async (_id, fixture) => {
    const bytes = await render(fixture.card, fixture.avatar);

    expect(bytes[0]).toBe(0xff);
    expect(bytes[1]).toBe(0xd8); // JPEG SOI marker

    const decoded = decodeJpeg(bytes, { useTArray: true });
    expect(decoded.width).toBe(1200);
    expect(decoded.height).toBe(630);
    expect(bytes.byteLength).toBeLessThan(MAX_BYTES);
  });

  it('is deterministic for the same inputs', async () => {
    const fixture = FIXTURES[0]!;
    const a = await render(fixture.card, fixture.avatar);
    const b = await render(fixture.card, fixture.avatar);
    expect(a).toEqual(b);
  });
});
