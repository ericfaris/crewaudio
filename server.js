#!/usr/bin/env node
import http from 'node:http';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3000;
const AUDIO_DIR = path.join(__dirname, 'audio');
const CACHE_DIR = path.join(__dirname, '.cache');
const PUBLIC_DIR = path.join(__dirname, 'public');

const AUDIO_EXTS = new Set(['.mp3', '.m4a', '.m4b', '.aac', '.ogg', '.oga', '.opus', '.flac', '.wav', '.webm']);
const MIME = {
  '.mp3': 'audio/mpeg', '.m4a': 'audio/mp4', '.m4b': 'audio/mp4', '.aac': 'audio/aac',
  '.ogg': 'audio/ogg', '.oga': 'audio/ogg', '.opus': 'audio/ogg', '.flac': 'audio/flac',
  '.wav': 'audio/wav', '.webm': 'audio/webm',
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
};

await fsp.mkdir(AUDIO_DIR, { recursive: true });
await fsp.mkdir(CACHE_DIR, { recursive: true });

// ---- helpers ---------------------------------------------------------------

function json(res, status, body) {
  const data = Buffer.from(JSON.stringify(body));
  res.writeHead(status, { 'Content-Type': MIME['.json'], 'Content-Length': data.length });
  res.end(data);
}

// Resolve a client-supplied relative path safely inside AUDIO_DIR.
function safeAudioPath(rel) {
  const clean = path.normalize(decodeURIComponent(rel)).replace(/^(\.\.[/\\])+/, '');
  const full = path.join(AUDIO_DIR, clean);
  if (full !== AUDIO_DIR && !full.startsWith(AUDIO_DIR + path.sep)) return null;
  return full;
}

async function listAudioFiles(dir = AUDIO_DIR, base = '') {
  const out = [];
  let entries;
  try { entries = await fsp.readdir(dir, { withFileTypes: true }); }
  catch { return out; }
  for (const e of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (e.name.startsWith('.')) continue;
    const rel = base ? `${base}/${e.name}` : e.name;
    if (e.isDirectory()) {
      out.push(...await listAudioFiles(path.join(dir, e.name), rel));
    } else if (AUDIO_EXTS.has(path.extname(e.name).toLowerCase())) {
      const st = await fsp.stat(path.join(dir, e.name));
      out.push({ path: rel, name: e.name, size: st.size, mtime: st.mtimeMs });
    }
  }
  return out;
}

function ffprobeDuration(file) {
  return new Promise((resolve) => {
    const p = spawn('ffprobe', ['-v', 'error', '-show_entries', 'format=duration',
      '-of', 'default=noprint_wrappers=1:nokey=1', file]);
    let out = '';
    p.stdout.on('data', (d) => (out += d));
    p.on('close', () => resolve(parseFloat(out.trim()) || 0));
    p.on('error', () => resolve(0));
  });
}

// Run ffmpeg silencedetect and parse silence_start / silence_end pairs.
function detectSilences(file, noiseDb, minSilence) {
  return new Promise((resolve, reject) => {
    const p = spawn('ffmpeg', ['-hide_banner', '-nostats', '-i', file,
      '-af', `silencedetect=noise=${noiseDb}dB:d=${minSilence}`, '-f', 'null', '-']);
    let err = '';
    p.stderr.on('data', (d) => (err += d));
    p.on('error', reject);
    p.on('close', (code) => {
      if (code !== 0 && !err.includes('silence')) return reject(new Error('ffmpeg failed: ' + err.slice(-500)));
      const silences = [];
      const re = /silence_(start|end): (-?[\d.]+)(?: \| silence_duration: ([\d.]+))?/g;
      let m, cur = null;
      while ((m = re.exec(err))) {
        if (m[1] === 'start') cur = { start: parseFloat(m[2]) };
        else if (cur) { cur.end = parseFloat(m[2]); cur.duration = parseFloat(m[3]) || (cur.end - cur.start); silences.push(cur); cur = null; }
      }
      resolve(silences);
    });
  });
}

