'use strict';

const { getJson } = require('../lib/http');
const { dlDirect, slugify } = require('./normalize');

/**
 * X / Twitter fallback via the public syndication CDN.
 * Needs no login and returns every media variant of a public tweet.
 * Token algorithm is the one the official embed widget uses.
 */

const ID_RE = /(?:twitter\.com|x\.com|fxtwitter\.com|vxtwitter\.com)\/(?:[^/]+\/status(?:es)?\/|i\/(?:status|web\/detail)\/|i\/events\/)(\d+)/i;

function syndicationToken(id) {
  return ((Number(id) / 1e15) * Math.PI).toString(6 ** 2).replace(/(0+|\.)/g, '');
}

async function viaSyndication(ctx) {
  const m = ctx.url.href.match(ID_RE);
  if (!m) throw new Error('not a tweet status link');
  const id = m[1];
  const json = await getJson(`https://cdn.syndication.twimg.com/tweet-result?id=${id}&token=${syndicationToken(id)}&lang=en`, {
    timeoutMs: 15_000,
    headers: { referer: 'https://platform.twitter.com/' },
  });

  if (json.__typename === 'TweetTombstone') throw new Error('No video could be found in this tweet (tombstone)');

  const media = json.mediaDetails || [];
  const photos = json.photos || [];
  const formats = [];
  const title = (json.text || 'Tweet media').slice(0, 140);
  const base = slugify(title);

  for (const [i, item] of media.entries()) {
    if (item.type === 'video' || item.type === 'animated_gif') {
      const variants = (item.video_info?.variants || [])
        .filter((v) => v.type === 'video/mp4' && v.url)
        .sort((a, b) => (b.bitrate || 0) - (a.bitrate || 0));
      const top = variants[0];
      const lower = variants.find((v) => v !== top);
      if (top) formats.push({ id: `v-${i}-hd`, label: item.type === 'animated_gif' ? 'GIF · MP4 (HD)' : `Video HD · MP4${top.bitrate ? ` ${Math.round(top.bitrate / 1000)}k` : ''}`, tag: 'HD', ext: 'mp4', kind: 'video', url: dlDirect(top.url, { filename: `${base}-hd` }) });
      if (lower) formats.push({ id: `v-${i}-sd`, label: 'Video SD · MP4', tag: 'SD', ext: 'mp4', kind: 'video', url: dlDirect(lower.url, { filename: base }) });
    } else if (item.type === 'photo' && item.media_url_https) {
      formats.push({
        id: `p-${i}`, label: media.length > 1 ? `Photo ${i + 1}/${media.length}` : 'Photo HD',
        tag: 'IMG', ext: 'jpg', kind: 'image',
        url: dlDirect(`${item.media_url_https}?name=orig`, { filename: `${base}-photo-${i + 1}` }),
      });
    }
  }

  for (const [i, p] of photos.entries()) {
    if (!p.url) continue;
    formats.push({
      id: `ph-${i}`, label: `Photo ${i + 1}/${photos.length}`, tag: 'IMG', ext: 'jpg', kind: 'image',
      url: dlDirect(`${p.url}${p.url.includes('?') ? '&' : '?'}name=orig`, { filename: `${base}-photo-${i + 1}` }),
    });
  }

  if (!formats.length) throw new Error('No video could be found in this tweet');

  return {
    platform: 'twitter', platformName: 'X / Twitter', url: ctx.url.href,
    title,
    author: json.user ? `@${json.user.screen_name}` : null,
    thumbnail: media[0]?.media_url_https || photos[0]?.url || null,
    kind: formats.some((f) => f.kind === 'video') ? 'video' : 'gallery',
    isPlaylist: false,
    likes: json.favorite_count ?? null,
    items: [{ id, title, thumbnail: media[0]?.media_url_https || null, kind: formats[0].kind, formats }],
    warnings: [],
  };
}

module.exports = { id: 'twitter', name: 'X / Twitter', methods: [{ name: 'syndication', run: viaSyndication }] };
