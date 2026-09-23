import type { Env as WorkerEnv } from '../src/env';

type Migration = Parameters<typeof import('cloudflare:test').applyD1Migrations>[1][number];

declare global {
  namespace Cloudflare {
    interface Env extends WorkerEnv {
      TEST_MIGRATIONS: Migration[];
    }
  }
}
