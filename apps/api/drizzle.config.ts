import { defineConfig } from 'drizzle-kit';

// Generates SQL into ./migrations, applied with `wrangler d1 migrations apply`.
export default defineConfig({
  dialect: 'sqlite',
  schema: './src/db/schema.ts',
  out: './migrations',
});
