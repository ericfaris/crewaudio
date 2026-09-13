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
const QUIZ_KEY = 'crewaudio.quiz';
const progress = JSON.parse(localStorage.getItem(PROGRESS_KEY) || '{}');
const saveProgress = () => localStorage.setItem(PROGRESS_KEY, JSON.stringify(progress));
const quizScores = JSON.parse(localStorage.getItem(QUIZ_KEY) || '{}');
const saveQuizScores = () => localStorage.setItem(QUIZ_KEY, JSON.stringify(quizScores));

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
    const pct = list.length ? Math.round((done / list.length) * 100) : 0;
    wrap.innerHTML = `<summary><span class="book-gauge" style="--gauge:${pct}"></span>${book} <span class="count">${done}/${list.length}</span></summary>`;
    const ul = document.createElement('ul');
    for (const f of list) {
      const li = document.createElement('li');
      const pr = progress[f.path];
      const badge = pr && pr.ratio > 0.97 ? '✓' : pr && pr.ratio > 0.02 ? `${Math.round(pr.ratio * 100)}%` : '';
      const qz = quizScores[f.path];
      const qzBadge = qz ? `<span class="quiz-badge">${qz.best}/${qz.total}</span>` : '';
      li.innerHTML = `<span class="name">${f.name}</span><span class="meta">${qzBadge}${badge || humanSize(f.size)}</span>`;
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
  $('#quiz').hidden = true;
  refreshQuizControls(pathRel);
}

// Heads-up note + a "take the quiz" button whenever this chapter has a quiz.
// The quiz can be taken any number of times, before or after finishing the audio.
let currentQuiz = null;
async function refreshQuizControls(track) {
  const note = $('#quiz-note');
  const openBtn = $('#quiz-open');
  note.hidden = true;
  openBtn.hidden = true;
  currentQuiz = null;
  const n = chapterOf(track);
  if (n < 1) return;
  try {
    const r = await fetch('/api/quiz?n=' + n);
    if (!r.ok || track !== current) return;
    const quiz = await r.json();
    if (!(quiz.questions && quiz.questions.length)) return;
    currentQuiz = { track, quiz };
    const score = quizScores[track];
    note.hidden = !!score; // only nag before the first attempt
    openBtn.hidden = false;
    openBtn.textContent = score
      ? `📝 Retake the review quiz · best ${score.best}/${score.total}`
      : '📝 Take the review quiz';
  } catch { /* offline — no quiz controls */ }
}

$('#quiz-open').onclick = () => {
  if (!currentQuiz || currentQuiz.track !== current) return;
  audio.pause();
  renderQuiz(currentQuiz.track, currentQuiz.quiz, { fromEnd: false });
};

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
  $('#play-ring').style.setProperty('--ring', d ? (t / d) * 100 : 0);
  seek.style.setProperty('--fill', seek.value / 10);
}
$('#playpause').onclick = togglePlay;
$('#prev').onclick = () => step(-1);
$('#next').onclick = () => step(1);
seek.addEventListener('input', () => { seeking = true; seek.style.setProperty('--fill', seek.value / 10); });
seek.addEventListener('change', () => {
  if (audio.duration) audio.currentTime = (seek.value / 1000) * audio.duration;
  seeking = false;
});
audio.addEventListener('play', () => { $('#playpause').textContent = '⏸'; updateMediaSession(); });
audio.addEventListener('pause', () => { $('#playpause').textContent = '▶'; });

function togglePlay() {
  if (!audio.src) return;
  if (audio.paused) audio.play().catch(() => {}); else audio.pause();
}

// Space toggles playback from anywhere except while typing in a field. Buttons
// keep their native Space-activates behaviour (don't hijack a focused control).
document.addEventListener('keydown', (e) => {
  if (e.code !== 'Space' || e.repeat) return;
  const t = e.target;
  const tag = t && t.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || tag === 'BUTTON' ||
      (t && t.isContentEditable)) return;
  e.preventDefault();
  togglePlay();
});

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
audio.addEventListener('ended', async () => {
  const finished = current;
  if (finished) { progress[finished] = { t: audio.duration, ratio: 1, at: Date.now() }; saveProgress(); render(); }
  const shown = await maybeShowQuiz(finished);
  if (!shown && $('#autoplay').checked) step(1);
});

// ---- chapter review quiz ----
// chapter number = the track's position within its book (1-based)
const chapterOf = (p) => queue.indexOf(p) + 1;
let pendingAdvance = false;

