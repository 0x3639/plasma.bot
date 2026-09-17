import { FuseRequest, type IFuseRequest } from '../models/FuseRequest.js';

/**
 * Thrown when a fuse request's 'processing' lease was released (by the stale
 * sweeper) before the job reached the front of the send queue. Nothing was
 * signed; the address lock and global-cap slot are already free.
 */
export class FuseLeaseLostError extends Error {
  constructor() {
    super('Fuse request lease was released before the block could be signed');
    this.name = 'FuseLeaseLostError';
  }
}

/**
 * Revalidate (and refresh) a request's 'processing' lease right before signing.
 *
 * A 'processing' FuseRequest is the per-address lock and occupies a
 * global-cap slot. The stale sweeper releases leases whose `updatedAt` is
 * older than its grace window on the assumption that the handler died. A
 * handler that is merely waiting in the send queue is still alive, so before
 * it signs it must confirm it still holds the lease; if the sweeper already
 * freed the slot (and possibly admitted another request for the same
 * address), signing anyway would exceed the admitted caps.
 *
 * On success the lease's `updatedAt` is bumped so the sweeper cannot release
 * it while the send is in flight.
 */
export async function assertFuseLeaseHeld(fuseRequest: IFuseRequest): Promise<void> {
  const result = await FuseRequest.updateOne(
    { _id: fuseRequest._id, status: 'processing' },
    { $set: { updatedAt: new Date() } },
  );

  if (result.matchedCount !== 1) {
    throw new FuseLeaseLostError();
  }
}
