'use strict';

/**
 * Single source of truth for supported platforms.
 * `test` = regex used for auto-detection, `tier` matches the product brief.
 * Also feeds /api/platforms so the UI never drifts from the backend.
 */
const PLATFORMS = [
  {
    id: 'tiktok', name: 'TikTok', tier: 1, color: '#25F4EE', accent: '#FE2C55',
    kinds: ['Video', 'Photo Slide', 'MP3', 'No Watermark'],
    test: /(^|\.)tiktok\.com$/i,
    sample: 'https://www.tiktok.com/@tiktok/video/7460937381265411370',
    engine: 'tikwm + yt-dlp',
  },
  {
    id: 'instagram', name: 'Instagram', tier: 1, color: '#E1306C', accent: '#F77737',
    kinds: ['Reels', 'Post', 'Carousel', 'IGTV', 'Story'],
    test: /(^|\.)instagram\.com$/i,
    sample: 'https://www.instagram.com/reel/C1x2y3z/',
    engine: 'yt-dlp + embed fallback',
  },
  {
    id: 'youtube', name: 'YouTube', tier: 1, color: '#FF0000', accent: '#FF4E45',
    kinds: ['MP4', 'MP3', 'Shorts', 'Thumbnail', 'Playlist'],
    test: /(^|\.)(youtube\.com|youtu\.be|youtube-nocookie\.com)$/i,
    sample: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
    engine: 'yt-dlp',
  },
  {
    id: 'facebook', name: 'Facebook', tier: 1, color: '#1877F2', accent: '#42A5F5',
    kinds: ['Video', 'Reels', 'Watch'],
    test: /(^|\.)(facebook\.com|fb\.watch|fb\.com|m\.facebook\.com)$/i,
    sample: 'https://www.facebook.com/watch/?v=1234567890',
    engine: 'yt-dlp',
  },
  {
    id: 'twitter', name: 'X / Twitter', tier: 1, color: '#E7E9EA', accent: '#1D9BF0',
    kinds: ['Video', 'GIF', 'Image'],
    test: /(^|\.)(twitter\.com|x\.com|fxtwitter\.com|vxtwitter\.com)$/i,
    sample: 'https://x.com/i/status/1580661436132757506',
    engine: 'yt-dlp + syndication',
  },
  {
    id: 'pinterest', name: 'Pinterest', tier: 2, color: '#E60023', accent: '#FF5252',
    kinds: ['Video', 'Image HD', 'GIF'],
    test: /(^|\.)(pinterest\.com|pinterest\.co\.id|pin\.it)$/i,
    sample: 'https://www.pinterest.com/pin/123456789/',
    engine: 'yt-dlp + page scrape',
  },
  {
    id: 'rednote', name: 'RedNote / 小红书', tier: 2, color: '#FF2442', accent: '#FF6B81',
    kinds: ['Video', 'Image'],
    test: /(^|\.)(xiaohongshu\.com|xhslink\.com)$/i,
    sample: 'https://www.xiaohongshu.com/explore/000000000000000000000000',
    engine: 'yt-dlp (XiaoHongShu)',
  },
  {
    id: 'snapchat', name: 'Snapchat', tier: 2, color: '#FFFC00', accent: '#FCE100',
    kinds: ['Spotlight', 'Story'],
    test: /(^|\.)(snapchat\.com|t\.snapchat\.com)$/i,
    sample: 'https://www.snapchat.com/spotlight/abcdef',
    engine: 'yt-dlp (SnapchatSpotlight)',
  },
  {
    id: 'threads', name: 'Threads', tier: 2, color: '#D8D8D8', accent: '#9B9B9B',
    kinds: ['Video', 'Image'],
    test: /(^|\.)(threads\.net|threads\.com)$/i,
    sample: 'https://www.threads.net/@user/post/ABC123',
    engine: 'yt-dlp',
  },
  {
    id: 'linkedin', name: 'LinkedIn', tier: 2, color: '#0A66C2', accent: '#4A9EFF',
    kinds: ['Video', 'Post'],
    test: /(^|\.)(linkedin\.com|lnkd\.in)$/i,
    sample: 'https://www.linkedin.com/posts/user_activity-000',
    engine: 'yt-dlp',
  },
  {
    id: 'vimeo', name: 'Vimeo', tier: 3, color: '#1AB7EA', accent: '#5BC8F0',
    kinds: ['Video HD'],
    test: /(^|\.)(vimeo\.com|player\.vimeo\.com)$/i,
    sample: 'https://vimeo.com/76979871',
    engine: 'yt-dlp',
  },
  {
    id: 'dailymotion', name: 'Dailymotion', tier: 3, color: '#0066DC', accent: '#3D8BFF',
    kinds: ['Video'],
    test: /(^|\.)(dailymotion\.com|dai\.ly)$/i,
    sample: 'https://www.dailymotion.com/video/x8abcde',
    engine: 'yt-dlp',
  },
  {
    id: 'twitch', name: 'Twitch', tier: 3, color: '#9146FF', accent: '#B084FF',
    kinds: ['Clip', 'VOD'],
    test: /(^|\.)(twitch\.tv|clips\.twitch\.tv)$/i,
    sample: 'https://clips.twitch.tv/SomeClipName',
    engine: 'yt-dlp',
  },
  {
    id: 'soundcloud', name: 'SoundCloud', tier: 3, color: '#FF5500', accent: '#FF8533',
    kinds: ['MP3'],
    test: /(^|\.)(soundcloud\.com|snd\.sc)$/i,
    sample: 'https://soundcloud.com/artist/track',
    engine: 'yt-dlp',
  },
];