async function maybeShowQuiz(track) {
  if (!track) return false;
  const n = chapterOf(track);
  if (n < 1) return false;
  let quiz;
  try {
    const r = await fetch('/api/quiz?n=' + n);
    if (!r.ok) return false;
    quiz = await r.json();
  } catch { return false; }
  if (!quiz.questions || !quiz.questions.length) return false;
  renderQuiz(track, quiz, { fromEnd: true });
  return true;
}

function renderQuiz(track, quiz, { fromEnd = true } = {}) {
  pendingAdvance = fromEnd && $('#autoplay').checked;
  const total = quiz.questions.length;
  const answered = new Array(total).fill(false);
  let correct = 0;

  $('#quiz-title').textContent = quiz.title || `Chapter ${quiz.chapter} review`;
  const list = $('#quiz-list');
  list.innerHTML = '';

  quiz.questions.forEach((q, qi) => {
    const li = document.createElement('li');
    const stem = document.createElement('p');
    stem.className = 'q-stem';
    stem.textContent = q.q;
    li.appendChild(stem);

    const verdict = document.createElement('p');
    verdict.className = 'q-verdict';
    verdict.hidden = true;

    const ex = document.createElement('p');
    ex.className = 'q-explain';
    ex.hidden = true;
    ex.textContent = q.explain || '';

    q.choices.forEach((choice, ci) => {
      const label = document.createElement('label');
      label.className = 'q-choice';
      label.innerHTML = `<input type="radio" name="q${qi}" value="${ci}"> <span></span>`;
      label.querySelector('span').textContent = choice;
      label.querySelector('input').addEventListener('change', () => {
        if (answered[qi]) return;
        answered[qi] = true;
        const right = ci === q.answer;
        if (right) correct++;
        // lock this question and reveal the answer + explanation
        li.querySelectorAll('.q-choice').forEach((lab, k) => {
          lab.querySelector('input').disabled = true;
          if (k === q.answer) lab.classList.add('right');
          if (k === ci && !right) lab.classList.add('wrong');
        });
        verdict.hidden = false;
        verdict.textContent = right ? '✓ Correct' : '✗ Not quite';
        verdict.classList.toggle('right', right);
        verdict.classList.toggle('wrong', !right);
        if (ex.textContent) ex.hidden = false;
        updateFoot();
      });
      li.appendChild(label);
    });
    li.appendChild(verdict);
    li.appendChild(ex);
    list.appendChild(li);
  });

  function updateFoot() {
    const done = answered.filter(Boolean).length;
    $('#quiz-score').textContent = `${correct} / ${done} answered`
      + (done < total ? ` — ${total - done} to go` : '');
    if (done === total) {
      const prev = quizScores[track];
      quizScores[track] = {
        last: correct, total,
        best: Math.max(correct, prev?.best || 0),
        at: Date.now(),
      };
      saveQuizScores();
      render();
      $('#quiz-score').textContent = `${correct} / ${total}`
        + (quizScores[track].best > correct ? `  (best ${quizScores[track].best})` : '');
      $('#quiz-retry').hidden = false;
      $('#quiz-continue').hidden = false;
    }
  }

  $('#quiz-score').textContent = `0 / ${total}`;
  $('#quiz-retry').hidden = true;
  $('#quiz-continue').hidden = true;
  $('#quiz-continue').textContent = pendingAdvance ? 'Continue ▸' : 'Close';

  const section = $('#quiz');
  section.hidden = false;
  section.dataset.track = track;
  section.scrollIntoView({ behavior: 'smooth', block: 'start' });

  $('#quiz-retry').onclick = () => renderQuiz(track, quiz, { fromEnd });
  $('#quiz-continue').onclick = () => closeQuiz(true);
  $('#quiz-close').onclick = () => closeQuiz(false);
  updateFoot();
}

function closeQuiz(advance) {
  $('#quiz').hidden = true;
  const wasAdvance = advance && pendingAdvance;
  pendingAdvance = false;
  if (wasAdvance) step(1);
  else refreshQuizControls(current); // update the "retake · best N/10" label
}

// OS-level media keys / lock-screen controls
function updateMediaSession() {
  if (!('mediaSession' in navigator) || !current) return;
  navigator.mediaSession.metadata = new MediaMetadata({
    title: files.find((f) => f.path === current)?.name || current,
    artist: bookOf(current),
    album: 'study',
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
  // Versioned URL so a deploy re-registers past Cloudflare's edge cache.
  const v = window.__ASSET_V__ ? `?v=${window.__ASSET_V__}` : '';
  navigator.serviceWorker.register('/sw.js' + v).catch(() => {});
}

loadFiles();
