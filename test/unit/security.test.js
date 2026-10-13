'use strict';

const { test } = require('node:test');
const assert = require('node:assert');

const { hostAllowed, contentDisposition } = require('../../server/index');

test('hostAllowed permits known platform CDNs', () => {
  const ok = [
    'https://v16-webapp.tiktok.com/x.mp4',
    'https://p16-common-sign.tiktokcdn-us.com/x.jpeg',
    'https://www.tikwm.com/video/media/play/x.mp4',
    'https://video.twimg.com/ext_tw_video/1/x.mp4',
    'https://scontent.cdninstagram.com/v/x.mp4',
    'https://scontent.fpku1-1.fna.fbcdn.net/v/x.mp4',
    'https://i.pinimg.com/originals/x.jpg',
    'https://cf-hls-media.sndcdn.com/x.m3u8',
    'https://i.ytimg.com/vi/x/maxresdefault.jpg',
    'https://rr1.sn-abc.googlevideo.com/videoplayback',
    'https://sns-video-bd.xhscdn.com/x.mp4',
  ];
  for (const u of ok) assert.strictEqual(hostAllowed(u), true, `should allow ${u}`);
});

test('hostAllowed blocks private ranges, loopback and unknown hosts (SSRF)', () => {
  const bad = [
    'http://localhost:3000/api/health',
    'http://127.0.0.1:3000/',
    'http://[::1]/',
    'http://10.0.0.5/secret',
    'http://172.16.0.1/',
    'http://192.168.1.1/admin',
    'http://169.254.169.254/latest/meta-data/',   // cloud metadata endpoint
    'http://metadata.google.internal/',
    'https://evil.example.com/x.mp4',
    'https://tiktokcdn.com.evil.test/x.mp4',      // suffix-spoofing attempt
    'file:///etc/passwd',
    'ftp://cdn.tiktok.com/x.mp4',
    'not a url at all',
  ];
  for (const u of bad) assert.strictEqual(hostAllowed(u), false, `should block ${u}`);
});

test('hostAllowed rejects arbitrary IP literals even in allowed ranges', () => {
  // an attacker cannot point the proxy at a raw IP that happens to resolve internally
  assert.strictEqual(hostAllowed('https://8.8.8.8/x.mp4'), false);
  assert.strictEqual(hostAllowed('https://0.0.0.0/'), false);
});

test('contentDisposition is RFC 5987 safe for unicode and quotes', () => {
  const ascii = contentDisposition('my video.mp4');
  assert.match(ascii, /^attachment; filename="my video\.mp4"/);

  const tricky = contentDisposition('judul "aneh" \\ \n.mp4');
  assert.ok(!/["\\]/.test(tricky.match(/filename="([^"]*)"/)[1]), 'quotes/backslashes must be stripped');
  assert.ok(!tricky.includes('\n'), 'newlines must not leak into the header (header injection)');

  const uni = contentDisposition('Video Liburan 🎉.mp4');
  assert.match(uni, /filename="[^"]*"/, 'ascii fallback required');
  assert.match(uni, /filename\*=UTF-8''/, 'rfc5987 form required');
  assert.ok(decodeURIComponent(uni.split("filename*=UTF-8''")[1]).includes('🎉'), 'unicode must survive');
});

test('contentDisposition caps absurd filenames', () => {
  const long = contentDisposition('a'.repeat(500));
  assert.ok(long.length < 400, `filename not capped: ${long.length} chars`);
});
