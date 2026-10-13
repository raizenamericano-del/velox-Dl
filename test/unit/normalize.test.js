'use strict';

const { test } = require('node:test');
const assert = require('node:assert');

const {
  buildFormats, entryToItem, normalizeYtDlp, dlDirect, dlEngine, slugify, humanDuration, fmtSize,
} = require('../../server/resolvers/normalize');

// A TikTok-style entry: one progressive MP4 with both tracks + a music track.
const progressiveInfo = {
  id: 'tt1', title: 'Video TikTok', ext: 'mp4', duration: 15,
  thumbnail: 'https://cdn.test/thumb.jpg',
  formats: [
    { format_id: '0', ext: 'mp4', height: 1080, vcodec: 'h264', acodec: 'aac', filesize: 4_000_000, url: 'https://cdn.test/v.mp4' },
    { format_id: 'audio', ext: 'mp3', vcodec: 'none', acodec: 'mp3', tbr: 128, url: 'https://cdn.test/a.mp3' },
  ],
};

// YouTube from a datacentre IP: DASH only, no progressive container.
const dashInfo = {
  id: 'yt1', title: 'Video YouTube', ext: 'mp4',
  webpage_url: 'https://www.youtube.com/watch?v=yt1',
  formats: [
    { format_id: '401', ext: 'mp4', height: 2160, vcodec: 'av1', acodec: 'none', url: 'https://cdn.test/v4k.mp4' },
    { format_id: '137', ext: 'mp4', height: 1080, vcodec: 'avc1', acodec: 'none', url: 'https://cdn.test/v1080.mp4' },
    { format_id: '140', ext: 'm4a', vcodec: 'none', acodec: 'mp4a', tbr: 130, url: 'https://cdn.test/a.m4a' },
    { format_id: 'sb0', ext: 'mhtml', vcodec: 'none', acodec: 'none', url: 'https://cdn.test/sb.mhtml' },
  ],
};

test('progressive source yields clean MP4 options plus MP3', () => {
  const { list, splitOnly } = buildFormats(progressiveInfo, { ffmpeg: true, pageUrl: 'https://tiktok.com/x', referer: null, baseName: 'video-tiktok' });
  const labels = list.map((f) => f.label);

  assert.ok(labels.some((l) => l.includes('1080p')), `missing 1080p: ${labels}`);
  assert.ok(list.some((f) => f.id === 'best-merged'), 'merged best option missing when ffmpeg is present');
  assert.ok(list.some((f) => f.ext === 'mp3' && f.kind === 'audio'), 'MP3 option missing');
  assert.strictEqual(splitOnly, false);

  // every format url must be our own gateway, never a raw CDN link
  for (const f of list) {
    assert.match(f.url, /^\/api\/dl\?/, `format url should be proxied: ${f.url}`);
  }
});

test('DASH-only + no ffmpeg is labelled honestly and flagged splitOnly', () => {
  const { list, splitOnly } = buildFormats(dashInfo, { ffmpeg: false, pageUrl: 'https://youtu.be/yt1', referer: null, baseName: 'v' });
  const video = list.find((f) => f.kind === 'video');

  assert.ok(video, 'expected a video option even without ffmpeg');
  assert.match(video.label, /tanpa audio/i, 'silent video must be labelled');
  assert.ok(!list.some((f) => f.id === 'best-merged'), 'must not promise a merge without ffmpeg');
  assert.ok(!list.some((f) => f.ext === 'mp3'), 'must not promise MP3 without ffmpeg');
  assert.ok(list.some((f) => f.kind === 'audio'), 'native audio should still be offered');
  assert.strictEqual(splitOnly, true);
});

test('DASH-only + ffmpeg offers the capped merged best quality', () => {
  const { list, splitOnly } = buildFormats(dashInfo, { ffmpeg: true, pageUrl: 'https://youtu.be/yt1', referer: null, baseName: 'v', maxMergeHeight: 1080 });
  const merged = list.find((f) => f.id === 'best-merged');

  assert.ok(merged, 'merged option missing');
  assert.strictEqual(list[0].id, 'best-merged', 'merged should be offered first');
  const sel = decodeURIComponent(merged.url);
  assert.match(sel, /height<=1080/, 'merged selector must cap the resolution');
  assert.strictEqual(splitOnly, false);
});

