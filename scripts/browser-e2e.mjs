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

const SKIP_INSTALL = () => localStorage.setItem('filmroll:install-skip', '1');

async function newUser(name, opts = {}, { install = false } = {}) {
  const ctx = await browser.newContext({ ...phone, permissions: ['camera'], ...opts });
  // Phones are asked to install first; only Alice goes through that screen.
  if (!install) await ctx.addInitScript(SKIP_INSTALL);
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
  // first-login tutorial: Alice walks through it, everyone else skips
  const tut = page.getByRole('dialog', { name: 'How FilmRoll works' });
  await tut.waitFor();
  if (name === 'Alice') {
    for (let i = 0; i < 6; i++) await page.getByRole('button', { name: 'Next' }).click();
    await shot(page, '01b-tutorial-last');
    await page.getByRole('button', { name: 'Start shooting' }).click();
  } else await tut.getByRole('button', { name: 'Skip' }).click();
  await tut.waitFor({ state: 'detached' });
  await page.waitForTimeout(1000); // let the "tutorial done" write reach the server before the test reloads
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

/** Wind the film-advance wheel (keyboard path: one notch per key press). */
async function wind(page) {
  const w = page.getByRole('slider', { name: 'Wind the film' });
  await w.waitFor();
  for (let i = 0; i < 10; i++) await w.press('ArrowRight');
  await page.getByText('ready', { exact: true }).waitFor();
}

/** After the shutter: add a note, tap Done, wait to be back at the camera (or the end-of-roll screen). */
async function noteAndDone(page, caption) {
  await page.getByLabel('Caption').fill(caption);
  await page.getByRole('button', { name: 'Done' }).click();
  await page.getByRole('button', { name: /^Take photo/ }).or(page.getByText('That’s the whole roll!')).waitFor({ timeout: 30000 });
}

/** Wait until no shots are still saving in the background (counter's "saving" mark gone). */
async function savesSettled(page) {
  await page.waitForFunction(() => !document.querySelector('[aria-label*="saving"]'), null, { timeout: 60000 });
}

/** Wind, then take a shot through the phone-camera fallback input. */
async function shootFile(page, file, caption) {
  await wind(page);
  await page.locator('input[type=file][capture]').setInputFiles(file);
  await noteAndDone(page, caption);
}

try {
  console.log('Alice signs up and creates a group');
  const alice = await newUser('Alice', {}, { install: true });
  await alice.page.goto(BASE + '/');
  await alice.page.getByRole('heading', { name: 'Put FilmRoll on your home screen' }).waitFor();
  log(await alice.page.getByText('Add to Home Screen').isVisible(), 'phones are asked to add FilmRoll to the home screen before signing up');
  await shot(alice.page, '00-install');
  await alice.page.getByRole('button', { name: 'Use it in the browser instead' }).click();
  await alice.page.getByRole('heading', { name: 'FilmRoll' }).waitFor();
  await shot(alice.page, '01-landing');
  const aliceEmail = await signUp(alice);
  await alice.page.getByRole('heading', { name: /Alice/ }).waitFor();
  await alice.page.reload();
  await alice.page.getByRole('heading', { name: /Alice/ }).waitFor();
  await alice.page.waitForTimeout(800);
  log((await alice.page.getByRole('dialog', { name: 'How FilmRoll works' }).count()) === 0, 'tutorial shows once per account');
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

  console.log('An invite opened in the browser keeps its code through the install screen');
  const carol = await newUser('Carol', {}, { install: true });
  await carol.page.goto(`${BASE}/join/${code.replace('-', '')}`);
  await carol.page.getByRole('button', { name: /Copy invite code/ }).waitFor();
  log((await carol.page.getByRole('button', { name: /Copy invite code/ }).textContent()).includes(code.replace('-', '')), 'install screen shows the invite code');
  await shot(carol.page, '03b-install-invite');
  await carol.ctx.close();
  pages.splice(pages.findIndex(([n]) => n === 'Carol'), 1);

  console.log('Bob joins with the invite link');
  const bob = await newUser('Bob');
  const bobEmail = await signUp(bob);
  await bob.page.goto(`${BASE}/join/${code}`);
  await bob.page.getByRole('button', { name: /Join The Crew/ }).click();
  await bob.page.waitForURL(new RegExp(`/g/${gid}`));
  log(true, 'bob joined');

  console.log('Alice turns on end-to-end encryption (opt-in, with pros and cons first)');
  await alice.page.goto(`${BASE}/g/${gid}/settings`);
  await alice.page.getByRole('button', { name: 'Turn on…' }).click();
  await alice.page.getByText('The trade-offs').waitFor();
  log(await alice.page.getByText(/gone for good/).isVisible(), 'the explainer spells out the trade-offs before turning it on');
  await shot(alice.page, '04a-encryption-explainer');
  await alice.page.getByRole('button', { name: 'Turn on encryption' }).click();
  await alice.page.getByText('End-to-end encryption is on', { exact: true }).waitFor();
  log(true, 'encryption turned on for the group');
  await alice.page.goto(`${BASE}/g/${gid}`);

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
  // the full-screen camera's ✕ closes it (and must work as the very first tap)
  await alice.page.goto(`${BASE}/camera?g=${gid}`);
  await alice.page.getByRole('button', { name: 'Close camera' }).click();
  await alice.page.waitForURL(new RegExp(`/g/${gid}$`));
  log(true, 'the ✕ closes the full-screen camera');
  // "Capture a memory" opens the camera on the home tab, where the tab bar's center button is the shutter
  await alice.page.getByRole('button', { name: 'Capture a memory' }).click();
  await alice.page.waitForURL(/\/\?g=/);
  await alice.page.getByRole('navigation', { name: 'Main' }).getByRole('button', { name: /^Take photo/ }).waitFor();
  log((await alice.page.getByRole('button', { name: /^Take photo/ }).count()) === 1, 'home camera: the center tab is the (only) shutter');
  log(await alice.page.getByRole('link', { name: 'Profile and settings' }).isVisible(), 'profile button in the top right of the camera');
  await alice.page.waitForFunction(() => {
    const v = document.querySelector('video');
    return v && v.videoWidth > 0 && !v.classList.contains('opacity-0');
  }, null, { timeout: 15000 });
  await shot(alice.page, '06-camera-unwound');
  // the shutter won't fire until the film is wound
  await alice.page.getByRole('button', { name: /^Take photo/ }).click();
  await alice.page.getByText('Wind the film first').waitFor();
  log(!(await alice.page.getByLabel('Caption').isVisible()), 'shutter refuses to fire before winding');
  await wind(alice.page);
  await shot(alice.page, '06b-camera-wound');

  // undo inside the window gives the exposure back and keeps the film wound
  await alice.page.getByRole('button', { name: /^Take photo/ }).click();
  await alice.page.getByRole('button', { name: /^Undo/ }).click();
  await alice.page.getByText('Shot discarded').waitFor();
  const undone = await Promise.all([alice.page.getByText('ready', { exact: true }).waitFor({ timeout: 5000 }), alice.page.getByLabel('12 exposures left').waitFor({ timeout: 5000 })]).then(() => true, () => false);
  log(undone, 'undo discards the shot, keeps 12 left and the film wound');
  await alice.page.waitForFunction(() => { const v = document.querySelector('video'); return v && v.videoWidth > 0 && !v.classList.contains('opacity-0'); }, null, { timeout: 15000 });

  // the real first shot: no preview, just an undeveloped frame + optional note
  await alice.page.getByRole('button', { name: /^Take photo/ }).click();
  await alice.page.getByText('undeveloped', { exact: true }).waitFor();
  log((await alice.page.locator('img[alt="Your photo with the film effect"]').count()) === 0, 'no preview after the shutter');
  await shot(alice.page, '07-note');
  await noteAndDone(alice.page, 'Morning coffee before work');
  await alice.page.getByLabel('11 exposures left').waitFor({ timeout: 15000 });
  await shot(alice.page, '08-back-to-camera');
  log(true, 'exposure counter shows 11 left and the film needs winding again');

  // more shots through the phone-camera fallback input (fresh files)
  const photos = await makePhotos(alice.page, 11);
  // offline: the shot waits on the phone and uploads by itself when the connection returns
  console.log('Offline shot');
  await alice.ctx.setOffline(true);
  await alice.page.getByText('Offline — shots will wait on your phone').waitFor();
  await wind(alice.page);
  await alice.page.getByRole('button', { name: /^Take photo/ }).click();
  await alice.page.getByText(/Offline — it’ll wait on your phone/).waitFor();
  await noteAndDone(alice.page, 'Alice frame 2');
  await alice.page.getByText(/1 waiting to upload/).waitFor({ timeout: 20000 });
  log(await alice.page.getByLabel('10 exposures left').count() > 0, 'offline: shot kept on the phone and already counted');
  await shot(alice.page, '08c-offline-waiting');
  await alice.ctx.setOffline(false);
  await alice.page.getByText(/waiting to upload/).waitFor({ state: 'detached', timeout: 60000 });
  await alice.page.getByText(/offline shot is on the roll now/).waitFor({ timeout: 10000 });
  log(true, 'back online: the waiting shot uploaded by itself');

  for (let i = 1; i < 5; i++) await shootFile(alice.page, photos[i], `Alice frame ${i + 2}`);
  await savesSettled(alice.page);
  log(true, 'alice added 6 photos (Done returned to the camera immediately; saves finished in the background)');

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

  console.log('Bob shoots the last 6 (phone-camera fallback input)');
  await bob.page.goto(`${BASE}/camera?g=${gid}`);
  for (let i = 0; i < 6; i++) await shootFile(bob.page, photos[5 + i] ?? photos[0], `Bob frame ${i + 1}`);
  await bob.page.getByText(/last shot/).waitFor();
  await savesSettled(bob.page);
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
  log(true, 'encrypted photos are unlocked on Bob’s phone');
  // What the server actually holds: sealed bytes and no readable caption.
  const stored = await bob.page.evaluate(async ([gid, rid, fs, base]) => {
    const h = { Authorization: 'Bearer owner' };
    const list = await fetch(`${fs}/v1/projects/demo-filmroll/databases/(default)/documents/groups/${gid}/rolls/${rid}/photos?pageSize=50`, { headers: h }).then((x) => x.json());
    const out = [];
    for (const d of list.documents) {
      const f = d.fields;
      const path = f.original.mapValue.fields.path.stringValue;
      const st = base.startsWith('https') ? base : 'http://127.0.0.1:9199';
      const bytes = new Uint8Array(await fetch(`${st}/v0/b/demo-filmroll.appspot.com/o/${encodeURIComponent(path)}?alt=media`, { headers: h }).then((x) => x.arrayBuffer()));
      out.push({ caption: f.caption.stringValue, sealedNote: !!f.noteEnc, head: String.fromCharCode(...bytes.slice(0, 4)), jpeg: bytes[0] === 0xff && bytes[1] === 0xd8 });
    }
    return out;
  }, [gid, rid, FIRESTORE, BASE]);
  log(stored.length === 12 && stored.every((p) => p.head === 'FRE1' && !p.jpeg), `storage holds only sealed files (${stored.filter((p) => p.head === 'FRE1').length}/12), not images`);
  log(stored.every((p) => p.caption === '' && p.sealedNote), 'the database holds no readable notes, only sealed ones');
  log((await bob.page.locator('img[src^="blob:"]').count()) >= 12, 'all 12 photos load after development');
  // shareable reveal clip (made on the device; downloads where there's no share sheet)
  await bob.page.evaluate(() => { navigator.canShare = undefined; });
  await bob.page.getByRole('button', { name: 'Share the reveal' }).click();
  const [dl] = await Promise.all([bob.page.waitForEvent('download', { timeout: 60000 }), bob.page.getByRole('button', { name: 'Make video' }).click()]);
  const clipPath = `${SHOTS}/reveal-clip.${dl.suggestedFilename().split('.').pop()}`;
  await dl.saveAs(clipPath);
  const { statSync } = await import('node:fs');
  const size = statSync(clipPath).size;
  log(size > 50_000 && /\.(mp4|webm)$/.test(clipPath), `reveal clip made on the device (${dl.suggestedFilename()}, ${Math.round(size / 1024)} KB)`);
  await bob.page.waitForTimeout(500);
  await bob.page.mouse.wheel(0, -3000);
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

  console.log('Bob on a new phone: keys come from a friend’s phone');
  const bob2 = await newUser('Bob2');
  await bob2.page.goto(`${BASE}/signin?next=${encodeURIComponent(`/g/${gid}/r/${rid}`)}`);
  await bob2.page.getByLabel('Email').fill(bobEmail);
  await bob2.page.getByLabel('Password').fill('password123');
  await bob2.page.getByRole('button', { name: 'Sign in' }).click();
  await bob2.page.getByRole('heading', { name: 'Contact sheet' }).or(bob2.page.getByRole('button', { name: 'Open the album' })).waitFor({ timeout: 20000 });
  if (await bob2.page.getByRole('button', { name: 'Open the album' }).isVisible()) await bob2.page.getByRole('button', { name: 'Open the album' }).click();
  // Alice's app (open in another tab) answers the key request.
  await alice.page.goto(`${BASE}/groups`);
  await bob2.page.waitForFunction(() => document.querySelectorAll('img[src^="blob:"]').length >= 3, null, { timeout: 45000 });
  log(true, 'a new device gets the keys from a friend’s open app and unlocks the photos');
  await shot(bob2.page, '15b-new-device-unlocked');
  await bob2.ctx.close();
  pages.splice(pages.findIndex(([n]) => n === 'Bob2'), 1);

  console.log('Recovery code');
  await alice.page.goto(BASE + '/profile');
  await alice.page.getByRole('button', { name: 'Make a recovery code' }).click();
  const recovery = (await alice.page.getByTestId('recovery-code').textContent({ timeout: 20000 })).trim();
  log(/^([A-Z2-9]{4}-){5}[A-Z2-9]{4}$/.test(recovery), 'a recovery code is shown once');
  await shot(alice.page, '19c-recovery-code');
  await alice.page.getByRole('button', { name: 'I’ve saved it' }).click();
  await alice.page.getByText(/Backed up with your recovery code/).waitFor({ timeout: 20000 });
  const alice2 = await newUser('Alice2');
  await alice2.page.goto(`${BASE}/signin?next=%2Fprofile`);
  await alice2.page.getByLabel('Email').fill(aliceEmail);
  await alice2.page.getByLabel('Password').fill('password123');
  await alice2.page.getByRole('button', { name: 'Sign in' }).click();
  await alice2.page.getByRole('button', { name: 'Enter recovery code' }).click();
  await alice2.page.getByPlaceholder('ABCD-EFGH-…').fill('AAAA-BBBB-CCCC-DDDD-EEEE-FFFF');
  await alice2.page.getByRole('button', { name: 'Unlock my photos' }).click();
  await alice2.page.getByText('That recovery code doesn’t match').waitFor({ timeout: 20000 });
  await alice2.page.getByPlaceholder('ABCD-EFGH-…').fill(recovery.toLowerCase());
  await alice2.page.getByRole('button', { name: 'Unlock my photos' }).click();
  await alice2.page.getByText(/Restored \d+ keys?/).waitFor({ timeout: 20000 });
  log(true, 'the recovery code restores the keys on a new phone (and a wrong code is refused)');
  await alice2.ctx.close();
  pages.splice(pages.findIndex(([n]) => n === 'Alice2'), 1);

  console.log('Alice sees the developed roll + notifications');
  await alice.page.goto(BASE + '/groups');
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
  await alice.page.waitForTimeout(800);
  log((await alice.page.getByRole('link', { name: 'Analytics' }).count()) === 0, 'analytics link hidden for non-admins');
  await shot(alice.page, '19-profile');
  await alice.page.getByRole('link', { name: 'About FilmRoll' }).click();
  await alice.page.getByRole('heading', { name: 'How it works' }).waitFor();
  await shot(alice.page, '19b-about');
  log(true, 'About FilmRoll page opens from Profile');
  await alice.page.goto(BASE + '/admin');
  await alice.page.getByText('Not available').first().waitFor();
  log(true, 'analytics page refuses non-admins (server-side)');
  // winding is optional
  await alice.page.goto(BASE + '/profile');
  await alice.page.getByRole('switch', { name: /Wind the film before each shot/ }).click();
  await alice.page.waitForTimeout(500);
  await alice.page.goto(`${BASE}/g/${gid}/new-roll`);
  await alice.page.getByLabel('Roll name').fill('No-wind roll');
  await alice.page.getByRole('radio', { name: '12 photos' }).click();
  await alice.page.getByRole('radio', { name: /When the roll is full/ }).click();
  await alice.page.getByRole('button', { name: 'Load 12 exposures' }).click();
  await alice.page.waitForURL(new RegExp(`/g/${gid}$`));
  await alice.page.goto(`${BASE}/camera?g=${gid}`);
  await alice.page.waitForFunction(() => { const v = document.querySelector('video'); return v && v.videoWidth > 0 && !v.classList.contains('opacity-0'); }, null, { timeout: 15000 });
  log((await alice.page.getByRole('slider', { name: 'Wind the film' }).count()) === 0, 'with winding off there is no wheel');
  await alice.page.getByRole('button', { name: /^Take photo/ }).click();
  await alice.page.getByText('undeveloped', { exact: true }).waitFor();
  log(true, 'with winding off the shutter fires straight away');
  await noteAndDone(alice.page, 'no wind');
  await savesSettled(alice.page);

  console.log('Roll switcher on the shutter view');
  await alice.page.goto(BASE + '/g/new');
  await alice.page.getByLabel('Group name').fill('Second Crew');
  await alice.page.getByRole('button', { name: 'Create group' }).click();
  await alice.page.waitForURL(/\/g\/[^/]+\?invite=1/);
  const gid2 = new URL(alice.page.url()).pathname.split('/')[2];
  await alice.page.goto(`${BASE}/g/${gid2}/new-roll`);
  await alice.page.getByLabel('Roll name').fill('Weekend roll');
  await alice.page.getByRole('radio', { name: '12 photos' }).click();
  await alice.page.getByRole('radio', { name: /When the roll is full/ }).click();
  await alice.page.getByRole('button', { name: 'Load 12 exposures' }).click();
  await alice.page.waitForURL(new RegExp(`/g/${gid2}$`));
  await alice.page.goto(BASE + '/');
  await alice.page.getByRole('button', { name: /Switch roll/ }).click();
  await shot(alice.page, '21-roll-switcher');
  await alice.page.getByRole('button', { name: /Weekend roll/ }).click();
  await alice.page.getByRole('button', { name: /Shooting on Second Crew, Weekend roll/ }).waitFor();
  await alice.page.reload();
  await alice.page.getByRole('button', { name: /Shooting on Second Crew, Weekend roll/ }).waitFor();
  log(true, 'switching rolls from the shutter view sticks');
  await alice.page.getByRole('navigation', { name: 'Main' }).getByRole('button', { name: /^Take photo/ }).click();
  await noteAndDone(alice.page, 'plain group shot');
  await savesSettled(alice.page);
  await alice.page.getByLabel('11 exposures left').waitFor({ timeout: 15000 });
  log(true, 'groups without encryption still shoot normally (unencrypted upload)');
  await shot(alice.page, '22-home-camera');
  await alice.page.goto(BASE + '/groups');
  await alice.page.getByRole('heading', { name: 'Groups' }).waitFor();
  await shot(alice.page, '23-groups');

  console.log('Reduced motion');
  const calm = await browser.newContext({ ...phone, reducedMotion: 'reduce' });
  await calm.addInitScript(SKIP_INSTALL);
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


} catch (e) {
  failures++;
  console.error(e);
  for (const [n, p] of pages) await p.screenshot({ path: `${SHOTS}/fail-${n}.png` }).catch(() => undefined);
}
console.log('\nConsole errors:', errors.length ? '\n' + errors.join('\n') : 'none');
console.log(failures ? `\n${failures} failure(s)` : '\nAll browser checks passed');
await browser.close();
process.exit(failures || errors.length ? 1 : 0);
