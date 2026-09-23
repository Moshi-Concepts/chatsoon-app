import { Resvg } from '@resvg/resvg-js';
import fs from 'node:fs';
import path from 'node:path';

const OUT = process.argv[2];
fs.mkdirSync(OUT, { recursive: true });

// Glyph on a 1024 canvas: a chat bubble with a "typing" indicator. Two indigo dots and a coral one.
// `scale` shrinks it around the centre (Android adaptive icons need a 66% safe zone).
function glyph({ bubble = '#FFFFFF', dot = '#5146E5', accent = '#FF6B4A', scale = 1 } = {}) {
  const t = `translate(512 512) scale(${scale}) translate(-512 -540)`;
  return `
  <g transform="${t}">
    <path fill="${bubble}" d="
      M 362 250
      H 662
      A 150 150 0 0 1 812 400
      V 560
      A 150 150 0 0 1 662 710
      H 470
      L 318 826
      C 304 836 286 824 291 807
      L 318 710
      A 150 150 0 0 1 212 560
      V 400
      A 150 150 0 0 1 362 250 Z" />
    <circle cx="387" cy="480" r="50" fill="${dot}" />
    <circle cx="512" cy="480" r="50" fill="${dot}" />
    <circle cx="637" cy="480" r="50" fill="${accent}" />
  </g>`;
}

const gradient = `
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#6D63FF" />
      <stop offset="1" stop-color="#4136C8" />
    </linearGradient>
  </defs>`;

const svgs = {
  // iOS / store icon: full bleed, no transparency, iOS applies the mask.
  'icon.png': `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024">${gradient}
    <rect width="1024" height="1024" fill="url(#bg)" />${glyph()}</svg>`,
  // Android adaptive foreground: transparent, glyph inside the safe zone.
  'android-icon-foreground.png': `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024">${glyph({ scale: 0.62 })}</svg>`,
  'android-icon-background.png': `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024">${gradient}
    <rect width="1024" height="1024" fill="url(#bg)" /></svg>`,
  'android-icon-monochrome.png': `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024">
    <mask id="m"><rect width="1024" height="1024" fill="black" />${glyph({ bubble: 'white', dot: 'black', accent: 'black', scale: 0.62 })}</mask>
    <rect width="1024" height="1024" fill="white" mask="url(#m)" /></svg>`,
  // Splash: glyph only, shown on the #5146E5 splash background.
  'splash-icon.png': `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024">${glyph({ scale: 0.9 })}</svg>`,
  // Favicon / web icon with rounded corners.
  'favicon.png': `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024">${gradient}
    <rect width="1024" height="1024" rx="230" fill="url(#bg)" />${glyph({ scale: 0.95 })}</svg>`,
};

const sizes = { 'favicon.png': 196 };

for (const [name, svg] of Object.entries(svgs)) {
  const width = sizes[name] ?? 1024;
  const png = new Resvg(svg, { fitTo: { mode: 'width', value: width } }).render().asPng();
  fs.writeFileSync(path.join(OUT, name), png);
  console.log(name, width, png.length);
}
fs.writeFileSync(path.join(OUT, 'icon.svg'), svgs['icon.png']);
