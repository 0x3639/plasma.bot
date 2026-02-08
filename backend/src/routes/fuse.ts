import { Router } from 'express';
import { validateBody, fuseRequestSchema, type FuseRequestBody } from '../middleware/validate.js';
import { ipRateLimiter, addressRateLimiter } from '../middleware/rateLimiter.js';
import { fuseToAddress } from '../services/plasma.js';
import { getQsrBalance, tryReserveQsr, releaseQsr } from '../services/balance.js';
import { getNextUnfuseTime } from '../services/unfuse.js';
import { CONFIG, type FuseTier } from '../config/index.js';
import { FuseRequest } from '../models/FuseRequest.js';
import { logger } from '../utils/logger.js';

const router = Router();

router.post(
  '/',
  ipRateLimiter,
  validateBody(fuseRequestSchema),
  addressRateLimiter,
  async (req, res) => {
    const { address, tier } = req.body as FuseRequestBody;
    const ip = req.ip || req.socket.remoteAddress || 'unknown';

    // Create request record for auditing
    const fuseRequest = await FuseRequest.create({
      beneficiary: address,
      tier,
      ipAddress: ip,
      status: 'processing',
    });

    const tierQsr = CONFIG.FUSE_TIERS[tier as FuseTier].qsr;
    const balance = await getQsrBalance();

    // Atomic check + reserve: no await between check and reserve,
    // so no concurrent request can sneak in between on the event loop.
    if (!tryReserveQsr(tierQsr, balance)) {
      fuseRequest.status = 'failed';
      fuseRequest.errorMessage = 'Insufficient QSR balance for this tier';
      await fuseRequest.save();

      // Build a helpful error message
      const available = Math.max(0, balance);
      const nextUnfuse = await getNextUnfuseTime();
      let error = `Not enough QSR available for the ${tier} tier (${tierQsr} QSR needed, ${available} available).`;

      if (available >= 20 && tierQsr > 20) {
        error += ' Try selecting a lower tier.';
      } else if (nextUnfuse) {
        const hoursRemaining = Math.max(1, Math.ceil((nextUnfuse.getTime() - Date.now()) / (60 * 60 * 1000)));
        error += ` QSR will be reclaimed in ~${hoursRemaining} hour${hoursRemaining === 1 ? '' : 's'}. Please try again later.`;
      } else {
        error += ' Please try again later.';
      }

      res.status(503).json({ error });
      return;
    }

    try {
      // Execute the fusion
      const fusion = await fuseToAddress(address, tier as FuseTier);

      fuseRequest.status = 'completed';
      fuseRequest.fusion = fusion._id;
      await fuseRequest.save();

      res.status(200).json({
        success: true,
        txHash: fusion.txHash,
        tier,
        amount: tierQsr,
      });
    } catch (error) {
      logger.error('Fuse request failed', { error, address, tier });

      fuseRequest.status = 'failed';
      fuseRequest.errorMessage = error instanceof Error ? error.message : 'Unknown error';
      await fuseRequest.save();

      res.status(500).json({
        error: 'Failed to fuse plasma. Please try again later.',
      });
    } finally {
      // Always release reservation — chain balance now reflects the result
      releaseQsr(tierQsr);
    }
  },
);

export default router;
