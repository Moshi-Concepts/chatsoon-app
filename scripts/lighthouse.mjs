#!/usr/bin/env node
/**
 * Lighthouse runner (docs/public-pages-plan.md §4 Stage A, WP-A4).
 *
 * Usage:
 *   pnpm lh <url…> [--runs 3] [--scheme light|dark|both] [--out dir] [--budgets file]
 *
 * Launches one headless Chrome with chrome-launcher (CHROME_PATH honoured), connects to it
 * with puppeteer-core, and runs Lighthouse against a live Page so the colour scheme can be
 * emulated before each run and double-checked after it. Prints median scores and metrics per
 * URL/scheme and saves every run's raw LHR JSON under --out.
 *
 * --budgets is parsed and validated as JSON here, but nothing in Stage A compares a run against
 * it: Lighthouse 13.5.0 has no budgets feature of its own, and the gate lands in Stage E (plan D22).
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { launch } from 'chrome-launcher';
import puppeteer from 'puppeteer-core';
import lighthouse from 'lighthouse';

const METRIC_AUDITS = [
  ['first-contentful-paint', 'FCP', 'ms'],
  ['largest-contentful-paint', 'LCP', 'ms'],
  ['total-blocking-time', 'TBT', 'ms'],
  ['cumulative-layout-shift', 'CLS', ''],
  ['speed-index', 'SI', 'ms'],
];

function parseArgs(argv) {
  const urls = [];
  const opts = { runs: 3, scheme: 'light', out: 'lighthouse-reports', budgets: undefined };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--runs') opts.runs = Number(argv[++i]);
    else if (arg === '--scheme') opts.scheme = argv[++i];
    else if (arg === '--out') opts.out = argv[++i];
    else if (arg === '--budgets') opts.budgets = argv[++i];
    else if (arg.startsWith('--')) throw new Error(`Unknown flag: ${arg}`);
    else urls.push(arg);
  }
  if (urls.length === 0) {
    throw new Error('Usage: pnpm lh <url…> [--runs 3] [--scheme light|dark|both] [--out dir] [--budgets file]');
  }
  if (!Number.isInteger(opts.runs) || opts.runs < 1) {
    throw new Error(`--runs must be a positive whole number, got "${opts.runs}"`);
  }
  if (!['light', 'dark', 'both'].includes(opts.scheme)) {
    throw new Error(`--scheme must be "light", "dark" or "both", got "${opts.scheme}"`);
  }
  return { urls, ...opts };
}

function median(values) {
  const nums = values.filter((v) => typeof v === 'number' && Number.isFinite(v)).sort((a, b) => a - b);
  if (nums.length === 0) return undefined;
  const mid = Math.floor(nums.length / 2);
  return nums.length % 2 ? nums[mid] : (nums[mid - 1] + nums[mid]) / 2;
}

// No public-suffix list here, so this just compares the last two dot-separated labels.
// It gets multi-part suffixes like "co.uk" wrong, which only widens what counts as first-party.
function registrableDomain(hostname) {
  const parts = hostname.split('.');
  return parts.length <= 2 ? hostname : parts.slice(-2).join('.');
}

function thirdPartyRequestsBeforeLoad(lhr) {
  const items = lhr.audits['network-requests']?.details?.items ?? [];
  const observedLoad = lhr.audits.metrics?.details?.items?.[0]?.observedLoad;
  if (observedLoad === undefined) return undefined;
  let pageDomain;
  try {
    pageDomain = registrableDomain(new URL(lhr.finalDisplayedUrl).hostname);
  } catch {
    return undefined;
  }
  let count = 0;
  for (const item of items) {
    if (item.rendererStartTime === undefined || item.rendererStartTime >= observedLoad) continue;
    try {
      if (registrableDomain(new URL(item.url).hostname) !== pageDomain) count++;
    } catch {
      // data: URIs and similar carry no host; not a third-party request.
    }
  }
  return count;
}

// Audits can carry a different weight per category; keep the highest one seen.
function collectFailingAudits(lhrs) {
  const audits = new Map();
  for (const lhr of lhrs) {
    for (const category of Object.values(lhr.categories)) {
      for (const ref of category.auditRefs) {
        if (!ref.weight) continue;
        const audit = lhr.audits[ref.id];
        if (!audit || audit.score === null) continue;
        const entry = audits.get(ref.id) ?? { title: audit.title, weight: ref.weight, scores: [] };
        entry.weight = Math.max(entry.weight, ref.weight);
        entry.scores.push(audit.score);
        audits.set(ref.id, entry);
      }
    }
  }
  const failing = [];
  for (const [id, { title, weight, scores }] of audits) {
    const medianScore = median(scores);
    if (medianScore !== undefined && medianScore < 1) failing.push({ id, title, weight, medianScore });
  }
  return failing.sort((a, b) => b.weight - a.weight);
}

async function runOnce(browser, url, scheme) {
  const page = await browser.newPage();
  try {
    await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: scheme }]);
    // Lighthouse 13.5.0 drops any flag that isn't in its own defaultSettings, which does not
    // include `budgets` (the feature was removed from core); a budgets flag here would be a
    // silent no-op, so we don't pass one. See the file header.
    const flags = { output: 'json', logLevel: 'error' };
    const result = await lighthouse(url, flags, undefined, page);
    if (!result) throw new Error(`Lighthouse returned no result for ${url}`);
    const isDark = await page.evaluate(() => matchMedia('(prefers-color-scheme: dark)').matches);
    if (isDark !== (scheme === 'dark')) {
      throw new Error(`${url}: asked for ${scheme} but the page reports ${isDark ? 'dark' : 'light'}`);
    }
    return result.lhr;
  } finally {
    await page.close();
  }
}

function slugFor(url) {
  return url.replace(/^https?:\/\//, '').replace(/[^a-z0-9]+/gi, '-').replace(/^-+|-+$/g, '');
}

function formatMetric(value, unit) {
  if (value === undefined) return 'n/a';
  return unit ? `${Math.round(value)} ${unit}` : value.toFixed(3);
}

async function reportGroup(browser, url, scheme, opts) {
  const lhrs = [];
  for (let i = 0; i < opts.runs; i++) {
    const lhr = await runOnce(browser, url, scheme);
    lhrs.push(lhr);
    const file = path.join(opts.out, `${slugFor(url)}-${scheme}-run${i + 1}.json`);
    await writeFile(file, JSON.stringify(lhr, null, 2));
  }

  console.log(`\n=== ${url} (${scheme}, median of ${opts.runs} run${opts.runs === 1 ? '' : 's'}) ===`);

  console.table(
    Object.values(lhrs[0].categories).map(({ id, title }) => {
      const score = median(lhrs.map((lhr) => lhr.categories[id]?.score));
      return { Category: title, Score: score === undefined ? 'n/a' : Math.round(score * 100) };
    }),
  );

  console.table(
    METRIC_AUDITS.map(([id, label, unit]) => ({
      Metric: label,
      Value: formatMetric(median(lhrs.map((lhr) => lhr.audits[id]?.numericValue)), unit),
    })),
  );

  const diagnosticsOf = (lhr) => lhr.audits.diagnostics?.details?.items?.[0];
  console.table([
    {
      'Document bytes': median(lhrs.map((lhr) => diagnosticsOf(lhr)?.mainDocumentTransferSize)),
      'Total bytes': median(lhrs.map((lhr) => diagnosticsOf(lhr)?.totalByteWeight)),
      Requests: median(lhrs.map((lhr) => diagnosticsOf(lhr)?.numRequests)),
      'Third-party before load': median(lhrs.map((lhr) => thirdPartyRequestsBeforeLoad(lhr))),
    },
  ]);

  const failing = collectFailingAudits(lhrs);
  if (failing.length === 0) {
    console.log('No failing weighted audits.');
  } else {
    console.log('Failing audits (weight > 0):');
    console.table(
      failing.map((f) => ({ Audit: f.id, Title: f.title, Weight: f.weight, 'Median score': f.medianScore })),
    );
  }
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.budgets) {
    opts.budgets = JSON.parse(await readFile(opts.budgets, 'utf8'));
    console.warn('--budgets is validated but not enforced yet: gating on it lands in Stage E, so this run will not fail on a breach.');
  }
  await mkdir(opts.out, { recursive: true });

  const chrome = await launch({ chromeFlags: ['--headless=new'], chromePath: process.env.CHROME_PATH });
  try {
    const browser = await puppeteer.connect({ browserURL: `http://127.0.0.1:${chrome.port}` });
    try {
      const schemes = opts.scheme === 'both' ? ['light', 'dark'] : [opts.scheme];
      for (const url of opts.urls) {
        for (const scheme of schemes) {
          await reportGroup(browser, url, scheme, opts);
        }
      }
    } finally {
      await browser.disconnect();
    }
  } finally {
    chrome.kill();
  }
}

main().catch((err) => {
  console.error(err.stack || err.message || err);
  process.exitCode = 1;
});
