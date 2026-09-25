// Ambient types for wrangler's own module rules (wrangler.jsonc's default CompiledWasm rule for
// `.wasm`, and the `Data` rule this package adds for `.woff`/`.jpg`) — none of which ship their own
// types, since they only exist once wrangler's bundler runs. Wildcard ambient module declarations like
// these only take effect from a `.d.ts` file with no imports/exports of its own: written inline in
// fonts.ts, assets.ts or index.ts (all real modules), TypeScript treats them as an attempt to augment
// that exact, unresolvable module specifier instead.

declare module '*.woff' {
  const data: ArrayBuffer;
  export default data;
}

declare module '*.jpg' {
  const data: ArrayBuffer;
  export default data;
}

declare module '*.wasm' {
  const mod: WebAssembly.Module;
  export default mod;
}
