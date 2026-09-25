// functions/id/[[path]].ts and functions/r/[code].ts import functions/_generated/assets.ts, which only
// `pnpm build` writes (it is gitignored). Typecheck runs this first so a fresh checkout type-checks
// without a build: it writes a placeholder only when the file is missing. Every build overwrites it
// with the real values.

import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../functions/_generated');
const file = path.join(dir, 'assets.ts');

if (!existsSync(file)) {
  await mkdir(dir, { recursive: true });
  await writeFile(
    file,
    `// Placeholder written by scripts/ensure-generated.ts for type-checking only. Run "pnpm build" to replace it.
import type { ProfileAssets } from '../../src/render/profile';
import type { ReferralAssets } from '../../src/render/referral';

export const PROFILE_ASSETS: ProfileAssets = { islandUrl: '', siteKey: '', apiOrigin: '', spa: { styles: '', entryScriptSrc: '' } };
export const REFERRAL_ASSETS: ReferralAssets = { islandUrl: '' };
`,
    'utf8',
  );
}