test('single-file image entries still yield a downloadable image format', () => {
  // A bare image entry has no "formats" array at all — entryToItem must fall
  // back to the entry url, otherwise the UI would show zero download options.
  const info = { id: 'img1', title: 'Foto', ext: 'jpg', url: 'https://cdn.test/p.jpg', formats: [] };
  const item = entryToItem(info, { ffmpeg: true, pageUrl: 'https://x.test', referer: 'https://x.test', fallbackTitle: 'Foto' });

  assert.strictEqual(item.kind, 'image');
  const img = item.formats.find((f) => f.kind === 'image');
  assert.ok(img, 'image format missing');
  assert.match(img.url, /^\/api\/dl\?t=direct/, 'image must be served through the gateway');
  assert.strictEqual(new URLSearchParams(img.url.split('?')[1]).get('u'), 'https://cdn.test/p.jpg');
});

test('normalizeYtDlp expands a flat playlist into per-item downloads', () => {
  const info = {
    _type: 'playlist', title: 'Playlistku',
    entries: [
      { id: 'a', title: 'Video A', url: 'https://youtu.be/a' },
      { id: 'b', title: 'Video B', url: 'https://youtu.be/b', duration: 90 },
    ],
  };
  const r = normalizeYtDlp(info, { platform: 'youtube', platformName: 'YouTube', url: 'https://youtube.com/playlist?list=X', ffmpeg: true });

  assert.strictEqual(r.isPlaylist, true);
  assert.strictEqual(r.count, 2);
  assert.strictEqual(r.items.length, 2);
  assert.strictEqual(r.items[1].duration, '1:30');
  for (const it of r.items) {
    assert.ok(it.formats.length >= 2, 'each playlist item needs video + audio options');
    assert.match(it.formats[0].url, /^\/api\/dl\?t=engine/);
  }
});

test('normalizeYtDlp adds a thumbnail option for YouTube and warns when split-only', () => {
  const r = normalizeYtDlp(dashInfo, { platform: 'youtube', platformName: 'YouTube', url: 'https://youtu.be/yt1', ffmpeg: false });
  assert.ok(r.items[0].formats.some((f) => f.id === 'thumb'), 'YouTube thumbnail option missing');
  assert.ok(r.warnings.some((w) => w.code === 'NO_FFMPEG'), 'expected a NO_FFMPEG warning');
  assert.match(r.warnings[0].text, /ffmpeg/i);
});

test('normalizeYtDlp throws when a source exposes no usable format', () => {
  const info = { id: 'x', title: 'Kosong', ext: 'txt', formats: [] };
  assert.throws(() => normalizeYtDlp(info, { platform: 'generic', platformName: 'Generic', url: 'https://x.test', ffmpeg: true }), /No formats/);
});

// ── URL builders ─────────────────────────────────────────────────────────
test('dlDirect/dlEngine build relative gateway URLs with encoded params', () => {
  const d = dlDirect('https://cdn.test/a b.mp4?x=1&y=2', { referer: 'https://www.tiktok.com/', filename: 'nama file' });
  assert.ok(d.startsWith('/api/dl?t=direct&u='), 'must be a relative gateway URL');
  const q = new URLSearchParams(d.split('?')[1]);
  assert.strictEqual(q.get('u'), 'https://cdn.test/a b.mp4?x=1&y=2', 'target url must round-trip');
  assert.strictEqual(q.get('r'), 'https://www.tiktok.com/');
  assert.strictEqual(q.get('n'), 'nama file');

  const e = dlEngine('https://youtu.be/abc', { format: 'bv*+ba/b', audio: 'mp3', ext: 'mp3', filename: 'lagu' });
  const eq = new URLSearchParams(e.split('?')[1]);
  assert.strictEqual(eq.get('t'), 'engine');
  assert.strictEqual(eq.get('f'), 'bv*+ba/b');
  assert.strictEqual(eq.get('a'), 'mp3');
  assert.strictEqual(eq.get('n'), 'lagu');
});

// ── helpers ──────────────────────────────────────────────────────────────
test('slugify produces safe filenames', () => {
  assert.strictEqual(slugify('Halo Dunia! 🎉 2026'), 'Halo-Dunia-2026');
  assert.strictEqual(slugify(''), 'velox-media');
  assert.ok(slugify('a'.repeat(200)).length <= 60, 'must cap length');
  assert.ok(!/[^\w-]/.test(slugify('karakter/aneh\\:*?"<>|')), 'unsafe characters must be stripped');
});

test('humanDuration formats seconds like a player', () => {
  assert.strictEqual(humanDuration(0), null);
  assert.strictEqual(humanDuration(9), '0:09');
  assert.strictEqual(humanDuration(65), '1:05');
  assert.strictEqual(humanDuration(3725), '1:02:05');
});

test('fmtSize is human readable and null-safe', () => {
  assert.strictEqual(fmtSize(0), null);
  assert.strictEqual(fmtSize(null), null);
  assert.strictEqual(fmtSize(512), '512 B');
  assert.strictEqual(fmtSize(2048), '2.0 KB');
  assert.strictEqual(fmtSize(5_242_880), '5.0 MB');
});
