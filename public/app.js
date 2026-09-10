const $ = (s) => document.querySelector(s);
const audio = $('#audio');
const groupsEl = $('#groups');
const chapterList = $('#chapter-list');
const chapterStatus = $('#chapter-status');

let files = [];          // flat list from server
let queue = [];          // ordered paths within the current book
let current = null;      // rel path of loaded track
let chapters = [];

const PROGRESS_KEY = 'crewaudio.progress';
const progress = JSON.parse(localStorage.getItem(PROGRESS_KEY) || '{}');
const saveProgress = () => localStorage.setItem(PROGRESS_KEY, JSON.stringify(progress));

function fmt(sec) {
  if (!isFinite(sec)) return '0:00';
  sec = Math.max(0, Math.round(sec));
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
  return (h ? `${h}:${String(m).padStart(2, '0')}` : `${m}`) + ':' + String(s).padStart(2, '0');
}
function humanSize(b) {
  const u = ['B', 'KB', 'MB', 'GB']; let i = 0;
  while (b >= 1024 && i < u.length - 1) { b /= 1024; i++; }
  return b.toFixed(i ? 1 : 0) + ' ' + u[i];
}
const bookOf = (p) => (p.includes('/') ? p.split('/').slice(0, -1).join('/') : '');
const encPath = (p) => p.split('/').map(encodeURIComponent).join('/');

async function loadFiles() {
  files = (await (await fetch('/api/files')).json()).files;
  render();
}

function render() {
  const books = new Map();
  for (const f of files) {
    const b = bookOf(f.path) || 'Library';
    if (!books.has(b)) books.set(b, []);
    books.get(b).push(f);
  }
  groupsEl.innerHTML = '';
  $('#empty').hidden = files.length > 0;
  for (const [book, list] of books) {
    const wrap = document.createElement('details');
    wrap.open = true;
    const done = list.filter((f) => (progress[f.path]?.ratio || 0) > 0.97).length;
    wrap.innerHTML = `<summary>${book} <span class="count">${done}/${list.length}</span></summary>`;
    const ul = document.createElement('ul');
    for (const f of list) {
      const li = document.createElement('li');
      const pr = progress[f.path];
      const badge = pr && pr.ratio > 0.97 ? '✓' : pr && pr.ratio > 0.02 ? `${Math.round(pr.ratio * 100)}%` : '';
      li.innerHTML = `<span class="name">${f.name}</span><span class="meta">${badge || humanSize(f.size)}</span>`;
      li.dataset.path = f.path;
      li.classList.toggle('active', f.path === current);
      li.onclick = () => play(f.path);
      ul.appendChild(li);
    }
    wrap.appendChild(ul);
    groupsEl.appendChild(wrap);
  }
}

function play(pathRel, { resume = true } = {}) {
  current = pathRel;
  const book = bookOf(pathRel);
  queue = files.filter((f) => bookOf(f.path) === book).map((f) => f.path);
  $('#np-book').textContent = book || '';
  $('#np-title').textContent = files.find((f) => f.path === pathRel)?.name || pathRel;
  audio.src = '/audio/' + encPath(pathRel);
  const pr = progress[pathRel];
  audio.load();
  audio.onloadedmetadata = () => {
    if (resume && pr && pr.t > 5 && pr.ratio < 0.97) {
      audio.currentTime = pr.t;
      $('#resume-note').textContent = `resumed at ${fmt(pr.t)}`;
    } else {
      $('#resume-note').textContent = '';
    }
    audio.play().catch(() => {});
  };
  chapters = [];
  chapterList.innerHTML = '';
  chapterStatus.textContent = 'Click Detect to split this track into chapters by silence.';
  document.querySelectorAll('#groups li').forEach((li) =>
    li.classList.toggle('active', li.dataset.path === pathRel));
}

function step(delta) {
  const i = queue.indexOf(current);
  if (i < 0) return;
  const n = i + delta;
  if (n >= 0 && n < queue.length) play(queue[n]);
}

let lastSave = 0;
audio.addEventListener('timeupdate', () => {
  const t = audio.currentTime, d = audio.duration;
  if (current && d && Date.now() - lastSave > 3000) {
    progress[current] = { t, ratio: t / d, at: Date.now() };
    saveProgress();
    lastSave = Date.now();
  }
  [...chapterList.children].forEach((li) =>
    li.classList.toggle('active', t >= +li.dataset.start && t < +li.dataset.end));
});
audio.addEventListener('ended', () => {
  if (current) { progress[current] = { t: audio.duration, ratio: 1, at: Date.now() }; saveProgress(); render(); }
  if ($('#autoplay').checked) step(1);
});

// ---- chapters ----
function renderChapters() {
  chapterList.innerHTML = '';
  chapters.forEach((c) => {
    const li = document.createElement('li');
    li.innerHTML = `<span>${c.title}</span><span class="t">${fmt(c.start)} – ${fmt(c.end)}</span>`;
    li.dataset.start = c.start; li.dataset.end = c.end;
    li.onclick = () => { audio.currentTime = c.start + 0.01; audio.play().catch(() => {}); };
    chapterList.appendChild(li);
  });
}
async function detect(force) {
  if (!current) { chapterStatus.textContent = 'Load a track first.'; return; }
  const q = new URLSearchParams({ file: current, noise: $('#p-noise').value,
    minSilence: $('#p-min').value, gap: $('#p-gap').value });
  if (force) q.set('force', '1');
  chapterStatus.textContent = 'Analyzing…';
  try {
    const r = await fetch('/api/chapters?' + q);
    const data = await r.json();
    if (!r.ok) throw new Error(data.error || 'failed');
    chapters = data.chapters;
    renderChapters();
    chapterStatus.textContent = `${chapters.length} chapters from ${data.silenceCount} silences · ${fmt(data.duration)}`;
  } catch (e) { chapterStatus.textContent = 'Error: ' + e.message; }
}

// ---- import ----
function runImport() {
  const url = $('#yt-url').value.trim();
  if (!url) return;
  const name = $('#yt-name').value.trim();
  const log = $('#yt-log');
  log.hidden = false; log.textContent = 'starting…\n';
  $('#yt-go').disabled = true;
  const q = new URLSearchParams({ url });
  if (name) q.set('name', name);
  const es = new EventSource('/api/import?' + q);
  const append = (s) => { log.textContent += s + '\n'; log.scrollTop = log.scrollHeight; };
  es.addEventListener('log', (e) => append(JSON.parse(e.data).line));
  es.addEventListener('done', (e) => {
    append('✓ done → audio/' + JSON.parse(e.data).folder);
    es.close(); $('#yt-go').disabled = false; loadFiles();
  });
  es.addEventListener('error', (e) => {
    append('✗ ' + (e.data ? JSON.parse(e.data).message : 'connection lost'));
    es.close(); $('#yt-go').disabled = false; loadFiles();
  });
}

$('#refresh').onclick = loadFiles;
$('#detect').onclick = () => detect(false);
$('#redetect').onclick = () => detect(true);
$('#prev').onclick = () => step(-1);
$('#next').onclick = () => step(1);
$('#yt-go').onclick = runImport;
window.addEventListener('beforeunload', () => {
  if (current && audio.duration) {
    progress[current] = { t: audio.currentTime, ratio: audio.currentTime / audio.duration, at: Date.now() };
    saveProgress();
  }
});

loadFiles();
