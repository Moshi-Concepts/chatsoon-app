// Writes self-contained HTML for /privacy, /terms and /support into the web export (dist/ by default):
// dist/<key>.html and dist/<key>/index.html.
// Cloudflare Pages serves these files ahead of the single-page app fallback, so store reviewers and
// crawlers get real HTML without running JavaScript. The text comes from src/content/legal.json,
// the same source the app renders, so the two never drift apart.
//
// Usage: node scripts/build-static-pages.mjs [outDir]   (run after `expo export --platform web`)

import { existsSync } from 'node:fs';
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Mirrors @chatsoon/shared constants (this script runs in plain Node, without the TypeScript sources).
const ORIGIN = 'https://chatsoon.app';
const APP_NAME = 'Chatsoon';
const TAGLINE = 'Meet people. Follow up.';
const SUPPORT_EMAIL = 'hello@chatsoon.app';
const COPYRIGHT = '© 2026 Moshi Concepts Inc.';

const PAGES = [
  { key: 'privacy', label: 'Privacy' },
  { key: 'terms', label: 'Terms' },
  { key: 'support', label: 'Support' },
];

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outDir = path.resolve(root, process.argv[2] ?? 'dist');

const escapeHtml = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

/** Escapes text and turns the support address and the website address into links. */
const rich = (s) =>
  escapeHtml(s)
    .split(escapeHtml(SUPPORT_EMAIL))
    .join(`<a href="mailto:${SUPPORT_EMAIL}">${SUPPORT_EMAIL}</a>`)
    .replace(/https:\/\/chatsoon\.app(?:\/[\w\-/#]*)?/g, (url) => `<a href="${url}">${url}</a>`);

const anchor = (heading) =>
  heading
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

function assertDoc(key, doc) {
  const fail = (msg) => {
    throw new Error(`legal.json: ${key} ${msg}`);
  };
  if (!doc || typeof doc !== 'object') fail('is missing');
  for (const field of ['title', 'updated', 'intro']) if (typeof doc[field] !== 'string' || !doc[field]) fail(`needs ${field}`);
  if (!Array.isArray(doc.sections) || doc.sections.length === 0) fail('needs sections');
  doc.sections.forEach((s, i) => {
    if (typeof s.heading !== 'string' || !s.heading) fail(`section ${i} needs a heading`);
    if (!s.paragraphs?.length && !s.bullets?.length) fail(`section "${s.heading}" needs paragraphs or bullets`);
  });
}

// Colours mirror src/constants/theme.ts (light and dark).
const CSS = `
:root{--bg:#F6F6FA;--surface:#FFFFFF;--border:#E2E2EC;--text:#12131A;--text2:#5C5F72;--text3:#8A8DA1;--primary:#5146E5;--primary-soft:#ECEBFF;color-scheme:light dark}
@media (prefers-color-scheme:dark){:root{--bg:#0B0B10;--surface:#16161F;--border:#2B2B3A;--text:#F3F3F8;--text2:#A5A7B8;--text3:#6F7186;--primary:#6B61FF;--primary-soft:#24224C}}
*{box-sizing:border-box}
html{-webkit-text-size-adjust:100%}
body{margin:0;background:var(--bg);color:var(--text);font:16px/1.6 Inter,ui-sans-serif,system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;-webkit-font-smoothing:antialiased}
a{color:var(--primary);text-decoration:none}
a:hover{text-decoration:underline}
.wrap{max-width:784px;margin:0 auto;padding:0 32px}
@media (max-width:639px){.wrap{padding:0 16px}}
.site{border-bottom:1px solid var(--border)}
.site .wrap{height:64px;display:flex;align-items:center;justify-content:space-between;gap:12px;max-width:1184px}
.brand{display:flex;align-items:center;gap:8px;color:var(--text);font-weight:800;font-size:19px;letter-spacing:-.4px}
.brand:hover{text-decoration:none}
.brand svg{display:block;flex:none}
.button{display:inline-flex;align-items:center;height:36px;padding:0 14px;border:1.5px solid var(--border);border-radius:12px;background:var(--surface);color:var(--text);font-weight:600;font-size:13px}
.button:hover{text-decoration:none;border-color:var(--primary)}
main{padding:48px 0 56px}
h1{font-size:40px;line-height:1.15;letter-spacing:-.8px;margin:0 0 8px}
@media (max-width:639px){h1{font-size:32px}}
.updated{color:var(--text3);font-size:13px;margin:0}
.intro{color:var(--text2);font-size:18px;line-height:1.6;margin:16px 0 0}
.toc{margin:32px 0 0;padding:20px 24px;background:var(--surface);border:1px solid var(--border);border-radius:16px}
.toc h2{font-size:13px;letter-spacing:1px;text-transform:uppercase;color:var(--text2);margin:0 0 8px}
.toc ol{margin:0;padding-left:20px;columns:2;column-gap:32px}
@media (max-width:639px){.toc ol{columns:1}}
.toc li{margin:4px 0;break-inside:avoid}
section{margin-top:40px}
section h2{font-size:21px;line-height:1.3;margin:0 0 12px;scroll-margin-top:16px}
section p{color:var(--text2);margin:0 0 12px}
section ul{color:var(--text2);margin:0 0 12px;padding-left:22px}
section li{margin:0 0 10px}
section li::marker{color:var(--primary)}
footer{border-top:1px solid var(--border);padding:32px 0;color:var(--text2);font-size:15px}
footer .wrap{max-width:1184px;display:flex;flex-wrap:wrap;justify-content:space-between;gap:16px 32px}
footer nav{display:flex;flex-wrap:wrap;gap:8px 24px}
footer nav a{color:var(--text2)}
footer .tagline{margin:6px 0 0;font-size:13px}
footer .copy{color:var(--text3);font-size:13px;margin:8px 0 0}
`.trim();

// The app icon (a speech bubble on a violet tile), drawn inline so the page has no external assets.
const LOGO = `<svg width="32" height="32" viewBox="0 0 64 64" aria-hidden="true"><rect width="64" height="64" rx="17" fill="#5146E5"/><path d="M14 23a8 8 0 0 1 8-8h20a8 8 0 0 1 8 8v12a8 8 0 0 1-8 8H29l-9 7v-7.3A8 8 0 0 1 14 35z" fill="#fff"/><circle cx="24" cy="29" r="3.2" fill="#5146E5"/><circle cx="32" cy="29" r="3.2" fill="#5146E5"/><circle cx="40" cy="29" r="3.2" fill="#FF6B4A"/></svg>`;

function renderSection(s) {
  const id = anchor(s.heading);
  const paragraphs = (s.paragraphs ?? []).map((p) => `<p>${rich(p)}</p>`).join('\n');
  const bullets = s.bullets?.length ? `<ul>\n${s.bullets.map((b) => `<li>${rich(b)}</li>`).join('\n')}\n</ul>` : '';
  return `<section id="${id}">\n<h2>${escapeHtml(s.heading)}</h2>\n${paragraphs}\n${bullets}\n</section>`;
}

function renderPage(key, doc) {
  const url = `${ORIGIN}/${key}`;
  const title = `${doc.title} · ${APP_NAME}`;
  const description = doc.intro.length > 300 ? `${doc.intro.slice(0, 297).trimEnd()}...` : doc.intro;
  const toc =
    doc.sections.length > 6
      ? `<nav class="toc" aria-label="On this page"><h2>On this page</h2><ol>${doc.sections
          .map((s) => `<li><a href="#${anchor(s.heading)}">${escapeHtml(s.heading)}</a></li>`)
          .join('')}</ol></nav>`
      : '';
  const nav = PAGES.map((p) =>
    p.key === key ? `<a href="/${p.key}" aria-current="page">${p.label}</a>` : `<a href="/${p.key}">${p.label}</a>`,
  ).join('');

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<meta name="description" content="${escapeHtml(description)}">
<link rel="canonical" href="${url}">
<meta property="og:type" content="website">
<meta property="og:site_name" content="${APP_NAME}">
<meta property="og:title" content="${escapeHtml(title)}">
<meta property="og:description" content="${escapeHtml(description)}">
<meta property="og:url" content="${url}">
<meta name="theme-color" content="#5146E5">
<link rel="icon" href="/favicon.ico">
<style>${CSS}</style>
</head>
<body>
<header class="site"><div class="wrap">
<a class="brand" href="/" aria-label="${APP_NAME} home">${LOGO}<span>${APP_NAME}</span></a>
<a class="button" href="/sign-in">Sign in</a>
</div></header>
<main><div class="wrap">
<h1>${escapeHtml(doc.title)}</h1>
<p class="updated">Last updated ${escapeHtml(doc.updated)}</p>
<p class="intro">${rich(doc.intro)}</p>
${toc}
${doc.sections.map(renderSection).join('\n')}
</div></main>
<footer><div class="wrap">
<div><a class="brand" href="/">${LOGO.replace(/width="32" height="32"/, 'width="24" height="24"')}<span>${APP_NAME}</span></a><p class="tagline">${TAGLINE}</p></div>
<div><nav aria-label="Legal">${nav}<a href="mailto:${SUPPORT_EMAIL}">${SUPPORT_EMAIL}</a></nav><p class="copy">${COPYRIGHT}</p></div>
</div></footer>
</body>
</html>
`;
}

// Refuse to finish a web build that still carries local dev values: an API on localhost or a LAN
// address (from .env), or one of Cloudflare's always-pass Turnstile test site keys. Metro caches
// inlined EXPO_PUBLIC_* values per file, which is why export:web runs with --clear.
// Set CHATSOON_ALLOW_DEV_BUILD=1 to skip this for a local test build.
const DEV_VALUE =
  /\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0|10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|172\.(?:1[6-9]|2\d|3[01])\.\d+\.\d+)[:/"'`]|\b[123]x0{20}[A-F]{2}\b/;

async function assertProductionBundle() {
  if (process.env.CHATSOON_ALLOW_DEV_BUILD === '1') return;
  const jsDir = path.join(outDir, '_expo/static/js');
  if (!existsSync(jsDir)) {
    console.warn(`static pages: no web bundle in ${path.relative(root, jsDir)}, skipping the production env check`);
    return;
  }
  const entries = await readdir(jsDir, { recursive: true });
  for (const name of entries.filter((n) => n.endsWith('.js'))) {
    const src = await readFile(path.join(jsDir, name), 'utf8');
    const bad = src.match(DEV_VALUE);
    if (bad) {
      throw new Error(
        `${name} contains the dev value "${bad[0]}". Set EXPO_PUBLIC_API_URL and EXPO_PUBLIC_TURNSTILE_SITE_KEY ` +
          'to the production values and run "pnpm run export:web" again (it clears the Metro cache).',
      );
    }
  }
}

await assertProductionBundle();

const legal = JSON.parse(await readFile(path.join(root, 'src/content/legal.json'), 'utf8'));

// Cloudflare Pages serves <key>.html at /<key> (the URL given to the stores) and <key>/index.html
// at /<key>/. With only the folder, /<key> would first redirect to /<key>/.
for (const { key } of PAGES) {
  const doc = legal[key];
  assertDoc(key, doc);
  const html = renderPage(key, doc);
  await mkdir(path.join(outDir, key), { recursive: true });
  for (const file of [path.join(outDir, `${key}.html`), path.join(outDir, key, 'index.html')]) {
    await writeFile(file, html, 'utf8');
    console.log(`static page: ${path.relative(root, file)}`);
  }
}
