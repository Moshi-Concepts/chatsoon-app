// Finishes the apps/web build after `expo export --platform web` has written the SPA into dist/
// (docs/public-pages-plan.md §2.5, §4 WP-B3): checks the exported bundle for dev/placeholder values,
// writes the static home and legal pages and the Pages `_redirects` file, then inlines the SPA's small
// stylesheets into index.html so none of them blocks rendering.
//
// The "build" script in package.json runs this after the export:
//   pnpm --filter @chatsoon/mobile exec expo export --platform web --clear --output-dir ../web/dist
//   tsx scripts/build.ts
// From the repo root, both steps run together as `pnpm build:web`.

import { existsSync } from 'node:fs';
import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';

import { build as esbuildBuild } from 'esbuild';
import QRCode from 'qrcode';

import { API_ORIGIN, WEB_ORIGIN } from '@chatsoon/shared/src/constants';

import { renderHome, type LandingContent } from '../src/render/home';
import { LEGAL_KEYS, renderLegal, type LegalDoc, type LegalKey } from '../src/render/legal';
import { DEFAULT_OG_IMAGE } from '../src/render/og-asset';
import type { SpaAssets } from '../src/render/handoff';
import { injectShellOg } from '../src/render/shell';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outDir = path.join(root, 'dist');
const mobileContent = path.resolve(root, '../mobile/src/content');

const HOME_GZIP_BUDGET = 14 * 1024;
const OG_IMAGE_MAX_BYTES = 300 * 1024;
const JPEG_MAGIC = Buffer.from([0xff, 0xd8, 0xff]);

// WP-C5: the profile island (apps/web/src/client/profile.ts), bundled to dist/_p/profile-<hash>.js.
const ISLAND_ENTRY = path.join(root, 'src/client/profile.ts');
const ISLAND_OUT_DIR = path.join(outDir, '_p');
const ISLAND_GZIP_BUDGET = 10 * 1024;

// WP-C5: apps/mobile/.env.production (or CHATSOON_ENV_FILE) supplies the Turnstile site key and the
// API origin the profile page's data attributes carry (docs/profile-page-dom.md).
const DEFAULT_PROFILE_ENV_FILE = '../mobile/.env.production';

