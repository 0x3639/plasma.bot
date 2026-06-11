import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import { Fusion } from '../../models/Fusion.js';
import { FuseRequest } from '../../models/FuseRequest.js';
import {
  addressRateLimiter,
  agentGlobalDailyLimiter,
  webGlobalDailyLimiter,
  confirmGlobalCapSlot,
} from '../../middleware/rateLimiter.js';
import { createMockAddress, createMockFusionEntry } from '../setup/mocks.js';

vi.mock('../../config/index.js', async () => {
  const actual = await vi.importActual('../../config/index.js') as Record<string, unknown>;
  return {
    ...actual,
    CONFIG: {
      ...(actual.CONFIG as Record<string, unknown>),
      AGENT_GLOBAL_DAILY_MAX: 2,
      TELEGRAM_GLOBAL_DAILY_MAX: 2,
      WEB_GLOBAL_DAILY_MAX: 2,
    },
  };
});

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

  it('blocks when address has a pending (unconfirmed) fusion', async () => {
    await Fusion.create({
      beneficiary: addr,
      tier: 'low',
      qsrAmount: 2000000000,
      txHash: 'tx-pending',
      status: 'pending',
      fusedAt: new Date(),
    });

    const app = createApp();
    const res = await request(app)
      .post('/test')
      .send({ address: addr });

    expect(res.status).toBe(429);
    expect(res.body.error).toContain('already has an active');
  });
});

describe('agentGlobalDailyLimiter', () => {
  function createApp() {
    const app = express();
    app.use(express.json());
    app.post('/test', agentGlobalDailyLimiter, (_req, res) => {
      res.status(200).json({ ok: true });
    });
    return app;
  }

  async function makeAgentRequests(count: number, status = 'completed') {
    for (let i = 0; i < count; i++) {
      await FuseRequest.create({
        beneficiary: `z1qrjdhy65zds69a96xlhheu4sy689k34x4hpse${i}`,
        tier: 'low',
        ipAddress: `1.2.3.${i}`,
        source: 'api',
        status,
      });
    }
  }

  it('allows requests below the global daily cap', async () => {
    await makeAgentRequests(1); // cap is mocked to 2
    const res = await request(createApp()).post('/test').send({});
    expect(res.status).toBe(200);
  });

  it('blocks once the global daily cap is reached', async () => {
    await makeAgentRequests(2); // at cap
    const res = await request(createApp()).post('/test').send({});
    expect(res.status).toBe(429);
    expect(res.body.error.code).toBe('GLOBAL_LIMIT_REACHED');
  });

  it('counts in-flight (processing) requests toward the cap', async () => {
    await makeAgentRequests(2, 'processing');
    const res = await request(createApp()).post('/test').send({});
    expect(res.status).toBe(429);
  });

  it('does not count web/telegram requests toward the agent cap', async () => {
    for (let i = 0; i < 5; i++) {
      await FuseRequest.create({
        beneficiary: `z1qrjdhy65zds69a96xlhheu4sy689k34x4hpse${i}`,
        tier: 'low',
        ipAddress: '127.0.0.1',
        source: 'web',
        status: 'completed',
      });
    }
    const res = await request(createApp()).post('/test').send({});
    expect(res.status).toBe(200);
  });
});

describe('FuseRequest processing race lock', () => {
  const addr = 'z1qrjdhy65zds69a96xlhheu4sy689k34x4hpse0';

  beforeEach(async () => {
    // Ensure the unique partial index is actually built before asserting on it.
    await FuseRequest.syncIndexes();
  });

  it('rejects a second concurrent processing request for the same address', async () => {
    await FuseRequest.create({ beneficiary: addr, tier: 'low', ipAddress: 'a', status: 'processing' });

    let dupCode: number | undefined;
    try {
      await FuseRequest.create({ beneficiary: addr, tier: 'low', ipAddress: 'b', status: 'processing' });
    } catch (err) {
      dupCode = (err as { code?: number }).code;
    }

    expect(dupCode).toBe(11000);
  });

  it('allows a new processing request once the prior one is completed', async () => {
    const first = await FuseRequest.create({ beneficiary: addr, tier: 'low', ipAddress: 'a', status: 'processing' });
    first.status = 'completed';
    await first.save();

    // No longer 'processing', so the partial index does not block a new one.
    const second = await FuseRequest.create({ beneficiary: addr, tier: 'low', ipAddress: 'b', status: 'processing' });
    expect(second.status).toBe('processing');
  });
});

