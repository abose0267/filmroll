// Orientation walkthrough: upright, sideways (tilt sensor) and rotated-UI shots,
// then checks the album keeps each photo's shape.
// Usage: node scripts/orientation-e2e.mjs <screenshotDir>   (emulators + `npm run dev:phone -- --port 5180`)
import { chromium, devices } from 'playwright-core';
const BASE = 'https://localhost:5180';
const OUT = process.argv[2] || 'e2e-screens';
import('node:fs').then((fs) => fs.mkdirSync(OUT, { recursive: true }));
const b = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] });
const ctx = await b.newContext({ ...devices['iPhone 14'], ignoreHTTPSErrors: true, permissions: ['camera'] });
const p = await ctx.newPage();
const errs = [];
p.on('pageerror', (e) => errs.push(e.message));
let failed = 0;
const log = (ok, m) => { if (!ok) failed++; console.log(`${ok ? '  ✓' : '  ✗'} ${m}`); };

await p.goto(BASE + '/signin');
await p.getByRole('button', { name: /New here/ }).click();
await p.getByLabel('Your name').fill('Orient');
await p.getByLabel('Email').fill(`or${Date.now()}@example.com`);
await p.getByLabel('Password').fill('password123');
await p.getByRole('button', { name: 'Create account' }).click();
await p.waitForURL(/welcome/);
for (const t of ['Next', 'Next', 'Set up my profile']) await p.getByRole('button', { name: t }).click();
await p.getByRole('button', { name: 'Start using FilmRoll' }).click();
await p.waitForURL(BASE + '/');
await p.getByRole('dialog', { name: 'How FilmRoll works' }).getByRole('button', { name: 'Skip' }).click();
await p.goto(BASE + '/g/new');
await p.getByLabel('Group name').fill('Sideways Club');
await p.getByRole('button', { name: 'Create group' }).click();
await p.waitForURL(/invite=1/);
const gid = new URL(p.url()).pathname.split('/')[2];
await p.getByRole('button', { name: 'Close' }).click();
await p.getByRole('button', { name: 'Start a new roll' }).click();
await p.getByLabel('Roll name').fill('Every Angle');
await p.getByRole('radio', { name: '12 photos' }).click();
await p.getByRole('radio', { name: /When the roll is full/ }).click();
await p.getByRole('button', { name: 'Load 12 exposures' }).click();
await p.waitForURL(new RegExp(`/g/${gid}$`));

const live = () => p.waitForFunction(() => { const v = document.querySelector('video'); return v && v.videoWidth > 0 && !v.classList.contains('opacity-0'); }, null, { timeout: 15000 });
const wind = async () => {
  const w = p.getByRole('slider', { name: 'Wind the film' });
  await w.waitFor();
  for (let i = 0; i < 10; i++) await w.press('ArrowRight');
  await p.getByText('ready', { exact: true }).waitFor();
};
/** Shape of the "undeveloped" frame shown after the shutter (follows the shot's orientation). */
const frameShape = async () => {
  await p.getByText('undeveloped', { exact: true }).waitFor({ timeout: 20000 });
  return p.getByText('undeveloped', { exact: true }).evaluate((el) => (el.parentElement.className.includes('aspect-[4/3]') ? 'landscape' : 'portrait'));
};
const done = async (cap) => {
  await p.getByLabel('Caption').fill(cap);
  await p.getByRole('button', { name: 'Done' }).click();
  await p.getByRole('button', { name: /^Take photo/ }).or(p.getByText('That’s the whole roll!')).waitFor({ timeout: 30000 });
};

// 1) upright
await p.goto(`${BASE}/camera?g=${gid}`);
await live();
await wind();
await p.getByRole('button', { name: /^Take photo/ }).click();
log((await frameShape()) === 'portrait', 'upright shot is a portrait frame');
await p.screenshot({ path: `${OUT}/o1-note-portrait.png` });
await done('Upright');

