import { spawn, execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** Create a temp audio library with `count` mp3s (`seconds` each) under "<tmp>/Test Book/". */
export function makeAudioLibrary(count = 3, seconds = 12) {
  const dir = mkdtempSync(path.join(tmpdir(), 'crewaudio-audio-'));
  const book = path.join(dir, 'Test Book');
  mkdirSync(book, { recursive: true });
  for (let i = 1; i <= count; i++) {
    const freq = 220 + i * 110;
    execFileSync('ffmpeg', [
      '-hide_banner', '-loglevel', 'error', '-y',
      '-f', 'lavfi', '-i', `sine=frequency=${freq}:duration=${seconds}`,
      '-q:a', '9', path.join(book, `${String(i).padStart(2, '0')} - Chapter ${i}.mp3`),
    ]);
  }
  return dir;
}

/** Start the server on an ephemeral port against `audioDir`. Returns { origin, close }. */
export function startServer(audioDir) {
  const cacheDir = mkdtempSync(path.join(tmpdir(), 'crewaudio-cache-'));
  const child = spawn(process.execPath, [path.join(ROOT, 'server.js')], {
    env: {
      ...process.env,
      PORT: '0',
      CREWAUDIO_AUDIO_DIR: audioDir,
      CREWAUDIO_CACHE_DIR: cacheDir,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  return new Promise((resolve, reject) => {
    let out = '';
    const onData = (b) => {
      out += b;
      const m = out.match(/http:\/\/localhost:(\d+)/);
      if (m) {
        child.stdout.off('data', onData);
        resolve({
          origin: `http://localhost:${m[1]}`,
          close: () => { child.kill('SIGKILL'); rmSync(cacheDir, { recursive: true, force: true }); },
        });
      }
    };
    child.stdout.on('data', onData);
    child.stderr.on('data', (b) => { out += b; });
    child.on('exit', (c) => reject(new Error(`server exited early (${c})\n${out}`)));
    setTimeout(() => reject(new Error(`server did not start\n${out}`)), 10000);
  });
}

export function cleanup(dir) {
  rmSync(dir, { recursive: true, force: true });
}

/** Locate a Playwright-managed Chromium/headless-shell binary, or null. */
export function findChromium() {
  const base = path.join(process.env.HOME || '', '.cache/ms-playwright');
  try {
    const hits = execFileSync('find', [base, '-type', 'f',
      '(', '-name', 'chrome-headless-shell', '-o', '-name', 'headless_shell', '-o', '-name', 'chrome', ')'],
      { encoding: 'utf8' }).trim().split('\n').filter(Boolean);
    return hits[0] || null;
  } catch {
    return null;
  }
}
