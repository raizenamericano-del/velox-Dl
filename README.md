<div align="center">

# ⚡ VELOX

**Satu link. Semua platform.**

Downloader premium untuk 14 platform media sosial — tanpa watermark, kualitas HD, MP3 instan.
Tanpa daftar, tanpa iklan jebakan, tanpa redirect.

[![CI](https://github.com/USERNAME/velox/actions/workflows/ci.yml/badge.svg)](https://github.com/USERNAME/velox/actions/workflows/ci.yml)
[![Node](https://img.shields.io/badge/node-%3E%3D20-35e39a)](https://nodejs.org)
[![License](https://img.shields.io/badge/license-MIT-7c5cff)](LICENSE)

**[LIVE DEMO →](https://velox.up.railway.app)** · [Fitur](#-fitur) · [API](#-api) · [Deploy](#-deploy-ke-railway) · [Riset](RESEARCH.md)

</div>

---

## ✨ Fitur

**14 platform, satu kotak input**

| Tier | Platform | Yang bisa diambil |
|---|---|---|
| **1** | TikTok | Video HD **tanpa watermark**, slide foto, MP3, sound asli |
| **1** | Instagram | Reels, Post, Carousel, IGTV, Story |
| **1** | YouTube | MP4, MP3, Shorts, Thumbnail, Playlist |
| **1** | Facebook | Video, Reels, Watch |
| **1** | X / Twitter | Video, GIF, Foto resolusi asli |
| **2** | Pinterest | Video, Image HD, GIF |
| **2** | RedNote / 小红书 | Video, Image |
| **2** | Snapchat | Spotlight, Story |
| **2** | Threads | Video, Image |
| **2** | LinkedIn | Video |
| **3** | Vimeo · Dailymotion | Video HD |
| **3** | Twitch · SoundCloud | Clip / VOD · MP3 |

> Plus **1.800+ situs lain** lewat engine universal — tempel saja linknya.

**Di balik layar**

- ⚡ **Cepat** — fast-path API untuk TikTok (≈1 s), cache hasil 10 menit, streaming langsung tanpa menunggu file jadi
- 🛡️ **Fallback berlapis** — tiap platform punya 2–3 metode; kalau satu mati, berikutnya mengambil alih otomatis
- 🔄 **Self-healing** — yt-dlp di-update setiap deploy *dan* diperiksa ulang tiap 12 jam saat runtime
- 🧠 **Error manusiawi** — "kontennya sudah dihapus" + saran, bukan `ERROR: [Instagram] HTTP 403`
- 🔒 **Anti-SSRF** — proxy hanya menerima CDN platform yang dikenal; loopback/metadata cloud ditolak
- 🚦 **Rate limit per IP** — 20 resolve + 40 download per menit (bisa diatur)
- 📱 **Mobile-first** — dark mode, animasi halus, 0 request eksternal, total aset **25 KB** (terkompresi)
- 🧾 **Jujur soal kualitas** — kalau server tak punya ffmpeg, UI bilang "(video saja, tanpa audio)", bukan mengirim file bisu

---

## 🚀 Deploy ke Railway

[![Deploy on Railway](https://railway.app/button.svg)](https://railway.app/new/template?template=https://github.com/USERNAME/velox)

1. **Fork repo ini** ke akun GitHub-mu
2. Klik tombol di atas → pilih repo hasil fork
3. Railway mendeteksi `Dockerfile` dan `railway.json` otomatis
   (health check sudah diarahkan ke `/api/health`)
4. Selesai — aplikasi live di `https://<project>.up.railway.app`

**Variabel yang disarankan** (opsional, default sudah jalan):

| Variabel | Default | Keterangan |
|---|---|---|
| `MAX_MERGE_HEIGHT` | `1080` | Batas kualitas merge. **Jangan** dinaikkan ke 2160 di instance kecil — file 4K bisa ratusan MB |
| `YTDLP_COOKIES` | — | Path `cookies.txt` untuk Instagram/konten terbatas |
| `RATE_MAX_RESOLVE` | `20` | Request resolve per IP per menit |
| `CACHE_TTL_MINUTES` | `10` | Umur cache hasil |

Lihat [`.env.example`](.env.example) untuk daftar lengkap.

<details>
<summary><b>Kenapa Docker, bukan buildpack Node biasa?</b></summary>

Engine-nya `yt-dlp` (Python) dan konversi butuh `ffmpeg`. Buildpack Node tidak
menyediakan keduanya. `Procfile` tetap disertakan untuk platform yang memaksa
buildpack — dalam mode itu `scripts/ensure-ytdlp.js` mengunduh binary standalone
ke `./vendor`, tapi **tanpa ffmpeg** sehingga MP3 & merge dinonaktifkan.
</details>

---

## 💻 Jalankan lokal

```bash
git clone https://github.com/USERNAME/velox.git
cd velox
npm install          # postinstall otomatis memasang yt-dlp bila belum ada
npm start            # → http://localhost:3000
```

Butuh ffmpeg untuk MP3 & merge video+audio:

```bash
# macOS
brew install ffmpeg yt-dlp
# Debian/Ubuntu
sudo apt install ffmpeg && pip3 install -U yt-dlp
```

Tanpa ffmpeg aplikasi tetap jalan — hanya opsi MP3/merge yang disembunyikan.

---

## 📡 API

Semua endpoint membalas JSON. Tanpa API key; rate limit berlaku per IP.

### `POST /api/resolve`

```bash
curl -X POST https://<your-app>/api/resolve \
  -H 'Content-Type: application/json' \
  -d '{"url":"https://www.tiktok.com/@tiktok/video/7460937381265411370"}'
```

```jsonc
{
  "platform": "tiktok",
  "platformName": "TikTok",
  "title": "Our response to the Supreme Court decision.",
  "author": "TikTok (@tiktok)",
  "thumbnail": "https://p16-common-sign.tiktokcdn-us.com/…",
  "duration": "1:24",
  "kind": "video",
  "via": "tikwm",                    // metode mana yang berhasil
  "cached": false,
  "ms": 1037,
  "items": [{
    "id": "7460937381265411370",
    "formats": [
      { "id": "hd", "label": "HD · Tanpa Watermark", "tag": "HD",
        "ext": "mp4", "kind": "video", "size": "4.1 MB",
        "url": "/api/dl?t=direct&u=…&n=…" },
      { "id": "music", "label": "Sound · MP3", "tag": "MP3",
        "ext": "mp3", "kind": "audio", "url": "/api/dl?t=direct&u=…" }
    ]
  }]
}
```

### `GET /api/dl` — gerbang download

Semua `formats[].url` sudah menunjuk ke sini; tinggal pakai.

| Param | Arti |
|---|---|
| `t=direct` | Proxy CDN platform (cepat, tanpa encode). Wajib domain yang diizinkan |
| `t=engine` | Lewat yt-dlp — untuk merge video+audio atau konversi MP3 |
| `u` | URL target |
| `f` | Format ID / selector (mode engine) |
| `a` | `mp3` atau `native` (mode engine) |
| `n` | Nama file |

### `GET /api/health`

```jsonc
{
  "status": "ok",
  "engine": { "engine": "yt-dlp", "version": "2026.08.19", "ffmpeg": true, "source": "path" },
  "cache": { "entries": 3, "hitRate": 0.667, "ttlMinutes": 10 },
  "disk": { "tmpDir": "/app/.tmp", "freeMB": 1843 },
  "limits": { "maxMergeHeight": 1080 }
}
```

### Lainnya

| Endpoint | Fungsi |
|---|---|
| `GET /api/platforms` | Daftar platform + tier + contoh link |
| `GET /api/detect?url=` | Deteksi platform dari sebuah link |

**Kode error** — selalu berisi `title` + `message` yang bisa langsung
ditampilkan ke pengguna, bukan stack trace:

`EMPTY_URL` · `INVALID_URL` · `NOT_FOUND` · `ACCESS_RESTRICTED` ·
`UPSTREAM_BLOCKED` · `UPSTREAM_RATE_LIMITED` · `NO_MEDIA` · `RATE_LIMITED` ·
`HOST_NOT_ALLOWED` · `ENGINE_MISSING` · `TIMEOUT` · `NETWORK`

---

## 🧪 Test

```bash
npm test          # 24 unit + 4 frontend (jsdom) — offline, tanpa jaringan
npm run test:live # 9 integrasi — memanggil platform sungguhan
npm run test:all  # semuanya
```

```
✔ unit      24 pass   deteksi URL, cache TTL/LRU, rate limit, pemetaan error,
                      normalizer format, guard SSRF, filename RFC 5987
✔ frontend   4 pass   boot tanpa console error, render hasil, render error,
                      validasi input sisi klien
✔ live       9 pass   health, resolve TikTok/YouTube, download byte MP4 nyata,
                      error ramah, blokir SSRF, cache
```

---

## 🗂 Struktur

```
velox/
├─ server/
│  ├─ index.js            # Express app, routes, proxy download, guard SSRF
│  ├─ config.js           # semua env var dalam satu tempat
│  ├─ lib/
│  │  ├─ ytdlp.js         # wrapper engine: locate/auto-install/auto-update/
│  │  │                   #   3 mode streaming (pipe | transcode | tempfile)
│  │  ├─ cache.js         # TTL + LRU
│  │  ├─ ratelimit.js     # sliding window per IP
│  │  ├─ errors.js        # error engine → pesan manusiawi
│  │  ├─ detect.js        # registri platform + validasi URL
│  │  ├─ http.js          # fetch + timeout + retry + parser meta
│  │  └─ semaphore.js     # batasi proses engine bersamaan
│  └─ resolvers/
│     ├─ index.js         # orkestrasi rantai fallback
│     ├─ normalize.js     # JSON engine → bentuk kanonik untuk UI
│     ├─ tiktok.js        # TikWM API
│     ├─ instagram.js     # embed publik / endpoint custom
│     ├─ twitter.js       # syndication CDN
│     └─ generic.js       # yt-dlp universal
├─ public/                # index.html + css + js + icons (semua lokal)
├─ test/{unit,frontend,live}
├─ scripts/ensure-ytdlp.js
├─ Dockerfile · Procfile · railway.json · .env.example
└─ RESEARCH.md            # riset library + decision matrix
```

---

## ⚖️ Legal & etika

VELOX mengambil **konten publik** yang memang bisa kamu lihat di browser — sama
dengan menekan F12 lalu Save. Hak cipta tetap milik pembuatnya.

- Gunakan untuk arsip pribadi, backup, atau konten milikmu sendiri
- Minta izin sebelum memakai ulang karya orang lain
- Hormati ToS tiap platform; beberapa melarang unduhan otomatis
- Jangan pakai untuk melewati paywall atau konten berbayar

Kode ini MIT — tanggung jawab pemakaian ada di pengguna.

---

## 🙏 Kredit

- [yt-dlp](https://github.com/yt-dlp/yt-dlp) — engine ekstraksi (Unlicense)
- [TikWM](https://www.tikwm.com) — fast-path TikTok tanpa key
- [ffmpeg](https://ffmpeg.org) — merge & konversi audio
- Ikon platform dari [Simple Icons](https://simpleicons.org) (CC0), di-embed lokal

<div align="center"><sub>Dibuat dengan ☕ dan terlalu banyak `curl`.</sub></div>
