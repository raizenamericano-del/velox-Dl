/* ==========================================================================
   VELOX — frontend
   Vanilla JS, no build step, no external requests.
   ========================================================================== */
'use strict';

(() => {
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

  // ── platform registry (mirrors server/lib/detect.js) ───────────────────
  const PLATFORMS = [
    { id: 'tiktok', name: 'TikTok', tier: 1, color: '#25F4EE', kinds: 'Video · Slide Foto · MP3 · No WM', test: /tiktok\.com/i, sample: 'https://www.tiktok.com/@tiktok/video/7460937381265411370' },
    { id: 'instagram', name: 'Instagram', tier: 1, color: '#E1306C', kinds: 'Reels · Post · Carousel · Story', test: /instagram\.com/i, sample: 'https://www.instagram.com/reel/C1x2y3z/' },
    { id: 'youtube', name: 'YouTube', tier: 1, color: '#FF3B3B', kinds: 'MP4 · MP3 · Shorts · Playlist · Thumb', test: /(youtube\.com|youtu\.be)/i, sample: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ' },
    { id: 'facebook', name: 'Facebook', tier: 1, color: '#4C8DFF', kinds: 'Video · Reels · Watch', test: /(facebook\.com|fb\.watch|fb\.com)/i, sample: 'https://www.facebook.com/watch/?v=1234567890' },
    { id: 'twitter', name: 'X / Twitter', tier: 1, color: '#E7E9EA', kinds: 'Video · GIF · Foto', test: /(twitter\.com|x\.com)/i, sample: 'https://x.com/i/status/1580661436132757506' },
    { id: 'pinterest', name: 'Pinterest', tier: 2, color: '#FF5252', kinds: 'Video · Image HD · GIF', test: /(pinterest\.|pin\.it)/i, sample: 'https://www.pinterest.com/pin/123456789/' },
    { id: 'rednote', name: 'RedNote', tier: 2, color: '#FF2442', kinds: 'Video · Image · 小红书', test: /(xiaohongshu\.com|xhslink\.com)/i, sample: 'https://www.xiaohongshu.com/explore/000000000000000000000000' },
    { id: 'snapchat', name: 'Snapchat', tier: 2, color: '#FFE14D', kinds: 'Spotlight · Story', test: /snapchat\.com/i, sample: 'https://www.snapchat.com/spotlight/abcdef' },
    { id: 'threads', name: 'Threads', tier: 2, color: '#D8D8D8', kinds: 'Video · Image', test: /threads\.(net|com)/i, sample: 'https://www.threads.net/@user/post/ABC123' },
    { id: 'linkedin', name: 'LinkedIn', tier: 2, color: '#4A9EFF', kinds: 'Video · Post', test: /(linkedin\.com|lnkd\.in)/i, sample: 'https://www.linkedin.com/posts/user_activity-000' },
    { id: 'vimeo', name: 'Vimeo', tier: 3, color: '#4CC8F0', kinds: 'Video HD', test: /vimeo\.com/i, sample: 'https://vimeo.com/76979871' },
    { id: 'dailymotion', name: 'Dailymotion', tier: 3, color: '#5C9DFF', kinds: 'Video', test: /(dailymotion\.com|dai\.ly)/i, sample: 'https://www.dailymotion.com/video/x8abcde' },
    { id: 'twitch', name: 'Twitch', tier: 3, color: '#B084FF', kinds: 'Clip · VOD', test: /twitch\.tv/i, sample: 'https://clips.twitch.tv/SomeClipName' },
    { id: 'soundcloud', name: 'SoundCloud', tier: 3, color: '#FF8533', kinds: 'MP3', test: /(soundcloud\.com|snd\.sc)/i, sample: 'https://soundcloud.com/artist/track' },
  ];
  const ICON_SLUG = { twitter: 'x', rednote: 'xiaohongshu' };
  const GLOBE = 'M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20Zm6.9 6h-2.9a15.6 15.6 0 0 0-1.4-3.6A8 8 0 0 1 18.9 8ZM12 4.1c.7 1 1.3 2.4 1.7 3.9h-3.4c.4-1.5 1-2.9 1.7-3.9ZM4.3 14a7.9 7.9 0 0 1 0-4h3.3a16 16 0 0 0 0 4H4.3Zm.8 2h2.9c.3 1.3.8 2.5 1.4 3.6A8 8 0 0 1 5.1 16Zm2.9-8H5.1a8 8 0 0 1 4.3-3.6A15.6 15.6 0 0 0 8 8ZM12 19.9c-.7-1-1.3-2.4-1.7-3.9h3.4c-.4 1.5-1 2.9-1.7 3.9ZM14 14H10a14 14 0 0 1 0-4h4a14 14 0 0 1 0 4Zm.6 5.6c.6-1.1 1.1-2.3 1.4-3.6h2.9a8 8 0 0 1-4.3 3.6Zm1.8-5.6a16 16 0 0 0 0-4h3.3a7.9 7.9 0 0 1 0 4h-3.3Z';

  const iconSvg = (id, size = 20) => {
    const slug = ICON_SLUG[id] || id;
    const d = (typeof ICONS !== 'undefined' && ICONS[slug]) || GLOBE;
    return `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="currentColor" aria-hidden="true"><path d="${d}"/></svg>`;
  };
  const colorOf = (id) => PLATFORMS.find((p) => p.id === id)?.color || '#7c5cff';
  const nameOf = (id) => PLATFORMS.find((p) => p.id === id)?.name || 'Website';

  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const detect = (v) => PLATFORMS.find((p) => p.test.test(String(v || ''))) || null;

  // ── elements ───────────────────────────────────────────────────────────
  const form = $('#dlForm'), input = $('#urlInput'), goBtn = $('#goBtn');
  const shell = $('#inputShell'), iconEl = $('#platformIcon'), hint = $('#hintText'), formHint = $('#formHint');
  const zone = $('#resultZone'), statusPill = $('#statusPill'), statusText = $('#statusText');
  const drawer = $('#historyDrawer'), scrim = $('#scrim'), histList = $('#historyList'), histCount = $('#historyCount');
  const toasts = $('#toasts');

  const HINT_DEFAULT = 'Mendukung 14 platform · hasil di-cache 10 menit biar ngebut';

  // ── toasts ─────────────────────────────────────────────────────────────
  function toast(kind, title, msg, ms = 4200) {
    const ico = kind === 'ok' ? '✓' : kind === 'err' ? '✕' : 'ℹ';
    const el = document.createElement('div');
    el.className = `toast ${kind}`;
    el.innerHTML = `<span class="toast-ico">${ico}</span><div><b>${esc(title)}</b>${msg ? `<p>${esc(msg)}</p>` : ''}</div>`;
    toasts.appendChild(el);
    setTimeout(() => { el.classList.add('out'); setTimeout(() => el.remove(), 300); }, ms);
  }

  // ── history (localStorage only — nothing leaves the browser) ───────────
  const HKEY = 'velox.history.v1';
  const readHistory = () => { try { return JSON.parse(localStorage.getItem(HKEY) || '[]'); } catch { return []; } };
  const writeHistory = (list) => { try { localStorage.setItem(HKEY, JSON.stringify(list.slice(0, 30))); } catch { /* quota */ } };

  function pushHistory(entry) {
    const list = readHistory().filter((h) => h.url !== entry.url);
    list.unshift({ ...entry, ts: Date.now() });
    writeHistory(list);
    renderHistory();
  }
  function renderHistory() {
    const list = readHistory();
    histCount.hidden = list.length === 0;
    histCount.textContent = list.length;
    if (!list.length) {
      histList.innerHTML = '<div class="empty-state"><span>🕘</span>Belum ada riwayat.<br>Link yang kamu proses akan muncul di sini.</div>';
      return;
    }
    histList.innerHTML = list.map((h, i) => `
      <div class="hist-item">
        ${h.thumb ? `<img class="hist-thumb" src="${esc(h.thumb)}" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.style.visibility='hidden'">` : '<div class="hist-thumb"></div>'}
        <div class="hist-info">
          <div class="hist-title">${esc(h.title || h.url)}</div>
          <div class="hist-sub">${esc(nameOf(h.platform))} · ${new Date(h.ts).toLocaleString('id-ID', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}</div>
          <div class="hist-acts">
            <button class="mini-btn" data-reopen="${i}">Buka lagi</button>
            <button class="mini-btn" data-copy="${esc(h.url)}">Salin</button>
          </div>
        </div>
        <button class="hist-del" data-del="${i}" aria-label="Hapus dari riwayat">✕</button>
      </div>`).join('');
  }

  histList.addEventListener('click', async (e) => {
    const reopen = e.target.closest('[data-reopen]'), del = e.target.closest('[data-del]'), copy = e.target.closest('[data-copy]');
    const list = readHistory();
    if (reopen) { const h = list[+reopen.dataset.reopen]; if (h) { input.value = h.url; closeDrawer(); submit(h.url); } }
    if (del) { writeHistory(list.filter((_, i) => i !== +del.dataset.del)); renderHistory(); }
    if (copy) { await copyText(copy.dataset.copy); }
  });

  $('#clearHistory').addEventListener('click', () => { writeHistory([]); renderHistory(); toast('info', 'Riwayat dikosongkan'); });

  async function copyText(t) {
    try { await navigator.clipboard.writeText(t); toast('ok', 'Tersalin ke clipboard'); }
    catch { toast('err', 'Gagal menyalin', 'Browser menolak akses clipboard.'); }
  }

  function openDrawer() { drawer.classList.add('is-open'); drawer.setAttribute('aria-hidden', 'false'); scrim.hidden = false; document.body.style.overflow = 'hidden'; }
  function closeDrawer() { drawer.classList.remove('is-open'); drawer.setAttribute('aria-hidden', 'true'); scrim.hidden = true; document.body.style.overflow = ''; }
  $('#historyBtn').addEventListener('click', openDrawer);
  $('#closeHistory').addEventListener('click', closeDrawer);
  scrim.addEventListener('click', closeDrawer);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeDrawer(); });

  // ── live platform icon in the input ────────────────────────────────────
  function syncIcon() {
    const p = detect(input.value);
    if (p) {
      iconEl.innerHTML = iconSvg(p.id, 20);
      iconEl.classList.add('is-live');
      iconEl.style.color = p.color;
      hint.textContent = `${p.name} terdeteksi — siap diambil`;
      formHint.classList.remove('has-err');
    } else {
      iconEl.innerHTML = `<svg viewBox="0 0 24 24" width="19" height="19" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7"/><path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7"/></svg>`;
      iconEl.classList.remove('is-live');
      iconEl.style.color = '';
      hint.textContent = HINT_DEFAULT;
      formHint.classList.remove('has-err');
    }
  }
  input.addEventListener('input', syncIcon);

  // ── paste button + global ctrl/⌘+V shortcut ────────────────────────────
  $('#pasteBtn').addEventListener('click', async () => {
    try {
      const t = (await navigator.clipboard.readText()).trim();
      if (!t) return toast('info', 'Clipboard kosong');
      input.value = t; syncIcon(); input.focus(); submit(t);
    } catch { input.focus(); toast('info', 'Tempel manual', 'Tekan Ctrl+V di kolom input.'); }
  });
  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'v' && document.activeElement !== input) {
      input.focus();
    }
  });

  // ── loading skeleton with rotating status ──────────────────────────────
  const STAGES = [
    'Mengenali platform…', 'Menghubungi sumber…', 'Membaca kualitas tersedia…', 'Menyiapkan link download…',
  ];
  let stageTimer = null;
  function showSkeleton() {
    zone.hidden = false;
    zone.innerHTML = `
      <div class="skel">
        <div class="skel-row">
          <div class="skel-thumb shimmer"></div>
          <div class="skel-lines">
            <div class="skel-line shimmer" style="width:82%"></div>
            <div class="skel-line shimmer" style="width:56%"></div>
            <div class="skel-line shimmer" style="width:38%"></div>
          </div>
        </div>
        <div class="skel-bar shimmer"></div>
        <div class="skel-status"><span class="spinner"></span><span id="stageText">${STAGES[0]}</span></div>
      </div>`;
    let i = 0;
    const label = $('#stageText');
    stageTimer = setInterval(() => { i = Math.min(i + 1, STAGES.length - 1); if (label) label.textContent = STAGES[i]; }, 1400);
    zone.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }
  const stopStages = () => { clearInterval(stageTimer); stageTimer = null; };

  function setLoading(on) {
    goBtn.classList.toggle('is-loading', on);
    goBtn.disabled = on;
    input.readOnly = on;
  }

  // ── resolve ────────────────────────────────────────────────────────────
  form.addEventListener('submit', (e) => { e.preventDefault(); submit(); });

  async function submit(forcedUrl) {
    const url = (forcedUrl || input.value).trim();
    if (!url) {
      formHint.classList.add('has-err');
      hint.textContent = 'Tempel dulu link videonya di atas 👆';
      shell.classList.add('is-shake');
      setTimeout(() => shell.classList.remove('is-shake'), 400);
      input.focus();
      return;
    }

    setLoading(true); showSkeleton();

    try {
      const res = await fetch('/api/resolve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url }),
      });
      const data = await res.json();
      stopStages();

      if (!res.ok || !data.items) {
        renderError(data.error || { title: 'Gagal memproses', message: 'Server membalas tanpa data.' }, url);
        return;
      }
      renderResult(data);
      pushHistory({ url, title: data.title, platform: data.platform, thumb: data.thumbnail });
      if (data.cached) toast('info', 'Diambil dari cache', 'Link ini baru saja diproses, jadi hasilnya instan.');
    } catch (err) {
      stopStages();
      renderError({
        code: 'NETWORK',
        title: 'Tidak bisa menghubungi server 📡',
        message: 'Koneksi ke server VELOX terputus. Coba lagi sebentar.',
        hint: 'Kalau terus gagal, muat ulang halaman ini.',
      }, url);
    } finally {
      setLoading(false);
    }
  }

  // ── render result ──────────────────────────────────────────────────────
  function formatButton(f, idx) {
    const ico = f.kind === 'audio'
      ? '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>'
      : f.kind === 'image'
        ? '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-5-5L5 21"/></svg>'
        : '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v12"/><path d="m7 11 5 5 5-5"/><path d="M5 21h14"/></svg>';
    return `<button class="fmt-btn" data-kind="${esc(f.kind)}" data-url="${esc(f.url)}" data-idx="${idx}">
      <span class="fmt-ico">${ico}</span>
      <span class="fmt-txt">
        <span class="fmt-label">${esc(f.label)}</span>
        <span class="fmt-sub">${esc(f.size || f.ext?.toUpperCase() || 'Download')}</span>
      </span>
      <span class="fmt-tag" data-tag="${esc(f.tag || '')}">${esc(f.tag || 'FILE')}</span>
    </button>`;
  }

  function renderResult(d) {
    zone.hidden = false;
    const plat = d.platform || 'generic';
    const color = colorOf(plat);
    const item = d.items[0];
    const vertical = /tiktok|instagram|snapchat|threads|rednote/i.test(plat);

    // group formats by kind, keep server ordering inside each group
    const groups = [
      { key: 'video', title: 'Video' },
      { key: 'audio', title: 'Audio' },
      { key: 'image', title: d.kind === 'gallery' ? 'Foto (slide)' : 'Foto' },
    ];

    const body = d.isPlaylist ? renderPlaylist(d) : groups.map((g) => {
      const list = (d.items || []).flatMap((it) => it.formats || []).filter((f) => (g.key === 'video' ? f.kind === 'video' : f.kind === g.key));
      if (!list.length) return '';
      return `<div class="fmt-section">
        <div class="fmt-head">${g.title} <span style="font-weight:500;letter-spacing:0;text-transform:none">· ${list.length} opsi</span></div>
        <div class="fmt-grid">${list.map((f, i) => formatButton(f, i)).join('')}</div>
      </div>`;
    }).join('');

    zone.innerHTML = `
      <div class="result-card">
        <div class="result-top">
          <div class="thumb-wrap ${vertical && !d.isPlaylist ? 'vertical' : ''}">
            ${d.thumbnail
              ? `<img src="${esc(d.thumbnail)}" alt="" referrerpolicy="no-referrer" onerror="this.parentElement.insertAdjacentHTML('beforeend','<div class=&quot;thumb-fallback&quot;>${iconSvg(plat, 30)}</div>');this.remove()">`
              : `<div class="thumb-fallback">${iconSvg(plat, 30)}</div>`}
            <span class="thumb-plat" style="color:${color}">${iconSvg(plat, 13)} ${esc(d.platformName || nameOf(plat))}</span>
            ${d.duration ? `<span class="thumb-dur">${esc(d.duration)}</span>` : ''}
          </div>
          <div class="result-meta">
            <h2 class="result-title">${esc(d.title || 'Media')}</h2>
            ${d.author ? `<p class="result-by">${esc(d.author)}</p>` : ''}
            <div class="result-stats">
              ${d.via ? `<span class="chip via">via ${esc(d.via)}</span>` : ''}
              ${d.views ? `<span class="chip">👁 ${d.views.toLocaleString('id-ID')}</span>` : ''}
              ${d.likes ? `<span class="chip">♥ ${d.likes.toLocaleString('id-ID')}</span>` : ''}
              ${d.isPlaylist ? `<span class="chip good">${d.count} item playlist</span>` : ''}
              ${!d.isPlaylist ? '<span class="chip good">✓ Tanpa watermark</span>' : ''}
              <span class="chip">${esc(typeof d.ms === 'number' ? `${d.ms} ms` : 'cepat')}</span>
            </div>
            ${(d.warnings || []).map((w) => `<div class="warn-note"><span>⚠</span><span>${esc(w.text || w)}</span></div>`).join('')}
          </div>
        </div>
        ${body}
      </div>`;
    zone.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  function renderPlaylist(d) {
    return `<div class="fmt-section">
      <div class="fmt-head">Item playlist · ${d.items.length} video</div>
      <div class="pl-list">
        ${d.items.map((it, i) => `
          <div class="pl-row">
            ${it.thumbnail ? `<img class="pl-thumb" src="${esc(it.thumbnail)}" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.style.visibility='hidden'">` : '<div class="pl-thumb"></div>'}
            <div class="pl-info">
              <div class="pl-title">${i + 1}. ${esc(it.title)}</div>
              <div class="pl-sub">${esc(it.duration || 'Video')}</div>
            </div>
            <div class="pl-acts">
              ${(it.formats || []).map((f) => `<button class="mini-btn" data-url="${esc(f.url)}" data-kind="${esc(f.kind)}">${esc(f.kind === 'audio' ? 'MP3' : 'MP4')}</button>`).join('')}
            </div>
          </div>`).join('')}
      </div>
    </div>`;
  }

  function renderError(err, url) {
    zone.hidden = false;
    zone.innerHTML = `
      <div class="err-card">
        <div class="err-head"><span class="err-ico">!</span><span>${esc(err.title || 'Gagal memproses')}</span></div>
        <p class="err-msg">${esc(err.message || 'Terjadi kesalahan yang tidak diketahui.')}</p>
        ${err.hint ? `<div class="err-hint">💡 <b>Saran:</b> ${esc(err.hint)}</div>` : ''}
        <div class="err-acts">
          <button class="mini-btn" id="retryBtn">↻ Coba lagi</button>
          <button class="mini-btn" id="copyUrlBtn">Salin link</button>
        </div>
        ${err.code ? `<p class="err-code" style="margin-top:12px">kode: ${esc(err.code)}</p>` : ''}
      </div>`;
    $('#retryBtn').addEventListener('click', () => submit(url));
    $('#copyUrlBtn').addEventListener('click', () => copyText(url));
    zone.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    toast('err', err.title || 'Gagal', err.message?.slice(0, 90), 5200);
  }

  // ── downloads (streamed via fetch so failures become toasts, not junk files)
  function filenameFrom(cd, fallback) {
    if (!cd) return fallback;
    const star = cd.match(/filename\*=UTF-8''([^;]+)/i);
    if (star) { try { return decodeURIComponent(star[1]); } catch { /* fall through */ } }
    const plain = cd.match(/filename="?([^";]+)"?/i);
    return plain ? plain[1] : fallback;
  }

  async function download(btn) {
    const url = btn.dataset.url;
    if (!url) return;
    const sub = btn.querySelector('.fmt-sub');
    const originalSub = sub ? sub.textContent : '';
    btn.classList.add('is-busy');
    if (sub) sub.textContent = 'Menyiapkan…';

    try {
      const res = await fetch(url);
      const ct = res.headers.get('content-type') || '';

      if (ct.includes('application/json')) {
        const j = await res.json().catch(() => ({}));
        const e = j.error || {};
        throw Object.assign(new Error(e.message || 'Gagal mengambil file'), { title: e.title, hint: e.hint });
      }
      if (!res.ok || !res.body) throw Object.assign(new Error(`Server membalas HTTP ${res.status}`), { title: 'Download gagal' });

      const total = Number(res.headers.get('content-length')) || 0;
      const name = filenameFrom(res.headers.get('content-disposition'), 'velox-media');

      const reader = res.body.getReader();
      const chunks = [];
      let got = 0;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value); got += value.length;
        if (sub) sub.textContent = total ? `${Math.round((got / total) * 100)}% · ${(got / 1048576).toFixed(1)} MB` : `${(got / 1048576).toFixed(1)} MB`;
      }

      const blob = new Blob(chunks, { type: ct || 'application/octet-stream' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = name;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 5000);

      if (sub) sub.textContent = `✓ ${(blob.size / 1048576).toFixed(1)} MB tersimpan`;
      toast('ok', 'Download selesai', name, 3600);
      setTimeout(() => { if (sub) sub.textContent = originalSub; }, 3200);
    } catch (err) {
      if (sub) sub.textContent = originalSub;
      toast('err', err.title || 'Download gagal', err.message || String(err), 5200);
    } finally {
      btn.classList.remove('is-busy');
    }
  }

  zone.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-url]');
    if (btn) download(btn);
  });

  // ── platform grid ──────────────────────────────────────────────────────
  function renderPlatforms() {
    $('#platformGrid').innerHTML = PLATFORMS.map((p) => `
      <button class="plat-card" style="--pc:${p.color}" data-sample="${esc(p.sample)}" title="Coba link contoh ${esc(p.name)}">
        <span class="plat-tier" data-tier="${p.tier}">T${p.tier}</span>
        <span class="plat-ico">${iconSvg(p.id, 21)}</span>
        <span class="plat-name">${esc(p.name)}</span>
        <span class="plat-kinds">${esc(p.kinds)}</span>
      </button>`).join('');
    $('#platformGrid').addEventListener('click', (e) => {
      const card = e.target.closest('[data-sample]');
      if (!card) return;
      input.value = card.dataset.sample;
      syncIcon();
      window.scrollTo({ top: 0, behavior: 'smooth' });
      setTimeout(() => submit(card.dataset.sample), 320);
    });
  }

  // ── api tabs + base url ────────────────────────────────────────────────
  function initApi() {
    $$('.api-base').forEach((el) => { el.textContent = location.origin === 'null' ? '' : location.origin; });
    $('.api-tabs').addEventListener('click', (e) => {
      const tab = e.target.closest('.api-tab');
      if (!tab) return;
      $$('.api-tab').forEach((t) => { t.classList.toggle('is-active', t === tab); t.setAttribute('aria-selected', String(t === tab)); });
      $$('.api-pane').forEach((p) => p.classList.toggle('is-active', p.id === tab.dataset.pane));
    });
  }

  // ── health ─────────────────────────────────────────────────────────────
  async function pingHealth() {
    try {
      const res = await fetch('/api/health');
      const j = await res.json();
      const ok = j.status === 'ok';
      statusPill.dataset.state = ok ? 'ok' : 'bad';
      statusText.textContent = ok ? `online · ${j.engine?.version ? 'v' + j.engine.version : 'ready'}` : 'terbatas';
      statusPill.title = `Engine: yt-dlp ${j.engine?.version || '?'} · ffmpeg ${j.engine?.ffmpeg ? 'aktif' : 'tidak ada'} · cache ${j.cache?.entries ?? 0} entri`;
      $('#footEngine').textContent = `yt-dlp ${j.engine?.version || ''}`.trim();
      $('#footPlatforms').textContent = j.platforms || PLATFORMS.length;
    } catch {
      statusPill.dataset.state = 'bad';
      statusText.textContent = 'offline';
    }
  }

  // ── reveal on scroll ───────────────────────────────────────────────────
  function initReveal() {
    const els = $$('.reveal');
    if (!('IntersectionObserver' in window)) { els.forEach((e) => e.classList.add('in')); return; }
    const io = new IntersectionObserver((entries) => {
      entries.forEach((en) => { if (en.isIntersecting) { en.target.classList.add('in'); io.unobserve(en.target); } });
    }, { threshold: .12, rootMargin: '0px 0px -40px' });
    els.forEach((e) => io.observe(e));
  }

  // ── boot ───────────────────────────────────────────────────────────────
  syncIcon();
  renderPlatforms();
  renderHistory();
  initApi();
  initReveal();
  pingHealth();
  setInterval(pingHealth, 60_000);

  // expose for debugging in the console without polluting globals elsewhere
  window.VELOX = { resolve: submit, history: readHistory, platforms: PLATFORMS };
})();
