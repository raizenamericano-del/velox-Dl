'use strict';

const express = require('express');
const compression = require('compression');
const path = require('path');
const fs = require('fs');
const net = require('net');

const config = require('./config');
const engine = require('./lib/ytdlp');
const { TtlCache } = require('./lib/cache');
const { rateLimit } = require('./lib/ratelimit');
const { AppError, friendlyError } = require('./lib/errors');
const { PLATFORMS, normalizeUrl, detect } = require('./lib/detect');
const resolvers = require('./resolvers');

const cache = new TtlCache({ max: config.cacheMaxEntries, ttlMs: config.cacheTtlMs });
const app = express();
const started = Date.now();

app.disable('x-powered-by');
app.set('trust proxy', config.trustProxy);
app.use(compression({ threshold: 1024 }));
app.use(express.json({ limit: '32kb' }));

app.use((req, res, next) => {
  res.set('X-Content-Type-Options', 'nosniff');
  res.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.set('X-Frame-Options', 'SAMEORIGIN');
  if (req.path.startsWith('/api')) res.set('Access-Control-Allow-Origin', config.corsOrigin);
  next();
});
app.options('/api/*', (req, res) => {
  res.set('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.set('Access-Control-Allow-Headers', 'Content-Type');
  res.sendStatus(204);
});

// ── Hosts we are willing to proxy (keeps /api/dl from becoming an open relay) ──
const ALLOWED_CDN_SUFFIXES = [
  'tiktokcdn.com', 'tiktokcdn-us.com', 'tiktok.com', 'muscdn.com', 'byteoversea.com', 'tiktokv.com',
  'twimg.com', 'twitter.com', 'x.com', 'pscp.tv',
  'instagram.com', 'cdninstagram.com', 'fbcdn.net', 'facebook.com', 'fb.watch', 'fbsbx.com',
  'pinimg.com', 'pinterest.com', 'pinterest.co.id',
  'sc-cdn.net', 'snapchat.com', 'snap-dev.net',
  'xhscdn.com', 'xiaohongshu.com', 'xhslink.com', 'xhscdn.net',
  'threads.net', 'threads.com',
  'licdn.com', 'linkedin.com',
  'vimeocdn.com', 'vimeo.com', 'dmcdn.net', 'dailymotion.com',
  'ttvnw.net', 'twitch.tv', 'jtvnw.net',
  'sndcdn.com', 'soundcloud.com',
  'googlevideo.com', 'ggpht.com', 'ytimg.com', 'googleapis.com',
  'cobalt.tools', 'imput.net', 'tikwm.com',
];

function hostAllowed(rawUrl) {
  let u;
  try { u = new URL(rawUrl); } catch { return false; }
  if (!/^https?:$/.test(u.protocol)) return false;
  const host = u.hostname.toLowerCase();
  // never proxy to private/loopback ranges
  if (host === 'localhost' || host.endsWith('.local') || host.endsWith('.internal')) return false;
  if (net.isIP(host)) {
    const parts = host.split('.').map(Number);
    if (parts[0] === 10 || parts[0] === 127 || parts[0] === 0) return false;
    if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return false;
    if (parts[0] === 192 && parts[1] === 168) return false;
    if (parts[0] === 169 && parts[1] === 254) return false;
    if (host.startsWith('fc') || host.startsWith('fd') || host === '::1') return false;
    return false; // arbitrary IPs are not proxied
  }
  return ALLOWED_CDN_SUFFIXES.some((s) => host === s || host.endsWith(`.${s}`));
}

function contentDisposition(filename) {
  const safe = String(filename || 'velox-media').replace(/["\\\r\n]/g, '_').slice(0, 140);
  const ascii = safe.replace(/[^\x20-\x7E]/g, '_');
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(safe)}`;
}

const EXT_MIME = {
  mp4: 'video/mp4', webm: 'video/webm', mov: 'video/quicktime', m4v: 'video/mp4',
  mp3: 'audio/mpeg', m4a: 'audio/mp4', opus: 'audio/ogg', ogg: 'audio/ogg', wav: 'audio/wav', flac: 'audio/flac',
  jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif',
};

// ── Routes ───────────────────────────────────────────────────────────────

app.get('/api/health', (req, res) => {
  const st = engine.status();
  const healthy = st.available !== false;
  res.status(healthy ? 200 : 503).json({
    status: healthy ? 'ok' : 'degraded',
    app: config.appName,
    uptimeSeconds: Math.round((Date.now() - started) / 1000),
    timestamp: new Date().toISOString(),
    engine: st,
    cache: cache.stats(),
    queue: { active: resolvers.engineSlot.active, pending: resolvers.engineSlot.pending },
    disk: { tmpDir: engine.TMP_DIR, freeMB: Math.round((engine.freeBytes(engine.TMP_DIR) || 0) / 1048576) },
    limits: { maxMergeHeight: config.maxMergeHeight, cacheMinutes: config.cacheTtlMs / 60000 },
    platforms: PLATFORMS.length,
  });
});

app.get('/api/platforms', (req, res) => {
  res.json({
    ok: true,
    count: PLATFORMS.length,
    platforms: PLATFORMS.map((p) => ({ id: p.id, name: p.name, tier: p.tier, kinds: p.kinds, engine: p.engine, sample: p.sample })),
  });
});

app.get('/api/detect', (req, res) => {
  try {
    const u = normalizeUrl(req.query.url);
    res.json({ ok: true, platform: detect(u) });
  } catch (err) {
    res.status(err.status || 400).json({ ok: false, error: (err instanceof AppError ? err : friendlyError(err)).toJSON() });
  }
});

const resolveLimiter = rateLimit({
  windowMs: config.rateWindowMs,
  max: config.rateMaxResolve,
  keyPrefix: 'resolve',
  message: 'Terlalu banyak request. Tunggu sebentar lalu coba lagi ya.',
});

app.post('/api/resolve', resolveLimiter, async (req, res) => {
  const t0 = Date.now();
  let urlObj;
  try {
    urlObj = normalizeUrl((req.body && req.body.url) || req.query.url);
  } catch (err) {
    return res.status(err.status || 400).json({ ok: false, error: err.toJSON() });
  }

  const platform = detect(urlObj);
  const forceRefresh = req.body?.refresh === true;
  const cacheKey = `${urlObj.href}`;

  if (!forceRefresh) {
    const hit = cache.get(cacheKey);
    if (hit) return res.json({ ...hit, cached: true, ms: Date.now() - t0, platform: { ...platform, ...hit.platformMeta } });
  }

  try {
    const result = await resolvers.resolve({ url: urlObj, platform, signal: req.signal });
    const payload = {
      ...result,
      cached: false,
      ms: Date.now() - t0,
    };
    cache.set(cacheKey, payload);
    res.json(payload);
  } catch (err) {
    const friendly = err instanceof AppError ? err : friendlyError(err, { platform: platform.name });
    const body = friendly.toJSON();
    if (err.attempts) body.attempts = err.attempts;
    res.status(friendly.status || 500).json({ ok: false, error: body });
  }
});

const downloadLimiter = rateLimit({
  windowMs: config.rateWindowMs,
  max: config.rateMaxDownload,
  keyPrefix: 'download',
  message: 'Batas download tercapai. Tunggu sebentar ya.',
});

/**
 * /api/dl — single download gateway.
 *   t=direct  → proxy an allowlisted CDN url (keeps referer/UA server-side)
 *   t=engine  → stream through yt-dlp (handles merge + audio conversion)
 */
app.get('/api/dl', downloadLimiter, async (req, res) => {
  const type = req.query.t === 'engine' ? 'engine' : 'direct';
  const target = String(req.query.u || '');
  const filename = String(req.query.n || 'velox-media');
  const ext = String(req.query.x || '').toLowerCase();

  try {
    if (!target) throw new AppError('MISSING_TARGET', { status: 400, title: 'Link download kosong', message: 'Parameter url tidak ada.' });

    // ── engine streaming ────────────────────────────────────────────────
    if (type === 'engine') {
      if (!engine.isAvailable()) {
        return res.status(503).json({ ok: false, error: { code: 'ENGINE_MISSING', title: 'Engine belum siap', message: 'yt-dlp tidak tersedia di server ini.' } });
      }
      const audioFormat = req.query.a === 'mp3' ? 'mp3' : req.query.a === 'native' ? 'native' : null;
      const outExt = audioFormat === 'mp3' ? 'mp3' : ext || 'mp4';
      let prepared;
      try {
        prepared = await engine.prepareStream(target, {
          format: req.query.f ? String(req.query.f) : undefined,
          audioFormat,
          ext: outExt,
        });
      } catch (err) {
        const friendly = friendlyError(err);
        const status = /ffmpeg/i.test(err.message || '') ? 501 : friendly.status || 500;
        return res.status(status).json({ ok: false, error: friendly.toJSON() });
      }

      const finalExt = prepared.ext || outExt;
      res.setHeader('Content-Type', finalExt === 'mp3' ? 'audio/mpeg' : EXT_MIME[finalExt] || 'application/octet-stream');
      res.setHeader('Content-Disposition', contentDisposition(`${filename}.${finalExt}`));
      res.setHeader('Cache-Control', 'private, max-age=300');
      res.setHeader('X-VELOX-Engine', `yt-dlp/${prepared.mode}`);
      if (prepared.size) res.setHeader('Content-Length', prepared.size);

      let sent = false;
      prepared.stream.once('data', () => { sent = true; });
      prepared.stream.pipe(res);

      prepared.onEngineError((msg) => {
        if (res.headersSent || sent) { res.destroy(); return; }
        res.status(422).json({ ok: false, error: friendlyError(new Error(msg)).toJSON() });
      });
      prepared.stream.on('error', () => { if (!res.headersSent) res.status(502).end(); else res.destroy(); });
      req.on('close', prepared.cleanup);
      res.on('close', prepared.cleanup);
      return;
    }

    // ── direct CDN proxy ────────────────────────────────────────────────
    if (!config.allowDirectProxy) {
      throw new AppError('PROXY_DISABLED', { status: 403, title: 'Proxy dimatikan', message: 'Server ini tidak mengizinkan proxy media langsung.' });
    }
    if (!hostAllowed(target)) {
      throw new AppError('HOST_NOT_ALLOWED', { status: 403, title: 'Domain tidak diizinkan', message: 'VELOX hanya mem-proxy CDN platform yang dikenal.' });
    }

    const headers = {
      'user-agent': config.userAgent,
      'accept': '*/*',
      'accept-language': 'en-US,en;q=0.9',
    };
    const referer = req.query.r ? String(req.query.r) : null;
    if (referer && /^https?:\/\//.test(referer)) headers.referer = referer;
    if (/tiktok/i.test(referer || '') || /tiktok/i.test(target)) headers.referer = 'https://www.tiktok.com/';
    if (/instagram|cdninstagram/i.test(target)) headers.referer = 'https://www.instagram.com/';
    if (req.headers.range) headers.range = req.headers.range;

    const upstream = await fetch(target, { headers, redirect: 'follow' });
    if (!upstream.ok) {
      throw new AppError('UPSTREAM_FETCH_FAILED', {
        status: 502,
        title: 'File tidak bisa diambil 😕',
        message: `CDN asal menolak (HTTP ${upstream.status}). Link media biasanya punya masa berlaku — coba resolve ulang.`,
        hint: 'Tekan tombol ambil ulang, lalu download lagi.',
      });
    }

    const mime = String(req.query.m || upstream.headers.get('content-type') || EXT_MIME[ext] || 'application/octet-stream').split(';')[0];
    res.setHeader('Content-Type', mime);
    res.setHeader('Content-Disposition', contentDisposition(`${filename}.${ext || mime.split('/')[1]?.replace(/^jpeg$/, 'jpg') || 'bin'}`));
    res.setHeader('Cache-Control', 'private, max-age=600');
    const len = upstream.headers.get('content-length');
    if (len) res.setHeader('Content-Length', len);
    if (upstream.status === 206) {
      res.status(206);
      const cr = upstream.headers.get('content-range');
      if (cr) res.setHeader('Content-Range', cr);
      res.setHeader('Accept-Ranges', 'bytes');
    } else {
      res.setHeader('Accept-Ranges', 'bytes');
    }

    const reader = upstream.body.getReader();
    const pump = async () => {
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          if (!res.write(value)) await new Promise((r) => res.once('drain', r));
        }
        res.end();
      } catch { res.destroy(); }
    };
    req.on('close', () => { try { reader.cancel(); } catch { /* already closed */ } });
    pump();
  } catch (err) {
    const friendly = err instanceof AppError ? err : friendlyError(err);
    if (res.headersSent) return res.destroy();
    res.status(friendly.status || 500).json({ ok: false, error: friendly.toJSON() });
  }
});

// ── Static frontend ─────────────────────────────────────────────────────
const publicDir = path.join(__dirname, '..', 'public');
app.use(express.static(publicDir, {
  extensions: ['html'],
  setHeaders(res, filePath) {
    if (filePath.endsWith('.html')) res.setHeader('Cache-Control', 'no-cache');
    else if (/\.(js|css|svg|png|webmanifest)$/.test(filePath)) res.setHeader('Cache-Control', 'public, max-age=3600');
  },
}));

app.get('/manifest.webmanifest', (req, res) => {
  res.type('application/manifest+json').send(JSON.stringify({
    name: `${config.appName} — All-in-One Downloader`,
    short_name: config.appName,
    description: config.tagline,
    start_url: '/',
    display: 'standalone',
    background_color: '#07070c',
    theme_color: '#07070c',
    icons: [{ src: '/icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' }],
  }));
});

// ── Errors ──────────────────────────────────────────────────────────────
app.use('/api', (req, res) => res.status(404).json({ ok: false, error: { code: 'NOT_FOUND', title: 'Endpoint tidak ada', message: `${req.method} ${req.originalUrl} bukan endpoint yang dikenal.` } }));

app.use((req, res) => {
  if (req.path.startsWith('/api')) return res.status(404).json({ ok: false, error: { code: 'NOT_FOUND', title: 'Endpoint tidak ada', message: 'Coba /api/health.' } });
  res.status(404).sendFile(path.join(publicDir, '404.html'), (err) => { if (err) res.status(404).send('Not found'); });
});

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  if (err?.type === 'entity.parse.failed') {
    return res.status(400).json({ ok: false, error: { code: 'BAD_JSON', title: 'Body JSON rusak', message: 'Server tidak bisa membaca body request.' } });
  }
  const friendly = friendlyError(err);
  console.error(`[error] ${req.method} ${req.originalUrl} →`, err.message);
  if (res.headersSent) return res.destroy();
  res.status(500).json({ ok: false, error: friendly.toJSON() });
});

// ── Boot ────────────────────────────────────────────────────────────────
async function boot() {
  const log = (...a) => console.log(...a);

  if (!engine.isAvailable() && config.ytdlpAutoInstall) {
    try {
      await engine.downloadVendored({ log });
      log(`[engine] installed yt-dlp ${await engine.version({ force: true })}`);
    } catch (err) {
      log(`[engine] auto-install failed: ${err.message} — falling back to API-only resolvers`);
    }
  } else {
    await engine.version({ force: true });
  }

  // keep the vendored engine fresh (self-heals when platforms change markup)
  engine.maybeUpdate({ log }).then(() => {
    setInterval(() => { engine.maybeUpdate({ log }).catch(() => {}); }, 6 * 3_600_000).unref();
  }).catch(() => {});

  // merge jobs write temp files; make sure crashed ones never accumulate
  await engine.sweepStaleTemp().catch(() => {});
  setInterval(() => { engine.sweepStaleTemp().catch(() => {}); }, 3_600_000).unref();

  const st = engine.status();
  const server = app.listen(config.port, config.host, () => {
    log('');
    log(`  ⚡ ${config.appName}  —  ${config.tagline}`);
    log(`  ▸ http://${config.host}:${config.port}   (${config.nodeEnv})`);
    log(`  ▸ engine: yt-dlp ${st.version || 'n/a'} [${st.source || 'missing'}] · ffmpeg ${st.ffmpeg ? 'yes' : 'no'} · ${PLATFORMS.length} platforms`);
    log(`  ▸ cache TTL ${config.cacheTtlMs / 60000}m · rate ${config.rateMaxResolve} resolve / ${config.rateMaxDownload} download per ${config.rateWindowMs / 1000}s`);
    log(`  ▸ merge cap ${config.maxMergeHeight}p · tmp ${engine.TMP_DIR} (${Math.round(engine.freeBytes(engine.TMP_DIR) / 1048576)} MB free)`);
    log('');
  });

  server.keepAliveTimeout = 65_000;
  server.headersTimeout = 66_000;

  const shutdown = (sig) => () => {
    log(`\n[${sig}] shutting down…`);
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 8000).unref();
  };
  process.on('SIGTERM', shutdown('SIGTERM'));
  process.on('SIGINT', shutdown('SIGINT'));
  return server;
}

if (require.main === module) {
  boot().catch((err) => { console.error('boot failed:', err); process.exit(1); });
}

module.exports = { app, boot, cache, hostAllowed, contentDisposition };
