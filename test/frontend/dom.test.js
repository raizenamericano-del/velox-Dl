'use strict';

/**
 * Boots the real frontend (index.html + icons.js + app.js) inside jsdom and
 * asserts: no console errors, platform grid renders, resolve → result render
 * works, and a failed resolve renders the friendly error card.
 */
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole } = require('jsdom');

const ROOT = path.join(__dirname, '..', '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

const HEALTH = {
  status: 'ok', app: 'VELOX', uptimeSeconds: 5, timestamp: new Date().toISOString(),
  engine: { engine: 'yt-dlp', available: true, version: '2026.08.19', ffmpeg: true, cache: 10 },
  cache: { entries: 0, hits: 0, misses: 0, hitRate: 0, ttlMinutes: 10 },
  queue: { active: 0, pending: 0 }, platforms: 14,
};

const RESOLVE_OK = {
  platform: 'tiktok', platformName: 'TikTok', url: 'https://www.tiktok.com/@tiktok/video/1',
  title: 'Video uji coba', author: '@tiktok', thumbnail: null, duration: '0:15',
  kind: 'video', isPlaylist: false, via: 'tikwm', ms: 812, warnings: [],
  items: [{
    id: '1', title: 'Video uji coba', thumbnail: null, duration: '0:15', kind: 'video',
    formats: [
      { id: 'hd', label: 'HD · Tanpa Watermark', tag: 'HD', ext: 'mp4', kind: 'video', size: '4.1 MB', url: '/api/dl?t=direct&u=x' },
      { id: 'music', label: 'Sound · MP3', tag: 'MP3', ext: 'mp3', kind: 'audio', url: '/api/dl?t=direct&u=y' },
    ],
  }],
};

const RESOLVE_ERR = {
  ok: false,
  error: { code: 'NOT_FOUND', title: 'Kontennya sudah tidak ada', message: 'Post ini sudah dihapus.', hint: 'Cek lagi linknya.' },
};

function makeDom({ fetchImpl }) {
  const errors = [];
  const vc = new VirtualConsole();
  vc.on('jsdomError', (e) => errors.push(`jsdomError: ${e.message}`));
  vc.on('error', (...a) => errors.push(`console.error: ${a.join(' ')}`));

  const dom = new JSDOM(read('public/index.html'), {
    runScripts: 'outside-only',
    pretendToBeVisual: false,
    url: 'http://localhost/',
    virtualConsole: vc,
  });
  const { window } = dom;

  // minimal APIs the app touches
  window.fetch = fetchImpl;
  window.URL.createObjectURL = () => 'blob:mock';
  window.URL.revokeObjectURL = () => {};
  window.IntersectionObserver = class { observe() {} unobserve() {} disconnect() {} };
  window.HTMLElement.prototype.scrollIntoView = () => {};
  Object.defineProperty(window.navigator, 'clipboard', { value: { readText: async () => '', writeText: async () => {} }, configurable: true });

  window.eval(read('public/js/icons.js'));
  window.eval(read('public/js/app.js'));

  // the app registers a 60s health interval; without closing the window the
  // jsdom event loop never drains and the test runner hangs.
  const close = () => { try { window.close(); } catch { /* already closed */ } };
  return { dom, window, errors, close };
}

const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms));

test('frontend boots with no console errors and renders 14 platform cards', async (t) => {
  t.after(() => ctx.close());
  let ctx;
  ctx = makeDom({
    fetchImpl: async (url) => ({
      ok: true, status: 200, headers: new Map([['content-type', 'application/json']]),
      json: async () => (String(url).includes('/api/health') ? HEALTH : RESOLVE_OK),
    }),
  });
  const { window, errors } = ctx;
  await tick(30);

  assert.deepStrictEqual(errors, [], `console errors on boot: ${errors.join(' | ')}`);
  const cards = window.document.querySelectorAll('.plat-card');
  assert.strictEqual(cards.length, 14, 'expected 14 platform cards');

  // every card must carry a real inline SVG icon (no external requests)
  for (const card of cards) {
    assert.ok(card.querySelector('.plat-ico svg path')?.getAttribute('d')?.length > 20, 'card missing icon path');
  }
  assert.match(window.document.querySelector('.status-pill')?.textContent || '', /online|cek/);
});

