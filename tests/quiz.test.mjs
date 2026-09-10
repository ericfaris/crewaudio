import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, makeAudioLibrary, makeQuizDir, startServer, cleanup } from './helpers.mjs';

const QUIZ_DIR = path.join(ROOT, 'data', 'quizzes');
const AUDIO_BOOK = path.join(ROOT, 'audio', 'Cry, the Beloved Country Chapter Audios');

const quizFiles = fs.existsSync(QUIZ_DIR)
  ? fs.readdirSync(QUIZ_DIR).filter((f) => f.endsWith('.json')).sort()
  : [];

test('there is at least one chapter quiz', () => {
  assert.ok(quizFiles.length > 0, 'expected data/quizzes/NN.json files');
});

for (const file of quizFiles) {
  test(`quiz ${file} is well-formed`, () => {
    const n = Number(path.basename(file, '.json'));
    assert.ok(/^\d{2}\.json$/.test(file), 'filename must be a zero-padded number, e.g. 07.json');
    assert.ok(Number.isInteger(n) && n >= 1, 'filename must be a positive integer');

    const quiz = JSON.parse(fs.readFileSync(path.join(QUIZ_DIR, file), 'utf8'));
    assert.equal(quiz.chapter, n, 'quiz.chapter must match the filename number');
    assert.equal(typeof quiz.title, 'string');
    assert.ok(Array.isArray(quiz.questions), 'questions must be an array');
    assert.equal(quiz.questions.length, 10, 'each chapter must have exactly 10 questions');

    quiz.questions.forEach((q, i) => {
      const where = `${file} q${i + 1}`;
      assert.equal(typeof q.q, 'string', `${where}: q must be a string`);
      assert.ok(q.q.trim().length > 5, `${where}: q looks empty`);
      assert.ok(Array.isArray(q.choices) && q.choices.length === 4, `${where}: need exactly 4 choices`);
      assert.ok(q.choices.every((c) => typeof c === 'string' && c.trim()), `${where}: choices must be non-empty strings`);
      assert.equal(new Set(q.choices).size, 4, `${where}: choices must be distinct`);
      assert.ok(Number.isInteger(q.answer) && q.answer >= 0 && q.answer <= 3, `${where}: answer must be 0-3`);
      assert.ok(typeof q.explain === 'string' && q.explain.trim().length > 5, `${where}: explain must be a non-empty string`);
    });
  });
}

test('every quiz maps to a real audio chapter (no orphan quizzes)', { skip: !fs.existsSync(AUDIO_BOOK) }, () => {
  const tracks = fs.readdirSync(AUDIO_BOOK).filter((f) => f.toLowerCase().endsWith('.mp3')).length;
  for (const file of quizFiles) {
    const n = Number(path.basename(file, '.json'));
    assert.ok(n <= tracks, `${file}: chapter ${n} but the book has only ${tracks} audio tracks`);
  }
});

// ---- API behaviour ------------------------------------------------------
let audioDir, server;
test.before(async () => {
  audioDir = makeAudioLibrary(3);
  server = await startServer(audioDir, { quizDir: makeQuizDir([1, 2]) });
});
test.after(() => { server?.close(); cleanup(audioDir); });

test('GET /api/quiz?n=1 returns a quiz with 10 questions', async () => {
  const r = await fetch(`${server.origin}/api/quiz?n=1`);
  assert.equal(r.status, 200);
  const quiz = await r.json();
  assert.equal(quiz.chapter, 1);
  assert.equal(quiz.questions.length, 10);
  assert.ok(quiz.questions[0].choices.length === 4);
});

test('GET /api/quiz for a chapter with no quiz is 404', async () => {
  const r = await fetch(`${server.origin}/api/quiz?n=9`);
  assert.equal(r.status, 404);
});

test('GET /api/quiz with a bad or missing n is 400', async () => {
  assert.equal((await fetch(`${server.origin}/api/quiz`)).status, 400);
  assert.equal((await fetch(`${server.origin}/api/quiz?n=abc`)).status, 400);
  assert.equal((await fetch(`${server.origin}/api/quiz?n=0`)).status, 400);
});

test('quiz lookup cannot escape the quiz directory', async () => {
  const r = await fetch(`${server.origin}/api/quiz?n=-1`);
  assert.equal(r.status, 400);
});
