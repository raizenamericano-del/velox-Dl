'use strict';

const config = require('../config');

/**
 * Turns engine output into one canonical shape the UI understands:
 *
 * {
 *   platform, platformName, url, title, author, thumbnail, duration, kind,
 *   items: [{ id, title, thumbnail, duration, kind,
 *             formats: [{ id, label, tag, ext, kind, url, size }] }],
 *   warnings: []
 * }
 *
 * Every `formats[].url` points at OUR /api/dl endpoint so that the browser
 * never has to deal with cross-origin CDN headers or expiring referers.
 */

const IMAGE_EXT = new Set(['jpg', 'jpeg', 'png', 'webp', 'gif', 'bmp', 'heic', 'avif']);
const AUDIO_EXT = new Set(['m4a', 'mp3', 'opus', 'webm', 'ogg', 'aac', 'flac', 'wav']);

const enc = encodeURIComponent;
const slugify = (s, max = 60) =>
  String(s || 'velox-media')
    .normalize('NFKD').replace(/[^\w\s-]/g, '')
    .trim().replace(/\s+/g, '-').slice(0, max) || 'velox-media';

/** Proxy link for a direct CDN URL. */
function dlDirect(mediaUrl, { referer, filename, mime } = {}) {
  const q = new URLSearchParams({ t: 'direct', u: mediaUrl });
  if (referer) q.set('r', referer);
  if (filename) q.set('n', filename);
  if (mime) q.set('m', mime);
  return `/api/dl?${q.toString()}`;
}

/** Proxy link that streams through the yt-dlp engine. */
function dlEngine(pageUrl, { format, audio, ext, filename } = {}) {
  const q = new URLSearchParams({ t: 'engine', u: pageUrl });
  if (format) q.set('f', format);
  if (audio) q.set('a', audio);
  if (ext) q.set('x', ext);
  if (filename) q.set('n', filename);
  return `/api/dl?${q.toString()}`;
}

const fmtSize = (bytes) => {
  if (!bytes || bytes <= 0) return null;
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(kb < 10 ? 1 : 0)} KB`;
  return `${(kb / 1024).toFixed(1)} MB`;
};

function humanDuration(sec) {
  if (!sec || !Number.isFinite(sec)) return null;
  const s = Math.round(sec);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}` : `${m}:${String(r).padStart(2, '0')}`;
}

/**
 * Build the format list for one yt-dlp entry.
 * - progressive MP4s first (playable everywhere, no merge needed)
 * - a "Best (merged)" option when ffmpeg is present
 * - audio-only option, MP3 when ffmpeg is present, otherwise native M4A/Opus
 */
