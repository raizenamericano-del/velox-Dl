# Research Summary — VELOX Engine Selection

Dikerjakan sebelum coding. Semua angka bintang/tanggal diambil langsung dari
GitHub API pada **2026-10-12**, dan semua klaim "works" di bawah sudah
**diuji nyata** dari sandbox (bukan dari README orang lain).

---

## 1. Kandidat yang dievaluasi

| Repo | ★ Stars | Commit terakhir | Status | Keputusan |
|---|---|---|---|---|
| `yt-dlp/yt-dlp` | 197.141 | **2 hari** lalu | 🟢 Sangat aktif, rilis ~2×/bulan | ✅ **Engine utama** |
| `imputnet/cobalt` | 44.894 | 189 hari | 🟡 Aktif, tapi API publik dikunci | ⚠️ Fallback opsional (self-host) |
| `davidteather/TikTok-Api` | 6.684 | 50 hari | 🟡 Aktif | ❌ Tidak dipakai (butuh ms_token/Playwright) |
| `postlight/parser` | 5.787 | **824 hari** | 🔴 Stagnan + salah domain | ❌ Ditolak |
| `drawrowfly/tiktok-scraper` | 5.215 | **1.242 hari (3,4 th)** | 🔴 Ditinggalkan | ❌ Ditolak |
| `fent/node-ytdl-core` | 4.731 | 336 hari | 🔴 Stale | ❌ Ditolak |
| `TobyG74/tiktok-api-dl` | 243 | 167 hari | 🟡 Kecil | ❌ Tidak perlu |

### Kenapa tiga repo yang disarankan brief ditolak

* **`drawrowfly/tiktok-scraper`** — 5.2k star memang menggiurkan, tapi commit
  terakhir **3,4 tahun lalu**. TikTok sudah beberapa kali mengubah signature API
  (`X-Bogus`, `msToken`, `webid`) sejak itu. Repo ber-star besar yang mati
  justru lebih berbahaya daripada repo kecil yang dirawat: ia terlihat aman.
* **`postlight/parser`** (Mercury) — ini *article extractor* (mengambil isi
  berita), bukan video extractor. Tidak relevan untuk media sosial video.
  Terakhir di-push 824 hari lalu.
* **`fent/node-ytdl-core`** — YouTube-only dan 336 hari tanpa update. yt-dlp
  menutupi kasus ini jauh lebih baik.

---

## 2. Uji fungsional nyata (bukan asumsi)

| Uji | Hasil | Bukti |
|---|---|---|
| `yt-dlp` versi terpasang | `2026.08.19` | `yt-dlp --version` |
| YouTube via engine | ✅ 48 formats | `Rick Astley - Never Gonna Give You Up…` |
| TikTok via engine | ✅ | `formats[0].url` = `v19.tiktokcdn-us.com` |
| **TikWM API** (tanpa key) | ✅ `code:0`, 0,84 s | mengembalikan `play`, `hdplay`, `music`, `images[]` |
| Cobalt API publik | ❌ **HTTP 400** | `{"error":{"code":"error.api.auth.jwt.missing"}}` |
| Instagram via engine | ⚠️ butuh cookies | *"Instagram sent an empty media response"* |
| IG `/embed/captioned/` | ✅ HTTP 200, 630 KB HTML | dipakai sebagai fallback |
| Twitter syndication CDN | ✅ JSON valid | tweet terhapus → `TweetTombstone` (perilaku benar) |
| `ffmpeg` ada? | ❌ tidak ada awalnya | memaksa desain *graceful degrade* |

> **Catatan penting soal Cobalt.** Dokumentasi resmi menyatakan instance
> hosted "not intended to be used in other projects without explicit
> permission", dan pengujian membuktikan ia menolak dengan
> `error.api.auth.jwt.missing`. Jadi cobalt **tidak** dijadikan dependency —
> hanya didukung sebagai fallback opsional bila kamu self-host
> (`COBALT_BASE`).

---

## 3. Decision matrix per platform

| Platform | Metode #1 | Fallback #2 | Fallback #3 | Alasan |
|---|---|---|---|---|
| TikTok | **TikWM API** | engine | — | TikWM paling cepat (≈1 s), memberi HD + no-WM + slide foto + musik sekaligus, tanpa key |
| Instagram | engine *(bila `YTDLP_COOKIES` diisi)* → kalau tidak: **embed page** | engine | `IG_API_ENDPOINT` (punyamu) | Engine sering minta login; halaman embed publik lebih sering tembus |
| YouTube | engine | — | — | Ekstraktor paling terawat; playlist via `--flat-playlist` |
| X / Twitter | engine | **syndication CDN** | — | Syndication tidak butuh login & memberi semua varian |
| Facebook | engine | — | — | Ekstraktor `facebook` aktif |
| Pinterest | engine | — | — | `pinterest` didukung |
| RedNote/小红书 | engine | — | — | Ekstraktor `XiaoHongShu` ada di daftar situs |
| Snapchat | engine | — | — | `SnapchatSpotlight` |
| Threads / LinkedIn | engine | — | — | Didukung yt-dlp |
| Vimeo / Dailymotion / Twitch / SoundCloud | engine | — | — | Semua masuk daftar 1.800+ situs |
| Lainnya (1.700+ situs) | engine generic | — | — | `generic` extractor |

