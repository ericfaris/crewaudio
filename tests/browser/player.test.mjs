import test from 'node:test';
import assert from 'node:assert/strict';
import { makeAudioLibrary, makeQuizDir, addTypedBook, startServer, cleanup, findChromium } from '../helpers.mjs';

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
  addTypedBook(audioDir, 'Some Album', 'music', 2);
  server = await startServer(audioDir, { quizDir: makeQuizDir([1]) });
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
    try { return JSON.parse(localStorage['study.progress'])['Test Book/01 - Chapter 1.mp3']?.t > 6; }
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

// ---- chapter review quiz ------------------------------------------------
async function finishChapterWithQuiz(page) {
  await page.click('#groups li'); // chapter 1 has a quiz fixture
  await page.waitForFunction(() => !document.querySelector('#audio').paused, null, { timeout: 6000 });
  await page.waitForSelector('#quiz-note:not([hidden])', { timeout: 4000 });
  await page.evaluate(() => { const a = document.querySelector('#audio'); a.currentTime = a.duration - 0.2; });
  await page.waitForSelector('#quiz:not([hidden])', { timeout: 8000 });
}

suite('a heads-up note appears while a chapter with a quiz is playing', async () => {
  const page = await freshPage();
  await page.click('#groups li');
  await page.waitForFunction(() => !document.querySelector('#audio').paused, null, { timeout: 6000 });
  assert.equal(await page.isVisible('#quiz-note'), true);

  // chapter 3 has no quiz fixture -> no note
  const items = await page.$$('#groups li');
  await items[2].click();
  await page.waitForTimeout(400);
  assert.equal(await page.isVisible('#quiz-note'), false);
});

suite('the quiz opens when the chapter audio finishes', async () => {
  const page = await freshPage();
  await finishChapterWithQuiz(page);
  const n = await page.evaluate(() => document.querySelectorAll('#quiz-list > li').length);
  assert.equal(n, 10, 'quiz should show all 10 questions');
});

suite('clicking a choice immediately shows right/wrong and an explanation (regression)', async () => {
  const page = await freshPage();
  await finishChapterWithQuiz(page);

  // Q1 fixture: answer index 0 ("alpha") is correct. Pick a wrong one first.
  const q1 = () => page.locator('#quiz-list > li').nth(0);
  await q1().locator('.q-choice').nth(1).locator('input').check();
  await page.waitForSelector('#quiz-list > li:first-child .q-verdict:not([hidden])', { timeout: 2000 });
  assert.match(await q1().locator('.q-verdict').textContent(), /Not quite/);
  assert.ok(await q1().locator('.q-choice.right').count() === 1, 'correct choice is marked');
  assert.ok(await q1().locator('.q-choice.wrong').count() === 1, 'chosen wrong choice is marked');
  assert.notEqual((await q1().locator('.q-explain').textContent()).trim(), '', 'explanation is revealed');
  // the question locks — further clicks do nothing
  assert.equal(await q1().locator('input:disabled').count(), 4);

  // Q2 fixture: answer index 1 ("bravo") is correct. Pick it.
  const q2 = page.locator('#quiz-list > li').nth(1);
  await q2.locator('.q-choice').nth(1).locator('input').check();
  await page.waitForSelector('#quiz-list > li:nth-child(2) .q-verdict:not([hidden])', { timeout: 2000 });
  assert.match(await q2.locator('.q-verdict').textContent(), /Correct/);
});

suite('finishing all questions records a score and offers Continue', async () => {
  const page = await freshPage();
  await finishChapterWithQuiz(page);

  // answer every question with its first choice
  const items = await page.$$('#quiz-list > li');
  for (const li of items) await li.$eval('.q-choice input', (el) => el.click());

  await page.waitForSelector('#quiz-continue:not([hidden])', { timeout: 3000 });
  const score = await page.textContent('#quiz-score');
  assert.match(score, /\/\s*10/);

  const stored = await page.evaluate(() => JSON.parse(localStorage['study.quiz'] || '{}'));
  const rec = stored['Test Book/01 - Chapter 1.mp3'];
  assert.ok(rec && rec.total === 10 && Number.isInteger(rec.best), 'score persisted to localStorage');

  // sidebar shows a quiz badge now
  assert.ok(await page.locator('#groups .quiz-badge').count() >= 1);

  // Continue closes the quiz
  await page.click('#quiz-continue');
  assert.equal(await page.locator('#quiz').evaluate((el) => el.hidden), true);
});

