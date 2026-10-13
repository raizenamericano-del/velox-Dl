'use strict';

const config = require('../config');

/**
 * Small fetch wrapper: browser UA, hard timeout (AbortController), 1 retry on
 * network/5xx. Every outbound request in the app goes through here so that a
 * hanging upstream can never hang a worker.
 */
async function request(url, { method = 'GET', headers = {}, body, timeoutMs = 15_000, retries = 1, signal } = {}) {
  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(new Error('timed out')), timeoutMs);
    const onAbort = () => ctrl.abort();
    if (signal) signal.addEventListener('abort', onAbort, { once: true });

    try {
      const res = await fetch(url, {
        method,
        body,
        signal: ctrl.signal,
        redirect: 'follow',
        headers: {
          'user-agent': config.userAgent,
          'accept-language': 'en-US,en;q=0.9,id;q=0.8',
          ...headers,
        },
      });
      clearTimeout(timer);
      if (signal) signal.removeEventListener('abort', onAbort);

      if (res.status >= 500 && attempt < retries) { lastErr = new Error(`HTTP ${res.status}`); continue; }
      return res;
    } catch (err) {
      clearTimeout(timer);
      if (signal) signal.removeEventListener('abort', onAbort);
      lastErr = err;
      if (signal?.aborted) throw err;
    }
  }
  throw lastErr || new Error('request failed');
}

async function getJson(url, opts = {}) {
  const res = await request(url, { headers: { accept: 'application/json, text/plain;q=0.8', ...opts.headers }, ...opts });
  const text = await res.text();
  if (!res.ok) throw Object.assign(new Error(`HTTP Error ${res.status}`), { status: res.status, body: text.slice(0, 300) });
  try { return JSON.parse(text); } catch { throw new Error('Invalid JSON from upstream'); }
}

async function getText(url, opts = {}) {
  const res = await request(url, { headers: { accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.8', ...opts.headers }, ...opts });
  if (!res.ok) throw Object.assign(new Error(`HTTP Error ${res.status}`), { status: res.status });
  return res.text();
}

/** Pull the content of the first matching <meta> tag out of an HTML string. */
function metaContent(html, property) {
  const patterns = [
    new RegExp(`<meta[^>]+(?:property|name)=["']${property}["'][^>]+content=["']([^"']+)["']`, 'i'),
    new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["']${property}["']`, 'i'),
  ];
  for (const re of patterns) {
    const m = html.match(re);
    if (m?.[1]) return decodeEntities(m[1]);
  }
  return null;
}

const ENTITIES = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#x27;': "'", '&#39;': "'", '&nbsp;': ' ' };
function decodeEntities(s) {
  return String(s).replace(/&(?:amp|lt|gt|quot|#x27|#39|nbsp);/g, (m) => ENTITIES[m] ?? m);
}

/** Grab "key":"value" or key:"value" pairs out of an embedded JSON blob. */
function jsonField(source, key) {
  const re = new RegExp(`["']?${key}["']?\\s*:\\s*"((?:[^"\\\\]|\\\\.)*)"`, 'i');
  const m = source.match(re);
  if (!m?.[1]) return null;
  try { return JSON.parse(`"${m[1]}"`); } catch { return m[1]; }
}

module.exports = { request, getJson, getText, metaContent, jsonField, decodeEntities };
