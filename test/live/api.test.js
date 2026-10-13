'use strict';

/**
 * Live integration test — boots the real server on an ephemeral port and
 * exercises the whole stack against real upstreams.
 *
 * Run with: npm run test:live
 * Skipped automatically when VELOX_SKIP_LIVE=1 or the network is unavailable.
 */
const { test, before, after } = require('node:test');
const assert = require('node:assert');

const SKIP = process.env.VELOX_SKIP_LIVE === '1';

let server, base;

before(async (t) => {
  if (SKIP) return t.skip('VELOX_SKIP_LIVE=1');
  try {
    const probe = await fetch('https://www.tiktok.com', { method: 'HEAD', signal: AbortSignal.timeout(8000) });
    if (!probe.ok && probe.status >= 500) throw new Error('upstream unreachable');
  } catch {
    return t.skip('no network access');
  }

  const { app } = require('../../server/index');
  await new Promise((resolve) => { server = app.listen(0, '127.0.0.1', resolve); });
  base = `http://127.0.0.1:${server.address().port}`;
});

after(() => new Promise((r) => (server ? server.close(r) : r())));

const json = async (path, opts) => {
  const res = await fetch(base + path, opts);
  return { status: res.status, body: await res.json().catch(() => ({})), headers: res.headers };
};

test('GET /api/health reports a working engine', async (t) => {
  if (SKIP) return t.skip();
  const { status, body } = await json('/api/health');
  assert.strictEqual(status, 200);
  assert.strictEqual(body.status, 'ok');
  assert.strictEqual(body.engine.available, true, 'yt-dlp must be available');
  assert.ok(body.engine.version, 'engine version missing');
  assert.ok(body.platforms >= 14);
  assert.ok(body.disk?.tmpDir, 'tmp volume must be reported for operators');
});

test('GET /api/platforms lists every tier from the brief', async (t) => {
  if (SKIP) return t.skip();
  const { body } = await json('/api/platforms');
  assert.strictEqual(body.count, body.platforms.length);
  const t1 = body.platforms.filter((p) => p.tier === 1).map((p) => p.id).sort();
  const t2 = body.platforms.filter((p) => p.tier === 2).map((p) => p.id).sort();
  assert.deepStrictEqual(t1, ['facebook', 'instagram', 'tiktok', 'twitter', 'youtube']);
  assert.deepStrictEqual(t2, ['linkedin', 'pinterest', 'rednote', 'snapchat', 'threads']);
});

test('POST /api/resolve returns a downloadable TikTok result', async (t) => {
  if (SKIP) return t.skip();
  const { status, body } = await json('/api/resolve', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url: 'https://www.tiktok.com/@tiktok/video/7460937381265411370' }),
  });

  assert.strictEqual(status, 200, JSON.stringify(body.error || {}).slice(0, 300));
  assert.strictEqual(body.platform, 'tiktok');
  assert.ok(body.title?.length > 0, 'title missing');
  const formats = body.items[0].formats;
  assert.ok(formats.length >= 2, `expected several qualities, got ${formats.length}`);
  assert.ok(formats.some((f) => /tanpa watermark/i.test(f.label)), 'no-watermark option missing');
  assert.ok(formats.every((f) => f.url.startsWith('/api/dl?')), 'all links must go through the gateway');
  assert.ok(typeof body.ms === 'number' && body.ms < 20000, `resolve too slow: ${body.ms}ms`);
});

test('POST /api/resolve returns YouTube qualities including audio', async (t) => {
  if (SKIP) return t.skip();
  const { status, body } = await json('/api/resolve', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url: 'https://youtu.be/dQw4w9WgXcQ' }),
  });

  assert.strictEqual(status, 200, JSON.stringify(body.error || {}).slice(0, 300));
  const formats = body.items[0].formats;
  assert.ok(formats.some((f) => f.kind === 'video'), 'video option missing');
  assert.ok(formats.some((f) => f.kind === 'audio'), 'audio option missing');
  assert.ok(formats.some((f) => f.id === 'thumb'), 'thumbnail option missing');
  // honest labelling: either a real merged file, or an explicit "video saja"
  const video = formats.find((f) => f.kind === 'video');
  assert.ok(video.tag === 'MAX' || /video saja/i.test(video.label), 'top video option is not labelled honestly');
});

test('a resolved TikTok link really downloads MP4 bytes', async (t) => {
  if (SKIP) return t.skip();
  const { body } = await json('/api/resolve', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url: 'https://www.tiktok.com/@tiktok/video/7460937381265411370' }),
  });
  const video = body.items[0].formats.find((f) => f.kind === 'video');
  assert.ok(video, 'no video format to download');

  const res = await fetch(base + video.url, { headers: { range: 'bytes=0-1023' } });
  // 206 Partial Content is the correct reply to a Range request; the proxy
  // forwards ranges so that video seeking works in the browser.
  assert.ok([200, 206].includes(res.status), `download failed: ${res.status}`);
  assert.match(res.headers.get('content-type') || '', /video\/mp4|octet-stream/);
  assert.ok(res.headers.get('content-disposition')?.includes('attachment'), 'must force attachment');

  const buf = Buffer.from(await res.arrayBuffer());
  assert.ok(buf.length > 100, `payload too small: ${buf.length}`);
  if (res.status === 206) assert.ok(res.headers.get('content-range'), 'Content-Range required on 206');
  assert.strictEqual(buf.subarray(4, 8).toString('ascii'), 'ftyp', 'not an MP4 (missing ftyp box)');
});

test('invalid input gets a friendly error, never a raw stack', async (t) => {
  if (SKIP) return t.skip();
  const cases = [
    ['', 400, 'EMPTY_URL'],
    ['ftp://x.com/a', 400, 'INVALID_URL'],
    ['https://localhost/x', 400, 'INVALID_URL'],
  ];
  for (const [url, status, code] of cases) {
    const r = await json('/api/resolve', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url }),
    });
    assert.strictEqual(r.status, status, `${url} → ${r.status}`);
    assert.strictEqual(r.body.error.code, code);
    assert.ok(r.body.error.title, 'human title missing');
    assert.ok(!/at Object\.|node_modules/.test(JSON.stringify(r.body)), 'stack trace leaked');
  }
});

test('the proxy refuses to relay non-CDN hosts (SSRF)', async (t) => {
  if (SKIP) return t.skip();
  const r = await fetch(`${base}/api/dl?t=direct&u=${encodeURIComponent('http://127.0.0.1:3000/api/health')}`);
  assert.strictEqual(r.status, 403);
  const b = await r.json();
  assert.strictEqual(b.error.code, 'HOST_NOT_ALLOWED');
});

test('unknown API routes return JSON, not HTML', async (t) => {
  if (SKIP) return t.skip();
  const r = await fetch(`${base}/api/does-not-exist`);
  assert.strictEqual(r.status, 404);
  assert.match(r.headers.get('content-type') || '', /application\/json/);
});

test('repeat requests are served from cache', async (t) => {
  if (SKIP) return t.skip();
  const url = 'https://www.tiktok.com/@tiktok/video/7460937381265411370';
  const post = () => json('/api/resolve', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url }),
  });
  await post();                       // warm (may already be cached by an earlier test)
  const second = await post();
  assert.strictEqual(second.body.cached, true, 'second identical request should hit the cache');
  assert.ok(second.body.ms < 50, `cached response too slow: ${second.body.ms}ms`);
});
