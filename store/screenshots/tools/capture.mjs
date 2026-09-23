// Tools used to make these screenshots (run from a scratch folder with puppeteer-core and @resvg/resvg-js installed):
// seed.mjs builds a demo account on a local API, capture.mjs grabs the web build at store sizes, compose.mjs adds captions.
// Captures raw app screens from the web build at store device sizes.
// usage: node capture.mjs <token> <slug> <outDir>
import fs from 'node:fs';
import path from 'node:path';
import puppeteer from 'puppeteer-core';

const [token, slug, outDir] = process.argv.slice(2);
const WEB = 'http://localhost:8081';
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';

const DEVICES = {
  // iPhone 6.9" (1320x2868) and 6.5" (1284x2778), Android phone (1080x2400)
  'ios-6.9': { width: 440, height: 956, deviceScaleFactor: 3 },
  'ios-6.5': { width: 428, height: 926, deviceScaleFactor: 3 },
  android: { width: 360, height: 800, deviceScaleFactor: 3 },
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
fs.mkdirSync(outDir, { recursive: true });

const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--hide-scrollbars'] });
try {
  for (const [device, vp] of Object.entries(DEVICES)) {
    const page = await browser.newPage();
    await page.setViewport({ ...vp, isMobile: true, hasTouch: true });
    await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'light' }]);
    await page.goto(WEB + '/sign-in', { waitUntil: 'networkidle0' });

    const shots = [];
    // Signed-out visitor view of a public profile first (what a non-user sees after scanning).
    shots.push(['05-public-profile', `/id/${slug}`]);
    for (const [name, route] of shots) {
      await page.goto(WEB + route, { waitUntil: 'networkidle0' });
      await sleep(2500);
      await page.screenshot({ path: path.join(outDir, `${device}-${name}.png`) });
    }

    await page.evaluate((t) => localStorage.setItem('chatsoon.session', t), token);
    const contacts = await (await fetch('http://localhost:8787/contacts', { headers: { Authorization: `Bearer ${token}` } })).json();
    const top = contacts.contacts.find((c) => c.name === 'Daniel Okafor') ?? contacts.contacts[0];
    const signedIn = [
      ['01-contacts', '/contacts'],
      ['02-qr', '/qr'],
      ['03-contact', `/contact/${top.id}`],
      ['04-add', '/add'],
    ];
    for (const [name, route] of signedIn) {
      await page.goto(WEB + route, { waitUntil: 'networkidle0' });
      await sleep(3000);
      await page.screenshot({ path: path.join(outDir, `${device}-${name}.png`) });
    }
    await page.close();
    console.log('captured', device);
  }
} finally {
  await browser.close();
}
