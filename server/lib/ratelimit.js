'use strict';

/**
 * Sliding-window rate limiter, per IP, in-memory.
 * Returns Express middleware. Sends a *human* message instead of a raw code.
 */
function rateLimit({ windowMs, max, message, keyPrefix = 'rl' }) {
  const buckets = new Map(); // key -> number[] (timestamps)

  // housekeeping so a long-lived process does not leak memory
  const sweeper = setInterval(() => {
    const cutoff = Date.now() - windowMs;
    for (const [key, stamps] of buckets) {
      const fresh = stamps.filter((t) => t > cutoff);
      if (fresh.length === 0) buckets.delete(key);
      else buckets.set(key, fresh);
    }
  }, Math.max(windowMs, 30_000));
  sweeper.unref?.();

  return function limit(req, res, next) {
    const ip = (req.ip || req.socket?.remoteAddress || 'unknown').toString();
    const key = `${keyPrefix}:${ip}`;
    const now = Date.now();
    const cutoff = now - windowMs;
    const stamps = (buckets.get(key) || []).filter((t) => t > cutoff);

    if (stamps.length >= max) {
      const retryIn = Math.ceil((stamps[0] + windowMs - now) / 1000);
      res.set('Retry-After', String(Math.max(retryIn, 1)));
      res.set('X-RateLimit-Limit', String(max));
      res.set('X-RateLimit-Remaining', '0');
      return res.status(429).json({
        ok: false,
        error: {
          code: 'RATE_LIMITED',
          title: 'Pelan-pelan dulu 🙂',
          message: message || `Tunggu ${retryIn} detik lagi ya — kamu sudah ${max}x request dalam ${Math.round(windowMs / 1000)} detik.`,
          retryAfter: Math.max(retryIn, 1),
        },
      });
    }

    stamps.push(now);
    buckets.set(key, stamps);
    res.set('X-RateLimit-Limit', String(max));
    res.set('X-RateLimit-Remaining', String(Math.max(max - stamps.length, 0)));
    next();
  };
}

module.exports = { rateLimit };
