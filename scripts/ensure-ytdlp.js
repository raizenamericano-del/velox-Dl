'use strict';

/**
 * Makes sure a usable yt-dlp exists before the app starts.
 * Runs as `postinstall` and can be invoked manually: `npm run ensure-engine`.
 *
 * Never fails the build — the app degrades to API-only resolvers if this fails,
 * and the runtime will retry on boot.
 */
const { spawnSync } = require('child_process');
const path = require('path');

const engine = require('../server/lib/ytdlp');

(async () => {
  const found = engine.locate({ force: true });
  if (found) {
    const v = await engine.version({ force: true });
    console.log(`[ensure-engine] using yt-dlp ${v || '?'} (${found.source}: ${found.path})`);
    return;
  }

  if (String(process.env.YTDLP_AUTO_INSTALL).toLowerCase() === 'false') {
    console.log('[ensure-engine] YTDLP_AUTO_INSTALL=false → skipping');
    return;
  }

  // 1) try the system package manager / pip (works inside Docker images)
  const pip = spawnSync('pip3', ['install', '--quiet', '--upgrade', 'yt-dlp'], { encoding: 'utf8', timeout: 180_000 });
  if (pip.status === 0) {
    engine.locate({ force: true });
    if (engine.isAvailable()) {
      console.log(`[ensure-engine] installed via pip: yt-dlp ${await engine.version({ force: true })}`);
      return;
    }
  }

  // 2) download the standalone binary into ./vendor
  try {
    const p = await engine.downloadVendored();
    console.log(`[ensure-engine] downloaded standalone binary (${engine.ASSET}) → ${path.relative(process.cwd(), p)}`);
    console.log(`[ensure-engine] version: ${await engine.version({ force: true })}`);
  } catch (err) {
    console.warn(`[ensure-engine] WARNING: could not install yt-dlp (${err.message}).`);
    console.warn('[ensure-engine] The app will still boot, but only API-based resolvers will work.');
  }
})();
