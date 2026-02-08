import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import { Fusion } from '../../models/Fusion.js';
import { FuseRequest } from '../../models/FuseRequest.js';
import { addressRateLimiter } from '../../middleware/rateLimiter.js';
import { createMockAddress, createMockFusionEntry } from '../setup/mocks.js';

// Mock zenon and wallet
const mockGetEntriesByAddress = vi.fn().mockResolvedValue({ list: [] });
vi.mock('../../services/zenon.js', () => ({
  getZenon: () => ({
    embedded: {
      plasma: {
        getEntriesByAddress: mockGetEntriesByAddress,
      },
    },
  }),
}));

vi.mock('../../services/wallet.js', () => ({
  getWalletAddress: () => createMockAddress(),
}));

function createApp() {
  const app = express();
  app.use(express.json());
  app.post('/test', addressRateLimiter, (_req, res) => {
    res.status(200).json({ ok: true });
  });
  return app;
}

describe('addressRateLimiter', () => {
  const addr = 'z1qrjdhy65zds69a96xlhheu4sy689k34x4hpse0';

  beforeEach(() => {
    vi.clearAllMocks();
    mockGetEntriesByAddress.mockResolvedValue({ list: [] });
  });

  it('allows request when no active fusion exists', async () => {
    const app = createApp();
    const res = await request(app)
      .post('/test')
      .send({ address: addr });

    expect(res.status).toBe(200);
  });

  it('blocks when address has active fusion in DB', async () => {
    await Fusion.create({
      beneficiary: addr,
      tier: 'low',
      qsrAmount: 2000000000,
      txHash: 'tx-abc',
      status: 'active',
      fusedAt: new Date(),
    });

    const app = createApp();
    const res = await request(app)
      .post('/test')
      .send({ address: addr });

    expect(res.status).toBe(429);
    expect(res.body.error).toContain('already has an active');
  });

  it('blocks when address has processing request in DB', async () => {
    await FuseRequest.create({
      beneficiary: addr,
      tier: 'low',
      ipAddress: '127.0.0.1',
      status: 'processing',
    });

    const app = createApp();
    const res = await request(app)
      .post('/test')
      .send({ address: addr });

    expect(res.status).toBe(429);
    expect(res.body.error).toContain('already being processed');
  });

  it('blocks when on-chain fusion found for address', async () => {
    mockGetEntriesByAddress.mockResolvedValueOnce({
      list: [
        createMockFusionEntry({ beneficiary: addr }),
      ],
    });

    const app = createApp();
    const res = await request(app)
      .post('/test')
      .send({ address: addr });

    expect(res.status).toBe(429);
    expect(res.body.error).toContain('already has an active');
  });

  it('allows when chain check fails (falls through)', async () => {
    mockGetEntriesByAddress.mockRejectedValueOnce(new Error('node offline'));

    const app = createApp();
    const res = await request(app)
      .post('/test')
      .send({ address: addr });

    // DB checks passed, chain check failed — still allowed
    expect(res.status).toBe(200);
  });

  it('passes through when no address in body', async () => {
    const app = createApp();
    const res = await request(app)
      .post('/test')
      .send({});

    expect(res.status).toBe(200);
  });

  it('allows address with only unfused fusion', async () => {
    await Fusion.create({
      beneficiary: addr,
      tier: 'low',
      qsrAmount: 2000000000,
      txHash: 'tx-old',
      status: 'unfused',
      fusedAt: new Date(),
      unfusedAt: new Date(),
    });

    const app = createApp();
    const res = await request(app)
      .post('/test')
      .send({ address: addr });

    expect(res.status).toBe(200);
  });
});
