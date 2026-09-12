FROM node:22-slim

WORKDIR /app

# ffmpeg: audio extraction/transcoding for imports and the chapter API.
# curl: yt-dlp download + the compose healthcheck.
# yt-dlp: standalone binary (needs a JS runtime — Node, already in this image —
# passed as `--js-runtimes node` by import.js).
RUN apt-get update && apt-get upgrade -y && apt-get install -y --no-install-recommends \
      ffmpeg curl ca-certificates \
    && rm -rf /var/lib/apt/lists/* \
    && curl -fsSL -o /usr/local/bin/yt-dlp \
       https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_linux \
    && chmod +x /usr/local/bin/yt-dlp

COPY package*.json ./
RUN npm ci --omit=dev || npm install --omit=dev

COPY server.js import.js ./
COPY public/ ./public/
COPY tools/ ./tools/

# audio/ and .cache/ are bind-mounted at runtime; create them so the first
# start doesn't race mkdir, and hand /app to the unprivileged node user (uid
# 1000, which also owns the host-side ./audio).
RUN mkdir -p /app/audio /app/.cache && chown -R node:node /app
USER node

ENV PORT=8250 \
    YT_DLP=/usr/local/bin/yt-dlp \
    NODE_ENV=production
EXPOSE 8250

HEALTHCHECK --interval=1m --timeout=10s --start-period=20s --retries=3 \
  CMD curl -fsS http://localhost:8250/api/files || exit 1

CMD ["node", "server.js"]
