'use strict';

const tiktok = require('./tiktok');
const instagram = require('./instagram');
const twitter = require('./twitter');
const generic = require('./generic');
const engine = require('../lib/ytdlp');
const { friendlyError, AppError } = require('../lib/errors');
const { Semaphore } = require('../lib/semaphore');
const config = require('../config');

const engineSlot = new Semaphore(parseInt(process.env.MAX_CONCURRENT_RESOLVE, 10) || 4);

const SPECIFIC = { tiktok, instagram, twitter };

/**
 * Build the attempt chain for a platform.
 * Order matters: fastest/most-likely-to-work first, engine always last as the
 * universal safety net.
 */
function chainFor(ctx) {
  const chain = [];
  const specific = SPECIFIC[ctx.platform.id];

  if (specific) {
    let methods = specific.methods.filter((m) => !m.optional || !m.optional());

    // With cookies configured, the engine is the better primary for Instagram
    // (HD sources, carousels, stories). Otherwise the public embed page is
    // faster and needs no session.
    if (specific.id === 'instagram' && config.cookiesFile) {
      methods = [{ name: 'engine', run: generic.methods[0].run }, ...methods];
    }
    for (const m of methods) chain.push({ resolver: specific, method: m });
  }

  if (!chain.some((c) => c.method.name === 'engine')) {
    chain.push({ resolver: generic, method: generic.methods[0] });
  }
  return chain;
}

const ERROR_RANK = {
  ACCESS_RESTRICTED: 5, NOT_FOUND: 4, UPSTREAM_BLOCKED: 3,
  UPSTREAM_RATE_LIMITED: 3, ENGINE_MISSING: 6, NO_MEDIA: 2, TIMEOUT: 1, NETWORK: 1,
};

/**
 * Resolve a URL into the canonical result shape.
 * Tries every method in the chain and returns the first success, so a broken
 * upstream degrades into the next one instead of failing the request.
 */
async function resolve(ctx) {
  const chain = chainFor(ctx);
  const attempts = [];
  let bestError = null;

  for (const { resolver, method } of chain) {
    const t0 = Date.now();
    let slot = false;
    try {
      if (method.name === 'engine') {
        await engineSlot.acquire(config.resolveTimeoutMs + 5000);
        slot = true;
      }
      const result = await method.run(ctx);
      if (!result?.items?.length) throw new Error('resolver returned no items');

      result.via = method.name;
      result.engine = { name: 'yt-dlp', version: engine.status().version, ffmpeg: engine.hasFfmpeg() };
      result.attempts = attempts.concat([{ resolver: resolver.id, method: method.name, ok: true, ms: Date.now() - t0 }]);
      return result;
    } catch (err) {
      const friendly = friendlyError(err, { platform: resolver.name });
      const entry = { resolver: resolver.id, method: method.name, ok: false, ms: Date.now() - t0, error: friendly.code };
      attempts.push(entry);

      // A "hard" answer beats a vague one: if the engine says the content is
      // private/deleted, that is more useful than the next resolver's timeout.
      const rank = ERROR_RANK[friendly.code] || 0;
      const bestRank = bestError ? ERROR_RANK[bestError.code] || 0 : -1;
      if (!bestError || rank > bestRank) {
        bestError = Object.assign(friendly, {
          attempts: attempts.slice(),
          ...(friendly instanceof AppError ? {} : {}),
        });
      }
      if (friendly.code === 'ENGINE_MISSING' || friendly.code === 'ACCESS_RESTRICTED' || friendly.code === 'NOT_FOUND') {
        // no point continuing — every method would say the same
        bestError.attempts = attempts.slice();
        throw bestError;
      }
    } finally {
      if (slot) engineSlot.release();
    }
  }

  if (bestError) {
    bestError.attempts = attempts;
    throw bestError;
  }
  throw new AppError('RESOLVE_FAILED', { status: 500, title: 'Tidak ada resolver yang cocok', message: 'Tidak ada metode yang bisa menangani link ini.' });
}

module.exports = { resolve, chainFor, engineSlot, SPECIFIC, generic };