describe('webGlobalDailyLimiter', () => {
  function createApp() {
    const app = express();
    app.use(express.json());
    app.post('/test', webGlobalDailyLimiter, (_req, res) => {
      res.status(200).json({ ok: true });
    });
    return app;
  }

  it('blocks once the web global daily cap is reached', async () => {
    for (let i = 0; i < 2; i++) { // cap mocked to 2
      await FuseRequest.create({
        beneficiary: `z1qrjdhy65zds69a96xlhheu4sy689k34x4hpse${i}`,
        tier: 'low',
        ipAddress: `1.2.3.${i}`,
        source: 'web',
        status: 'completed',
      });
    }
    const res = await request(createApp()).post('/test').send({});
    expect(res.status).toBe(429);
    expect(res.body.error).toContain('daily limit');
  });

  it('does not count agent requests toward the web cap', async () => {
    for (let i = 0; i < 5; i++) {
      await FuseRequest.create({
        beneficiary: `z1qrjdhy65zds69a96xlhheu4sy689k34x4hpse${i}`,
        tier: 'low',
        ipAddress: `1.2.3.${i}`,
        source: 'api',
        status: 'completed',
      });
    }
    const res = await request(createApp()).post('/test').send({});
    expect(res.status).toBe(200);
  });
});

describe('confirmGlobalCapSlot (post-create atomic cap enforcement)', () => {
  function makeRequest(i: number, source: 'api' | 'web' = 'api') {
    return FuseRequest.create({
      beneficiary: `z1qrjdhy65zds69a96xlhheu4sy689k34x4hpse${i}`,
      tier: 'low',
      ipAddress: `9.9.9.${i}`,
      source,
      status: 'processing',
    });
  }

  it('grants slots to sequential requests within the cap', async () => {
    const first = await makeRequest(0);
    expect(await confirmGlobalCapSlot(first)).toBe(true);

    const second = await makeRequest(1); // count = 2 = cap, still within
    expect(await confirmGlobalCapSlot(second)).toBe(true);
  });

  it('rejects and rolls back a concurrent burst that exceeds the cap', async () => {
    // Simulate the TOCTOU burst: all records are inserted before any cap check
    // runs (every request passed the middleware pre-check against count 0).
    const burst = await Promise.all([0, 1, 2].map((i) => makeRequest(i)));

    const grants = [];
    for (const req of burst) {
      grants.push(await confirmGlobalCapSlot(req));
    }

    // Each check sees count = 3 > cap (2): the burst cannot over-dispense.
    expect(grants.filter(Boolean).length).toBeLessThanOrEqual(2);

    // Rejected requests are rolled back to 'failed', freeing their slots.
    const stillProcessing = await FuseRequest.countDocuments({ source: 'api', status: 'processing' });
    expect(stillProcessing).toBeLessThanOrEqual(2);
  });

  it('enforces the cap per source', async () => {
    // Fill the api cap; a web request must still get a slot.
    const apiReqs = await Promise.all([0, 1].map((i) => makeRequest(i, 'api')));
    for (const req of apiReqs) {
      expect(await confirmGlobalCapSlot(req)).toBe(true);
    }

    const webReq = await makeRequest(5, 'web');
    expect(await confirmGlobalCapSlot(webReq)).toBe(true);
  });
});
