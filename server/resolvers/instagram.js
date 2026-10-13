'use strict';

const { getText, metaContent, getJson } = require('../lib/http');
const { dlDirect, slugify } = require('./normalize');
const config = require('../config');

/**
 * Instagram fallbacks for when the engine asks for cookies.
 *
 *  1. Optional 3rd-party endpoint (IG_API_ENDPOINT) — bring your own if you have one
 *  2. Public embed page (`/embed/captioned/`) — works for most public posts,
 *     no login, no key. Selectors are regex-based and kept deliberately loose
 *     so a markup tweak does not kill the resolver.
 */

const CODE_RE = /instagram\.com\/(?:[a-z]{2,3}\/)?(?:p|reel|reels|tv|share)\/([A-Za-z0-9_-]+)/i;
const STORY_RE = /instagram\.com\/stories\/([^/]+)\/([A-Za-z0-9_-]+)/i;

function shortcode(ctx) {
  const m = ctx.url.href.match(CODE_RE);
  return m ? m[1] : null;
}

async function viaCustomApi(ctx) {
  if (!config.igApiEndpoint) throw new Error('no custom IG endpoint configured');
  const u = config.igApiEndpoint.includes('{url}')
    ? config.igApiEndpoint.replace('{url}', encodeURIComponent(ctx.url.href))
    : `${config.igApiEndpoint}?url=${encodeURIComponent(ctx.url.href)}`;
  const json = await getJson(u, { timeoutMs: 20_000 });
  const list = json.data?.media || json.media || json.result?.media || json.data || json.result || json;
  const arr = Array.isArray(list) ? list : Array.isArray(list?.videos) ? list.videos : null;
  if (!arr || !arr.length) throw new Error('custom IG endpoint returned nothing');

  const base = slugify(json.data?.title || json.title || 'instagram-media');
  const formats = arr.map((m, i) => ({
    id: `m-${i + 1}`,
    label: arr.length > 1 ? `Media ${i + 1}/${arr.length}` : m.type === 'image' ? 'Photo HD' : 'Video HD',
    tag: m.type === 'image' ? 'IMG' : 'HD',
    ext: m.type === 'image' ? 'jpg' : 'mp4',
    kind: m.type === 'image' ? 'image' : 'video',
    url: dlDirect(m.url || m.video_url || m.display_url, { referer: 'https://www.instagram.com/', filename: `${base}-${i + 1}` }),
  })).filter((f) => f.url);
  if (!formats.length) throw new Error('custom IG endpoint returned no urls');

  return {
    platform: 'instagram', platformName: 'Instagram', url: ctx.url.href,
    title: json.data?.title || json.title || 'Instagram post',
    author: json.data?.author || json.author || null,
    thumbnail: json.data?.thumbnail || json.thumbnail || (arr[0].type === 'image' ? arr[0].url : null),
    kind: formats.some((f) => f.kind === 'video') ? 'video' : 'gallery',
    isPlaylist: false,
    items: [{ id: base, title: 'Instagram post', thumbnail: null, kind: formats[0].kind, formats }],
    warnings: [],
  };
}

async function viaEmbed(ctx) {
  const code = shortcode(ctx);
  if (!code) throw new Error('not a post/reel/tv link');
  const isReel = /\/(reel|reels|tv)\//i.test(ctx.url.href);
  const embedUrl = `https://www.instagram.com/${isReel ? 'reel' : 'p'}/${code}/embed/captioned/`;
  const html = await getText(embedUrl, { timeoutMs: 18_000, retries: 1 });

  const videos = [...html.matchAll(/<video[^>]+src="([^"]+\.mp4[^"]*)"/gi)].map((m) => m[1].replace(/&amp;/g, '&'));
  const imgs = [...html.matchAll(/<img[^>]+class="[^"]*(?:EmbeddedMediaImage|t-9B9R0)[^"]*"[^>]+src="([^"]+)"/gi)]
    .map((m) => m[1].replace(/&amp;/g, '&'))
    .filter((s) => /cdninstagram/.test(s));
  const poster = metaContent(html, 'og:image') || [...html.matchAll(/poster="([^"]+)"/gi)].map((m) => m[1])[0] || null;
  const caption = (html.match(/<div[^>]+class="[^"]*Caption[^"]*"[^>]*>[\s\S]*?<span[^>]*>([\s\S]*?)<\/span>/i)?.[1] || metaContent(html, 'og:title') || '').replace(/<[^>]+>/g, '').trim();
  const author = html.match(/<a[^>]+class="[^"]*Username[^"]*"[^>]*>[^<]*@?([A-Za-z0-9_.]+)/i)?.[1] || null;

  const title = caption.slice(0, 120) || `Instagram ${isReel ? 'Reel' : 'post'}`;
  const base = slugify(caption || 'instagram');
  const formats = [];

  videos.slice(0, 10).forEach((v, i) => formats.push({
    id: `v-${i + 1}`, label: videos.length > 1 ? `Video ${i + 1}/${videos.length}` : 'Video · MP4',
    tag: 'HD', ext: 'mp4', kind: 'video',
    url: dlDirect(v, { referer: 'https://www.instagram.com/', filename: videos.length > 1 ? `${base}-${i + 1}` : base }),
  }));
  imgs.slice(0, 20).forEach((v, i) => formats.push({
    id: `i-${i + 1}`, label: imgs.length > 1 ? `Photo ${i + 1}/${imgs.length}` : 'Photo HD',
    tag: 'IMG', ext: 'jpg', kind: 'image',
    url: dlDirect(v, { referer: 'https://www.instagram.com/', filename: `${base}-photo-${i + 1}` }),
  }));

  if (!formats.length) throw new Error('empty media response');

  return {
    platform: 'instagram', platformName: 'Instagram', url: ctx.url.href,
    title, author: author ? `@${author}` : null, thumbnail: poster,
    kind: formats.some((f) => f.kind === 'video') ? 'video' : 'gallery',
    isPlaylist: false,
    items: [{ id: code, title, thumbnail: poster, kind: formats[0].kind, formats }],
    warnings: [],
  };
}

module.exports = {
  id: 'instagram',
  name: 'Instagram',
  methods: [
    { name: 'custom-api', run: viaCustomApi, optional: () => !config.igApiEndpoint },
    { name: 'embed', run: viaEmbed },
  ],
  isStory: (href) => STORY_RE.test(href),
};
