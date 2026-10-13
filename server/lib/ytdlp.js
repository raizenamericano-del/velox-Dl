'use strict';

const { spawn, spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');
const config = require('../config');

/**
 * yt-dlp engine wrapper.
 *
 * Resolution order for the binary:
 *   1. YT_DLP_PATH env var
 *   2. `yt-dlp` on PATH            (Docker image / apt / brew / pipx)
 *   3. `python3 -m yt_dlp`         (pip install inside the image)
 *   4. vendored ./vendor/yt-dlp    (auto-downloaded standalone binary)
 *
 * The vendored copy is kept fresh automatically (re-downloaded every
 * YTDLP_UPDATE_HOURS) so a deployed instance self-heals when a platform
 * changes its page structure.
 */
const VENDOR_DIR = path.join(__dirname, '..', '..', 'vendor');
const VENDORED = path.join(VENDOR_DIR, 'yt-dlp');
const STATE_FILE = path.join(VENDOR_DIR, '.installed-at');

/** Bytes available on the volume holding `dir` (Infinity when we cannot tell). */
function freeBytes(dir) {
  try {
    const st = fs.statfsSync(dir);
    return st.bavail * st.bsize;
  } catch { return Infinity; }
}

/** Prefer os.tmpdir(); fall back to ./.tmp when that volume is unusable. */
function resolveTmpDir() {
  const candidates = [config.tmpDir, path.join(__dirname, '..', '..', '.tmp')];
  for (const dir of candidates) {
    try {
      fs.mkdirSync(dir, { recursive: true });
      fs.accessSync(dir, fs.constants.W_OK);
      return dir;
    } catch { /* try next */ }
  }
  return candidates[0];
}

const TMP_DIR = resolveTmpDir();
/** Minimum headroom before we let a merge write to disk. */
const MIN_FREE_BYTES = 150 * 1024 * 1024;

/** Delete every artefact of one merge job (incl. .part / .fNNN.* / .temp.*). */
async function purgeTemp(basePath) {
  try {
    const dir = path.dirname(basePath);
    const base = path.basename(basePath);
    const files = await fs.promises.readdir(dir);
    await Promise.all(
      files.filter((f) => f.startsWith(base))
        .map((f) => fs.promises.unlink(path.join(dir, f)).catch(() => {})),
    );
  } catch { /* nothing to clean */ }
}

/** Remove merge leftovers older than an hour (crashed jobs, killed workers). */
async function sweepStaleTemp(maxAgeMs = 3_600_000) {
  try {
    const files = await fs.promises.readdir(TMP_DIR);
    const cutoff = Date.now() - maxAgeMs;
    await Promise.all(files.filter((f) => f.startsWith('velox-')).map(async (f) => {
      const full = path.join(TMP_DIR, f);
      const st = await fs.promises.stat(full).catch(() => null);
      if (st && st.mtimeMs < cutoff) await fs.promises.unlink(full).catch(() => {});
    }));
  } catch { /* ignore */ }
}

const RELEASE_BASE = 'https://github.com/yt-dlp/yt-dlp/releases/latest/download';
const ASSET = process.platform === 'linux' ? 'yt-dlp_linux'
  : process.platform === 'darwin' ? 'yt-dlp_macos'
  : 'yt-dlp';

let resolved = null;   // { kind: 'bin'|'module', path?, module? }
let versionCache = null;
let ffmpegCache;
let updating = null;

function detectFfmpeg() {
  if (ffmpegCache !== undefined) return ffmpegCache;
  try {
    const r = spawnSync(config.ffmpegPath, ['-version'], { stdio: 'ignore', timeout: 5000 });
    ffmpegCache = r.status === 0;
  } catch { ffmpegCache = false; }
  return ffmpegCache;
}

function onPath(cmd) {
  try {
    const probe = process.platform === 'win32' ? 'where' : 'command';
    const r = probe === 'command'
      ? spawnSync('sh', ['-c', `command -v ${cmd}`], { encoding: 'utf8', timeout: 5000 })
      : spawnSync(probe, [cmd], { encoding: 'utf8', timeout: 5000 });
    return r.status === 0 && !!String(r.stdout || '').trim();
  } catch { return false; }
}

/** Find a usable engine. Cheap after the first call. */
function locate({ force = false } = {}) {
  if (resolved && !force) return resolved;

  if (config.ytdlpPath) {
    resolved = { kind: 'bin', path: config.ytdlpPath, source: 'env' };
    return resolved;
  }
  if (fs.existsSync(VENDORED)) {
    try { fs.chmodSync(VENDORED, 0o755); } catch { /* ignore */ }
    resolved = { kind: 'bin', path: VENDORED, source: 'vendor' };
    return resolved;
  }
  if (onPath('yt-dlp')) { resolved = { kind: 'bin', path: 'yt-dlp', source: 'path' }; return resolved; }

  for (const py of ['python3', 'python']) {
    const r = spawnSync(py, ['-c', 'import yt_dlp; print(yt_dlp.version.__version__)'], { encoding: 'utf8', timeout: 15_000 });
    if (r.status === 0 && r.stdout.trim()) { resolved = { kind: 'module', path: py, source: 'python-module' }; return resolved; }
  }

  resolved = null;
  return null;
}

/**
 * Splits the launch command from its prefix.
 *   bin    → { cmd: '/usr/bin/yt-dlp', prefix: [] }
 *   module → { cmd: 'python3',         prefix: ['-m','yt_dlp'] }
 * Kept explicit because `slice(1)` on the combined array silently eats the
 * binary path and makes spawn() run the first *flag* as a command.
 */
function launch() {
  const engine = locate();
  if (!engine) throw new Error('yt-dlp not found');
  return engine.kind === 'bin'
    ? { cmd: engine.path, prefix: [] }
    : { cmd: engine.path, prefix: ['-m', 'yt_dlp'] };
}

/** Download the standalone binary into ./vendor (used when nothing else is available). */
async function downloadVendored({ log = console.log } = {}) {
  fs.mkdirSync(VENDOR_DIR, { recursive: true });
  const url = `${RELEASE_BASE}/${ASSET}`;
  log(`[engine] downloading yt-dlp (${ASSET}) → ${VENDORED}`);
  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok || !res.body) throw new Error(`download failed: HTTP ${res.status}`);

  const tmp = `${VENDORED}.part`;
  await fs.promises.writeFile(tmp, Buffer.from(await res.arrayBuffer()));
  await fs.promises.rename(tmp, VENDORED);
  await fs.promises.chmod(VENDORED, 0o755);
  await fs.promises.writeFile(STATE_FILE, new Date().toISOString());
  resolved = { kind: 'bin', path: VENDORED, source: 'vendor' };
  versionCache = null;
  return VENDORED;
}

