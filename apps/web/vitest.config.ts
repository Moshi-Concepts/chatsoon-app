import { defineConfig } from 'vitest/config';

// Every render and build module here runs server-side (Cloudflare Pages Functions arrive in Stage C,
// still Node-shaped enough for these tests) — nothing needs a DOM, unlike the browser-side island
// tests Stage C's tsconfig.client.json will add.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts', 'src/**/*.test.ts'],
  },
});
