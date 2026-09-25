import { cloudflareTest } from '@cloudflare/vitest-pool-workers';
import { defineConfig } from 'vitest/config';

// chatsoon-og has no bindings and no routes (§3.2) — tests run against the real Worker (satori,
// resvg-wasm, the Data-imported fonts and plate) through wrangler's own config, same pattern as
// apps/api/vitest.config.ts, just without any D1/R2 setup to do first.
export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: './wrangler.jsonc' },
    }),
  ],
});
