import test from 'node:test';
import assert from 'node:assert/strict';
import { makeAudioLibrary, startServer, cleanup, findChromium } from '../helpers.mjs';

const chromiumPath = findChromium();
const suite = chromiumPath ? test : test.skip;
if (!chromiumPath) {
  console.warn('· browser tests skipped — run `npx playwright install chromium`');
}

let audioDir, server, browser, chromium;

test.before(async () => {
  if (!chromiumPath) return;
  ({ chromium } = await import('playwright-core'));
  audioDir = makeAudioLibrary(3);
  server = await startServer(audioDir);
  browser = await chromium.launch({ executablePath: chromiumPath });
});
test.after(async () => {
  await browser?.close();
  server?.close();
  if (audioDir) cleanup(audioDir);
});

async function freshPage() {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.errors = errors;
  await page.goto(server.origin, { waitUntil: 'networkidle' });
  return page;
}

const isPlaying = () => !document.querySelector('#audio').paused;
const isPaused = () => document.querySelector('#audio').paused;
const label = () => document.querySelector('#playpause').textContent;
const audioSnap = (page) => page.evaluate(() => {
  const a = document.querySelector('#audio');
  return { paused: a.paused, time: +a.currentTime.toFixed(2), src: a.src,
    label: document.querySelector('#playpause').textContent,
    mediaError: a.error ? a.error.code : null };
});

async function playFirstTrack(page) {
  await page.click('#groups li');
  await page.waitForFunction(
    () => { const a = document.querySelector('#audio'); return !a.paused && a.currentTime > 0; },
    null, { timeout: 6000 });
}

suite('clicking a track starts playback', async () => {
  const page = await freshPage();
  await playFirstTrack(page);
  const s = await audioSnap(page);
  assert.equal(s.paused, false);
  assert.equal(s.mediaError, null, 'no media error');
  assert.equal(s.label, '⏸');
  assert.deepEqual(page.errors, []);
});

suite('the play/pause button toggles playback (regression)', async () => {
  const page = await freshPage();
  await playFirstTrack(page);

  await page.click('#playpause');
  await page.waitForFunction(() => document.querySelector('#audio').paused
    && document.querySelector('#playpause').textContent === '▶', null, { timeout: 3000 });

  await page.click('#playpause');
  await page.waitForFunction(() => !document.querySelector('#audio').paused
    && document.querySelector('#playpause').textContent === '⏸', null, { timeout: 3000 });
});

suite('the spacebar toggles playback from anywhere (regression)', async () => {
  const page = await freshPage();
  await playFirstTrack(page);

  await page.evaluate(() => (document.activeElement || document.body).blur());
  await page.keyboard.press('Space');
  await page.waitForFunction(isPaused, null, { timeout: 3000 });

  await page.keyboard.press('Space');
  await page.waitForFunction(isPlaying, null, { timeout: 3000 });
});

suite('spacebar does NOT toggle while typing in the import field', async () => {
  const page = await freshPage();
  await playFirstTrack(page);

  await page.click('#yt-url');
  await page.keyboard.type('hello world');
  assert.equal((await audioSnap(page)).paused, false, 'still playing while typing');
  assert.equal(await page.inputValue('#yt-url'), 'hello world');
});

suite('next / prev move through the book', async () => {
  const page = await freshPage();
  await playFirstTrack(page);

  await page.click('#next');
  await page.waitForFunction(
    () => document.querySelector('#audio').src.includes('02%20-%20Chapter%202'),
    null, { timeout: 4000 });

  await page.click('#prev');
  await page.waitForFunction(
    () => document.querySelector('#audio').src.includes('01%20-%20Chapter%201'),
    null, { timeout: 4000 });
});

suite('progress is saved and the last track is restored on reload', async () => {
  const page = await freshPage();
  await page.uncheck('#autoplay'); // don't let auto-advance move us off track 1
  await playFirstTrack(page);

  // jump past the 5s "don't resume tiny offsets" threshold, then let a save tick fire
  await page.evaluate(() => { document.querySelector('#audio').currentTime = 7; });
  await page.waitForFunction(() => {
    try { return JSON.parse(localStorage['crewaudio.progress'])['Test Book/01 - Chapter 1.mp3']?.t > 6; }
    catch { return false; }
  }, null, { timeout: 6000 });

  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForFunction(() => {
    const a = document.querySelector('#audio');
    return a.src.includes('01%20-%20Chapter%201') && a.readyState >= 1;
  }, null, { timeout: 6000 });

  const s = await audioSnap(page);
  assert.equal(s.paused, true, 'restored track should not auto-play');
  assert.ok(s.time > 6, `expected resume near 7s, got ${s.time}`);
});

suite('mini mode collapses the library but keeps transport usable', async () => {
  const page = await freshPage();
  await page.click('#mini-toggle');
  assert.equal(await page.isVisible('#library'), false);
  assert.equal(await page.isVisible('#playpause'), true);
  await page.click('#mini-toggle');
  assert.equal(await page.isVisible('#library'), true);
});
