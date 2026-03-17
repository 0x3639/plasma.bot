import { Router } from 'express';
import type { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { fuseRequestSchema, type FuseRequestBody } from '../middleware/validate.js';
import { agentIpRateLimiter, checkAddressAvailability } from '../middleware/rateLimiter.js';
import { fuseToAddress } from '../services/plasma.js';
import { getQsrBalance, tryReserveQsr, releaseQsr } from '../services/balance.js';
import { getNextUnfuseTime } from '../services/unfuse.js';
import { CONFIG, type FuseTier } from '../config/index.js';
import { FuseRequest } from '../models/FuseRequest.js';
import { logger } from '../utils/logger.js';

const router = Router();

function agentValidateBody(schema: z.ZodSchema) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const result = schema.safeParse(req.body);
    if (!result.success) {
      res.status(400).json({
        success: false,
        error: {
          code: 'VALIDATION_FAILED',
          message: 'Invalid request body',
          details: result.error.errors.map((e) => ({
            field: e.path.join('.'),
            message: e.message,
          })),
        },
      });
      return;
    }
    req.body = result.data;
    next();
  };
}

async function agentAddressRateLimiter(
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
    res.status(429).json({
      success: false,
      error: {
        code: 'ADDRESS_UNAVAILABLE',
        message: result.reason || 'Address has an active fusion',
      },
    });
    return;
  }
  next();
}

function requireJson(req: Request, res: Response, next: NextFunction): void {
  const contentType = req.headers['content-type'];
  if (!contentType || !contentType.includes('application/json')) {
    res.status(415).json({
      success: false,
      error: {
        code: 'UNSUPPORTED_MEDIA_TYPE',
        message: 'Content-Type must be application/json',
      },
    });
    return;
  }
  next();
}

router.post(
  '/',
  requireJson,
  agentIpRateLimiter,
  agentValidateBody(fuseRequestSchema),
  agentAddressRateLimiter,
  async (req, res) => {
    const { address, tier } = req.body as FuseRequestBody;
    const ip = req.ip || req.socket.remoteAddress || 'unknown';

    const fuseRequest = await FuseRequest.create({
      beneficiary: address,
      tier,
      ipAddress: ip,
      source: 'api',
      status: 'processing',
    });

    const tierQsr = CONFIG.FUSE_TIERS[tier as FuseTier].qsr;
    const balance = await getQsrBalance();

    if (!tryReserveQsr(tierQsr, balance)) {
      fuseRequest.status = 'failed';
      fuseRequest.errorMessage = 'Insufficient QSR balance for this tier';
      await fuseRequest.save();

      const available = Math.max(0, balance);
      const nextUnfuse = await getNextUnfuseTime();

      res.status(503).json({
        success: false,
        error: {
          code: 'INSUFFICIENT_BALANCE',
          message: `Not enough QSR available for the ${tier} tier`,
          available,
          needed: tierQsr,
          nextUnfuseAt: nextUnfuse?.toISOString() || null,
        },
      });
      return;
    }

    try {
      const fusion = await fuseToAddress(address, tier as FuseTier);

      fuseRequest.status = 'completed';
      fuseRequest.fusion = fusion._id;
      await fuseRequest.save();

      res.status(200).json({
        success: true,
        txHash: fusion.txHash,
        address,
        tier,
        amount: tierQsr,
      });
    } catch (error) {
      logger.error('Agent fuse request failed', { error, address, tier });

      fuseRequest.status = 'failed';
      fuseRequest.errorMessage = error instanceof Error ? error.message : 'Unknown error';
      await fuseRequest.save();

      res.status(500).json({
        success: false,
        error: {
          code: 'FUSE_FAILED',
          message: 'Failed to fuse plasma. Please try again later.',
        },
      });
    } finally {
      releaseQsr(tierQsr);
    }
  },
);

export default router;