const BY_ID = Object.fromEntries(PLATFORMS.map((p) => [p.id, p]));

/** Normalise + validate a user-supplied link. Throws a friendly AppError on junk. */
function normalizeUrl(input) {
  const { AppError } = require('./errors');
  let raw = String(input || '').trim();
  if (!raw) throw new AppError('EMPTY_URL', { status: 400, title: 'Linknya kosong 🙃', message: 'Tempel dulu link videonya di kolom di atas.' });

  // strip surrounding quotes / trailing junk from chat apps
  raw = raw.replace(/^["'`<]+|["'`>]+$/g, '');

  // Reject foreign schemes up front. Without this, "ftp://x/a" would be
  // prefixed into "https://ftp://x/a", which URL() happily parses with the
  // host "ftp" — a bogus link that only fails deep inside the engine.
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(raw) && !/^https?:\/\//i.test(raw)) {
    throw new AppError('INVALID_URL', { status: 400, title: 'Protokol tidak didukung', message: 'VELOX hanya menerima link http/https.' });
  }

  // "lihat ini https://..." → grab the first token that looks like a URL
  if (!/^https?:\/\//i.test(raw)) {
    const found = raw.match(/https?:\/\/[^\s"'<>]+/i);
    if (found) raw = found[0];
    else raw = `https://${raw}`;
  }

  let u;
  try { u = new URL(raw); } catch {
    throw new AppError('INVALID_URL', { status: 400, title: 'Linknya tidak valid 😅', message: 'Itu bukan URL yang bisa dibaca. Pastikan formatnya seperti https://...' });
  }
  if (!/^https?:$/.test(u.protocol)) {
    throw new AppError('INVALID_URL', { status: 400, title: 'Protokol tidak didukung', message: 'VELOX hanya menerima link http/https.' });
  }
  // require a real domain (at least one dot) so "https://foo" or a bare
  // hostname never reaches the engine or the SSRF-filtered proxy
  if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/i.test(u.hostname)) {
    throw new AppError('INVALID_URL', {
      status: 400,
      title: 'Domainnya tidak lengkap 🤔',
      message: 'Link itu tidak punya nama domain yang valid (mis. tiktok.com).',
      hint: 'Salin ulang linknya langsung dari tombol Share di aplikasinya.',
    });
  }
  return u;
}

/** Detect which platform a URL belongs to (falls back to "generic"). */
function detect(url) {
  const u = typeof url === 'string' ? (() => { try { return new URL(url); } catch { return null; } })() : url;
  if (!u) return { id: 'generic', name: 'Website', tier: 3, kinds: ['Video', 'Audio'], color: '#8b8b9a', accent: '#8b8b9a', engine: 'yt-dlp generic' };
  const host = u.hostname.replace(/^www\./, '').toLowerCase();
  for (const p of PLATFORMS) {
    if (p.test.test(host)) return { ...p, host };
  }
  return { id: 'generic', name: host || 'Website', tier: 3, kinds: ['Video', 'Audio', 'Image'], color: '#8b8b9a', accent: '#8b8b9a', engine: 'yt-dlp generic', host };
}

const isPlaylistUrl = (u) => /[?&]list=/.test(u.href) || /\/playlist\b/.test(u.pathname) || /\/channel\b/.test(u.pathname);

module.exports = { PLATFORMS, BY_ID, normalizeUrl, detect, isPlaylistUrl };
