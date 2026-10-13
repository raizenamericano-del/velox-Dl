'use strict';

const { test } = require('node:test');
const assert = require('node:assert');

const { normalizeUrl, detect, isPlaylistUrl, PLATFORMS } = require('../../server/lib/detect');
const { TtlCache } = require('../../server/lib/cache');
const { rateLimit } = require('../../server/lib/ratelimit');
const { friendlyError, AppError } = require('../../server/lib/errors');

// ── URL detection ────────────────────────────────────────────────────────
test('detect() maps every documented platform', () => {
  const cases = {
    'https://www.tiktok.com/@a/video/1': 'tiktok',
    'https://vm.tiktok.com/ZMabc/': 'tiktok',
    'https://www.instagram.com/reel/Cx1/': 'instagram',
    'https://youtu.be/abc': 'youtube',
    'https://www.youtube.com/watch?v=abc': 'youtube',
    'https://m.facebook.com/watch/?v=1': 'facebook',
    'https://fb.watch/abc/': 'facebook',
    'https://x.com/i/status/1': 'twitter',
    'https://twitter.com/a/status/1': 'twitter',
    'https://www.pinterest.com/pin/1/': 'pinterest',
    'https://pin.it/abc': 'pinterest',
    'https://www.xiaohongshu.com/explore/1': 'rednote',
    'https://www.snapchat.com/spotlight/abc': 'snapchat',
    'https://www.threads.net/@a/post/1': 'threads',
    'https://www.linkedin.com/posts/a_1': 'linkedin',
    'https://vimeo.com/123': 'vimeo',
    'https://www.dailymotion.com/video/x1': 'dailymotion',
    'https://clips.twitch.tv/abc': 'twitch',
    'https://soundcloud.com/a/b': 'soundcloud',
  };
  for (const [url, expected] of Object.entries(cases)) {
    assert.strictEqual(detect(new URL(url)).id, expected, `${url} should be ${expected}`);
  }
});

test('detect() falls back to generic for unknown hosts', () => {
  const p = detect(new URL('https://some-random-blog.test/video.mp4'));
  assert.strictEqual(p.id, 'generic');
  assert.ok(p.engine.includes('yt-dlp'));
});

test('every tier-1 and tier-2 platform from the brief is registered', () => {
  const required = ['instagram', 'tiktok', 'youtube', 'facebook', 'twitter', 'pinterest', 'rednote', 'snapchat', 'threads', 'linkedin'];
  const ids = PLATFORMS.map((p) => p.id);
  for (const r of required) assert.ok(ids.includes(r), `missing platform: ${r}`);
  assert.ok(PLATFORMS.filter((p) => p.tier === 1).length === 5, 'expected 5 tier-1 platforms');
  assert.ok(PLATFORMS.filter((p) => p.tier === 2).length === 5, 'expected 5 tier-2 platforms');
});

test('normalizeUrl() accepts messy real-world input', () => {
  assert.strictEqual(normalizeUrl('  https://youtu.be/abc  ').href, 'https://youtu.be/abc');
  assert.strictEqual(normalizeUrl('tiktok.com/@a/video/1').href, 'https://tiktok.com/@a/video/1');
  assert.strictEqual(normalizeUrl('lihat ini https://x.com/i/status/1 ok?').href, 'https://x.com/i/status/1');
  assert.strictEqual(normalizeUrl('"https://vimeo.com/1"').href, 'https://vimeo.com/1');
});

test('normalizeUrl() rejects junk with a friendly AppError', () => {
  assert.throws(() => normalizeUrl(''), (e) => e instanceof AppError && e.code === 'EMPTY_URL');
  assert.throws(() => normalizeUrl('ftp://x.com/a'), (e) => e.code === 'INVALID_URL');
  assert.throws(() => normalizeUrl('::::'), (e) => e instanceof AppError);
  // a foreign scheme must not be silently rewritten into a bogus https host
  assert.throws(() => normalizeUrl('ftp://x.com/a'), (e) => e.code === 'INVALID_URL');
  assert.throws(() => normalizeUrl('file:///etc/passwd'), (e) => e.code === 'INVALID_URL');
  // bare hostnames (no TLD) are rejected before reaching the engine
  assert.throws(() => normalizeUrl('http://localhost/admin'), (e) => e.code === 'INVALID_URL');
  assert.throws(() => normalizeUrl('https://foo'), (e) => e.code === 'INVALID_URL');
});

test('isPlaylistUrl() only matches real playlist links', () => {
  assert.ok(isPlaylistUrl(new URL('https://www.youtube.com/playlist?list=PLabc')));
  assert.ok(isPlaylistUrl(new URL('https://www.youtube.com/watch?v=a&list=PLabc')));
  assert.ok(!isPlaylistUrl(new URL('https://www.youtube.com/watch?v=a')));
});