**Prinsip fallback:** tiap resolver mengembalikan hasil pertama yang berhasil.
Kalau metode #1 error, #2 langsung mengambil alih — user tidak pernah melihat
kegagalan internal, hanya hasil atau satu pesan error yang manusiawi.

---

## 4. Tech stack yang dipilih + alasan

| Lapisan | Pilihan | Alasan |
|---|---|---|
| Backend | **Node.js 20 + Express** (2 dependency) | Satu runtime untuk API + proxy stream; `child_process` cukup untuk memanggil yt-dlp. Tidak perlu Python web framework kedua |
| Engine | **yt-dlp** (subprocess) | 1.800+ situs, komunitas terbesar, rilis 2×/bulan. "Jangan bangun apa yang sudah dibangun yt-dlp" |
| Konversi | **ffmpeg** (pipa) | Merge video+audio & MP3 |
| Frontend | **Vanilla JS + CSS murni** | 0 request eksternal, 0 framework. Target *load < 3 s* tercapai dengan total aset < 60 KB |
| Database | **tidak ada** | Riwayat di `localStorage` user. Cache hasil di memori (TTL 10 mnt) |
| Deploy | **Docker** di Railway | yt-dlp butuh Python & ffmpeg — buildpack Node saja tidak cukup |

### Ukuran aset frontend (kenapa bukan React/Tailwind CDN)
`index.html` + `app.css` + `app.js` + `icons.js` = **84 KB mentah / 25 KB setelah gzip** (terverifikasi via `curl -H "Accept-Encoding: gzip"`), semua lokal.
Tailwind Play CDN sendiri ~300 KB **dan** memicu warning di console —
bertentangan dengan kriteria "no console error" dan "load < 3 s".

---

## 5. Temuan teknis yang mengubah desain

Hal-hal ini ditemukan **dengan menjalankan**, dan semuanya memperbaiki produk:

1. **`-o -` mematikan post-processing yt-dlp.** `-x --audio-format mp3`
   diabaikan diam-diam saat output ke stdout → server sempat mengirim **M4A
   berlabel MP3**. Solusi: pipa `yt-dlp → ffmpeg → response` (mode
   `transcode`).
2. **Merge ke stdout membuat ffmpeg crash** (`ffmpeg exited with code -11`),
   karena muxer MP4 butuh output *seekable*. Solusi: mode `tempfile` +
   `--merge-output-format`.
3. **yt-dlp menulis `<nama>.mp4.webm`**, bukan `<nama>.mp4`, saat codec-nya
   vp9+opus. Solusi: template tanpa ekstensi + deteksi file hasil.
4. **"Best quality" tanpa batas memilih 4K (230 MB)** dan menghabiskan disk
   992 MB di sandbox. Solusi: `MAX_MERGE_HEIGHT=1080` + guard sisa disk
   150 MB + pembersih file sisa tiap jam.
5. **YouTube dari IP datacenter hanya mengirim DASH** (tidak ada MP4
   progressive). Solusi: opsi merge via ffmpeg; tanpa ffmpeg UI berkata jujur
   "(video saja, tanpa audio)".
6. **`ftp://x.com/a` lolos validasi** karena di-prepend menjadi
   `https://ftp://x.com/a` yang tetap bisa di-parse (host = `ftp`).
   Solusi: tolak skema asing + wajibkan domain bertitik.

---

## 6. Risiko yang tersisa (jujur)

| Risiko | Dampak | Mitigasi |
|---|---|---|
| Instagram makin ketat | Sebagian post butuh login | `YTDLP_COOKIES`, pesan error jelas, `IG_API_ENDPOINT` |
| YouTube rate-limit IP datacenter | `Sign in to confirm` | Deploy ulang (yt-dlp auto-update), `MAX_MERGE_HEIGHT`, proxy/cookies |
| TikWM rate-limit (≈1 req/s) | TikTok sesekali gagal | Fallback otomatis ke engine |
| Perubahan markup platform | Resolver mati | `YTDLP_AUTO_UPDATE` + workflow cek versi mingguan |
| Beban disk saat merge | Request gagal | Guard 150 MB + purge + sweeper |