function vendoredAgeHours() {
  try {
    const at = Date.parse(fs.readFileSync(STATE_FILE, 'utf8'));
    if (!Number.isFinite(at)) return Infinity;
    return (Date.now() - at) / 3_600_000;
  } catch { return Infinity; }
}

/** Keep the vendored engine fresh. Never throws — an update failure is not fatal. */
async function maybeUpdate({ log = console.log } = {}) {
  if (!config.ytdlpAutoUpdate) return { updated: false, reason: 'disabled' };
  const engine = locate();
  if (!engine || engine.source !== 'vendor') return { updated: false, reason: 'engine-managed-elsewhere' };
  const age = vendoredAgeHours();
  if (age < config.ytdlpUpdateHours) return { updated: false, reason: `fresh (${age.toFixed(1)}h old)` };
  if (updating) return updating;
  updating = (async () => {
    try {
      const before = await version();
      await downloadVendored({ log });
      const after = await version({ force: true });
      log(`[engine] yt-dlp updated ${before} → ${after}`);
      return { updated: true, from: before, to: after };
    } catch (err) {
      log(`[engine] auto-update failed (keeping current): ${err.message}`);
      return { updated: false, reason: err.message };
    } finally { updating = null; }
  })();
  return updating;
}

/** Read the version straight from the binary (blocking, but ~20ms). */
function versionSync({ force = false } = {}) {
  if (versionCache && !force) return versionCache;
  try {
    const { cmd, prefix } = launch();
    const r = spawnSync(cmd, prefix.concat(['--version']), { encoding: 'utf8', timeout: 20_000 });
    versionCache = (r.stdout || '').trim() || null;
  } catch { versionCache = null; }
  return versionCache;
}

async function version(opts) { return versionSync(opts); }

/** One-shot engine health report for /api/health. */
function status() {
  const engine = locate();
  return {
    engine: 'yt-dlp',
    available: !!engine,
    source: engine?.source || null,
    // resolve on demand: /api/health is the Railway health check and must be
    // correct even if no resolve has run yet
    version: versionCache || (engine ? versionSync() : null),
    ffmpeg: detectFfmpeg(),
    cookies: !!config.cookiesFile,
    cache: config.cacheTtlMs / 60000,
  };
}

