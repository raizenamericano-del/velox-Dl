'use strict';

const engine = require('../lib/ytdlp');
const { normalizeYtDlp } = require('./normalize');
const { isPlaylistUrl } = require('../lib/detect');
const { AppError } = require('../lib/errors');
const config = require('../config');

/**
 * Universal resolver: yt-dlp handles 1800+ sites, which is why it is both the
 * primary engine for most platforms and the last-resort fallback for all of them.
 */
async function viaEngine(ctx) {
  if (!engine.isAvailable()) {
    throw new AppError('ENGINE_MISSING', {
      status: 503,
      title: 'Engine belum siap ⚙️',
      message: 'yt-dlp belum terpasang di server ini, jadi link belum bisa diproses.',
      hint: 'Jalankan `node scripts/ensure-ytdlp.js` atau set YTDLP_AUTO_INSTALL=true.',
    });
  }

  const playlist = ctx.playlist ?? (ctx.platform.id === 'youtube' && isPlaylistUrl(ctx.url));
  const info = await engine.getInfo(ctx.url.href, {
    playlist,
    timeoutMs: config.resolveTimeoutMs,
    signal: ctx.signal,
  });

  const result = normalizeYtDlp(info, {
    platform: ctx.platform.id,
    platformName: ctx.platform.name,
    url: ctx.url.href,
    ffmpeg: engine.hasFfmpeg(),
    warnings: ctx.warnings || [],
  });

  if (!result.items?.length) throw new Error('No formats available');
  return result;
}

module.exports = { id: 'generic', name: 'Universal (yt-dlp)', methods: [{ name: 'engine', run: viaEngine }] };
