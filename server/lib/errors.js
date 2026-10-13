'use strict';

/**
 * User-facing error type + a mapper that turns raw extractor errors
 * (yt-dlp tracebacks, HTTP codes, DNS failures) into language a human understands.
 */
class AppError extends Error {
  constructor(code, { status = 400, title = 'Gagal memproses', message = '', hint = '' } = {}) {
    super(message || title);
    this.name = 'AppError';
    this.code = code;
    this.status = status;
    this.title = title;
    this.hint = hint;
  }
  toJSON() {
    return {
      code: this.code,
      title: this.title,
      message: this.message,
      ...(this.hint ? { hint: this.hint } : {}),
    };
  }
}

const RULES = [
  {
    test: /login|logged in|account|private video|age.?restrict|not available in your|members.?only|Sign in to confirm/i,
    code: 'ACCESS_RESTRICTED',
    title: 'Kontennya terkunci 🔒',
    message: 'Konten ini butuh login, berbayar, atau dibatasi umur — jadi tidak bisa diambil tanpa sesi akun.',
    hint: 'Coba konten publik lain. Untuk server milikmu sendiri, isi YTDLP_COOKIES dengan cookies.txt.',
  },
  {
    test: /video unavailable|removed|has been removed|no longer available|deleted|410|not found|404|does not exist|empty media response/i,
    code: 'NOT_FOUND',
    title: 'Kontennya sudah tidak ada 😕',
    message: 'Post/video ini sudah dihapus, diprivat, atau linknya salah ketik.',
    hint: 'Cek lagi linknya, atau buka di browser untuk memastikan masih bisa diakses.',
  },
  {
    test: /HTTP Error 429|too many requests|rate.?limit/i,
    code: 'UPSTREAM_RATE_LIMITED',
    title: 'Server sumbernya lagi sibuk ⏳',
    message: 'Platform asal membatasi request dari server ini. Coba lagi sebentar lagi.',
    hint: 'Tunggu 30–60 detik lalu ulangi.',
  },
  {
    test: /HTTP Error 403|forbidden|Signature|blocked|cloudflare|challenge/i,
    code: 'UPSTREAM_BLOCKED',
    title: 'Akses ditolak platform asal 🛡️',
    message: 'Platform asal menolak request otomatis dari server ini.',
    hint: 'Biasanya sembuh sendiri setelah beberapa menit, atau setelah engine di-update.',
  },
  {
    test: /No video could be found|no video|Unsupported URL|unable to extract|Unable to download|no media|is not a valid URL|no formats/i,
    code: 'NO_MEDIA',
    title: 'Tidak ada media di link itu 🤔',
    message: 'Link-nya kebuka, tapi tidak ada video/foto yang bisa diambil dari sana.',
    hint: 'Untuk Instagram/Facebook, pastikan post-nya berisi video atau foto (bukan hanya teks/link).',
  },
  {
    test: /timed? ?out|ETIMEDOUT|ESOCKETTIMEDOUT/i,
    code: 'TIMEOUT',
    title: 'Keburu timeout ⌛',
    message: 'Server asal tidak menjawab tepat waktu.',
    hint: 'Coba sekali lagi — kadang percobaan kedua langsung jalan.',
  },
  {
    test: /ENOTFOUND|EAI_AGAIN|getaddrinfo|DNS/i,
    code: 'NETWORK',
    title: 'Masalah jaringan 🌐',
    message: 'Server tidak bisa menjangkau platform asal.',
    hint: 'Cek koneksi server / DNS, lalu ulangi.',
  },
  {
    test: /ffmpeg|conversion|Failed to write|No space left/i,
    code: 'SERVER_SIDE',
    title: 'Kendala di sisi server ⚙️',
    message: 'Terjadi kendala saat menyiapkan file.',
    hint: 'Lapor ke pemilik server: biasanya ffmpeg belum terpasang.',
  },
];

/** Turn anything thrown by an extractor into a friendly AppError. */
function friendlyError(err, { platform } = {}) {
  if (err instanceof AppError) return err;

  const raw = String(err?.stderr || err?.message || err || '').slice(0, 400);

  for (const rule of RULES) {
    if (rule.test.test(raw)) {
      return new AppError(rule.code, {
        status: rule.code === 'NOT_FOUND' ? 404 : rule.code === 'UPSTREAM_RATE_LIMITED' ? 429 : 422,
        title: rule.title,
        message: rule.message + (platform ? ` (platform: ${platform})` : ''),
        hint: rule.hint,
      });
    }
  }

  return new AppError('RESOLVE_FAILED', {
    status: 422,
    title: 'Belum bisa diambil 🙇',
    message: `Engine gagal membaca link ini${platform ? ` dari ${platform}` : ''}. Platform sering mengubah struktur halaman mereka.`,
    hint: 'Coba link lain, atau tunggu update engine berikutnya.',
  });
}

module.exports = { AppError, friendlyError };
