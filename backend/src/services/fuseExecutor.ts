import type { FuseTier } from '../config/index.js';
import type { IFuseRequest } from '../models/FuseRequest.js';
import type { Fusion } from '../models/Fusion.js';
import { fuseToAddress } from './plasma.js';
import { SendQueueFullError } from './sendQueue.js';
import { assertFuseLeaseHeld, FuseLeaseLostError } from './fuseLease.js';
import type { QsrReservation } from './balance.js';
import { logger } from '../utils/logger.js';

type FusionDoc = InstanceType<typeof Fusion>;

export type FuseOutcome =
  | { ok: true; fusion: FusionDoc }
  | { ok: false; code: 'QUEUE_FULL' | 'LEASE_LOST' | 'FUSE_FAILED' };

/**
 * Shared fuse lifecycle for every entry point (web, agent API, Telegram).
 *
 * Owns the transition of a 'processing' FuseRequest to a terminal state and
 * the fate of its QSR reservation, so the three handlers cannot diverge:
 *
 * - The lease is revalidated inside the send-queue slot right before signing.
 *   If the stale sweeper already released it, nothing is signed.
 * - The reservation is released exactly once. Paths where nothing was sent
 *   release immediately; paths where a block may have been published hold
 *   the reservation across the confirmation window.
 *
 * Never throws. Callers only decide how to present the outcome; notification
 * failures (HTTP write errors, Telegram reply errors) happen after this
 * returns and cannot alter the recorded transaction state.
 */
export async function executeFuse(
  fuseRequest: IFuseRequest,
  tier: FuseTier,
  reservation: QsrReservation,
): Promise<FuseOutcome> {
  const address = fuseRequest.beneficiary;

  try {
    const fusion = await fuseToAddress(address, tier, {
      beforeSend: () => assertFuseLeaseHeld(fuseRequest),
    });

    fuseRequest.status = 'completed';
    fuseRequest.fusion = fusion._id;
    await fuseRequest.save();

    // Hold the reservation across the chain-confirmation window, then release.
    // The on-chain balance does not drop the instant send() returns.
    reservation.scheduleRelease();

    return { ok: true, fusion };
  } catch (error) {
    if (error instanceof SendQueueFullError) {
      // Rejected before entering the queue: nothing was sent.
      logger.warn('Fuse rejected: send queue full', { address, tier, source: fuseRequest.source });
      fuseRequest.status = 'failed';
      fuseRequest.errorMessage = 'Send queue full';
      await fuseRequest.save().catch(() => undefined);
      reservation.release();
      return { ok: false, code: 'QUEUE_FULL' };
    }

    if (error instanceof FuseLeaseLostError) {
      // The sweeper already moved this record to 'failed' and freed its slot;
      // nothing was signed, so release now. Do not save the stale in-memory
      // document over the sweeper's write.
      logger.warn('Fuse aborted: processing lease lost before signing', {
        address,
        tier,
        source: fuseRequest.source,
        requestId: fuseRequest._id.toString(),
      });
      reservation.release();
      return { ok: false, code: 'LEASE_LOST' };
    }

    logger.error('Fuse request failed', { error, address, tier, source: fuseRequest.source });

    fuseRequest.status = 'failed';
    fuseRequest.errorMessage = error instanceof Error ? error.message : 'Unknown error';
    await fuseRequest.save().catch(() => undefined);

    // A send "failure" can be a timeout on a block that still lands in a
    // momentum seconds later, so hold the reservation across the confirmation
    // window instead of releasing it against a stale balance.
    reservation.scheduleRelease();

    return { ok: false, code: 'FUSE_FAILED' };
  }
}
