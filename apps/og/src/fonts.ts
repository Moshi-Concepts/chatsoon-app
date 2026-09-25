// Loads the 15 card fonts (fonts/*.woff, docs/og-plan.md O19) as the Worker sees them: wrangler's
// `Data` module rule (wrangler.jsonc) turns each `.woff` import into the file's raw bytes, no
// filesystem access needed at runtime. scripts/preview.ts and scripts/gen-plate.ts build the same
// shape of array with `node:fs` instead — see `render.ts`'s `RendererFont`, which either loader
// produces, so `createRenderer` never knows which one ran.
//
// Family names match card.ts's `FONT_FAMILY` list (PJS, PJSX, PJSV, NSC, NSG) and satori's own rule
// that it won't fall back between subsets sharing one family name (O19), so each subset gets its own.
// (types for the `.woff` imports: wasm-assets.d.ts)

import nsc400 from '../fonts/nsc-cyrillic-400.woff';
import nsc600 from '../fonts/nsc-cyrillic-600.woff';
import nsc800 from '../fonts/nsc-cyrillic-800.woff';
import nsg400 from '../fonts/nsg-greek-400.woff';
import nsg600 from '../fonts/nsg-greek-600.woff';
import nsg800 from '../fonts/nsg-greek-800.woff';
import pjs400 from '../fonts/pjs-latin-400.woff';
import pjs600 from '../fonts/pjs-latin-600.woff';
import pjs800 from '../fonts/pjs-latin-800.woff';
import pjsv400 from '../fonts/pjsv-vietnamese-400.woff';
import pjsv600 from '../fonts/pjsv-vietnamese-600.woff';
import pjsv800 from '../fonts/pjsv-vietnamese-800.woff';
import pjsx400 from '../fonts/pjsx-latin-ext-400.woff';
import pjsx600 from '../fonts/pjsx-latin-ext-600.woff';
import pjsx800 from '../fonts/pjsx-latin-ext-800.woff';

import type { RendererFont } from './render';

export const FONTS: RendererFont[] = [
  { name: 'PJS', weight: 400, data: pjs400 },
  { name: 'PJS', weight: 600, data: pjs600 },
  { name: 'PJS', weight: 800, data: pjs800 },
  { name: 'PJSX', weight: 400, data: pjsx400 },
  { name: 'PJSX', weight: 600, data: pjsx600 },
  { name: 'PJSX', weight: 800, data: pjsx800 },
  { name: 'PJSV', weight: 400, data: pjsv400 },
  { name: 'PJSV', weight: 600, data: pjsv600 },
  { name: 'PJSV', weight: 800, data: pjsv800 },
  { name: 'NSC', weight: 400, data: nsc400 },
  { name: 'NSC', weight: 600, data: nsc600 },
  { name: 'NSC', weight: 800, data: nsc800 },
  { name: 'NSG', weight: 400, data: nsg400 },
  { name: 'NSG', weight: 600, data: nsg600 },
  { name: 'NSG', weight: 800, data: nsg800 },
];
