import rateLimit from 'express-rate-limit';
import type { Request, Response, NextFunction } from 'express';
import { CONFIG } from '../config/index.js';
import { Fusion } from '../models/Fusion.js';
import { FuseRequest } from '../models/FuseRequest.js';
import { getZenon } from '../services/zenon.js';
import { getWalletAddress } from '../services/wallet.js';
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
  // Check DB for active fusion
  const activeFusion = await Fusion.findOne({
    beneficiary: address,
    status: 'active',
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
    const zenon = getZenon();
    const walletAddress = getWalletAddress();
    const entries = await zenon.embedded.plasma.getEntriesByAddress(walletAddress);
    const fusionList = entries?.list || [];

    const hasChainFusion = fusionList.some(
      (entry: { beneficiary?: { toString(): string } }) =>
        entry.beneficiary?.toString() === address,
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

  const result = await checkAddressAvailability(address);
  if (!result.allowed) {
    res.status(429).json({ error: result.reason });
    return;
  }

  next();
}
