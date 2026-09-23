// Frames raw captures into store screenshots: brand gradient, caption, rounded screenshot.
// usage: node compose.mjs <rawDir> <outDir>
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { Resvg } = require('@resvg/resvg-js');

const [rawDir, outDir] = process.argv.slice(2);
fs.mkdirSync(outDir, { recursive: true });

const SIZES = { 'ios-6.9': [1320, 2868], 'ios-6.5': [1284, 2778], android: [1080, 2400] };
const CAPTIONS = {
  '01-contacts': ['Everyone you meet,', 'in one place'],
  '02-qr': ['Share your profile', 'with one QR code'],
  '03-contact': ['Follow up in a tap', 'on Telegram, email or X'],
  '04-add': ['Capture people', 'in seconds'],
  '05-public-profile': ['No app? They can', 'still connect with you'],
};

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');

for (const file of fs.readdirSync(rawDir).filter((f) => f.endsWith('.png'))) {
  const device = Object.keys(SIZES).find((d) => file.startsWith(d + '-'));
  const key = file.slice(device.length + 1, -4);
  const [W, H] = SIZES[device];
  const [l1, l2] = CAPTIONS[key];
  const shot = fs.readFileSync(path.join(rawDir, file)).toString('base64');

  const scale = 0.82;
  const sw = Math.round(W * scale);
  const sh = Math.round(H * scale);
  const sx = Math.round((W - sw) / 2);
  const top = Math.round(H * 0.165);
  const radius = Math.round(W * 0.06);
  const fs1 = Math.round(W * 0.068);

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#6D63FF"/><stop offset="1" stop-color="#4136C8"/>
    </linearGradient>
    <clipPath id="clip"><rect x="${sx}" y="${top}" width="${sw}" height="${sh}" rx="${radius}"/></clipPath>
    <filter id="shadow" x="-20%" y="-20%" width="140%" height="140%">
      <feDropShadow dx="0" dy="${Math.round(W * 0.012)}" stdDeviation="${Math.round(W * 0.02)}" flood-color="#0B0830" flood-opacity="0.35"/>
    </filter>
  </defs>
  <rect width="${W}" height="${H}" fill="url(#bg)"/>
  <text x="${W / 2}" y="${Math.round(H * 0.075)}" font-family="Segoe UI, Arial, sans-serif" font-weight="700" font-size="${fs1}" fill="#FFFFFF" text-anchor="middle">${esc(l1)}</text>
  <text x="${W / 2}" y="${Math.round(H * 0.075 + fs1 * 1.2)}" font-family="Segoe UI, Arial, sans-serif" font-weight="700" font-size="${fs1}" fill="#FFFFFF" text-anchor="middle">${esc(l2)}</text>
  <rect x="${sx}" y="${top}" width="${sw}" height="${sh}" rx="${radius}" fill="#FFFFFF" filter="url(#shadow)"/>
  <image x="${sx}" y="${top}" width="${sw}" height="${sh}" clip-path="url(#clip)" preserveAspectRatio="xMidYMin slice" xlink:href="data:image/png;base64,${shot}"/>
</svg>`;
  const png = new Resvg(svg, { font: { loadSystemFonts: true }, fitTo: { mode: 'width', value: W } }).render().asPng();
  fs.writeFileSync(path.join(outDir, file), png);
  console.log('framed', file, W, H);
}
