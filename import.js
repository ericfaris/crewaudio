#!/usr/bin/env node
// Download audio from a YouTube video/playlist into audio/<playlist>/ as mp3.
// Usage: node import.js <url> [--name "Folder Name"]
import { spawn } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const AUDIO_DIR = path.join(__dirname, 'audio');

export function findYtDlp() {
  const candidates = [
    process.env.YT_DLP,
    path.join(process.env.HOME || '', '.local/bin/yt-dlp'),
    '/usr/local/bin/yt-dlp',
    '/usr/bin/yt-dlp',
    'yt-dlp',
  ].filter(Boolean);
  for (const c of candidates) {
    if (c === 'yt-dlp') return c;
    try { fs.accessSync(c, fs.constants.X_OK); return c; } catch {}
  }
  return 'yt-dlp';
}

function sanitize(s) {
  return String(s).replace(/[/\\?%*:|"<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, 120);
}

// study.mooseflip.com has no login (it's meant to stay public), so this is the
// only gate between the internet and a `spawn(yt-dlp, [..., url])` call.
// Reject anything that isn't an http(s) YouTube URL *before* it reaches
// yt-dlp's argv — otherwise a value like "--exec=..." would be parsed as a
// yt-dlp option instead of a URL (yt-dlp has options that read/write files
// and run commands), and any other host would let yt-dlp be used as an SSRF
// probe into the LAN.
const ALLOWED_YOUTUBE_HOSTS = new Set([
  'youtube.com', 'www.youtube.com', 'm.youtube.com',
  'music.youtube.com', 'youtu.be',
]);

export function assertYoutubeUrl(raw) {
  let u;
  try { u = new URL(String(raw)); } catch { throw new Error('not a valid URL'); }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') {
    throw new Error('URL must be http(s)');
  }
  if (!ALLOWED_YOUTUBE_HOSTS.has(u.hostname.toLowerCase())) {
    throw new Error(`URL host "${u.hostname}" is not a YouTube host`);
  }
  // Re-serialize the parsed URL rather than trusting the raw string: this
  // guarantees what we hand to yt-dlp always starts with "http(s)://" and can
  // never be interpreted as a flag, independent of the "--" below.
  return u.toString();
}

// Resolve playlist/video metadata (title, uploader, per-entry durations) via
// a fast --flat-playlist call — no download. Shared by getTitle and
// inspectPlaylist so both read the same yt-dlp call.
function fetchPlaylistMeta(bin, url) {
  return new Promise((resolve) => {
    const p = spawn(bin, ['--flat-playlist', '--no-warnings', '-J', '--', url]);
    let out = '';
    p.stdout.on('data', (d) => (out += d));
    p.on('close', () => {
      try { resolve(JSON.parse(out)); } catch { resolve({}); }
    });
    p.on('error', () => resolve({}));
  });
}

function getTitle(bin, url) {
  return fetchPlaylistMeta(bin, url)
    .then((j) => sanitize(j.title || j.playlist_title || j.id || 'youtube-import'));
}

export const LIBRARY_TYPES = new Set(['book', 'music', 'other']);

// Guess whether a playlist is an audiobook, a music album/playlist, or
// neither — from its own title/uploader text and per-entry durations.
// Keyword matches (either direction) win over the duration heuristic;
// with neither, default to "book" (the app's original purpose).
export function guessType({ title = '', uploader = '', entries = [] } = {}) {
  const text = `${title} ${uploader}`.toLowerCase();
  if (/\b(audiobook|audio book|unabridged|narrat\w*|full book|complete book|novel)\b/.test(text)) return 'book';
  if (/\b(album|full album|ep\b|music video|lyrics|official audio|soundtrack|mixtape)\b/.test(text)) return 'music';

  const durations = entries.map((e) => e && e.duration).filter((d) => typeof d === 'number' && d > 0);
  if (durations.length) {
    const avg = durations.reduce((a, b) => a + b, 0) / durations.length;
    if (avg <= 12 * 60 && durations.length >= 3) return 'music';
    if (avg >= 15 * 60) return 'book';
  }
  return 'book';
}

/**
 * Fast, no-download lookup for the "confirm before importing" step: resolves
 * the folder name and a suggested library type without invoking a download.
 * @returns {Promise<{folder: string, type: string, trackCount: number}>}
 */
export async function inspectPlaylist(rawUrl) {
  const url = assertYoutubeUrl(rawUrl);
  const bin = findYtDlp();
  const j = await fetchPlaylistMeta(bin, url);
  const entries = Array.isArray(j.entries) ? j.entries : [];
  const folder = sanitize(j.title || j.playlist_title || j.id || 'youtube-import');
  const type = guessType({ title: j.title || '', uploader: j.uploader || j.channel || '', entries });
  return { folder, type, trackCount: entries.length || 1 };
}

/**
 * @param {string} url
 * @param {object} opts { name?, onLine?: (line)=>void }
 * @returns {Promise<{dir: string, folder: string}>}
 */
export async function importPlaylist(rawUrl, opts = {}) {
  const url = assertYoutubeUrl(rawUrl);
  const bin = findYtDlp();
  const folder = sanitize(opts.name || (await getTitle(bin, url)));
  const dir = path.join(AUDIO_DIR, folder);
  fs.mkdirSync(dir, { recursive: true });
  // Written up front (not just on success) so a re-run/retry into the same
  // folder still lands the type the user actually confirmed.
  fs.writeFileSync(path.join(dir, '.type'), LIBRARY_TYPES.has(opts.type) ? opts.type : 'book');

  // Optional Netscape-format cookies file for videos behind YouTube's bot check.
  const cookies = process.env.YT_DLP_COOKIES
    || [path.join(__dirname, 'cookies.txt'), path.join(process.env.HOME || '', '.config/yt-dlp/cookies.txt')]
      .find((f) => { try { return fs.statSync(f).size > 0; } catch { return false; } });

  const args = [
    // yt-dlp needs a JS runtime to solve YouTube's challenges; Node is on PATH.
    '--js-runtimes', process.env.YT_DLP_JS_RUNTIME || 'node',
    // Bound every socket op so one stalled read can't hang the whole import.
    '--socket-timeout', '30',
    // Space out requests a little so YouTube doesn't start throttling mid-playlist.
    '--sleep-interval', '2', '--max-sleep-interval', '5',
    ...(cookies ? ['--cookies', cookies] : []),
    '-x', '--audio-format', 'mp3', '--audio-quality', '0',
    '--embed-metadata', '--embed-thumbnail',
    '--ignore-errors', '--no-overwrites', '--continue',
    '--yes-playlist',
    '--newline',
    '-o', path.join(dir, '%(playlist_index)02d - %(title)s.%(ext)s'),
    '-o', 'chapter:' + path.join(dir, '%(title)s.%(ext)s'),
    '--',
    url,
  ];

  return new Promise((resolve, reject) => {
    const p = spawn(bin, args);
    const handle = (buf) => String(buf).split(/\r?\n/).forEach((l) => l && (opts.onLine ? opts.onLine(l) : process.stdout.write(l + '\n')));
    p.stdout.on('data', handle);
    p.stderr.on('data', handle);
    p.on('error', reject);
    p.on('close', (code) => {
      // Single videos have no playlist_index -> "NA - title.mp3"; tidy that up.
      try {
        for (const f of fs.readdirSync(dir)) {
          if (f.startsWith('NA - ')) fs.renameSync(path.join(dir, f), path.join(dir, f.slice(5)));
        }
      } catch {}
      // yt-dlp exits non-zero if any single item failed; folder may still have tracks.
      const got = fs.existsSync(dir) && fs.readdirSync(dir).some((f) => f.endsWith('.mp3'));
      if (got) resolve({ dir, folder });
      else reject(new Error('no audio downloaded (exit ' + code + ')'));
    });
  });
}

// CLI
if (import.meta.url === `file://${process.argv[1]}`) {
  const argv = process.argv.slice(2);
  const url = argv.find((a) => !a.startsWith('--'));
  const nameIdx = argv.indexOf('--name');
  const name = nameIdx >= 0 ? argv[nameIdx + 1] : undefined;
  const typeIdx = argv.indexOf('--type');
  const type = typeIdx >= 0 ? argv[typeIdx + 1] : undefined;
  if (!url) { console.error('Usage: node import.js <youtube-url> [--name "Folder Name"] [--type book|music|other]'); process.exit(1); }
  importPlaylist(url, { name, type })
    .then(({ folder }) => console.log(`\n✓ done → audio/${folder}`))
    .catch((e) => { console.error('✗ ' + e.message); process.exit(1); });
}
