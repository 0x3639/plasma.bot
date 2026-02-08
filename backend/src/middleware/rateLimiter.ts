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

// Per-address limiter: one active fusion per address
// Checks both the DB and the chain to catch orphaned fusions
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

  // Check DB for active fusion
  const activeFusion = await Fusion.findOne({
    beneficiary: address,
    status: 'active',
  });

  if (activeFusion) {
    res.status(429).json({
      error: 'This address already has an active plasma fusion.',
    });
    return;
  }

  // Check DB for in-flight request (prevents double-submit race condition)
  const pendingRequest = await FuseRequest.findOne({
    beneficiary: address,
    status: 'processing',
  });

  if (pendingRequest) {
    res.status(429).json({
      error: 'A fusion request for this address is already being processed.',
    });
    return;
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
      // Sync the missing fusion into the DB so future checks are faster
      logger.warn('Found on-chain fusion not in DB, blocking duplicate', { address });
      res.status(429).json({
        error: 'This address already has an active plasma fusion.',
      });
      return;
    }
  } catch (error) {
    // If chain check fails, still allow based on DB check (already passed above)
    logger.warn('Chain fusion check failed, relying on DB check only', { error, address });
  }

  next();
}
