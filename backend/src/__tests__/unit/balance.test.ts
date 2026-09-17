import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  reserveQsr,
  releaseQsr,
  getReservedQsr,
  tryReserveQsr,
  _resetForTesting,
} from '../../services/balance.js';

describe('balance reservation (in-memory)', () => {
  beforeEach(() => {
    _resetForTesting();
  });

  it('starts with zero reserved', () => {
    expect(getReservedQsr()).toBe(0);
  });

  it('reserveQsr increments the counter', () => {
    reserveQsr(20);
    expect(getReservedQsr()).toBe(20);
    reserveQsr(80);
    expect(getReservedQsr()).toBe(100);
  });

  it('releaseQsr decrements the counter', () => {
    reserveQsr(100);
    releaseQsr(40);
    expect(getReservedQsr()).toBe(60);
  });

  it('releaseQsr never goes below zero', () => {
    reserveQsr(10);
    releaseQsr(50);
    expect(getReservedQsr()).toBe(0);
  });

  it('_resetForTesting clears the counter', () => {
    reserveQsr(500);
    _resetForTesting();
    expect(getReservedQsr()).toBe(0);
  });

  describe('QsrReservation.scheduleRelease', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });
    afterEach(() => {
      vi.useRealTimers();
    });

    it('keeps the reservation held until the delay elapses, then releases', () => {
      const reservation = tryReserveQsr(120, 130)!;
      reservation.scheduleRelease(30000);

      // Still reserved immediately after send returns — this is the window where
      // the chain has not yet reflected the spend.
      expect(getReservedQsr()).toBe(120);

      // Not yet released partway through the hold window.
      vi.advanceTimersByTime(29999);
      expect(getReservedQsr()).toBe(120);

      // Released once the confirmation window has passed.
      vi.advanceTimersByTime(1);
      expect(getReservedQsr()).toBe(0);
    });

    it('a concurrent reservation cannot over-spend during the hold window', () => {
      // Wallet has 130 QSR. First fuse reserves 120 and sends.
      const first = tryReserveQsr(120, 130);
      expect(first).not.toBeNull();
      first!.scheduleRelease(30000);

      // A second request arrives before the chain reflects the first spend.
      // Balance still reads 130, but the held reservation blocks a second 120.
      expect(tryReserveQsr(120, 130)).toBeNull();

      // After the window, the reservation frees up.
      vi.advanceTimersByTime(30000);
      expect(getReservedQsr()).toBe(0);
    });

    it('releases exactly once even if scheduled twice', () => {
      const other = tryReserveQsr(20, 200)!; // another request's live reservation
      const mine = tryReserveQsr(120, 200)!;
      expect(getReservedQsr()).toBe(140);

      mine.scheduleRelease(30000);
      mine.scheduleRelease(30000); // e.g. a second exit path after a failed notification
      expect(mine.settled).toBe(true);

      vi.advanceTimersByTime(30000);
      // Only 120 came off; the other request's 20 is untouched.
      expect(getReservedQsr()).toBe(20);
      expect(other.settled).toBe(false);
    });

    it('release() then scheduleRelease() does not double-release', () => {
      tryReserveQsr(20, 200)!; // someone else's
      const mine = tryReserveQsr(80, 200)!;
      mine.release();
      expect(getReservedQsr()).toBe(20);
      mine.scheduleRelease(1000);
      vi.advanceTimersByTime(1000);
      expect(getReservedQsr()).toBe(20);
    });
  });

  describe('tryReserveQsr', () => {
    it('reserves when sufficient balance', () => {
      const result = tryReserveQsr(20, 100);
      expect(result).not.toBeNull();
      expect(result!.amount).toBe(20);
      expect(getReservedQsr()).toBe(20);
    });

    it('rejects when insufficient balance', () => {
      const result = tryReserveQsr(120, 100);
      expect(result).toBeNull();
      expect(getReservedQsr()).toBe(0);
    });

    it('accounts for existing reservations', () => {
      reserveQsr(80);
      // 100 - 80 = 20 available, trying to reserve 30
      const result = tryReserveQsr(30, 100);
      expect(result).toBeNull();
      expect(getReservedQsr()).toBe(80);
    });

    it('allows exact balance match', () => {
      reserveQsr(80);
      // 100 - 80 = 20 available, trying to reserve exactly 20
      const result = tryReserveQsr(20, 100);
      expect(result).not.toBeNull();
      expect(getReservedQsr()).toBe(100);
    });

    it('rejects when balance equals reserved (zero available)', () => {
      reserveQsr(100);
      const result = tryReserveQsr(1, 100);
      expect(result).toBeNull();
      expect(getReservedQsr()).toBe(100);
    });
  });
});