suite('closing the quiz with ✕ does not advance the track', async () => {
  const page = await freshPage();
  await finishChapterWithQuiz(page);
  const before = await page.evaluate(() => document.querySelector('#audio').src);
  await page.click('#quiz-close');
  assert.equal(await page.locator('#quiz').evaluate((el) => el.hidden), true);
  assert.equal(await page.evaluate(() => document.querySelector('#audio').src), before);
});

suite('the quiz can be retaken any number of times, before or after the audio', async () => {
  const page = await freshPage();
  // 1) take it on demand mid-listen via the button (no waiting for the audio to end)
  await page.click('#groups li');
  await page.waitForFunction(() => !document.querySelector('#audio').paused, null, { timeout: 6000 });
  await page.waitForSelector('#quiz-open:not([hidden])', { timeout: 3000 });
  await page.click('#quiz-open');
  await page.waitForSelector('#quiz:not([hidden])', { timeout: 3000 });
  assert.equal(await page.evaluate(() => document.querySelector('#audio').paused), true, 'opening the quiz pauses audio');

  const answerAll = async () => {
    const items = await page.$$('#quiz-list > li');
    for (const li of items) await li.$eval('.q-choice input', (el) => el.click());
    await page.waitForSelector('#quiz-continue:not([hidden])', { timeout: 3000 });
  };

  // attempt 1
  await answerAll();
  await page.click('#quiz-retry');           // "Try again" -> immediate retake
  await page.waitForSelector('#quiz-list > li:first-child .q-choice input:not(:disabled)', { timeout: 2000 });

  // attempt 2
  await answerAll();
  await page.click('#quiz-continue');
  assert.equal(await page.locator('#quiz').evaluate((el) => el.hidden), true);

  // the button now offers a retake and shows the best score
  await page.waitForFunction(() => /Retake/.test(document.querySelector('#quiz-open').textContent), null, { timeout: 3000 });
  assert.match(await page.textContent('#quiz-open'), /best \d+\/10/);

  // attempt 3 via the button
  await page.click('#quiz-open');
  await page.waitForSelector('#quiz:not([hidden])', { timeout: 3000 });
  assert.equal(await page.evaluate(() => document.querySelectorAll('#quiz-list > li').length), 10);
});

// ---- library hierarchy (Type -> playlist -> track) & music-only shuffle ----
suite('the sidebar groups by type, and shuffle only appears for music', async () => {
  const page = await freshPage();

  const headings = await page.$$eval('.type-head', (els) => els.map((e) => e.textContent));
  assert.deepEqual(headings, ['Books', 'Music']);

  // "Test Book" (no .type marker) plays with no shuffle control
  await playFirstTrack(page);
  assert.equal(await page.isVisible('#shuffle'), false);

  // "Some Album" is typed "music" -> shuffle appears
  const albumTrack = page.locator('#groups li', { hasText: '01 - Track 1' });
  await albumTrack.click();
  await page.waitForFunction(() => !document.querySelector('#audio').paused, null, { timeout: 6000 });
  assert.equal(await page.isVisible('#shuffle'), true);

  // switching back to the book hides it again
  await page.locator('#groups li', { hasText: 'Chapter 1.mp3' }).click();
  await page.waitForFunction(() => !document.querySelector('#audio').paused, null, { timeout: 6000 });
  assert.equal(await page.isVisible('#shuffle'), false);
});

suite('shuffle toggles on click and persists across reload (music only)', async () => {
  const page = await freshPage();
  await page.locator('#groups li', { hasText: '01 - Track 1' }).click();
  await page.waitForFunction(() => !document.querySelector('#audio').paused, null, { timeout: 6000 });

  assert.equal(await page.evaluate(() => localStorage.getItem('study.shuffle')), null);
  await page.click('#shuffle');
  assert.equal(await page.evaluate(() => document.querySelector('#shuffle').classList.contains('active')), true);
  assert.equal(await page.evaluate(() => localStorage.getItem('study.shuffle')), '1');

  await page.reload({ waitUntil: 'networkidle' });
  await page.locator('#groups li', { hasText: '02 - Track 2' }).click();
  await page.waitForFunction(() => !document.querySelector('#audio').paused, null, { timeout: 6000 });
  assert.equal(await page.evaluate(() => document.querySelector('#shuffle').classList.contains('active')), true);
});
