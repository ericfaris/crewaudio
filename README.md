# crewaudio

Minimal Node.js audiobook player: import audio from YouTube playlists, play them
grouped as "books", resume where you left off, and auto-split tracks into chapters
by silence.

## Requirements

- Node 18+ (no npm dependencies — pure Node)
- `ffmpeg` + `ffprobe` on PATH — audio conversion + chapter detection
- `yt-dlp` for YouTube import. Looked for at `$YT_DLP`, `~/.local/bin/yt-dlp`,
  `/usr/local/bin/yt-dlp`, `/usr/bin/yt-dlp`, then `yt-dlp` on PATH.
  Install the standalone binary:
  ```bash
  curl -L -o ~/.local/bin/yt-dlp https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_linux
  chmod +x ~/.local/bin/yt-dlp
  ```

## Run

```bash
npm start          # → http://localhost:3000  (set PORT to change)
```

## Import a playlist

**From the UI:** paste a YouTube playlist (or single video) URL into the box in
the sidebar, optionally name the folder, click **Import audio**. Progress streams
live. Each video becomes `audio/<playlist title>/NN - <video title>.mp3` with
metadata and cover art embedded.

**From the CLI:**
```bash
node import.js "https://www.youtube.com/playlist?list=..." --name "My Book"
```

## Playing

- The sidebar groups tracks by folder — one folder = one book. Click a track to
  play; playback auto-advances to the next track in that book (toggle off with
  **Auto-advance**), and ⏮/⏭ move between tracks.
- Your position in every track is saved in the browser (`localStorage`) and
  restored on reload. Finished tracks show ✓; partial ones show a percentage.

## Chapters

Click **Detect** on a playing track to scan for silences (`ffmpeg silencedetect`)
and split it into chapters. Tune the noise floor (dB), minimum silence length,
and the minimum gap that counts as a chapter break. Cached in `.cache/` per
file+params; **force** re-runs.

## API

| Endpoint | Purpose |
|---|---|
| `GET /api/files` | all audio files (with subfolder paths) |
| `GET /audio/<path>` | range-enabled audio stream |
| `GET /api/chapters?file=<path>&noise=-30&minSilence=0.5&gap=1.5&force=1` | chapter detection |
| `GET /api/import?url=<yt-url>&name=<folder>` | SSE stream of import progress |
| `GET /api/yt-dlp` | resolved yt-dlp path |