// Refuse to finish a web build that still carries local dev values: an API on localhost or a LAN
// address (from .env), one of Cloudflare's always-pass Turnstile test site keys, or the placeholder
// site key committed in .env.production. Metro caches inlined EXPO_PUBLIC_* values per file, which is
// why the export step above always runs with --clear.
// Ported verbatim from apps/mobile/scripts/build-static-pages.mjs (deleted by this WP; this build
// folds that script's job in). Set CHATSOON_ALLOW_DEV_BUILD=1 to skip this for a local test build.
const DEV_VALUE =
  /\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0|10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|172\.(?:1[6-9]|2\d|3[01])\.\d+\.\d+)[:/"'`]|\b[123]x0{20}[A-F]{2}\b|REPLACE_WITH_TURNSTILE_SITE_KEY/;

// WP-C5: the island (dist/_p/**) and the generated assets module (functions/_generated/**) can carry
// the very same dev/placeholder values as the Expo bundle — the site key and API origin are read from
// the same env file (see writeGeneratedAssets) — so they get the same scan. functions/_generated holds
// committed-looking .ts source rather than compiled .js, hence the per-target extension match.
interface ProductionScanTarget {
  dir: string;
  matches(fileName: string): boolean;
}

const PRODUCTION_SCAN_TARGETS: ProductionScanTarget[] = [
  { dir: path.join(outDir, '_expo/static/js'), matches: (n) => n.endsWith('.js') },
  { dir: ISLAND_OUT_DIR, matches: (n) => n.endsWith('.js') },
  { dir: path.join(root, 'functions/_generated'), matches: (n) => n.endsWith('.ts') },
];

// Runs last (after the island and functions/_generated exist) so every target above actually has
// something to scan; see the call site at the bottom of the file.
async function assertProductionBundle(): Promise<void> {
  if (process.env.CHATSOON_ALLOW_DEV_BUILD === '1') return;
  for (const target of PRODUCTION_SCAN_TARGETS) {
    if (!existsSync(target.dir)) {
      console.warn(`build: no ${path.relative(root, target.dir)}, skipping the production env check for it`);
      continue;
    }
    const entries = await readdir(target.dir, { recursive: true });
    for (const name of entries.filter((n) => target.matches(n))) {
      const filePath = path.join(target.dir, name);
      const src = await readFile(filePath, 'utf8');
      const bad = src.match(DEV_VALUE);
      if (bad) {
        throw new Error(
          `${path.relative(root, filePath)} contains the dev or placeholder value "${bad[0]}". Set EXPO_PUBLIC_API_URL ` +
            'and EXPO_PUBLIC_TURNSTILE_SITE_KEY to the production values in apps/mobile/.env.production (and keep dev ' +
            'values out of apps/mobile/.env and .env.local), then run "pnpm build:web" again (it clears the Metro cache).',
        );
      }
    }
  }
}

async function writeFileLogged(file: string, contents: string): Promise<void> {
  await writeFile(file, contents, 'utf8');
  console.log(`build: wrote ${path.relative(root, file)}`);
}

async function buildHome(): Promise<void> {
  const landing = JSON.parse(await readFile(path.join(mobileContent, 'landing.json'), 'utf8')) as LandingContent;
  // margin:0 because home.ts's phone mock already pads the code inside its own .qr-tile wrapper.
  const qrSvg = await QRCode.toString(WEB_ORIGIN, { type: 'svg', margin: 0 });
  const html = renderHome(landing, { qrSvg });
  const gzipped = gzipSync(Buffer.from(html, 'utf8')).byteLength;
  if (gzipped > HOME_GZIP_BUDGET) {
    throw new Error(`build: home.html is ${gzipped} B gzipped, over the ${HOME_GZIP_BUDGET} B budget`);
  }
  await writeFileLogged(path.join(outDir, 'home.html'), html);
}

// Mirrors build-static-pages.mjs's assertDoc: a malformed legal.json entry fails the build loudly
// instead of silently shipping a page that's missing a section.
function assertLegalDoc(key: string, doc: unknown): asserts doc is LegalDoc {
  const fail = (msg: string): never => {
    throw new Error(`build: legal.json.${key} ${msg}`);
  };
  if (!doc || typeof doc !== 'object') fail('is missing');
  const d = doc as Record<string, unknown>;
  for (const field of ['title', 'updated', 'intro']) {
    if (typeof d[field] !== 'string' || !d[field]) fail(`needs ${field}`);
  }
  if (!Array.isArray(d.sections) || d.sections.length === 0) fail('needs sections');
  (d.sections as Record<string, unknown>[]).forEach((s, i) => {
    if (typeof s.heading !== 'string' || !s.heading) fail(`section ${i} needs a heading`);
    const paragraphs = s.paragraphs as unknown[] | undefined;
    const bullets = s.bullets as unknown[] | undefined;
    if (!paragraphs?.length && !bullets?.length) fail(`section "${String(s.heading)}" needs paragraphs or bullets`);
  });
}

// Cloudflare Pages serves <key>.html at /<key> (the URL given to the stores) and <key>/index.html at
// /<key>/. With only the folder, /<key> would first redirect to /<key>/.
async function buildLegalPages(): Promise<void> {
  const legal = JSON.parse(await readFile(path.join(mobileContent, 'legal.json'), 'utf8')) as Record<
    LegalKey,
    unknown
  >;
  for (const key of LEGAL_KEYS) {
    const doc = legal[key];
    assertLegalDoc(key, doc);
    const html = renderLegal(key, doc);
    await mkdir(path.join(outDir, key), { recursive: true });
    await writeFileLogged(path.join(outDir, `${key}.html`), html);
    await writeFileLogged(path.join(outDir, key, 'index.html'), html);
  }
}

// Expo links its global CSS (apps/mobile/src/global.css, a few hundred bytes) from the SPA shell as a
// render-blocking stylesheet, which costs a round trip (~160 ms on mobile) before first paint. Inline
// every small Expo stylesheet into dist/index.html instead and drop its <link> and preload.
const INLINE_CSS_MAX_BYTES = 4 * 1024;

async function inlineSpaStylesheets(): Promise<void> {
  const file = path.join(outDir, 'index.html');
  if (!existsSync(file)) return;
  let html = await readFile(file, 'utf8');
  const links = [...html.matchAll(/<link rel="stylesheet" href="(\/_expo\/static\/css\/[^"]+\.css)">/g)];
  for (const [tag, href] of links) {
    if (!href) continue;
    const css = (await readFile(path.join(outDir, href), 'utf8')).trim();
    if (Buffer.byteLength(css) > INLINE_CSS_MAX_BYTES) continue;
    // The CSS comes from our own source, but a stray "</style" would still end the element early.
    if (/<\/style/i.test(css)) throw new Error(`${href} contains "</style" and can't be inlined`);
    html = html
      .replace(tag, `<style data-href="${href}">${css}</style>`)
      .replace(`<link rel="preload" href="${href}" as="style">`, '');
  }
  await writeFileLogged(file, html);
}

// §3.5: `/ /home 200` shows home.html's content at the root URL without changing it; `/home / 301`
// keeps /home from becoming a second, competing canonical URL for the same page.
async function writeRedirects(): Promise<void> {
  await writeFileLogged(path.join(outDir, '_redirects'), '/home / 301\n/ /home 200\n');
}

// Gives every app route a branded link preview (docs/og-plan.md O12, WP-2) by splicing the generic
// tags into the exported SPA shell. Skipped, like inlineSpaStylesheets, if there's no shell to patch.
async function injectSpaShellOg(): Promise<void> {
  const file = path.join(outDir, 'index.html');
  if (!existsSync(file)) return;
  const html = await readFile(file, 'utf8');
  await writeFileLogged(file, injectShellOg(html));
}

// A missing or truncated static file would otherwise serve 200 text/html for what every page's
// og:image tag claims is a JPEG (docs/og-plan.md §4 WP-2, risk table). Checked after the SPA export,
// since `expo export` is what copies apps/mobile/public/og/ into dist/.
async function assertOgImage(): Promise<void> {
  const file = path.join(outDir, DEFAULT_OG_IMAGE.path);
  const bytes = await readFile(file);
  if (!bytes.subarray(0, 3).equals(JPEG_MAGIC)) {
    throw new Error(`build: ${DEFAULT_OG_IMAGE.path} doesn't start with the JPEG SOI marker (FF D8 FF)`);
  }
  if (bytes.byteLength > OG_IMAGE_MAX_BYTES) {
    throw new Error(`build: ${DEFAULT_OG_IMAGE.path} is ${bytes.byteLength} B, over the ${OG_IMAGE_MAX_BYTES} B budget`);
  }
}

// `functions/` doesn't exist until WP-5 adds the /id/* Pages Function; until then there's nothing for
// `_routes.json` to scope and Pages should keep invoking no Function at all.
async function writeRoutesJson(): Promise<void> {
  if (!existsSync(path.join(root, 'functions'))) return;
  await writeFileLogged(
    path.join(outDir, '_routes.json'),
    JSON.stringify({ version: 1, include: ['/id/*'], exclude: [] }),
  );
}

// WP-C5: esbuild's own JS API, straight to dist/_p/profile-<contenthash>.js (docs/public-pages-plan.md
// §2.5, §4 WP-C5). Returns the island's public URL for profile.ts's ProfileAssets. `entryNames` with a
// `[hash]` placeholder is esbuild's content hash, i.e. exactly the "contenthash" the plan asks for.
async function bundleIsland(): Promise<string> {
  await rm(ISLAND_OUT_DIR, { recursive: true, force: true }); // no stale hashed files from an earlier run
  const result = await esbuildBuild({
    absWorkingDir: root,
    entryPoints: [ISLAND_ENTRY],
    bundle: true,
    format: 'esm',
    minify: true,
    target: 'es2020',
    outdir: ISLAND_OUT_DIR,
    entryNames: 'profile-[hash]',
    write: true,
    metafile: true,
  });
  const outputs = Object.keys(result.metafile.outputs);
  if (outputs.length !== 1) {
    throw new Error(`build: expected exactly one profile island output, got ${outputs.length}`);
  }
  const outputPath = path.resolve(root, outputs[0]!);
  const gzipped = gzipSync(await readFile(outputPath)).byteLength;
  if (gzipped > ISLAND_GZIP_BUDGET) {
    throw new Error(`build: the profile island is ${gzipped} B gzipped, over the ${ISLAND_GZIP_BUDGET} B budget`);
  }
  const fileName = path.basename(outputPath);
  console.log(`build: wrote dist/_p/${fileName} (${gzipped} B gzipped)`);
  return `/_p/${fileName}`;
}

// WP-C5: dist/index.html, once inlineSpaStylesheets and injectSpaShellOg have both already run on it,
// is exactly what handoff.ts's spaBodyScript() needs to splice into a signed-in visitor's profile page
// (docs/public-pages-plan.md §2.3): its inline <style> blocks (the Expo reset plus the
// `<style data-href=…>` blocks Stage B inlined) and its one entry <script src=…>.
async function parseSpaShellAssets(): Promise<SpaAssets> {
  const html = await readFile(path.join(outDir, 'index.html'), 'utf8');

  const styles = [...html.matchAll(/<style\b[^>]*>[\s\S]*?<\/style>/g)].map((m) => m[0]).join('');
  if (!styles) throw new Error('build: dist/index.html has no <style> blocks for the SPA handoff to copy');

  const scriptMatches = [...html.matchAll(/<script\s+src="([^"]+)"[^>]*><\/script>/g)];
  if (scriptMatches.length !== 1) {
    throw new Error(`build: expected exactly one <script src=…> in dist/index.html, found ${scriptMatches.length}`);
  }
  return { styles, entryScriptSrc: scriptMatches[0]![1]! };
}

// Reads KEY=value out of a simple, unquoted .env file (apps/mobile/.env.production's own format).
async function readEnvValue(envFile: string, key: string): Promise<string | undefined> {
  if (!existsSync(envFile)) return undefined;
  const contents = await readFile(envFile, 'utf8');
  return contents.match(new RegExp(`^${key}=(.*)$`, 'm'))?.[1]?.trim();
}

// WP-C5: functions/_generated/assets.ts (gitignored — see apps/web/.gitignore's Stage C note), the one
// file functions/id/[[path]].ts imports for the ProfileAssets it hands to handle(). `CHATSOON_ENV_FILE`
// overrides the default production env file, resolved the same way both are given on the command line:
// relative to apps/web (`root`).
async function writeGeneratedAssets(islandUrl: string, spa: SpaAssets): Promise<void> {
  const envFile = path.resolve(root, process.env.CHATSOON_ENV_FILE ?? DEFAULT_PROFILE_ENV_FILE);
  const siteKey = await readEnvValue(envFile, 'EXPO_PUBLIC_TURNSTILE_SITE_KEY');
  const apiOrigin = (await readEnvValue(envFile, 'EXPO_PUBLIC_API_URL')) ?? API_ORIGIN;
  if (!siteKey) {
    throw new Error(`build: no EXPO_PUBLIC_TURNSTILE_SITE_KEY in ${path.relative(root, envFile)}`);
  }

  const generatedDir = path.join(root, 'functions/_generated');
  await mkdir(generatedDir, { recursive: true });
  const contents = `// Written by scripts/build.ts (WP-C5) from ${path.relative(root, envFile)}.
// Gitignored: never hand-edited or committed (see apps/web/.gitignore).
import type { ProfileAssets } from '../../src/render/profile';

export const PROFILE_ASSETS: ProfileAssets = ${JSON.stringify({ islandUrl, siteKey, apiOrigin, spa }, null, 2)};
`;
  await writeFileLogged(path.join(generatedDir, 'assets.ts'), contents);
}

await buildHome();
await buildLegalPages();
await writeRedirects();
await inlineSpaStylesheets();
await injectSpaShellOg();
await assertOgImage();
const islandUrl = await bundleIsland();
const spaAssets = await parseSpaShellAssets();
await writeGeneratedAssets(islandUrl, spaAssets);
await assertProductionBundle(); // last: dist/_p and functions/_generated must exist for it to scan them
await writeRoutesJson();
