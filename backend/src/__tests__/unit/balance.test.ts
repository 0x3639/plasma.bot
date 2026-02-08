import { describe, it, expect, vi, beforeEach } from 'vitest';
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
