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
// Scanned books number chapters 1..N and restart at each "BOOK" division, and
// the pages are numbered too. We follow the *expected next chapter number*
// rather than trusting every lone digit — page numbers almost never equal the
// exact chapter we're looking for at that point in the text.
let starts = [];
const notes = [];
const gapBefore = (i) => !lines.slice(Math.max(0, i - 2), i).some((l) => l.trim());
const proseAfter = (i) => lines.slice(i + 1, i + 9).some((l) => l.trim().length > 40);

if (explicit) {
  lines.forEach((ln, i) => { if (ln.trim() === '@@@') starts.push(i + 1); });
} else {
  let expected = 0;
  let lastMatch = -Infinity;
  for (let i = 0; i < lines.length; i++) {
    const t = lines[i].trim();
    if (/^BOOK\s+(ONE|TWO|THREE|FOUR|FIVE)\b/i.test(t)) { expected = 1; continue; }
    // a lone chapter number, tolerating OCR grit between the digits ("1*4", "1 4")
    if (!/^\d(?:[\s*.,|]*\d){0,2}$/.test(t) || !gapBefore(i) || !proseAfter(i)) continue;
    const n = +t.replace(/\D/g, '');
    if (expected && n >= expected && n <= expected + 2) {
      if (n > expected) {
        notes.push(`chapter ${expected}${n - expected > 1 ? `–${n - 1}` : ''} has no clean marker `
          + `near source line ${i + 1} — that boundary is a guess; add @@@ there to fix`);
      }
      starts.push(i); lastMatch = i; expected = n + 1;
    } else if (expected > 3 && n === 1 && i - lastMatch > 200) {
      // numbering reset far from the last chapter = a new, unlabelled book division
      starts.push(i); lastMatch = i; expected = 2;
    }
  }
}

if (starts.length === 0) {
  console.error('No chapter breaks found. Put a line that is exactly  @@@  at each chapter start in book.txt.');
  process.exit(1);
}
notes.forEach((w) => console.warn('! ' + w));

// keep anything before chapter 1 (title page, author's note) as a 00 file
const frontMatter = starts[0] > 0 ? lines.slice(0, starts[0]).join('\n').trim() : '';

// --- slice into chapters, dropping the leading chapter-number line --------
const chapters = starts.map((s, k) => {
  const end = k + 1 < starts.length ? starts[k + 1] : lines.length;
  const body = lines.slice(s, end);
  if (!explicit && /^\d(?:[\s*.,|]*\d){0,2}$/.test((body[0] || '').trim())) body.shift();
  return body.join('\n').trim() + '\n';
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

if (frontMatter) console.log(`  00 - front-matter.txt  —  (title page, author's note — source lines 1–${starts[0]})`);

if (checkOnly) {
  console.log(`\n--check: would write ${chapters.length}${frontMatter ? ' + 1 front-matter' : ''} `
    + `files to ${path.relative(ROOT, OUT_DIR)}/`);
  process.exit(0);
}

fs.rmSync(OUT_DIR, { recursive: true, force: true });
fs.mkdirSync(OUT_DIR, { recursive: true });
if (frontMatter) fs.writeFileSync(path.join(OUT_DIR, '00 - front-matter.txt'), frontMatter + '\n');
chapters.forEach((c, k) => fs.writeFileSync(path.join(OUT_DIR, names[k]), c));
console.log(`\nWrote ${chapters.length}${frontMatter ? ' + front-matter' : ''} files to ${path.relative(ROOT, OUT_DIR)}/`);
