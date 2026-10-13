'use strict';

/**
 * Tiny TTL + LRU cache. Zero dependencies, single process.
 * Used to cache resolved results (default 10 min) so repeat hits are instant
 * and upstream APIs are not hammered.
 */
class TtlCache {
  constructor({ max = 500, ttlMs = 600_000 } = {}) {
    this.max = max;
    this.ttlMs = ttlMs;
    this.map = new Map(); // key -> { value, expires }
    this.hits = 0;
    this.misses = 0;
  }

  get(key) {
    const row = this.map.get(key);
    if (!row) { this.misses++; return undefined; }
    if (row.expires < Date.now()) {
      this.map.delete(key);
      this.misses++;
      return undefined;
    }
    // refresh LRU position
    this.map.delete(key);
    this.map.set(key, row);
    this.hits++;
    return row.value;
  }

  set(key, value, ttlMs = this.ttlMs) {
    if (this.map.has(key)) this.map.delete(key);
    this.map.set(key, { value, expires: Date.now() + ttlMs });
    while (this.map.size > this.max) {
      const oldest = this.map.keys().next().value;
      if (oldest === undefined) break;
      this.map.delete(oldest);
    }
    return value;
  }

  has(key) {
    const row = this.map.get(key);
    if (!row) return false;
    if (row.expires < Date.now()) { this.map.delete(key); return false; }
    return true;
  }

  delete(key) { return this.map.delete(key); }
  clear() { this.map.clear(); }
  get size() { return this.map.size; }
  stats() {
    const total = this.hits + this.misses;
    return {
      entries: this.map.size,
      hits: this.hits,
      misses: this.misses,
      hitRate: total ? +(this.hits / total).toFixed(3) : 0,
      ttlMinutes: Math.round(this.ttlMs / 60000),
    };
  }
}

module.exports = { TtlCache };
