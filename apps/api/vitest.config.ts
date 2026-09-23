import path from 'node:path';

import { cloudflareTest, readD1Migrations } from '@cloudflare/vitest-pool-workers';
import { defineConfig } from 'vitest/config';

export default defineConfig(async () => {
  const migrations = await readD1Migrations(path.join(import.meta.dirname, 'migrations'));
  return {
    plugins: [
      cloudflareTest({
        wrangler: { configPath: './wrangler.jsonc' },
        miniflare: {
          bindings: {
            TEST_MIGRATIONS: migrations,
            WEB_ORIGIN: 'http://localhost:8081',
            API_ORIGIN: 'http://localhost:8787',
            EXTRA_ORIGINS: '',
            EMAIL_PROVIDER: 'log',
            BETTER_AUTH_SECRET: 'test-secret-test-secret-test-secret-1234',
            TURNSTILE_SECRET: '1x0000000000000000000000000000000AA',
            FILE_SIGNING_SECRET: 'test-file-secret',
            REVIEWER_ENABLED: 'true',
            REVIEWER_CODE: '135790',
            ANTHROPIC_API_KEY: '',
          },
        },
      }),
    ],
    test: {
      setupFiles: ['./test/setup.ts'],
    },
  };
});
