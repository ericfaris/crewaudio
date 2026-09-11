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

// Resolve the playlist/video title so we can name the folder up front.
function getTitle(bin, url) {
  return new Promise((resolve) => {
    const p = spawn(bin, ['--flat-playlist', '--no-warnings', '-J', '--', url]);
    let out = '';
    p.stdout.on('data', (d) => (out += d));
    p.on('close', () => {
      try {
        const j = JSON.parse(out);
        resolve(sanitize(j.title || j.playlist_title || j.id || 'youtube-import'));
      } catch { resolve('youtube-import'); }
    });
    p.on('error', () => resolve('youtube-import'));
  });
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
  if (!url) { console.error('Usage: node import.js <youtube-url> [--name "Folder Name"]'); process.exit(1); }
  importPlaylist(url, { name })
    .then(({ folder }) => console.log(`\n✓ done → audio/${folder}`))
    .catch((e) => { console.error('✗ ' + e.message); process.exit(1); });
}
