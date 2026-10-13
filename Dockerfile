# syntax=docker/dockerfile:1
# ==========================================================================
# VELOX — Railway-ready image
# Railway auto-detects a Dockerfile and will use it over the Node buildpack.
# Everything the engine needs (yt-dlp + ffmpeg) is baked in at build time,
# so `pip install -U yt-dlp` on every deploy keeps extraction up to date.
# ==========================================================================

FROM node:20-slim

ENV DEBIAN_FRONTEND=noninteractive \
    NODE_ENV=production \
    PYTHONUNBUFFERED=1 \
    PORT=8000

# ffmpeg      → merge video+audio, MP3 conversion
# python3/pip → yt-dlp runtime
# ca-certificates + curl → engine auto-update & health probes
RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      python3 python3-pip ffmpeg ca-certificates curl tini \
 && rm -rf /var/lib/apt/lists/*

# Latest yt-dlp on every build. `--break-system-packages` is required on
# Debian bookworm+; the fallback keeps older base images working.
RUN python3 -m pip install --no-cache-dir --break-system-packages -U yt-dlp \
 || python3 -m pip install --no-cache-dir -U yt-dlp

# Optional but recommended: yt-dlp uses a JS runtime for some YouTube formats.
# Non-fatal — extraction still works without it, just with fewer variants.
RUN (curl -fsSL https://deno.land/install.sh | sh -s -- -y \
     && ln -sf /root/.deno/bin/deno /usr/local/bin/deno) \
 || echo "[build] deno unavailable, continuing without it"

WORKDIR /app

# Install dependencies first so the layer caches between deploys
COPY package*.json ./
RUN npm ci --omit=dev || npm install --omit=dev

COPY server ./server
COPY public ./public
COPY scripts ./scripts

# Drop privileges: the app only needs to read /app and write to TMPDIR
RUN useradd -m -u 1001 velox \
 && mkdir -p /app/.tmp /app/vendor \
 && chown -R velox:velox /app
USER velox

ENV TMPDIR=/app/.tmp \
    YTDLP_AUTO_INSTALL=true \
    YTDLP_AUTO_UPDATE=true

EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD curl -fsS "http://127.0.0.1:${PORT}/api/health" || exit 1

# tini reaps zombie ffmpeg/yt-dlp processes if a client disconnects mid-download
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "server/index.js"]