/**
 * Extract metadata as JSON.
 * @returns {Promise<object>} parsed `-J` output
 */
function getInfo(url, { playlist = false, playlistItems, timeoutMs = config.resolveTimeoutMs, signal } = {}) {
  return new Promise((resolve, reject) => {
    let engine;
    try { engine = locate(); } catch (err) { return reject(err); }
    if (!engine) return reject(new Error('yt-dlp not found on this server'));

    const { cmd, prefix } = launch();
    const args = prefix.concat([
      '-J', '--no-warnings', '--no-progress',
      '--socket-timeout', '20', '--retries', '2', '--fragment-retries', '2',
      '--user-agent', config.userAgent,
    ]);
    if (playlist) {
      args.push('--flat-playlist', '--playlist-items', String(playlistItems || `1-${config.maxPlaylistItems}`));
    } else {
      args.push('--no-playlist');
    }
    if (config.cookiesFile) args.push('--cookies', config.cookiesFile);
    args.push('--', url);

    const child = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    let err = '';
    let done = false;

    const timer = setTimeout(() => {
      if (done) return;
      done = true;
      child.kill('SIGKILL');
      reject(new Error(`timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    const onAbort = () => { if (!done) { done = true; child.kill('SIGKILL'); reject(new Error('aborted')); } };
    if (signal) signal.addEventListener('abort', onAbort, { once: true });

    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { err += d; });

    child.on('error', (e) => { clearTimeout(timer); if (!done) { done = true; reject(e); } });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (done) return;
      done = true;
      if (signal) signal.removeEventListener('abort', onAbort);
      if (code === 0 && out.trim()) {
        try { return resolve(JSON.parse(out)); } catch { return reject(new Error('Unable to parse extractor output')); }
      }
      const e = new Error(err.trim() || out.trim() || `exit code ${code}`);
      e.stderr = err;
      e.exitCode = code;
      reject(e);
    });
  });
}

const crypto = require('crypto');

/**
 * Prepare a media stream for an HTTP response.
 *
 * Three modes, chosen because each was verified against real yt-dlp behaviour:
 *
 *  A. pipe      — single format, no post-processing. yt-dlp stdout → response.
 *                 Fastest, zero disk.
 *  B. transcode — MP3. yt-dlp stdout → ffmpeg stdin → ffmpeg stdout → response.
 *                 Required because yt-dlp's own "-x --audio-format mp3" is
 *                 silently ignored when output is stdout, which would ship an
 *                 M4A container labelled as MP3.
 *  C. temp-file — merged "video+audio". MP4 muxing needs seekable output, so
 *                 piping crashes ffmpeg (exit -11). We download to a temp file
 *                 and stream that, then delete it.
 *
 * @returns {Promise<{stream, cleanup, mode, size, ext}>}
 */
async function prepareStream(url, { format, audioFormat, ext = 'mp4', bitrate = 192 } = {}) {
  const engine = locate();
  if (!engine) throw new Error('yt-dlp not found on this server');

  const { cmd, prefix } = launch();
  const baseArgs = prefix.concat([
    '--no-warnings', '--no-progress', '--no-playlist',
    '--socket-timeout', '20', '--retries', '3',
    '--user-agent', config.userAgent,
    '--restrict-filenames',
  ]);
  if (config.cookiesFile) baseArgs.push('--cookies', config.cookiesFile);

  const children = [];
  const track = (child) => {
    children.push(child);
    let err = '';
    child.stderr?.on('data', (d) => { err += d; if (err.length > 4000) err = err.slice(-4000); child.lastStderr = err; });
    child.on('close', (code) => { if (code !== 0) child.emit('engine-error', err.trim() || `exit ${code}`); });
    return child;
  };
  const cleanup = () => { for (const c of children) { try { if (!c.killed) c.kill('SIGKILL'); } catch { /* already gone */ } } };
  const onEngineError = (cb) => { for (const c of children) c.on('engine-error', cb); };

  // ── B. MP3 via ffmpeg pipe ─────────────────────────────────────────────
  if (audioFormat === 'mp3') {
    if (!detectFfmpeg()) throw new Error('ffmpeg required for MP3 conversion');
    const dl = track(spawn(cmd, baseArgs.concat(['-f', format || 'bestaudio/best', '-o', '-', '--', url]), { stdio: ['ignore', 'pipe', 'pipe'] }));
    const ff = track(spawn(config.ffmpegPath, [
      '-hide_banner', '-loglevel', 'error',
      '-i', 'pipe:0', '-vn', '-f', 'mp3', '-b:a', `${bitrate}k`, 'pipe:1',
    ], { stdio: ['pipe', 'pipe', 'pipe'] }));

    dl.stdout.pipe(ff.stdin);
    dl.on('engine-error', (msg) => ff.emit('engine-error', msg));
    ff.stdin.on('error', () => { /* upstream closed early */ });

    return { stream: ff.stdout, cleanup, onEngineError, mode: 'transcode', ext: 'mp3', size: null };
  }

  // ── C. merged video+audio → temp file, then stream ─────────────────────
  const needsMerge = typeof format === 'string' && format.includes('+');
  if (needsMerge) {
    if (!detectFfmpeg()) throw new Error('ffmpeg required to merge video+audio');
    const outExt = ext === 'mp4' ? 'mp4' : 'mkv';
    // No extension in the template on purpose: yt-dlp renames the target to
    // match the muxed container (vp9+opus lands as "<name>.mp4.webm"), so a
    // fixed ".mp4" path would stat a file that never existed.
    const free = freeBytes(TMP_DIR);
    if (free < MIN_FREE_BYTES) {
      throw new Error(`No space left on device (only ${Math.round(free / 1048576)} MB free, need ${Math.round(MIN_FREE_BYTES / 1048576)} MB)`);
    }
    const tmpBase = path.join(TMP_DIR, `velox-${crypto.randomBytes(8).toString('hex')}`);
    const dl = track(spawn(cmd, baseArgs.concat([
      '-f', format,
      '--merge-output-format', outExt,
      '-o', tmpBase,
      '--', url,
    ]), { stdio: ['ignore', 'pipe', 'pipe'] }));

    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => { cleanup(); reject(new Error(`timed out after ${config.resolveTimeoutMs * 4}ms`)); }, config.resolveTimeoutMs * 4);
      dl.on('close', (code) => {
        clearTimeout(timer);
        if (code === 0) return resolve();
        purgeTemp(tmpBase).finally(() => reject(new Error(dl.lastStderr || `engine failed (exit ${code})`)));
      });
      dl.on('error', (e) => { clearTimeout(timer); purgeTemp(tmpBase).finally(() => reject(e)); });
    });

    // find whatever yt-dlp actually produced (extension may differ)
    const produced = (await fs.promises.readdir(TMP_DIR))
      .filter((f) => f.startsWith(path.basename(tmpBase)))
      .map((f) => path.join(TMP_DIR, f))
      .sort((a, b) => a.length - b.length)[0];

    const stat = produced ? await fs.promises.stat(produced).catch(() => null) : null;
    if (!produced || !stat || stat.size === 0) {
      await purgeTemp(tmpBase);
      throw new Error(dl.lastStderr || 'merged output is empty');
    }
    const realExt = path.extname(produced).replace('.', '') || outExt;
    const stream = fs.createReadStream(produced);
    let purged = false;
    const removeTemp = () => { if (purged) return; purged = true; stream.close?.(); purgeTemp(tmpBase); };
    stream.on('close', removeTemp);
    stream.on('error', removeTemp);

    return {
      stream,
      cleanup: () => { cleanup(); removeTemp(); },
      onEngineError,
      mode: 'tempfile', ext: realExt, size: stat.size,
    };
  }

  // ── A. single format, straight pipe ────────────────────────────────────
  const sel = format || (audioFormat ? 'bestaudio/best' : 'b');
  const dl = track(spawn(cmd, baseArgs.concat(['-f', sel, '-o', '-', '--', url]), { stdio: ['ignore', 'pipe', 'pipe'] }));
  return { stream: dl.stdout, cleanup, onEngineError, mode: 'pipe', ext, size: null };
}

module.exports = {
  locate, getInfo, prepareStream, version, versionSync, status, maybeUpdate, downloadVendored,
  detectFfmpeg, hasFfmpeg: detectFfmpeg, sweepStaleTemp, freeBytes, TMP_DIR,
  VENDORED, VENDOR_DIR, ASSET, os: os.platform(),
  isAvailable: () => !!locate(),
  path: () => locate()?.path || null,
};
