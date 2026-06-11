import { Router } from 'express';
import { validateBody, fuseRequestSchema, type FuseRequestBody } from '../middleware/validate.js';
import { ipRateLimiter, addressRateLimiter, webGlobalDailyLimiter, confirmGlobalCapSlot } from '../middleware/rateLimiter.js';
import { fuseToAddress } from '../services/plasma.js';
import { getQsrBalance, tryReserveQsr, scheduleReleaseQsr } from '../services/balance.js';
import { getNextUnfuseTime } from '../services/unfuse.js';
import { CONFIG, type FuseTier } from '../config/index.js';
import { FuseRequest } from '../models/FuseRequest.js';
import { logger } from '../utils/logger.js';

const router = Router();

router.post(
  '/',
  ipRateLimiter,
  validateBody(fuseRequestSchema),
  webGlobalDailyLimiter,
  addressRateLimiter,
  async (req, res) => {
    const { address, tier } = req.body as FuseRequestBody;
    const ip = req.ip || req.socket.remoteAddress || 'unknown';

    // Create request record for auditing. This also acts as the race lock: a
    // unique partial index on FuseRequest{beneficiary, status:'processing'}
    // makes a concurrent request for the same address fail here (E11000)
    // instead of both passing the availability check and double-fusing.
    let fuseRequest;
    try {
      fuseRequest = await FuseRequest.create({
        beneficiary: address,
        tier,
        ipAddress: ip,
        status: 'processing',
      });
    } catch (error) {
      if (error instanceof Error && (error as { code?: number }).code === 11000) {
        res.status(429).json({ error: 'A fusion request for this address is already being processed.' });
        return;
      }
      // Don't rethrow: Express 4 won't forward an async rejection, leaving the
      // request hanging with no response.
      logger.error('Failed to create fuse request record', { error, address, tier });
      res.status(503).json({ error: 'Service temporarily unavailable. Please try again later.' });
      return;
    }

    const tierQsr = CONFIG.FUSE_TIERS[tier as FuseTier].qsr;

    // From here on, every exit path must move the record off 'processing' — a
    // stuck 'processing' record blocks this address (unique partial index +
    // availability check) until the stale-request sweeper clears it.
    let balance: number;
    try {
      // Atomic re-check of the global cap now that our 'processing' record
      // exists; the middleware pre-check alone is racy under a concurrent burst.
      if (!(await confirmGlobalCapSlot(fuseRequest))) {
        res.status(429).json({ error: 'The fuse service has reached its daily limit. Please try again later.' });
        return;
      }

      balance = await getQsrBalance();
    } catch (error) {
      logger.error('Fuse pre-checks failed', { error, address, tier });
      fuseRequest.status = 'failed';
      fuseRequest.errorMessage = 'Pre-check failed (node or DB unavailable)';
      await fuseRequest.save().catch(() => undefined); // sweeper cleans up if this also fails
      res.status(503).json({ error: 'Service temporarily unavailable. Please try again later.' });
      return;
    }

    // Atomic check + reserve: no await between check and reserve,
    // so no concurrent request can sneak in between on the event loop.
    if (!tryReserveQsr(tierQsr, balance)) {
      fuseRequest.status = 'failed';
      fuseRequest.errorMessage = 'Insufficient QSR balance for this tier';
      await fuseRequest.save();

      // Build a helpful error message (best-effort: the record is already
      // 'failed', so a node error here must not hang the response)
      const available = Math.max(0, balance);
      const nextUnfuse = await getNextUnfuseTime().catch(() => null);
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

      // Hold the reservation across the chain-confirmation window, then release.
      // The on-chain balance does not drop the instant send() returns.
      scheduleReleaseQsr(tierQsr);

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
      await fuseRequest.save().catch(() => undefined);

      // A send "failure" can be a timeout on a block that still lands in a
      // momentum seconds later, so hold the reservation across the
      // confirmation window instead of releasing it against a stale balance.
      scheduleReleaseQsr(tierQsr);

      res.status(500).json({
        error: 'Failed to fuse plasma. Please try again later.',
      });
    }
  },
);

export default router;