// ── cache ────────────────────────────────────────────────────────────────
test('TtlCache expires entries after the TTL', async () => {
  const c = new TtlCache({ max: 5, ttlMs: 40 });
  c.set('a', 1);
  assert.strictEqual(c.get('a'), 1);
  assert.ok(c.has('a'));
  await new Promise((r) => setTimeout(r, 60));
  assert.strictEqual(c.get('a'), undefined, 'entry should have expired');
  assert.ok(!c.has('a'));
});

test('TtlCache evicts the least recently used entry when full', () => {
  const c = new TtlCache({ max: 3, ttlMs: 60_000 });
  c.set('a', 1); c.set('b', 2); c.set('c', 3);
  c.get('a');            // touch a → b becomes oldest
  c.set('d', 4);
  assert.strictEqual(c.get('b'), undefined, 'LRU entry should be evicted');
  assert.strictEqual(c.get('a'), 1);
  assert.strictEqual(c.size, 3);
});

test('TtlCache reports hit rate for /api/health', () => {
  const c = new TtlCache({ max: 5, ttlMs: 60_000 });
  c.set('a', 1);
  c.get('a'); c.get('a'); c.get('miss');
  const s = c.stats();
  assert.strictEqual(s.hits, 2);
  assert.strictEqual(s.misses, 1);
  assert.strictEqual(s.hitRate, 0.667);
});

// ── rate limiter ─────────────────────────────────────────────────────────
function mockReqRes(ip = '1.2.3.4') {
  const res = {
    statusCode: 200, headers: {}, body: null,
    set(k, v) { this.headers[k.toLowerCase()] = v; },
    status(c) { this.statusCode = c; return this; },
    json(b) { this.body = b; return this; },
  };
  return { req: { ip }, res };
}

test('rateLimit allows up to max, then answers 429 with Retry-After', () => {
  const mw = rateLimit({ windowMs: 60_000, max: 3, keyPrefix: 't1' });
  const codes = [];
  for (let i = 0; i < 5; i++) {
    const { req, res } = mockReqRes();
    let nexted = false;
    mw(req, res, () => { nexted = true; });
    codes.push(nexted ? 200 : res.statusCode);
    if (i === 3) {
      assert.ok(res.headers['retry-after'], 'Retry-After header missing on 429');
      assert.match(res.body.error.message, /Tunggu/, 'error message is not human friendly');
      assert.strictEqual(res.body.error.code, 'RATE_LIMITED');
    }
  }
  assert.deepStrictEqual(codes, [200, 200, 200, 429, 429]);
});

test('rateLimit tracks IPs independently', () => {
  const mw = rateLimit({ windowMs: 60_000, max: 1, keyPrefix: 't2' });
  const a = mockReqRes('10.0.0.1'); let na = false; mw(a.req, a.res, () => { na = true; });
  const b = mockReqRes('10.0.0.2'); let nb = false; mw(b.req, b.res, () => { nb = true; });
  assert.ok(na && nb, 'second IP should not be limited by the first');
  const a2 = mockReqRes('10.0.0.1'); let na2 = false; mw(a2.req, a2.res, () => { na2 = true; });
  assert.ok(!na2 && a2.res.statusCode === 429, 'first IP should now be limited');
});

// ── error mapping ────────────────────────────────────────────────────────
test('friendlyError translates raw extractor output into human language', () => {
  const cases = [
    ['ERROR: [Instagram] x: Login Instagram sent an empty media response', 'ACCESS_RESTRICTED'],
    ['HTTP Error 404: Not Found', 'NOT_FOUND'],
    ['ERROR: HTTP Error 429: Too Many Requests', 'UPSTREAM_RATE_LIMITED'],
    ['ERROR: unable to download video data: HTTP Error 403', 'UPSTREAM_BLOCKED'],
    ['ERROR: No video could be found in this tweet', 'NO_MEDIA'],
    ['socket timed out after 20s', 'TIMEOUT'],
    ['getaddrinfo ENOTFOUND example.test', 'NETWORK'],
  ];
  for (const [raw, code] of cases) {
    const e = friendlyError(new Error(raw));
    assert.strictEqual(e.code, code, `"${raw}" → ${e.code}, expected ${code}`);
    assert.ok(e.title.length > 3, 'missing human title');
    assert.ok(!/traceback|stderr/i.test(e.message), 'raw engine text leaked to the user');
  }
});

test('friendlyError passes AppError through untouched', () => {
  const original = new AppError('CUSTOM', { status: 418, title: 'Teapot', message: 'short and stout' });
  assert.strictEqual(friendlyError(original), original);
  assert.deepStrictEqual(original.toJSON(), { code: 'CUSTOM', title: 'Teapot', message: 'short and stout' });
});
