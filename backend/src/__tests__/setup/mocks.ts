import { vi } from 'vitest';

/**
 * Creates a mock Zenon SDK instance with all the methods used in the codebase.
 */
export function createMockZenon() {
  return {
    ledger: {
      getAccountInfoByAddress: vi.fn().mockResolvedValue(null),
      getUnreceivedBlocksByAddress: vi.fn().mockResolvedValue({ list: [] }),
      getFrontierMomentum: vi.fn().mockResolvedValue({ height: 1000000 }),
    },
    embedded: {
      plasma: {
        fuse: vi.fn().mockReturnValue({ /* block template */ }),
        cancel: vi.fn().mockReturnValue({ /* block template */ }),
        getEntriesByAddress: vi.fn().mockResolvedValue({ list: [] }),
      },
    },
    send: vi.fn().mockResolvedValue({ hash: { toString: () => 'mock-tx-hash-abc123' } }),
    initialize: vi.fn().mockResolvedValue(undefined),
    clearConnection: vi.fn(),
  };
}

/**
 * Creates a mock KeyPair.
 */
export function createMockKeyPair() {
  return {
    getAddress: () => createMockAddress(),
    getPublicKey: () => Buffer.from('mock-public-key'),
  };
}

/**
 * Creates a mock Address.
 */
export function createMockAddress(addr = 'z1qp972aed9levp34gwn32xw24j2evsmcmu6knx0') {
  return {
    toString: () => addr,
    hrp: 'z',
  };
}

/**
 * Creates a mock account info with QSR balance.
 * @param qsrHuman QSR balance in human-readable units (e.g. 100 = 100 QSR)
 */
export function createMockAccountInfo(qsrHuman: number) {
  const baseUnits = BigInt(qsrHuman) * BigInt(10 ** 8);
  return {
    balanceInfoMap: {
      'zts1qsrxxxxxxxxxxxxxmerced': {
        token: {
          tokenStandard: { toString: () => 'zts1qsrxxxxxxxxxxxxxmerced' },
        },
        balance: { toString: () => baseUnits.toString() },
      },
    },
  };
}

/**
 * Creates a mock fusion entry as returned by the chain.
 */
export function createMockFusionEntry(overrides: {
  id?: string;
  beneficiary?: string;
  qsrAmount?: number;
  expirationHeight?: number;
} = {}) {
  const defaults = {
    id: 'fusion-id-abc123',
    beneficiary: 'z1qrjdhy65zds69a96xlhheu4sy689k34x4hpse0',
    qsrAmount: 2000000000, // 20 QSR in base units
    expirationHeight: 999000,
  };
  const merged = { ...defaults, ...overrides };
  return {
    id: { toString: () => merged.id },
    beneficiary: { toString: () => merged.beneficiary },
    qsrAmount: { toString: () => merged.qsrAmount.toString() },
    expirationHeight: merged.expirationHeight,
  };
}
