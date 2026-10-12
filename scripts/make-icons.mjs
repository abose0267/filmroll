// Renders public/icons/icon.svg to PNG app icons using a local Chrome via playwright-core.
// Usage: npm run icons   (set CHROME_PATH if Chrome isn't in the default location)
import { chromium } from 'playwright-core';
import { readFileSync } from 'node:fs';

const svg = readFileSync('public/icons/icon.svg', 'utf8');
const exe = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const browser = await chromium.launch({ executablePath: exe });
const page = await browser.newPage();
const out = [
  ['icon-192.png', 192, 0],
  ['icon-512.png', 512, 0],
  ['apple-touch-icon.png', 180, 0],
  // maskable: keep the artwork inside the 80% safe zone on a full-bleed background
  ['icon-maskable-512.png', 512, 0.12],
];
for (const [name, size, pad] of out) {
  await page.setViewportSize({ width: size, height: size });
  const inner = Math.round(size * (1 - pad * 2));
  const art = pad ? svg.replace('rx="112"', 'rx="0"') : svg;
  await page.setContent(`<html><body style="margin:0;background:${pad ? '#D9714E' : 'transparent'};display:grid;place-items:center;width:${size}px;height:${size}px">${art.replace('<svg ', `<svg width="${inner}" height="${inner}" `)}</body></html>`);
  await page.screenshot({ path: `public/icons/${name}`, omitBackground: !pad });
  console.log('wrote', name);
}
await browser.close();
