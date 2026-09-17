import { Router } from 'express';
import type { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { fuseRequestSchema, type FuseRequestBody } from '../middleware/validate.js';
import { agentIpRateLimiter, agentGlobalDailyLimiter, confirmGlobalCapSlot, checkAddressAvailability } from '../middleware/rateLimiter.js';
import { executeFuse } from '../services/fuseExecutor.js';
import { getQsrBalance, tryReserveQsr } from '../services/balance.js';
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

  // Express 4 does not forward async rejections to the error handler — an
  // unguarded DB error here would leave the request hanging with no response.
  let result;
  try {
    result = await checkAddressAvailability(address);
  } catch (error) {
    logger.error('Agent address availability check failed', { error, address });
    res.status(503).json({
      success: false,
      error: { code: 'SERVICE_UNAVAILABLE', message: 'Service temporarily unavailable.' },
    });
    return;
  }

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
  agentGlobalDailyLimiter,
  agentAddressRateLimiter,
  async (req, res) => {
    const { address, tier } = req.body as FuseRequestBody;
    const ip = req.ip || req.socket.remoteAddress || 'unknown';

    // Creating the 'processing' record acts as the race lock: a unique partial
    // index on FuseRequest{beneficiary, status:'processing'} makes a concurrent
    // request for the same address fail here (E11000) instead of double-fusing.
    let fuseRequest;
    try {
      fuseRequest = await FuseRequest.create({
        beneficiary: address,
        tier,
        ipAddress: ip,
        source: 'api',
        status: 'processing',
      });
    } catch (error) {
      if (error instanceof Error && (error as { code?: number }).code === 11000) {
        res.status(429).json({
          success: false,
          error: {
            code: 'ADDRESS_UNAVAILABLE',
            message: 'A fusion request for this address is already being processed.',
          },
        });
        return;
      }
      // Don't rethrow: Express 4 won't forward an async rejection, leaving the
      // request hanging with no response.
      logger.error('Failed to create agent fuse request record', { error, address, tier });
      res.status(503).json({
        success: false,
        error: { code: 'SERVICE_UNAVAILABLE', message: 'Service temporarily unavailable.' },
      });
      return;
    }

    const tierQsr = CONFIG.FUSE_TIERS[tier as FuseTier].qsr;

    // From here on, every exit path must move the record off 'processing' — a
    // stuck 'processing' record blocks this address (unique partial index +
    // availability check) and occupies a global-cap slot until the stale-request
    // sweeper clears it.
    let balance: number;
    try {
      // Atomic re-check of the global cap now that our 'processing' record
      // exists; the middleware pre-check alone is racy under a concurrent burst.
      if (!(await confirmGlobalCapSlot(fuseRequest))) {
        res.status(429).json({
          success: false,
          error: {
            code: 'GLOBAL_LIMIT_REACHED',
            message: 'The agent fuse service has reached its daily limit. Please try again later.',
          },
        });
        return;
      }

      balance = await getQsrBalance();
    } catch (error) {
      logger.error('Agent fuse pre-checks failed', { error, address, tier });
      fuseRequest.status = 'failed';
      fuseRequest.errorMessage = 'Pre-check failed (node or DB unavailable)';
      await fuseRequest.save().catch(() => undefined); // sweeper cleans up if this also fails
      res.status(503).json({
        success: false,
        error: { code: 'SERVICE_UNAVAILABLE', message: 'Service temporarily unavailable.' },
      });
      return;
    }

    const reservation = tryReserveQsr(tierQsr, balance);
    if (!reservation) {
      fuseRequest.status = 'failed';
      fuseRequest.errorMessage = 'Insufficient QSR balance for this tier';
      await fuseRequest.save();

      // Best-effort: the record is already 'failed', so a node error here must
      // not hang the response.
      const available = Math.max(0, balance);
      const nextUnfuse = await getNextUnfuseTime().catch(() => null);

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

    // Shared lifecycle: lease revalidation before signing, terminal record
    // state, and exactly-once reservation release all live in executeFuse.
    const outcome = await executeFuse(fuseRequest, tier as FuseTier, reservation);

    if (outcome.ok) {
      res.status(200).json({
        success: true,
        txHash: outcome.fusion.txHash,
        address,
        tier,
        amount: tierQsr,
      });
      return;
    }

    switch (outcome.code) {
      case 'QUEUE_FULL':
        res.status(503).json({
          success: false,
          error: { code: 'SERVICE_BUSY', message: 'The fuse service is busy. Please try again in a few minutes.' },
        });
        return;
      case 'LEASE_LOST':
        res.status(503).json({
          success: false,
          error: { code: 'REQUEST_EXPIRED', message: 'Your request expired before it could be sent. Please try again.' },
        });
        return;
      case 'FUSE_FAILED':
        res.status(500).json({
          success: false,
          error: { code: 'FUSE_FAILED', message: 'Failed to fuse plasma. Please try again later.' },
        });
        return;
    }
  },
);

export default router;
