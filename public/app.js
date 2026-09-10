const $ = (s) => document.querySelector(s);
const audio = $('#audio');
const groupsEl = $('#groups');
const seek = $('#seek');

let files = [];          // flat list from server
let queue = [];          // ordered paths within the current book
let current = null;      // rel path of loaded track
let seeking = false;

const PROGRESS_KEY = 'crewaudio.progress';
const LAST_KEY = 'crewaudio.last';
const MINI_KEY = 'crewaudio.mini';
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
  if (!current) {
    const last = localStorage.getItem(LAST_KEY);
    if (last && files.some((f) => f.path === last)) play(last, { autoplay: false });
  }
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

function play(pathRel, { resume = true, autoplay = true } = {}) {
  current = pathRel;
  localStorage.setItem(LAST_KEY, pathRel);
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
      $('#resume-note').textContent = `${autoplay ? 'resumed' : 'ready'} at ${fmt(pr.t)}`;
    } else {
      $('#resume-note').textContent = '';
    }
    updateClock();
    if (autoplay) audio.play().catch(() => {});
  };
  document.querySelectorAll('#groups li').forEach((li) =>
    li.classList.toggle('active', li.dataset.path === pathRel));
  updateMediaSession();
}

function step(delta) {
  const i = queue.indexOf(current);
  if (i < 0) return;
  const n = i + delta;
  if (n >= 0 && n < queue.length) play(queue[n]);
}

// ---- transport ----
function updateClock() {
  const d = audio.duration || 0, t = audio.currentTime || 0;
  $('#clock').textContent = `${fmt(t)} / ${fmt(d)}`;
  if (!seeking) seek.value = d ? Math.round((t / d) * 1000) : 0;
}
$('#playpause').onclick = () => (audio.paused ? audio.play().catch(() => {}) : audio.pause());
$('#prev').onclick = () => step(-1);
$('#next').onclick = () => step(1);
seek.addEventListener('input', () => { seeking = true; });
seek.addEventListener('change', () => {
  if (audio.duration) audio.currentTime = (seek.value / 1000) * audio.duration;
  seeking = false;
});
audio.addEventListener('play', () => { $('#playpause').textContent = '⏸'; updateMediaSession(); });
audio.addEventListener('pause', () => { $('#playpause').textContent = '▶'; });

let lastSave = 0;
audio.addEventListener('timeupdate', () => {
  updateClock();
  const t = audio.currentTime, d = audio.duration;
  if (current && d && Date.now() - lastSave > 3000) {
    progress[current] = { t, ratio: t / d, at: Date.now() };
    saveProgress();
    lastSave = Date.now();
  }
});
audio.addEventListener('ended', () => {
  if (current) { progress[current] = { t: audio.duration, ratio: 1, at: Date.now() }; saveProgress(); render(); }
  if ($('#autoplay').checked) step(1);
});

// OS-level media keys / lock-screen controls
function updateMediaSession() {
  if (!('mediaSession' in navigator) || !current) return;
  navigator.mediaSession.metadata = new MediaMetadata({
    title: files.find((f) => f.path === current)?.name || current,
    artist: bookOf(current),
    album: 'crewaudio',
  });
  navigator.mediaSession.setActionHandler('play', () => audio.play());
  navigator.mediaSession.setActionHandler('pause', () => audio.pause());
  navigator.mediaSession.setActionHandler('previoustrack', () => step(-1));
  navigator.mediaSession.setActionHandler('nexttrack', () => step(1));
  navigator.mediaSession.setActionHandler('seekbackward', () => { audio.currentTime -= 15; });
  navigator.mediaSession.setActionHandler('seekforward', () => { audio.currentTime += 30; });
}

// ---- mini / widget mode ----
const isStandalone = () =>
  matchMedia('(display-mode: standalone)').matches ||
  matchMedia('(display-mode: minimal-ui)').matches ||
  window.navigator.standalone === true;
let restoreSize = null;

function setMini(on) {
  document.body.classList.toggle('mini', on);
  localStorage.setItem(MINI_KEY, on ? '1' : '0');
  $('#mini-toggle').textContent = on ? '▢' : '▁';
  $('#mini-toggle').title = on ? 'Expand' : 'Minimize to widget';
  if (!isStandalone()) return;
  try {
    if (on) {
      restoreSize = { w: window.outerWidth, h: window.outerHeight };
      window.resizeTo(400, 132);
    } else if (restoreSize) {
      window.resizeTo(restoreSize.w, restoreSize.h);
      restoreSize = null;
    }
  } catch { /* resizeTo is blocked outside app windows */ }
}
$('#mini-toggle').onclick = () => setMini(!document.body.classList.contains('mini'));
if (localStorage.getItem(MINI_KEY) === '1') setMini(true);

// ---- install prompt ----
let deferredPrompt = null;
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferredPrompt = e;
  $('#install').hidden = false;
});
$('#install').onclick = async () => {
  if (!deferredPrompt) return;
  deferredPrompt.prompt();
  await deferredPrompt.userChoice;
  deferredPrompt = null;
  $('#install').hidden = true;
};
window.addEventListener('appinstalled', () => { $('#install').hidden = true; });

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
$('#yt-go').onclick = runImport;
window.addEventListener('beforeunload', () => {
  if (current && audio.duration) {
    progress[current] = { t: audio.currentTime, ratio: audio.currentTime / audio.duration, at: Date.now() };
    saveProgress();
  }
});

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js').catch(() => {});
}

loadFiles();
