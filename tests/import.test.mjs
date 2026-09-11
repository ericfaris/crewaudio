import test from 'node:test';
import assert from 'node:assert/strict';
import { assertYoutubeUrl } from '../import.js';

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