function buildFormats(info, { ffmpeg, pageUrl, referer, baseName, maxMergeHeight = 1080 }) {
  const formats = Array.isArray(info.formats) ? info.formats : [];
  const list = [];
  const seen = new Set();

  const CONTAINER = new Set(['mp4', 'mov', 'mkv', 'webm']);
  const progressive = formats.filter((f) =>
    f.url && f.vcodec && f.vcodec !== 'none' && f.acodec && f.acodec !== 'none' && CONTAINER.has(String(f.ext || '')),
  );

  // de-duplicate per resolution+container, keep the heaviest (= best bitrate) variant
  const byHeight = new Map();
  for (const f of progressive) {
    const h = f.height || 0;
    const k = `${h}-${f.ext}`;
    const prev = byHeight.get(k);
    if (!prev || (f.filesize || f.filesize_approx || 0) > (prev.filesize || prev.filesize_approx || 0)) byHeight.set(k, f);
  }
  const ranked = [...byHeight.entries()].sort((a, b) => (b[1].height || 0) - (a[1].height || 0));

  ranked.forEach(([key, f], idx) => {
    if (seen.has(key)) return;
    seen.add(key);
    const ext = String(f.ext).toLowerCase();
    const height = f.height || 0;
    list.push({
      id: f.format_id,
      label: height ? `${height}p · ${ext.toUpperCase()}` : ext.toUpperCase(),
      tag: idx === 0 || height >= 720 ? 'HD' : 'SD',
      ext,
      kind: 'video',
      size: fmtSize(f.filesize || f.filesize_approx),
      fps: f.fps || null,
      url: dlEngine(pageUrl, { format: f.format_id, ext, filename: `${baseName}-${height || 'video'}p` }),
    });
  });

  // images (Instagram carousel, Pinterest, XiaoHongShu…)
  const directImage = formats.filter((f) => f.url && IMAGE_EXT.has(String(f.ext || '').toLowerCase()));
  for (const f of directImage) {
    list.push({
      id: f.format_id || 'image',
      label: f.resolution ? `Photo ${f.resolution}` : 'Photo HD',
      tag: 'IMG',
      ext: String(f.ext).toLowerCase(),
      kind: 'image',
      size: fmtSize(f.filesize || f.filesize_approx),
      url: dlDirect(f.url, { referer, filename: baseName }),
    });
  }

  // "hasVideo" must look at the SOURCE format list, not at `list`: on YouTube a
  // datacentre IP gets DASH-only streams, so there is no progressive entry and a
  // check against `list` would silently hide the merged best-quality option.
  const hasProgressive = list.some((f) => f.kind === 'video');
  const videoStreams = formats
    .filter((f) => f.url && f.vcodec && f.vcodec !== 'none')
    .sort((a, b) => (b.height || 0) - (a.height || 0));

  if (ffmpeg && videoStreams.length) {
    list.unshift({
      id: 'best-merged',
      label: 'Kualitas Terbaik · MP4 (video+audio)',
      tag: 'MAX',
      ext: 'mp4',
      kind: 'video',
      // Cap the height: an uncapped "best" picks 4K/8K sources that can be
      // hundreds of MB and will exhaust a small instance's disk mid-request.
      // mp4+m4a is preferred so the muxed file plays in every browser.
      url: dlEngine(pageUrl, {
        format: `bv*[height<=${maxMergeHeight}][ext=mp4]+ba[ext=m4a]/bv*[height<=${maxMergeHeight}]+ba/b`,
        ext: 'mp4',
        filename: `${baseName}-best`,
      }),
    });
  }

  // No single-file video available → expose the top video-only stream, labelled
  // honestly so nobody downloads a silent clip by accident.
  if (!hasProgressive && videoStreams.length) {
    const top = videoStreams[0];
    const vext = String(top.ext || 'mp4').toLowerCase();
    list.push({
      id: top.format_id,
      label: `${top.height || '?'}p · ${vext.toUpperCase()} (video saja, tanpa audio)`,
      tag: 'HD',
      ext: vext,
      kind: 'video',
      size: fmtSize(top.filesize || top.filesize_approx),
      url: dlEngine(pageUrl, { format: top.format_id, ext: vext, filename: baseName }),
    });
  }

  // audio
  const audioCandidates = formats.filter((f) => f.url && f.acodec && f.acodec !== 'none' && (!f.vcodec || f.vcodec === 'none'));
  if (audioCandidates.length) {
    const pref = ['m4a', 'mp3', 'opus', 'webm', 'ogg', 'aac'];
    const sorted = [...audioCandidates].sort((a, b) => {
      const pa = pref.indexOf(a.ext); const pb = pref.indexOf(b.ext);
      if (pa !== pb) return (pa === -1 ? 99 : pa) - (pb === -1 ? 99 : pb);
      return (b.tbr || b.filesize || 0) - (a.tbr || a.filesize || 0);
    });
    const best = sorted[0];
    const nativeExt = best.ext === 'webm' ? 'webm' : best.ext === 'opus' ? 'opus' : 'm4a';
    const kbps = Math.round((best.tbr || best.abr || 128));

    if (ffmpeg) {
      list.push({
        id: 'audio-mp3',
        label: `MP3 · ${Math.min(Math.max(kbps, 128), 320)}kbps`,
        tag: 'MP3',
        ext: 'mp3',
        kind: 'audio',
        url: dlEngine(pageUrl, { format: best.format_id, audio: 'mp3', filename: baseName }),
      });
    }
    list.push({
      id: best.format_id,
      label: ffmpeg ? `Audio asli · ${nativeExt.toUpperCase()}` : `Audio · ${nativeExt.toUpperCase()} ${kbps}kbps`,
      tag: 'AUDIO',
      ext: nativeExt,
      kind: 'audio',
      size: fmtSize(best.filesize || best.filesize_approx),
      url: dlEngine(pageUrl, { format: best.format_id, audio: 'native', ext: nativeExt, filename: baseName }),
    });
  }

  // splitOnly = video and audio live in separate streams and this server has
  // no ffmpeg to mux them. The UI says so instead of handing over a silent file.
  const splitOnly = !ffmpeg && list.some((f) => f.kind === "video") && !list.some((f) => f.id === "best-merged");
  return { list, splitOnly };
}

