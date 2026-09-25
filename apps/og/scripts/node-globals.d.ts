// Ambient types the scripts need that aren't otherwise available under tsconfig.scripts.json's
// Node-only "types" (no "dom" lib, so no WebAssembly; fontkit ships no types at all — checked, nothing
// under node_modules/fontkit matches *.d.ts). Kept minimal: just the shapes these scripts actually call.

declare namespace WebAssembly {
  class Module {}
  function compile(bytes: BufferSource): Promise<Module>;
}

declare module 'fontkit' {
  export function create(data: Buffer | Uint8Array): { characterSet: number[] };
}
