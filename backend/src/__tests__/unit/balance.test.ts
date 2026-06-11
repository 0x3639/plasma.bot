import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  reserveQsr,
  releaseQsr,
  scheduleReleaseQsr,
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

  describe('scheduleReleaseQsr', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });
    afterEach(() => {
      vi.useRealTimers();
    });

    it('keeps the reservation held until the delay elapses, then releases', () => {
      reserveQsr(120);
      scheduleReleaseQsr(120, 30000);

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
      expect(tryReserveQsr(120, 130)).toBe(true);
      scheduleReleaseQsr(120, 30000);

      // A second request arrives before the chain reflects the first spend.
      // Balance still reads 130, but the held reservation blocks a second 120.
      expect(tryReserveQsr(120, 130)).toBe(false);

      // After the window, the reservation frees up.
      vi.advanceTimersByTime(30000);
      expect(getReservedQsr()).toBe(0);
    });
  });

  describe('tryReserveQsr', () => {
    it('reserves when sufficient balance', () => {
      const result = tryReserveQsr(20, 100);
      expect(result).toBe(true);
      expect(getReservedQsr()).toBe(20);
    });

    it('rejects when insufficient balance', () => {
      const result = tryReserveQsr(120, 100);
      expect(result).toBe(false);
      expect(getReservedQsr()).toBe(0);
    });

    it('accounts for existing reservations', () => {
      reserveQsr(80);
      // 100 - 80 = 20 available, trying to reserve 30
      const result = tryReserveQsr(30, 100);
      expect(result).toBe(false);
      expect(getReservedQsr()).toBe(80);
    });

    it('allows exact balance match', () => {
      reserveQsr(80);
      // 100 - 80 = 20 available, trying to reserve exactly 20
      const result = tryReserveQsr(20, 100);
      expect(result).toBe(true);
      expect(getReservedQsr()).toBe(100);
    });

    it('rejects when balance equals reserved (zero available)', () => {
      reserveQsr(100);
      const result = tryReserveQsr(1, 100);
      expect(result).toBe(false);
      expect(getReservedQsr()).toBe(100);
    });
  });
});