/** Convert a single yt-dlp info dict into one result item. */
function entryToItem(entry, { ffmpeg, pageUrl, referer, fallbackTitle, maxMergeHeight = 1080 }) {
  const ext = String(entry.ext || '').toLowerCase();
  const title = entry.title || entry.fulltitle || fallbackTitle || 'Media';
  const baseName = slugify(title);
  const kind = IMAGE_EXT.has(ext) ? 'image' : AUDIO_EXT.has(ext) && (!entry.vcodec || entry.vcodec === 'none') ? 'audio' : 'video';

  const built = buildFormats(entry, { ffmpeg, pageUrl: entry.webpage_url || pageUrl, referer, baseName, maxMergeHeight });
  let formats = built.list;
  const splitOnly = built.splitOnly;

  // single-file entries (images, direct mp3, some CDNs) expose the url directly
  if (entry.url && (IMAGE_EXT.has(ext) || ext === 'mp3' || !entry.formats?.length)) {
    if (!formats.some((f) => f.kind === kind)) {
      formats.unshift({
        id: 'direct',
        label: kind === 'image' ? 'Photo HD' : kind === 'audio' ? `Audio · ${ext.toUpperCase()}` : `Video · ${ext.toUpperCase()}`,
        tag: kind === 'image' ? 'IMG' : kind === 'audio' ? 'AUDIO' : 'HD',
        ext: ext || 'mp4',
        kind,
        size: fmtSize(entry.filesize || entry.filesize_approx),
        url: dlDirect(entry.url, { referer, filename: baseName }),
      });
    }
  }

  return {
    id: entry.id || baseName,
    title,
    thumbnail: entry.thumbnail || entry.thumbnails?.at(-1)?.url || null,
    duration: humanDuration(entry.duration),
    kind,
    splitOnly: !!splitOnly,
    formats,
  };
}

/** Top-level normaliser for engine JSON (single video OR flat playlist). */
function normalizeYtDlp(info, { platform, platformName, url, ffmpeg, warnings = [] }) {
  const isList = info._type === 'playlist' || info._type === 'multi_video' || Array.isArray(info.entries);

  if (isList) {
    const entries = (info.entries || []).filter(Boolean);
    const items = entries.map((e) => {
      const pageUrl = e.url || e.webpage_url || url;
      return {
        id: e.id || pageUrl,
        title: e.title || 'Item playlist',
        thumbnail: e.thumbnail || e.thumbnails?.at(-1)?.url || null,
        duration: humanDuration(e.duration),
        kind: 'video',
        url: pageUrl,
        formats: [
          { id: 'best', label: 'Kualitas Terbaik · MP4', tag: 'HD', ext: 'mp4', kind: 'video', url: dlEngine(pageUrl, { format: 'b', ext: 'mp4', filename: slugify(e.title) }) },
          { id: 'audio', label: ffmpeg ? 'MP3 Audio' : 'Audio asli', tag: 'MP3', ext: ffmpeg ? 'mp3' : 'm4a', kind: 'audio', url: dlEngine(pageUrl, { audio: ffmpeg ? 'mp3' : 'native', ext: ffmpeg ? 'mp3' : 'm4a', filename: slugify(e.title) }) },
        ],
      };
    });
    return {
      platform, platformName, url,
      title: info.title || 'Playlist',
      author: info.uploader || info.channel || null,
      thumbnail: info.thumbnails?.at(-1)?.url || items[0]?.thumbnail || null,
      duration: null,
      kind: 'playlist',
      isPlaylist: true,
      count: items.length,
      items,
      warnings,
    };
  }

  const item = entryToItem(info, {
    ffmpeg,
    pageUrl: info.webpage_url || url,
    referer: info.webpage_url || url,
    fallbackTitle: info.title,
    maxMergeHeight: config.maxMergeHeight,
  });

  // YouTube thumbnails as an extra option
  if (/youtube|youtu\.be/i.test(url) && info.id) {
    item.formats.push({
      id: 'thumb',
      label: 'Thumbnail · JPG',
      tag: 'IMG',
      ext: 'jpg',
      kind: 'image',
      url: dlDirect(`https://i.ytimg.com/vi/${info.id}/maxresdefault.jpg`, { filename: `${slugify(info.title)}-thumb` }),
    });
  }

  if (!item.formats.length) {
    throw Object.assign(new Error('No formats available'), { noMedia: true });
  }

  const allWarnings = [...warnings];
  if (item.splitOnly) {
    allWarnings.push({
      code: 'NO_FFMPEG',
      text: 'Server ini belum punya ffmpeg, jadi track video dan audio masih terpisah. Pasang ffmpeg untuk mendapat satu file MP4 utuh + konversi MP3.',
    });
  }

  return {
    platform,
    platformName,
    url,
    title: info.title || item.title,
    author: info.uploader || info.channel || info.creator || null,
    thumbnail: item.thumbnail,
    duration: item.duration,
    kind: item.kind,
    isPlaylist: false,
    views: info.view_count ?? null,
    likes: info.like_count ?? null,
    items: [item],
    warnings: allWarnings,
  };
}

module.exports = { normalizeYtDlp, entryToItem, buildFormats, dlDirect, dlEngine, slugify, humanDuration, fmtSize, IMAGE_EXT, AUDIO_EXT };
