# crewaudio

Minimal Node.js audio player with silence-based chapter detection for audiobooks.

## Run

```bash
npm start          # → http://localhost:3000  (PORT env to change)
```

No dependencies — pure Node. Requires `ffmpeg` + `ffprobe` on PATH for chapter detection.

## Use

1. Put `.mp3` / `.m4a` / `.m4b` / `.flac` / … files (subfolders OK) into `audio/`.
2. Open the page, click a file — it loads into the player and starts.
3. For audiobooks, click **Detect** to scan for silences and split into chapters.
   Click a chapter to jump to it.

## Chapter detection tuning

| Control | Meaning |
|---|---|
| Silence dB | Noise floor. Quieter than this counts as silence (`-30` default; try `-35`/`-40` for noisy recordings). |
| min s | A silence must last at least this long to register. |
| gap s | A registered silence must be at least this long to become a chapter break. |

Results are cached in `.cache/` keyed by file + params. **force** re-runs ffmpeg.

## API

- `GET /api/files` — list of audio files
- `GET /audio/<path>` — range-enabled stream
- `GET /api/chapters?file=<path>&noise=-30&minSilence=0.5&gap=1.5&force=1`
