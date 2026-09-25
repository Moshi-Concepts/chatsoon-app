// Google Play assets: 9:16 phone screenshots re-framed from the android-*.png store shots, a 512px icon and
// the 1024x500 feature graphic. usage (repo root): NODE_PATH=node_modules node store/screenshots/tools/play-assets.cjs .
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const render = (svg) => sharp(Buffer.from(svg), { density: 72 }).png().toBuffer();
const root = process.argv[2];
const out = path.join(root, 'store/screenshots/play');
const CAPTIONS = {
  '01-contacts': ['Everyone you meet,', 'in one place'],
  '02-qr': ['Share your profile', 'with one QR code'],
  '03-contact': ['Follow up in a tap', 'on Telegram, email or X'],
  '04-add': ['Capture people', 'in seconds'],
  '05-public-profile': ['No app? They can', 'still connect with you'],
};
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
const defs = (W, H, sx, top, sw, sh, radius) => `<defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#6D63FF"/><stop offset="1" stop-color="#4136C8"/></linearGradient>
    <clipPath id="clip"><rect x="${sx}" y="${top}" width="${sw}" height="${sh}" rx="${radius}"/></clipPath>
    <filter id="shadow" x="-20%" y="-20%" width="140%" height="140%"><feDropShadow dx="0" dy="${Math.round(W * 0.012)}" stdDeviation="${Math.round(W * 0.02)}" flood-color="#0B0830" flood-opacity="0.35"/></filter>
  </defs>`;
(async () => {
  // 1. Screenshots: cut the app screen out of the 1080x2400 framed image (same geometry as compose.mjs),
  // then re-frame at 1080x1920 (9:16).
  const [W0, H0] = [1080, 2400];
  const sw0 = Math.round(W0 * 0.82), sh0 = Math.round(H0 * 0.82), sx0 = Math.round((W0 - sw0) / 2), top0 = Math.round(H0 * 0.165);
  const inset = Math.round(W0 * 0.06); // skip the rounded corners at the top
  for (const key of Object.keys(CAPTIONS)) {
    const src = path.join(root, `store/screenshots/android-${key}.png`);
    const shot = await sharp(src).extract({ left: sx0, top: top0 + inset, width: sw0, height: Math.min(sh0, H0 - top0) - inset }).png().toBuffer();
    const { data: px } = await sharp(shot).extract({ left: 20, top: 2, width: 1, height: 1 }).raw().toBuffer({ resolveWithObject: true });
    const fill = `rgb(${px[0]},${px[1]},${px[2]})`;
    const [W, H] = [1080, 1920];
    const sw = Math.round(W * 0.82), sx = Math.round((W - sw) / 2), top = Math.round(H * 0.2), sh = H - top + 40;
    const radius = Math.round(W * 0.06), fs1 = Math.round(W * 0.068);
    const [l1, l2] = CAPTIONS[key];
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  ${defs(W, H, sx, top, sw, sh, radius)}
  <rect width="${W}" height="${H}" fill="url(#bg)"/>
  <text x="${W / 2}" y="${Math.round(H * 0.085)}" font-family="Segoe UI, Arial, sans-serif" font-weight="700" font-size="${fs1}" fill="#FFFFFF" text-anchor="middle">${esc(l1)}</text>
  <text x="${W / 2}" y="${Math.round(H * 0.085 + fs1 * 1.2)}" font-family="Segoe UI, Arial, sans-serif" font-weight="700" font-size="${fs1}" fill="#FFFFFF" text-anchor="middle">${esc(l2)}</text>
  <rect x="${sx}" y="${top}" width="${sw}" height="${sh}" rx="${radius}" fill="${fill}" filter="url(#shadow)"/>
  <image x="${sx}" y="${top + inset * sw / sw0}" width="${sw}" height="${sh}" clip-path="url(#clip)" preserveAspectRatio="xMidYMin slice" xlink:href="data:image/png;base64,${shot.toString('base64')}"/>
</svg>`;
    const png = await render(svg);
    await sharp(png).flatten({ background: '#4136C8' }).png().toFile(path.join(out, `phone-${key}.png`));
    console.log('screenshot', key);
  }
  // 2. App icon 512x512.
  await sharp(path.join(root, 'apps/mobile/assets/images/icon.png')).resize(512, 512).png().toFile(path.join(out, 'icon-512.png'));
  // 3. Feature graphic 1024x500, no alpha.
  const icon = (await sharp(path.join(root, 'apps/mobile/assets/images/icon.png')).resize(260, 260).png().toBuffer()).toString('base64');
  const fg = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="1024" height="500" viewBox="0 0 1024 500">
  <defs><linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#6D63FF"/><stop offset="1" stop-color="#4136C8"/></linearGradient>
  <clipPath id="ic"><rect x="96" y="120" width="260" height="260" rx="58"/></clipPath>
  <filter id="shadow" x="-20%" y="-20%" width="140%" height="140%"><feDropShadow dx="0" dy="10" stdDeviation="18" flood-color="#0B0830" flood-opacity="0.35"/></filter></defs>
  <rect width="1024" height="500" fill="url(#bg)"/>
  <rect x="96" y="120" width="260" height="260" rx="58" fill="#FFFFFF" filter="url(#shadow)"/>
  <image x="96" y="120" width="260" height="260" clip-path="url(#ic)" xlink:href="data:image/png;base64,${icon}"/>
  <text x="412" y="232" font-family="Segoe UI, Arial, sans-serif" font-weight="700" font-size="84" fill="#FFFFFF">Chatsoon</text>
  <text x="414" y="302" font-family="Segoe UI, Arial, sans-serif" font-weight="600" font-size="40" fill="#FFFFFF" fill-opacity="0.92">Meet people. Follow up.</text>
  <text x="414" y="356" font-family="Segoe UI, Arial, sans-serif" font-weight="400" font-size="28" fill="#FFFFFF" fill-opacity="0.8">The networking CRM for events</text>
</svg>`;
  const fgPng = await render(fg);
  await sharp(fgPng).flatten({ background: '#4136C8' }).removeAlpha().png().toFile(path.join(out, 'feature-graphic-1024x500.png'));
  console.log('done');
})();