// 2) phone turned sideways with the UI still portrait (tilt sensor)
await live();
await p.evaluate(() => window.dispatchEvent(new DeviceOrientationEvent('deviceorientation', { alpha: 0, beta: 4, gamma: -82 })));
await p.waitForTimeout(400);
await wind();
await p.screenshot({ path: `${OUT}/o2-camera-tilted.png` });
const t = await p.evaluate(() => getComputedStyle(document.querySelector('[aria-label$="exposures left"]')).transform);
log(t !== 'none' && !t.startsWith('matrix(1, 0'), `controls turn to face the user when sideways (${t})`);
await p.getByRole('button', { name: /^Take photo/ }).click();
log((await frameShape()) === 'landscape', 'sideways shot becomes a landscape frame');
await p.screenshot({ path: `${OUT}/o3-note-landscape.png` });
await done('Sideways (tilt)');
await p.evaluate(() => window.dispatchEvent(new DeviceOrientationEvent('deviceorientation', { alpha: 0, beta: 85, gamma: 3 })));

// 3) the browser rotates the whole UI to landscape
await p.setViewportSize({ width: 844, height: 390 });
await live();
await wind();
await p.waitForTimeout(300);
await p.screenshot({ path: `${OUT}/o4-camera-landscape-ui.png` });
await p.getByRole('button', { name: /^Take photo/ }).click();
log((await frameShape()) === 'landscape', 'landscape-UI shot is a landscape frame');
await done('Landscape UI');
await p.setViewportSize({ width: 390, height: 664 });

// fill the roll: mix of portrait/landscape through the phone-camera input
const files = await p.evaluate(async () => {
  const out = [];
  for (let i = 0; i < 9; i++) {
    const land = i % 2 === 0;
    const c = document.createElement('canvas'); c.width = land ? 1600 : 1200; c.height = land ? 1200 : 1600;
    const x = c.getContext('2d'); const g = x.createLinearGradient(0, 0, c.width, c.height);
    g.addColorStop(0, `hsl(${i * 40} 60% 65%)`); g.addColorStop(1, `hsl(${i * 40 + 70} 50% 35%)`);
    x.fillStyle = g; x.fillRect(0, 0, c.width, c.height);
    x.font = '400px serif'; x.textAlign = 'center'; x.fillText(['🏔️','🐕','🌉','🍕','🚲','🌅','🎡','🍦','🛶'][i], c.width / 2, c.height / 2 + 140);
    const bl = await new Promise((r) => c.toBlob(r, 'image/jpeg', 0.9));
    out.push(Array.from(new Uint8Array(await bl.arrayBuffer())));
  }
  return out;
});
for (let i = 0; i < 9; i++) {
  await wind();
  await p.locator('input[type=file][capture]').setInputFiles({ name: `s${i}.jpg`, mimeType: 'image/jpeg', buffer: Buffer.from(files[i]) });
  await done(`Mixed ${i}`);
}
await p.waitForFunction(() => !document.querySelector('[aria-label*="saving"]'), null, { timeout: 60000 });
log(true, 'roll filled with mixed orientations');

// album
await p.goto(`${BASE}/g/${gid}`);
const rid = await p.evaluate(async (gid) => (await fetch(`/v1/projects/demo-filmroll/databases/(default)/documents/groups/${gid}/rolls`, { headers: { Authorization: 'Bearer owner' } }).then((r) => r.json())).documents[0].name.split('/').pop(), gid);
await p.goto(`${BASE}/g/${gid}/r/${rid}`);
await p.getByRole('button', { name: 'Skip' }).click();
await p.getByRole('heading', { name: 'Contact sheet' }).waitFor();
await p.waitForTimeout(2500);
await p.screenshot({ path: `${OUT}/o5-cover.png` });
for (let y = 0; y < 4; y++) { await p.mouse.wheel(0, 600); await p.waitForTimeout(300); }
await p.waitForTimeout(1500);
await p.screenshot({ path: `${OUT}/o6-contact.png` });
await p.getByRole('button', { name: /Open frame 2:/ }).click();
await p.waitForTimeout(1500);
await p.screenshot({ path: `${OUT}/o7-viewer-landscape.png` });
const box = await p.locator('[role=dialog] img').first().evaluate((i) => [i.naturalWidth, i.naturalHeight, i.getBoundingClientRect().width, i.getBoundingClientRect().height]);
log(box[0] > box[1], `viewer shows the landscape frame whole (${box.map(Math.round).join(', ')})`);
await p.keyboard.press('ArrowLeft');
await p.waitForTimeout(1200);
await p.screenshot({ path: `${OUT}/o8-viewer-portrait.png` });
console.log('page errors:', errs.length ? errs : 'none');
await b.close();
process.exit(errs.length || failed ? 1 : 0);
