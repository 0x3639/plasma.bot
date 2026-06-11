import rateLimit from 'express-rate-limit';
import type { Request, Response, NextFunction } from 'express';
import { CONFIG } from '../config/index.js';
import { Fusion } from '../models/Fusion.js';
import { FuseRequest, type IFuseRequest } from '../models/FuseRequest.js';
import { getAllFusionEntries } from '../services/plasma.js';
import { logger } from '../utils/logger.js';

// IP-based rate limiter: 4 requests per 24 hours
export const ipRateLimiter = rateLimit({
  windowMs: CONFIG.RATE_LIMIT_PER_IP_WINDOW_MS,
  max: CONFIG.RATE_LIMIT_PER_IP_MAX,
  message: { error: `Too many fuse requests from this IP. Maximum ${CONFIG.RATE_LIMIT_PER_IP_MAX} per 24 hours.` },
  standardHeaders: true,
  legacyHeaders: false,
});

/**
 * Check if an address is available for a new fusion.
 * Shared by both web (Express middleware) and Telegram bot.
 */
export async function checkAddressAvailability(
  address: string,
): Promise<{ allowed: boolean; reason?: string }> {
  // Check DB for an active or pending fusion ('pending' = sent but not yet
  // confirmed on-chain; it still occupies the address).
  const activeFusion = await Fusion.findOne({
    beneficiary: address,
    status: { $in: ['pending', 'active'] },
  });

  if (activeFusion) {
    return { allowed: false, reason: 'This address already has an active plasma fusion.' };
  }

  // Check DB for in-flight request (prevents double-submit race condition)
  const pendingRequest = await FuseRequest.findOne({
    beneficiary: address,
    status: 'processing',
  });

  if (pendingRequest) {
    return { allowed: false, reason: 'A fusion request for this address is already being processed.' };
  }

  // Check on-chain fusion entries as a fallback (catches orphaned fusions
  // where the TX succeeded on chain but the DB record wasn't created)
  try {
    const fusionList = await getAllFusionEntries();

    const hasChainFusion = fusionList.some(
      (entry) => entry.beneficiary?.toString() === address,
    );

    if (hasChainFusion) {
      logger.warn('Found on-chain fusion not in DB, blocking duplicate', { address });
      return { allowed: false, reason: 'This address already has an active plasma fusion.' };
    }
  } catch (error) {
    // If chain check fails, still allow based on DB check (already passed above)
    logger.warn('Chain fusion check failed, relying on DB check only', { error, address });
  }

  return { allowed: true };
}

// Agent IP-based rate limiter: separate counter, higher default (10/day)
export const agentIpRateLimiter = rateLimit({
  windowMs: CONFIG.RATE_LIMIT_PER_IP_WINDOW_MS,
  max: CONFIG.AGENT_RATE_LIMIT_PER_IP_MAX,
  keyGenerator: (req) => `agent:${req.ip}`,
  message: {
    success: false,
    error: {
      code: 'RATE_LIMITED',
      message: `Too many agent fuse requests from this IP. Maximum ${CONFIG.AGENT_RATE_LIMIT_PER_IP_MAX} per 24 hours.`,
    },
  },
  standardHeaders: true,
  legacyHeaders: false,
});

/**
 * Global daily caps, per entry-point source.
 *
 * Per-IP, per-user, and per-address limits are all individually bypassable —
 * IPs (via proxies), Telegram accounts, and Zenon addresses are cheap or free
 * to an attacker — so none of them bounds total dispensation. These caps count
 * fuses per source in the rolling 24h window and are the wallet's hard
 * backstop against a multi-identity drain.
 */
export type FuseSource = IFuseRequest['source'];

export function globalDailyCapFor(source: FuseSource): number {
  switch (source) {
    case 'api': return CONFIG.AGENT_GLOBAL_DAILY_MAX;
    case 'telegram': return CONFIG.TELEGRAM_GLOBAL_DAILY_MAX;
    case 'web': return CONFIG.WEB_GLOBAL_DAILY_MAX;
  }
}

