// Renders public/icons/icon.svg to PNG app icons using a local Chrome via playwright-core.
// Usage: npm run icons   (set CHROME_PATH if Chrome isn't in the default location)
import { chromium } from 'playwright-core';
import { readFileSync } from 'node:fs';

const svg = readFileSync('public/icons/icon.svg', 'utf8');
// background colour = the full-size rect's fill (fills the maskable icon's bleed area)
const bg = svg.match(/<rect width="512" height="512"[^>]*fill="([^"]+)"/)?.[1] ?? '#F4EBDD';
const exe = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const browser = await chromium.launch({ executablePath: exe });
const page = await browser.newPage({ viewport: { width: 600, height: 600 } });
const out = [
  ['icon-192.png', 192, 0],
  ['icon-512.png', 512, 0],
  ['apple-touch-icon.png', 180, 0],
  // maskable: artwork inside the 80% safe zone on a full-bleed background
  ['icon-maskable-512.png', 512, 0.1],
];
for (const [name, size, pad] of out) {
  const inner = Math.round(size * (1 - pad * 2));
  // iOS/Android apply their own rounding, so maskable + apple-touch use square corners
  const square = pad || name.startsWith('apple');
  const art = (square ? svg.replace('rx="112"', 'rx="0"') : svg).replace('<svg ', `<svg width="${inner}" height="${inner}" style="display:block" `);
  await page.setContent(`<html><body style="margin:0"><div id="icon" style="width:${size}px;height:${size}px;display:flex;align-items:center;justify-content:center;background:${pad ? bg : 'transparent'}">${art}</div></body></html>`);
  await page.locator('#icon').screenshot({ path: `public/icons/${name}`, omitBackground: !pad });
  console.log('wrote', name);
}
await browser.close();