// Turn silences into chapter boundaries. A chapter starts at the midpoint of
// each qualifying silence (and at 0). Silences shorter than `gap` are ignored.
function buildChapters(silences, duration, gap) {
  const bounds = [0];
  for (const s of silences) {
    if (s.duration >= gap) bounds.push(Math.min(s.start + s.duration / 2, duration));
  }
  bounds.push(duration);
  const uniq = [...new Set(bounds.map((b) => +b.toFixed(3)))].sort((a, b) => a - b);
  const chapters = [];
  for (let i = 0; i < uniq.length - 1; i++) {
    const start = uniq[i], end = uniq[i + 1];
    if (end - start < 1) continue;
    chapters.push({ index: chapters.length + 1, title: `Chapter ${chapters.length + 1}`, start, end });
  }
  return chapters;
}

async function getChapters(rel, opts) {
  const file = safeAudioPath(rel);
  if (!file || !fs.existsSync(file)) throw new Error('not found');
  const noiseDb = Number(opts.noise ?? -30);
  const minSilence = Number(opts.minSilence ?? 0.5);
  const gap = Number(opts.gap ?? 1.5);
  const st = await fsp.stat(file);
  const key = Buffer.from(`${rel}|${st.mtimeMs}|${noiseDb}|${minSilence}|${gap}`).toString('base64url');
  const cacheFile = path.join(CACHE_DIR, key + '.json');
  if (!opts.force) {
    try { return JSON.parse(await fsp.readFile(cacheFile, 'utf8')); } catch {}
  }
  const duration = await ffprobeDuration(file);
  const silences = await detectSilences(file, noiseDb, minSilence);
  const chapters = buildChapters(silences, duration, gap);
  const result = { file: rel, duration, params: { noiseDb, minSilence, gap }, silenceCount: silences.length, chapters };
  await fsp.writeFile(cacheFile, JSON.stringify(result, null, 2));
  return result;
}

function streamAudio(req, res, file) {
  const st = fs.statSync(file);
  const type = MIME[path.extname(file).toLowerCase()] || 'application/octet-stream';
  const range = req.headers.range;
  if (range) {
    const m = /bytes=(\d*)-(\d*)/.exec(range);
    let start = m[1] ? parseInt(m[1], 10) : 0;
    let end = m[2] ? parseInt(m[2], 10) : st.size - 1;
    if (isNaN(start) || start >= st.size) { res.writeHead(416, { 'Content-Range': `bytes */${st.size}` }); return res.end(); }
    end = Math.min(end, st.size - 1);
    res.writeHead(206, {
      'Content-Type': type,
      'Content-Range': `bytes ${start}-${end}/${st.size}`,
      'Accept-Ranges': 'bytes',
      'Content-Length': end - start + 1,
    });
    fs.createReadStream(file, { start, end }).pipe(res);
  } else {
    res.writeHead(200, { 'Content-Type': type, 'Content-Length': st.size, 'Accept-Ranges': 'bytes' });
    fs.createReadStream(file).pipe(res);
  }
}

async function serveStatic(res, urlPath) {
  const rel = urlPath === '/' ? 'index.html' : urlPath.replace(/^\/+/, '');
  const full = path.join(PUBLIC_DIR, path.normalize(rel));
  if (!full.startsWith(PUBLIC_DIR)) { res.writeHead(403); return res.end(); }
  try {
    const data = await fsp.readFile(full);
    res.writeHead(200, { 'Content-Type': MIME[path.extname(full).toLowerCase()] || 'application/octet-stream' });
    res.end(data);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not found');
  }
}

// ---- routing --------------------------------------------------------------

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const p = url.pathname;

    if (p === '/api/files') {
      return json(res, 200, { files: await listAudioFiles() });
    }

    if (p === '/api/chapters') {
      const rel = url.searchParams.get('file');
      if (!rel) return json(res, 400, { error: 'file required' });
      const result = await getChapters(rel, {
        noise: url.searchParams.get('noise'),
        minSilence: url.searchParams.get('minSilence'),
        gap: url.searchParams.get('gap'),
        force: url.searchParams.get('force') === '1',
      });
      return json(res, 200, result);
    }

    if (p.startsWith('/audio/')) {
      const file = safeAudioPath(p.slice('/audio/'.length));
      if (!file || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
        res.writeHead(404); return res.end('Not found');
      }
      return streamAudio(req, res, file);
    }

    if (p.startsWith('/api/')) return json(res, 404, { error: 'unknown endpoint' });

    return serveStatic(res, p);
  } catch (err) {
    json(res, 500, { error: String(err && err.message || err) });
  }
});

server.listen(PORT, () => {
  console.log(`crewaudio → http://localhost:${PORT}`);
  console.log(`audio folder: ${AUDIO_DIR}`);
});