test('submitting a link renders the result card with video + audio options', async (t) => {
  t.after(() => ctx.close());
  let ctx;
  let postedBody = null;
  ctx = makeDom({
    fetchImpl: async (url, opts = {}) => {
      if (String(url).includes('/api/resolve')) {
        postedBody = JSON.parse(opts.body);
        return { ok: true, status: 200, headers: new Map(), json: async () => RESOLVE_OK };
      }
      return { ok: true, status: 200, headers: new Map(), json: async () => HEALTH };
    },
  });
  const { window, errors } = ctx;
  await tick(20);

  const doc = window.document;
  doc.querySelector('#urlInput').value = 'https://www.tiktok.com/@tiktok/video/1';
  doc.querySelector('#urlInput').dispatchEvent(new window.Event('input', { bubbles: true }));
  doc.querySelector('#dlForm').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));

  await tick(40);

  assert.deepStrictEqual(errors, [], `console errors: ${errors.join(' | ')}`);
  assert.strictEqual(postedBody?.url, 'https://www.tiktok.com/@tiktok/video/1', 'URL was not POSTed to /api/resolve');

  assert.ok(doc.querySelector('.result-card'), 'result card not rendered');
  assert.match(doc.querySelector('.result-title').textContent, /Video uji coba/);

  const labels = [...doc.querySelectorAll('.fmt-label')].map((n) => n.textContent);
  assert.ok(labels.some((l) => l.includes('HD · Tanpa Watermark')), `video option missing: ${labels}`);
  assert.ok(labels.some((l) => l.includes('Sound · MP3')), `audio option missing: ${labels}`);

  // history persisted to localStorage
  const hist = JSON.parse(window.localStorage.getItem('velox.history.v1') || '[]');
  assert.strictEqual(hist.length, 1, 'history entry not written');
  assert.strictEqual(hist[0].platform, 'tiktok');
});

test('a failed resolve shows the friendly error card, not a raw code', async (t) => {
  t.after(() => ctx.close());
  let ctx;
  ctx = makeDom({
    fetchImpl: async (url) => {
      if (String(url).includes('/api/resolve')) return { ok: false, status: 404, headers: new Map(), json: async () => RESOLVE_ERR };
      return { ok: true, status: 200, headers: new Map(), json: async () => HEALTH };
    },
  });
  const { window, errors } = ctx;
  await tick(20);

  const doc = window.document;
  doc.querySelector('#urlInput').value = 'https://www.instagram.com/reel/gone/';
  doc.querySelector('#dlForm').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
  await tick(40);

  assert.deepStrictEqual(errors, [], `console errors: ${errors.join(' | ')}`);
  const card = doc.querySelector('.err-card');
  assert.ok(card, 'error card not rendered');
  assert.match(card.textContent, /Kontennya sudah tidak ada/);
  assert.match(card.textContent, /Saran/, 'hint not shown to the user');
  assert.ok(doc.querySelector('#retryBtn'), 'retry button missing');
});

test('empty input is rejected client-side without a request', async (t) => {
  t.after(() => ctx.close());
  let ctx;
  let called = 0;
  ctx = makeDom({
    fetchImpl: async (url) => { called++; return { ok: true, status: 200, headers: new Map(), json: async () => HEALTH }; },
  });
  const { window, errors } = ctx;
  await tick(20);

  const doc = window.document;
  doc.querySelector('#urlInput').value = '';
  doc.querySelector('#dlForm').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
  await tick(20);

  const resolveCalls = called; // health ping is the only allowed call
  assert.ok(resolveCalls <= 1, `expected no /api/resolve call, got ${resolveCalls} fetches`);
  assert.match(doc.querySelector('#hintText').textContent, /Tempel dulu/, 'no inline validation message');
  assert.deepStrictEqual(errors, [], `console errors: ${errors.join(' | ')}`);
});
