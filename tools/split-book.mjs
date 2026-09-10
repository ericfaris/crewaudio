#!/usr/bin/env node
// Split a local plain-text book into per-chapter files that line up with the
// audio tracks in a book folder. YOU supply the text (paste it into book.txt);
// this script only reorganizes it. Output goes to text/, which is git-ignored
// and is NOT served by the app (the server only serves public/ and audio/).
//
//   1. Save the full text to  ./book.txt
//   2. npm run split-book                    # auto-detect chapter breaks
//      npm run split-book -- --check         # just show what it would do
//
// Auto-detect treats a line that is only a number (1..49) or "BOOK ONE/TWO/
// THREE" as a chapter start. OCR page numbers can fool it — if the count is
// wrong, put a line that is exactly  @@@  at the start of each chapter in
// book.txt and re-run (explicit markers win over auto-detect).

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = process.env.BOOK_SRC || path.join(ROOT, 'book.txt');
const BOOK = process.env.BOOK_NAME || 'Cry, the Beloved Country Chapter Audios';
const AUDIO_DIR = path.join(ROOT, 'audio', BOOK);
const OUT_DIR = path.join(ROOT, 'text', BOOK);
const checkOnly = process.argv.includes('--check');

if (!fs.existsSync(SRC)) {
  console.error(`No source text at ${SRC}\nSave the book text there first, or set BOOK_SRC.`);
  process.exit(1);
}

const raw = fs.readFileSync(SRC, 'utf8').replace(/\r\n/g, '\n');
const lines = raw.split('\n');
const explicit = /\n\s*@@@\s*(\n|$)/.test(raw);

// --- find chapter start line indices --------------------------------------
let starts = [];
if (explicit) {
  lines.forEach((ln, i) => { if (ln.trim() === '@@@') starts.push(i + 1); });
} else {
  lines.forEach((ln, i) => {
    const t = ln.trim();
    const prevGap = !lines.slice(Math.max(0, i - 2), i).some((l) => l.trim().length > 0);
    const soonProse = lines.slice(i + 1, i + 7).some((l) => l.trim().length > 40);
    if (/^BOOK\s+(ONE|TWO|THREE)$/i.test(t)) starts.push(i);
    else if (/^\d{1,2}$/.test(t) && +t >= 1 && +t <= 49 && prevGap && soonProse) starts.push(i);
  });
  // collapse a "BOOK X" immediately followed by its "1"
  starts = starts.filter((s, k) => k === 0 || s - starts[k - 1] > 3);
}

if (starts.length === 0) {
  console.error('No chapter breaks found. Add @@@ lines at each chapter start in book.txt.');
  process.exit(1);
}

// --- slice into chapters ---------------------------------------------------
const chapters = starts.map((s, k) => {
  const end = k + 1 < starts.length ? starts[k + 1] : lines.length;
  return lines.slice(s, end).join('\n').trim() + '\n';
});

// --- name files to match the audio tracks --------------------------------
let names;
try {
  const tracks = fs.readdirSync(AUDIO_DIR)
    .filter((f) => f.toLowerCase().endsWith('.mp3')).sort();
  if (tracks.length === chapters.length) {
    names = tracks.map((t) => t.replace(/\.mp3$/i, '.txt'));
    console.log(`Matched ${tracks.length} audio tracks in ${path.relative(ROOT, AUDIO_DIR)}`);
  } else {
    console.warn(`! ${chapters.length} chapters but ${tracks.length} audio tracks — using generic names`);
  }
} catch {
  console.warn(`! no audio folder at ${path.relative(ROOT, AUDIO_DIR)} — using generic names`);
}
if (!names) {
  const w = String(chapters.length).length;
  names = chapters.map((_, k) => `${String(k + 1).padStart(w, '0')} - Chapter ${k + 1}.txt`);
}

// --- report / write ------------------------------------------------------
chapters.forEach((c, k) => {
  const firstLine = c.split('\n').find((l) => l.trim()) || '';
  console.log(`  ${names[k]}  —  ${firstLine.slice(0, 60)}${firstLine.length > 60 ? '…' : ''}`);
});

if (checkOnly) {
  console.log(`\n--check: would write ${chapters.length} files to ${path.relative(ROOT, OUT_DIR)}/`);
  process.exit(0);
}

fs.mkdirSync(OUT_DIR, { recursive: true });
chapters.forEach((c, k) => fs.writeFileSync(path.join(OUT_DIR, names[k]), c));
console.log(`\nWrote ${chapters.length} files to ${path.relative(ROOT, OUT_DIR)}/`);
