import test from 'node:test';
import assert from 'node:assert/strict';
import { assertYoutubeUrl, guessType } from '../import.js';

// study.mooseflip.com has no login, so this validation is the only thing
// standing between the public internet and a `spawn(yt-dlp, [..., url])`
// call. See the security note in ../import.js for the full threat model.

test('assertYoutubeUrl accepts known YouTube hosts', () => {
  for (const url of [
    'https://www.youtube.com/watch?v=abc123',
    'https://youtube.com/playlist?list=xyz',
    'http://m.youtube.com/watch?v=abc123',
    'https://music.youtube.com/watch?v=abc123',
    'https://youtu.be/abc123',
  ]) {
    assert.equal(assertYoutubeUrl(url), new URL(url).toString());
  }
});

test('assertYoutubeUrl rejects non-YouTube hosts (SSRF)', () => {
  for (const url of [
    'https://evil.example.com/',
    'https://localhost:8250/api/import',
    'http://169.254.169.254/latest/meta-data/',
    'https://youtube.com.evil.com/',
  ]) {
    assert.throws(() => assertYoutubeUrl(url), /not a YouTube host/);
  }
});

test('assertYoutubeUrl rejects non-http(s) schemes', () => {
  for (const url of ['javascript:alert(1)', 'file:///etc/passwd', 'ftp://youtube.com/x']) {
    assert.throws(() => assertYoutubeUrl(url));
  }
});

test('assertYoutubeUrl rejects flag-like / unparseable input (argv injection)', () => {
  for (const bad of ['--exec=touch /tmp/pwned', '-o', '', undefined, null]) {
    assert.throws(() => assertYoutubeUrl(bad));
  }
});

test('guessType: title/uploader keywords win regardless of duration', () => {
  assert.equal(guessType({ title: 'The Great Novel (Unabridged Audiobook)', entries: [{ duration: 120 }] }), 'book');
  assert.equal(guessType({ title: 'Narrated by a robot', entries: [] }), 'book');
  assert.equal(guessType({ title: 'Greatest Hits (Full Album)', entries: [{ duration: 3600 }] }), 'music');
  assert.equal(guessType({ uploader: 'Some Records - Official Audio channel', entries: [] }), 'music');
});

test('guessType: falls back to duration heuristic with no keyword match', () => {
  // many short tracks -> music (an album)
  const shortTracks = Array.from({ length: 12 }, () => ({ duration: 210 })); // 3.5 min avg
  assert.equal(guessType({ title: 'My Playlist', entries: shortTracks }), 'music');

  // few long tracks -> book (a chaptered audiobook)
  const longTracks = Array.from({ length: 8 }, () => ({ duration: 20 * 60 }));
  assert.equal(guessType({ title: 'Some Lectures', entries: longTracks }), 'book');
});

test('guessType: defaults to "book" with no signal at all', () => {
  assert.equal(guessType({}), 'book');
  assert.equal(guessType({ title: 'untitled', entries: [] }), 'book');
});
