import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Fusion } from '../../models/Fusion.js';
import { fuseToAddress } from '../../services/plasma.js';

// Mock SDK dependencies
const mockFuse = vi.fn().mockReturnValue({ blockType: 4 });
const mockSend = vi.fn().mockResolvedValue({ hash: { toString: () => 'mock-tx-hash' } });

vi.mock('../../services/zenon.js', () => ({
  getZenon: () => ({
    embedded: {
      plasma: {
        fuse: mockFuse,
      },
    },
    send: mockSend,
  }),
}));

vi.mock('../../services/sendQueue.js', () => ({
  serializedSend: (...args: unknown[]) => mockSend(...args),
}));

vi.mock('../../services/wallet.js', () => ({
  getKeyPair: () => ({ getAddress: () => ({ toString: () => 'z1mock' }) }),
}));

// Mock Address.parse from SDK
vi.mock('znn-typescript-sdk', async () => {
  const actual = await vi.importActual('znn-typescript-sdk') as Record<string, unknown>;
  return {
    ...actual,
    Address: {
      parse: (addr: string) => ({ toString: () => addr }),
    },
  };
});

describe('fuseToAddress', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('creates a fusion and saves to DB', async () => {
    const addr = 'z1qrjdhy65zds69a96xlhheu4sy689k34x4hpse0';

    const fusion = await fuseToAddress(addr, 'low');

    expect(fusion.beneficiary).toBe(addr);
    expect(fusion.tier).toBe('low');
    expect(fusion.qsrAmount).toBe(20 * 10 ** 8); // 20 QSR in base units
    expect(fusion.txHash).toBe('mock-tx-hash');
    // Created as 'pending' — reconcile promotes to 'active' once the fuse is
    // confirmed on-chain, so a rejected send can't leave a phantom 'active'.
    expect(fusion.status).toBe('pending');

    // Verify it's actually in MongoDB
    const dbRecord = await Fusion.findById(fusion._id);
    expect(dbRecord).not.toBeNull();
    expect(dbRecord?.beneficiary).toBe(addr);
  });

  it('uses correct QSR amount for medium tier', async () => {
    const addr = 'z1qrjdhy65zds69a96xlhheu4sy689k34x4hpse0';

    const fusion = await fuseToAddress(addr, 'medium');
    expect(fusion.qsrAmount).toBe(80 * 10 ** 8);
  });

  it('uses correct QSR amount for high tier', async () => {
    const addr = 'z1qrjdhy65zds69a96xlhheu4sy689k34x4hpse0';

    const fusion = await fuseToAddress(addr, 'high');
    expect(fusion.qsrAmount).toBe(120 * 10 ** 8);
  });

  it('calls zenon.embedded.plasma.fuse with correct args', async () => {
    const addr = 'z1qrjdhy65zds69a96xlhheu4sy689k34x4hpse0';

    await fuseToAddress(addr, 'low');

    expect(mockFuse).toHaveBeenCalledTimes(1);
    // First arg is Address, second is base units string
    const args = mockFuse.mock.calls[0];
    expect(args[0].toString()).toBe(addr);
    expect(args[1]).toBe((20n * 10n ** 8n).toString());
  });

  it('calls serializedSend with the fuse block', async () => {
    const addr = 'z1qrjdhy65zds69a96xlhheu4sy689k34x4hpse0';

    await fuseToAddress(addr, 'low');

    expect(mockSend).toHaveBeenCalledTimes(1);
    expect(mockSend.mock.calls[0][0]).toEqual({ blockType: 4 });
  });
});
