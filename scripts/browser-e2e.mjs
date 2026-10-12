// Mobile browser walkthrough against the emulators + dev server.
// Prereqs: `npm run emulators` and `npm run dev:emulators -- --port 5174` running.
// Usage: node scripts/browser-e2e.mjs [baseUrl] [screenshotDir]
import { chromium, devices } from 'playwright-core';
import { mkdirSync } from 'node:fs';

const BASE = process.argv[2] || 'http://localhost:5174';
const SHOTS = process.argv[3] || 'e2e-screens';
mkdirSync(SHOTS, { recursive: true });
const exe = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const browser = await chromium.launch({
  executablePath: exe,
  args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'],
});
// self-signed certificate in `npm run dev:phone`
const phone = { ...devices['iPhone 14'], defaultBrowserType: undefined, ignoreHTTPSErrors: true };
// Over HTTPS the emulators are reached through the dev server's proxy.
const FIRESTORE = BASE.startsWith('https') ? BASE : 'http://127.0.0.1:8080';
delete phone.defaultBrowserType;

let failures = 0;
const log = (ok, msg) => {
  if (!ok) failures++;
  console.log(`${ok ? '  ✓' : '  ✗'} ${msg}`);
};
const errors = [];
const pages = [];

async function newUser(name, opts = {}) {
  const ctx = await browser.newContext({ ...phone, permissions: ['camera'], ...opts });
  const page = await ctx.newPage();
  pages.push([name, page]);
  page.on('pageerror', (e) => errors.push(`[${name}] pageerror ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error' && !/favicon|Download the React DevTools|net::ERR|status of 40[13]/i.test(m.text())) errors.push(`[${name}] ${m.text().slice(0, 200)}`);
  });
  return { ctx, page, name };
}
const shot = (p, n) => p.screenshot({ path: `${SHOTS}/${n}.png` });

async function signUp({ page, name }) {
  await page.goto(BASE + '/');
  await page.getByRole('link', { name: 'Continue with email' }).click();
  await page.getByRole('button', { name: /New here/ }).click();
  await page.getByLabel('Your name').fill(name);
  const email = `${name.toLowerCase()}-${Date.now()}@example.com`;
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill('password123');
  await page.getByRole('button', { name: 'Create account' }).click();
  await page.waitForURL(/\/welcome/);
  for (const b of ['Next', 'Next', 'Set up my profile']) await page.getByRole('button', { name: b }).click();
  await page.getByLabel('City').fill(name === 'Alice' ? 'Austin' : 'Boston');
  await page.getByRole('button', { name: 'Start using FilmRoll' }).click();
  await page.waitForURL(BASE + '/');
  return email;
}

/** Generates test photos in the browser (canvas → JPEG) and returns them as file payloads. */
async function makePhotos(page, n) {
  const datas = await page.evaluate(async (n) => {
    const out = [];
    const subjects = ['☕', '🐶', '🎸', '🚗', '🌊', '🍜', '🌇', '🎂'];
    for (let i = 0; i < n; i++) {
      const c = document.createElement('canvas');
      c.width = 1200;
      c.height = 1600;
      const x = c.getContext('2d');
      const g = x.createLinearGradient(0, 0, 0, 1600);
      g.addColorStop(0, `hsl(${(i * 47) % 360} 60% 70%)`);
      g.addColorStop(1, `hsl(${(i * 47 + 60) % 360} 50% 35%)`);
      x.fillStyle = g;
      x.fillRect(0, 0, 1200, 1600);
      x.font = '520px serif';
      x.textAlign = 'center';
      x.fillText(subjects[i % subjects.length], 600, 1000);
      const b = await new Promise((r) => c.toBlob(r, 'image/jpeg', 0.9));
      out.push(Array.from(new Uint8Array(await b.arrayBuffer())));
    }
    return out;
  }, n);
  return datas.map((d, i) => ({ name: `photo-${i}.jpg`, mimeType: 'image/jpeg', buffer: Buffer.from(d) }));
}

async function confirmShot(page, caption) {
  await page.getByLabel('Caption').fill(caption);
  await page.getByRole('button', { name: 'Use one exposure' }).waitFor();
  await page.waitForSelector('img[alt="Your photo with the film effect"]', { timeout: 20000 });
  await page.getByRole('button', { name: 'Use one exposure' }).click();
  await page.getByRole('button', { name: /Take another|Back to/ }).first().waitFor({ timeout: 30000 });
}

try {
  console.log('Alice signs up and creates a group');
  const alice = await newUser('Alice');
  await alice.page.goto(BASE + '/');
  await alice.page.getByRole('heading', { name: 'FilmRoll' }).waitFor();
  await shot(alice.page, '01-landing');
  const aliceEmail = await signUp(alice);
  await alice.page.getByRole('heading', { name: /Alice/ }).waitFor();
  await shot(alice.page, '02-home-empty');
  await alice.page.getByRole('button', { name: 'Start a group' }).click();
  await alice.page.getByLabel('Group name').fill('The Crew');
  await alice.page.getByRole('radio', { name: 'Dusk' }).click();
  await alice.page.getByRole('button', { name: 'Create group' }).click();
  await alice.page.waitForURL(/\/g\/[^/]+\?invite=1/);
  const codeEl = alice.page.locator('p.font-mono.text-3xl');
  await codeEl.waitFor();
  const code = (await codeEl.textContent()).trim();
  log(/^[A-Z2-9]{4}-[A-Z2-9]{4}$/.test(code), `invite code shown (${code})`);
  await shot(alice.page, '03-invite');
  await alice.page.getByRole('button', { name: 'Close' }).click();
  const gid = new URL(alice.page.url()).pathname.split('/')[2];

  console.log('Bob joins with the invite link');
  const bob = await newUser('Bob');
  await signUp(bob);
  await bob.page.goto(`${BASE}/join/${code}`);
  await bob.page.getByRole('button', { name: /Join The Crew/ }).click();
  await bob.page.waitForURL(new RegExp(`/g/${gid}`));
  log(true, 'bob joined');

  console.log('Alice loads a 12-exposure roll');
  await alice.page.reload();
  await alice.page.getByRole('button', { name: 'Start a new roll' }).click();
  await alice.page.getByLabel('Roll name').fill('October Memories');
  await alice.page.getByRole('radio', { name: '12 photos' }).click();
  await alice.page.getByRole('radio', { name: /When the roll is full/ }).click();
  await alice.page.getByRole('radio', { name: /Warm Vintage/ }).click();
  await shot(alice.page, '04-new-roll');
  await alice.page.getByRole('button', { name: 'Load 12 exposures' }).click();
  await alice.page.waitForURL(new RegExp(`/g/${gid}$`));
  await alice.page.getByText('0 / 12 memories captured').waitFor();
  await shot(alice.page, '05-group-active');

  console.log('Alice shoots with the (fake) camera');
  await alice.page.getByRole('button', { name: 'Capture a memory' }).click();
  await alice.page.waitForURL(/\/camera/);
  await alice.page.waitForFunction(() => {
    const v = document.querySelector('video');
    return v && v.videoWidth > 0 && !v.classList.contains('opacity-0');
  }, null, { timeout: 15000 });
  await shot(alice.page, '06-camera');
  await alice.page.getByRole('button', { name: 'Take photo' }).click();
  await alice.page.getByLabel('Caption').waitFor();
  await alice.page.waitForSelector('img[alt="Your photo with the film effect"]', { timeout: 20000 });
  await shot(alice.page, '07-confirm');
  await alice.page.getByLabel('Caption').fill('Morning coffee before work');
  await alice.page.getByRole('button', { name: 'Use one exposure' }).click();
  await alice.page.getByRole('button', { name: 'Take another' }).waitFor({ timeout: 30000 });
  await shot(alice.page, '08-captured');
  log(await alice.page.getByText(/11 exposures left/).isVisible(), 'exposure counter shows 11 left');

  // more shots from the gallery
  const photos = await makePhotos(alice.page, 11);
  for (let i = 0; i < 5; i++) {
    await alice.page.getByRole('button', { name: 'Take another' }).click();
    await alice.page.locator('input[type=file]:not([capture])').setInputFiles(photos[i]);
    await confirmShot(alice.page, `Alice frame ${i + 2}`);
  }
  log(true, 'alice added 6 photos');

  console.log('Before development, nothing is visible');
  await alice.page.goto(`${BASE}/g/${gid}`);
  await alice.page.getByText('6 / 12 memories captured').waitFor();
  const rid = await alice.page.evaluate(async ([gid, base]) => {
    const r = await fetch(`${base}/v1/projects/demo-filmroll/databases/(default)/documents/groups/${gid}`, { headers: { Authorization: 'Bearer owner' } }).then((x) => x.json());
    return r.fields.activeRollId.stringValue;
  }, [gid, FIRESTORE]);
  await alice.page.goto(`${BASE}/g/${gid}/r/${rid}`);
  await alice.page.getByText('Still in the camera').waitFor({ timeout: 10000 }).catch(() => undefined);
  log(await alice.page.getByText('Still in the camera').isVisible(), 'album page refuses to show an undeveloped roll');
  await shot(alice.page, '09-still-in-camera');
  const imgs = await alice.page.locator('img[src^="blob:"]').count();
  log(imgs === 0, 'no photo images loaded before development');
  // leave the album page, otherwise the reveal plays live in this tab when the roll develops
  await alice.page.goto(`${BASE}/g/${gid}`);

  console.log('Bob shoots the last 6 from his gallery');
  await bob.page.goto(`${BASE}/camera?g=${gid}`);
  for (let i = 0; i < 6; i++) {
    if (i > 0) await bob.page.getByRole('button', { name: 'Take another' }).click();
    await bob.page.locator('input[type=file]:not([capture])').setInputFiles(photos[5 + i] ?? photos[0]);
    await confirmShot(bob.page, `Bob frame ${i + 1}`);
  }
  await bob.page.getByText(/last shot/).waitFor();
  await shot(bob.page, '10-last-shot');
  log(true, 'roll filled and sent to develop');

  console.log('Bob opens the developed album');
  await bob.page.goto(`${BASE}/g/${gid}/r/${rid}`);
  await bob.page.getByText('Developing…').waitFor({ timeout: 15000 });
  await shot(bob.page, '11-reveal-developing');
  await bob.page.getByText('CONTACT SHEET', { exact: false }).waitFor({ timeout: 15000 });
  await bob.page.waitForTimeout(1500);
  await shot(bob.page, '12-reveal-contact');
  await bob.page.getByRole('heading', { name: 'Contact sheet' }).waitFor({ timeout: 15000 });
  await bob.page.waitForTimeout(1500);
  await shot(bob.page, '13-album');
  // contact sheet frames lazy-load as they scroll into view
  for (let y = 0; y < 6; y++) {
    await bob.page.mouse.wheel(0, 700);
    await bob.page.waitForTimeout(400);
  }
  await bob.page.waitForFunction(() => document.querySelectorAll('img[src^="blob:"]').length >= 12, null, { timeout: 30000 });
  await shot(bob.page, '13b-contact-sheet');
  log((await bob.page.locator('img[src^="blob:"]').count()) >= 12, 'all 12 photos load after development');
  await bob.page.getByRole('button', { name: /Open frame 1:/ }).click();
  await bob.page.getByText('Morning coffee before work').waitFor();
  await bob.page.waitForTimeout(800);
  await shot(bob.page, '14-viewer');
  await bob.page.getByRole('button', { name: 'React 🥹' }).click();
  await bob.page.locator('button:has(svg.lucide-message-circle)').click();
  await bob.page.getByLabel('Comment').fill('Is that the place on 5th?');
  await bob.page.getByRole('button', { name: 'Send' }).click();
  await bob.page.getByText('Is that the place on 5th?').waitFor();
  await shot(bob.page, '15-comments');
  log(true, 'reaction and comment added');
  await bob.page.keyboard.press('Escape');
  await bob.page.waitForTimeout(400);
  // swipe to next photo
  await bob.page.keyboard.press('ArrowRight');
  await bob.page.getByText('Alice frame 2').waitFor();
  log(true, 'viewer navigates to the next frame');

  console.log('Alice sees the developed roll + notifications');
  await alice.page.goto(BASE + '/');
  await alice.page.getByText('Your film is developed!').waitFor({ timeout: 10000 });
  await shot(alice.page, '16-home-developed');
  await alice.page.goto(BASE + '/notifications');
  await alice.page.getByText(/commented on your photo/).waitFor({ timeout: 10000 });
  await shot(alice.page, '17-notifications');
  log(true, 'developed + comment notifications delivered');
  await alice.page.goto(BASE + '/albums');
  await alice.page.getByText('October Memories').first().waitFor();
  await shot(alice.page, '18-albums');
  await alice.page.goto(BASE + '/profile');
  await alice.page.getByText('Your groups').waitFor();
  await shot(alice.page, '19-profile');

  console.log('Reduced motion');
  const calm = await browser.newContext({ ...phone, reducedMotion: 'reduce' });
  const cp = await calm.newPage();
  await cp.goto(`${BASE}/signin?next=${encodeURIComponent(`/g/${gid}/r/${rid}`)}`);
  await cp.getByLabel('Email').fill(aliceEmail);
  await cp.getByLabel('Password').fill('password123');
  await cp.getByRole('button', { name: 'Sign in' }).click();
  await cp.getByRole('button', { name: 'Open the album' }).waitFor({ timeout: 15000 });
  await shot(cp, '20-reduced-motion');
  await cp.getByRole('button', { name: 'Open the album' }).click();
  await cp.getByRole('heading', { name: 'Contact sheet' }).waitFor();
  log(true, 'reduced-motion reveal is a simple card');

  await alice.page.goto(BASE + '/camera');
  await alice.page.getByText('No roll in the camera').waitFor();
  await shot(alice.page, '21-camera-no-roll');
} catch (e) {
  failures++;
  console.error(e);
  for (const [n, p] of pages) await p.screenshot({ path: `${SHOTS}/fail-${n}.png` }).catch(() => undefined);
}
console.log('\nConsole errors:', errors.length ? '\n' + errors.join('\n') : 'none');
console.log(failures ? `\n${failures} failure(s)` : '\nAll browser checks passed');
await browser.close();
process.exit(failures || errors.length ? 1 : 0);
