// The static plate (assets/plate.jpg, built by scripts/gen-plate.ts), loaded through wrangler's `Data`
// module rule the same way fonts.ts loads fonts — see that file's comment (types: wasm-assets.d.ts).

import plateJpg from '../assets/plate.jpg';

export const PLATE: ArrayBuffer = plateJpg;