async function countGlobalDaily(source: FuseSource): Promise<number> {
  const since = new Date(Date.now() - CONFIG.RATE_LIMIT_PER_IP_WINDOW_MS);
  // 'processing' counts so in-flight requests occupy a slot; 'failed' does not,
  // so requests that never dispensed (insufficient balance, node down, over-cap
  // rollback) don't consume the cap.
  return FuseRequest.countDocuments({
    source,
    status: { $in: ['processing', 'completed'] },
    createdAt: { $gte: since },
  });
}

/** Pre-check used before doing any work. Throws on DB errors (callers fail closed). */
export async function isGlobalDailyCapReached(source: FuseSource): Promise<boolean> {
  return (await countGlobalDaily(source)) >= globalDailyCapFor(source);
}

/**
 * Atomic cap enforcement, called AFTER the 'processing' FuseRequest is created.
 *
 * The pre-check middleware alone is read-then-act: N concurrent requests can
 * all observe count < cap before any of their records commit, blowing through
 * the cap in one burst. Re-counting after our own insert closes that race —
 * each request's count includes its own record plus every record committed
 * before it, so at most `cap` requests can observe count <= cap. Requests that
 * lose are rolled back to 'failed' (releasing their slot) and rejected.
 *
 * Returns true if the request holds a valid cap slot. Throws on DB errors
 * (callers fail closed).
 */
export async function confirmGlobalCapSlot(fuseRequest: IFuseRequest): Promise<boolean> {
  const cap = globalDailyCapFor(fuseRequest.source);
  const count = await countGlobalDaily(fuseRequest.source);

  if (count > cap) {
    fuseRequest.status = 'failed';
    fuseRequest.errorMessage = 'Global daily fuse cap reached';
    await fuseRequest.save();
    logger.warn('Global daily fuse cap hit (post-create check)', {
      source: fuseRequest.source,
      count,
      cap,
    });
    return false;
  }

  return true;
}

function globalDailyLimiterFor(
  source: FuseSource,
  buildCapBody: () => unknown,
  buildUnavailableBody: () => unknown,
) {
  return async (_req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      if (await isGlobalDailyCapReached(source)) {
        logger.warn('Global daily fuse cap reached', { source, max: globalDailyCapFor(source) });
        res.status(429).json(buildCapBody());
        return;
      }
      next();
    } catch (error) {
      // Fail safe: if we can't verify the cap, do not dispense funds.
      logger.error('Global daily limiter check failed', { source, error });
      res.status(503).json(buildUnavailableBody());
    }
  };
}

export const agentGlobalDailyLimiter = globalDailyLimiterFor(
  'api',
  () => ({
    success: false,
    error: {
      code: 'GLOBAL_LIMIT_REACHED',
      message: 'The agent fuse service has reached its daily limit. Please try again later.',
    },
  }),
  () => ({
    success: false,
    error: { code: 'SERVICE_UNAVAILABLE', message: 'Service temporarily unavailable.' },
  }),
);

export const webGlobalDailyLimiter = globalDailyLimiterFor(
  'web',
  () => ({ error: 'The fuse service has reached its daily limit. Please try again later.' }),
  () => ({ error: 'Service temporarily unavailable. Please try again later.' }),
);

// Per-address limiter: one active fusion per address (Express middleware wrapper)
export async function addressRateLimiter(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const { address } = req.body;
  if (!address) {
    next();
    return;
  }

  // Express 4 does not forward async rejections to the error handler — an
  // unguarded DB error here would leave the request hanging with no response.
  let result;
  try {
    result = await checkAddressAvailability(address);
  } catch (error) {
    logger.error('Address availability check failed', { error, address });
    res.status(503).json({ error: 'Service temporarily unavailable. Please try again later.' });
    return;
  }

  if (!result.allowed) {
    res.status(429).json({ error: result.reason });
    return;
  }

  next();
}
