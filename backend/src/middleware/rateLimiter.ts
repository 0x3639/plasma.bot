import rateLimit from 'express-rate-limit';
import type { Request, Response, NextFunction } from 'express';
import { CONFIG } from '../config/index.js';
import { Fusion } from '../models/Fusion.js';
import { FuseRequest } from '../models/FuseRequest.js';

// IP-based rate limiter: 4 requests per 24 hours
export const ipRateLimiter = rateLimit({
  windowMs: CONFIG.RATE_LIMIT_PER_IP_WINDOW_MS,
  max: CONFIG.RATE_LIMIT_PER_IP_MAX,
  message: { error: `Too many fuse requests from this IP. Maximum ${CONFIG.RATE_LIMIT_PER_IP_MAX} per 24 hours.` },
  standardHeaders: true,
  legacyHeaders: false,
});

// Per-address limiter: one active fusion per address
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

  next();
}
