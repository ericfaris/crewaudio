const $ = (s) => document.querySelector(s);
const audio = $('#audio');
const fileList = $('#file-list');
const chapterList = $('#chapter-list');
const chapterStatus = $('#chapter-status');

let files = [];
let current = null;      // rel path of loaded track
let chapters = [];

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

async function loadFiles() {
  const r = await fetch('/api/files');
  files = (await r.json()).files;
  fileList.innerHTML = '';
  $('#empty').hidden = files.length > 0;
  for (const f of files) {
    const li = document.createElement('li');
    li.innerHTML = `${f.name}<span class="meta">${f.path.includes('/') ? f.path.split('/').slice(0, -1).join('/') + ' · ' : ''}${humanSize(f.size)}</span>`;
    li.onclick = () => selectFile(f);
    if (f.path === current) li.classList.add('active');
    li.dataset.path = f.path;
    fileList.appendChild(li);
  }
}

function selectFile(f) {
  current = f.path;
  [...fileList.children].forEach((li) => li.classList.toggle('active', li.dataset.path === f.path));
  $('#np-title').textContent = f.name;
  audio.src = '/audio/' + f.path.split('/').map(encodeURIComponent).join('/');
  audio.play().catch(() => {});
  chapters = [];
  chapterList.innerHTML = '';
  chapterStatus.textContent = 'No chapters yet — click Detect to analyze silences.';
}

function renderChapters() {
  chapterList.innerHTML = '';
  chapters.forEach((c) => {
    const li = document.createElement('li');
    li.innerHTML = `<span>${c.title}</span><span class="t">${fmt(c.start)} – ${fmt(c.end)}</span>`;
    li.onclick = () => { audio.currentTime = c.start + 0.01; audio.play().catch(() => {}); };
    li.dataset.start = c.start;
    li.dataset.end = c.end;
    chapterList.appendChild(li);
  });
}

audio.addEventListener('timeupdate', () => {
  const t = audio.currentTime;
  [...chapterList.children].forEach((li) => {
    li.classList.toggle('active', t >= +li.dataset.start && t < +li.dataset.end);
  });
});

async function detect(force) {
  if (!current) { chapterStatus.textContent = 'Load a track first.'; return; }
  const q = new URLSearchParams({
    file: current,
    noise: $('#p-noise').value,
    minSilence: $('#p-min').value,
    gap: $('#p-gap').value,
  });
  if (force) q.set('force', '1');
  chapterStatus.textContent = 'Analyzing… (this reads the whole file, may take a bit)';
  try {
    const r = await fetch('/api/chapters?' + q);
    const data = await r.json();
    if (!r.ok) throw new Error(data.error || 'failed');
    chapters = data.chapters;
    renderChapters();
    chapterStatus.textContent =
      `${chapters.length} chapters from ${data.silenceCount} silences · duration ${fmt(data.duration)}`;
  } catch (e) {
    chapterStatus.textContent = 'Error: ' + e.message;
  }
}

$('#refresh').onclick = loadFiles;
$('#detect').onclick = () => detect(false);
$('#redetect').onclick = () => detect(true);

loadFiles();
