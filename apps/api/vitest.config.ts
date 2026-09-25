import path from 'node:path';

import { cloudflareTest, readD1Migrations } from '@cloudflare/vitest-pool-workers';
import { defineConfig } from 'vitest/config';

// A tiny but valid JPEG (SOI, an APP0 segment, EOI): enough to round-trip through R2 in tests. The
// real chatsoon-og Worker (apps/og, built in WP-3) is a separate package; this stands in for it so
// the OG service binding in wrangler.jsonc resolves in the test runtime (docs/og-plan.md WP-4).
const STUB_JPEG_HEX =
  'ffd8ffe000104a46494600010100000100010000ffd9'
    .match(/../g)!
    .map((byte) => `0x${byte}`)
    .join(', ');

const OG_STUB_WORKER = `
import { WorkerEntrypoint } from 'cloudflare:workers';

const STUB_JPEG = new Uint8Array([${STUB_JPEG_HEX}]);

export class OgRenderer extends WorkerEntrypoint {
  async render(card, avatar) {
    return STUB_JPEG;
  }
}

export default { fetch: () => new Response('Not found', { status: 404 }) };
`;

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
            BANNED_EMAILS: ' removed.user@example.com, other-removed@example.com',
            ANTHROPIC_API_KEY: '',
            OG_CARDS_ENABLED: 'true',
            PAGES_SHARED_SECRET: 'test-pages-secret',
            REFERRAL_DISCORD_MIN_AGE_DAYS: '90',
            REFERRAL_X_MIN_FOLLOWERS: '50',
            // Referrals (issue #11, PR 2). Enabled in tests (ships "false" in wrangler.jsonc).
            // REFERRAL_FOUNDER_CAP is 3 here (not the doc's 100) so the founder-cap tests don't need
            // to create 4 x 10 = 40 qualifying referrals; individual tests override it per-call where
            // the harness allows (callWithEnv/withEnv, the pattern social-auth.test.ts already uses).
            REFERRAL_ENABLED: 'true',
            REFERRAL_FOUNDER_THRESHOLD: '10',
            REFERRAL_FOUNDER_CAP: '3',
            REFERRAL_CLAIM_THRESHOLD: '20',
            REFERRAL_POINTS_PER_REFERRAL: '100',
            REFERRAL_POINTS_FOR_JOINING: '1',
            REFERRAL_HOLD_DAYS: '7',
            REFERRAL_ATTRIBUTION_DAYS: '14',
            REFERRAL_MAX_PENDING_DAYS: '60',
            REFERRAL_INVITE_DAILY_PER_USER: '20',
            REFERRAL_CLAIM_URL: 'https://bounties.learncardano.io/claim/chatsoon',
            REFERRAL_PARTNER_SECRET: 'test-referral-partner-secret',
            REFERRAL_HASH_SECRET: 'test-referral-hash-secret',
          },
          // Auxiliary worker: wrangler.jsonc's "services" binding names it "chatsoon-og" with the
          // "OgRenderer" entrypoint, so this is what env.OG.render() actually calls in tests.
          workers: [
            {
              name: 'chatsoon-og',
              modules: [{ type: 'ESModule', path: 'chatsoon-og-stub.js', contents: OG_STUB_WORKER }],
              compatibilityDate: '2026-08-20',
            },
          ],
        },
      }),
    ],
    test: {
      setupFiles: ['./test/setup.ts'],
      // Integration tests sign up several accounts through the real auth routes (OTP, profile save,
      // tag seeding) before asserting, which can pass 5 s on a shared CI runner. CI run 36176621104
      // timed out the sitemap test at 5 s while every assertion would have passed.
      testTimeout: 20_000,
    },
  };
});
