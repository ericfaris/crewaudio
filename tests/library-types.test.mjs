import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { startServer, cleanup } from './helpers.mjs';

// listAudioFiles only cares about extension, not real audio content, so a
// stub file is enough here — no need for ffmpeg-synthesized fixtures.
function makeLibrary() {
  const dir = mkdtempSync(path.join(tmpdir(), 'study-types-'));
  for (const [book, type] of [['Test Book', null], ['Album One', 'music'], ['Misc Clips', 'other']]) {
    const bookDir = path.join(dir, book);
    mkdirSync(bookDir, { recursive: true });
    writeFileSync(path.join(bookDir, '01 - Track.mp3'), '');
    if (type) writeFileSync(path.join(bookDir, '.type'), type);
  }
  return dir;
}

let libraryDir, server;

test.before(async () => {
  libraryDir = makeLibrary();
  server = await startServer(libraryDir);
});
test.after(() => { server?.close(); cleanup(libraryDir); });

test('GET /api/files: folderTypes defaults missing markers to "book" and reads real ones', async () => {
  const { folderTypes } = await (await fetch(`${server.origin}/api/files`)).json();
  assert.deepEqual(folderTypes, {
    'Test Book': 'book',
    'Album One': 'music',
    'Misc Clips': 'other',
  });
});

test('GET /api/files: an invalid .type value falls back to "book"', async () => {
  writeFileSync(path.join(libraryDir, 'Misc Clips', '.type'), 'not-a-real-type');
  const { folderTypes } = await (await fetch(`${server.origin}/api/files`)).json();
  assert.equal(folderTypes['Misc Clips'], 'book');
  writeFileSync(path.join(libraryDir, 'Misc Clips', '.type'), 'other'); // restore for any later test
});

test('GET /api/import/inspect requires a url', async () => {
  const r = await fetch(`${server.origin}/api/import/inspect`);
  assert.equal(r.status, 400);
});

test('GET /api/import/inspect rejects a non-YouTube url without spawning yt-dlp', async () => {
  const r = await fetch(`${server.origin}/api/import/inspect?` + new URLSearchParams({ url: 'https://evil.example.com/' }));
  assert.equal(r.status, 400);
  const { error } = await r.json();
  assert.match(error, /not a YouTube host/);
});
