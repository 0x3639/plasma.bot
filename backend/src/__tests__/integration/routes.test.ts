import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import { Fusion } from '../../models/Fusion.js';
import { createMockAddress, createMockAccountInfo } from '../setup/mocks.js';

// --- Mock all external services ---
const mockGetAccountInfo = vi.fn();
const mockGetFrontierMomentum = vi.fn().mockResolvedValue({ height: 1000000 });
const mockGetEntriesByAddress = vi.fn().mockResolvedValue({ list: [] });
const mockGetUnreceived = vi.fn().mockResolvedValue({ list: [] });
const mockFuse = vi.fn().mockReturnValue({ blockType: 4 });
const mockCancel = vi.fn().mockReturnValue({ blockType: 5 });
const mockSend = vi.fn().mockResolvedValue({ hash: { toString: () => 'mock-tx-hash' } });

vi.mock('../../services/zenon.js', () => ({
  getZenon: () => ({
    ledger: {
      getAccountInfoByAddress: mockGetAccountInfo,
      getUnreceivedBlocksByAddress: mockGetUnreceived,
      getFrontierMomentum: mockGetFrontierMomentum,
    },
    embedded: {
      plasma: {
        fuse: mockFuse,
        cancel: mockCancel,
        getEntriesByAddress: mockGetEntriesByAddress,
      },
    },
    send: mockSend,
  }),
}));

vi.mock('../../services/wallet.js', () => ({
  getKeyPair: () => ({ getAddress: () => createMockAddress() }),
  getWalletAddress: () => createMockAddress(),
}));

vi.mock('../../services/sendQueue.js', () => ({
  serializedSend: (...args: unknown[]) => mockSend(...args),
}));

vi.mock('znn-typescript-sdk', async () => {
  const actual = await vi.importActual('znn-typescript-sdk') as Record<string, unknown>;
  return {
    ...actual,
    Address: {
      parse: (addr: string) => ({ toString: () => addr }),
    },
    Hash: {
      parse: (hash: string) => hash,
    },
    QSR_ZTS: { toString: () => 'zts1qsrxxxxxxxxxxxxxmerced' },
    AccountBlockTemplate: {
      receive: vi.fn().mockReturnValue({ blockType: 2 }),
    },
  };
});

vi.mock('../../config/index.js', async () => {
  const actual = await vi.importActual('../../config/index.js') as Record<string, unknown>;
  return {
    ...actual,
    CONFIG: {
      ...(actual.CONFIG as Record<string, unknown>),
      ADMIN_API_KEY: 'test-admin-key',
      RATE_LIMIT_PER_IP_MAX: 100, // High limit so tests don't trip IP limiter
      RATE_LIMIT_PER_IP_WINDOW_MS: 60000,
    },
  };
});

// Import routes after mocking
import { setupSecurity } from '../../middleware/security.js';
import { errorHandler } from '../../middleware/errorHandler.js';
import fuseRoutes from '../../routes/fuse.js';
import statusRoutes from '../../routes/status.js';
import statsRoutes, { resetStatsCache } from '../../routes/stats.js';
import healthRoutes from '../../routes/health.js';
import adminRoutes from '../../routes/admin.js';

function createApp() {
  const app = express();
  setupSecurity(app);
  app.use('/api/fuse', fuseRoutes);
  app.use('/api/fusions', statusRoutes);
  app.use('/api/stats', statsRoutes);
  app.use('/api/health', healthRoutes);
  app.use('/api/admin', adminRoutes);
  app.use(errorHandler);
  return app;
}

describe('Route Integration Tests', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetStatsCache();
    mockGetAccountInfo.mockResolvedValue(createMockAccountInfo(1000));
    mockGetEntriesByAddress.mockResolvedValue({ list: [] });
  });

  // --- Health endpoint ---
  describe('GET /api/health', () => {
    it('returns health status', async () => {
      const app = createApp();
      const res = await request(app).get('/api/health');

      expect(res.status).toBe(200);
      expect(res.body.status).toBe('ok');
      expect(res.body).toHaveProperty('uptime');
      expect(res.body).toHaveProperty('qsrBalance');
      expect(res.body).toHaveProperty('walletAddress');
      expect(res.body).toHaveProperty('activeFusionCount');
    });
  });

  // --- Stats endpoint ---
  describe('GET /api/stats', () => {
    it('returns stats with zero fusions', async () => {
      const app = createApp();
      const res = await request(app).get('/api/stats');

      expect(res.status).toBe(200);
      expect(res.body.qsrAvailable).toBe(1000);
      expect(res.body.activeFusionCount).toBe(0);
      expect(res.body.qsrFused).toBe(0);
      expect(res.body.availableTiers).toContain('low');
    });

    it('includes active fusions in stats', async () => {
      await Fusion.create({
        beneficiary: 'z1qrjdhy65zds69a96xlhheu4sy689k34x4hpse0',
        tier: 'low',
        qsrAmount: 2000000000,
        txHash: 'tx-1',
        status: 'active',
        fusedAt: new Date(),
      });

      const app = createApp();
      const res = await request(app).get('/api/stats');

      expect(res.status).toBe(200);
      expect(res.body.activeFusionCount).toBe(1);
      expect(res.body.qsrFused).toBe(20);
    });
  });

  // --- Fusions endpoint ---
  describe('GET /api/fusions', () => {
    it('returns empty list when no fusions', async () => {
      const app = createApp();
      const res = await request(app).get('/api/fusions');

      expect(res.status).toBe(200);
      expect(res.body.fusions).toEqual([]);
      expect(res.body.total).toBe(0);
    });

    it('returns active fusions with pagination', async () => {
      // Create 3 fusions
      for (let i = 0; i < 3; i++) {
        await Fusion.create({
          beneficiary: `z1qrjdhy65zds69a96xlhheu4sy689k34x4hpse${i}`,
          tier: 'low',
          qsrAmount: 2000000000,
          txHash: `tx-${i}`,
          status: 'active',
          fusedAt: new Date(Date.now() - i * 1000),
        });
      }

      const app = createApp();
      const res = await request(app).get('/api/fusions?limit=2&page=1');

      expect(res.status).toBe(200);
      expect(res.body.fusions).toHaveLength(2);
      expect(res.body.total).toBe(3);
      expect(res.body.totalPages).toBe(2);
    });

    it('rejects invalid pagination', async () => {
      const app = createApp();
      const res = await request(app).get('/api/fusions?page=-1');

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('Invalid pagination');
    });
  });

  // --- Fusions by address ---
  describe('GET /api/fusions/:address', () => {
    it('returns fusions for a specific address', async () => {
      const addr = 'z1qrjdhy65zds69a96xlhheu4sy689k34x4hpse0';
      await Fusion.create({
        beneficiary: addr,
        tier: 'low',
        qsrAmount: 2000000000,
        txHash: 'tx-abc',
        status: 'active',
        fusedAt: new Date(),
      });

      const app = createApp();
      const res = await request(app).get(`/api/fusions/${addr}`);

      expect(res.status).toBe(200);
      expect(res.body.address).toBe(addr);
      expect(res.body.fusions).toHaveLength(1);
      expect(res.body.fusions[0].qsrAmount).toBe(20);
    });

    it('rejects invalid address format', async () => {
      const app = createApp();
      const res = await request(app).get('/api/fusions/not-an-address');

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('Invalid');
    });
  });

  // --- Security headers ---
  describe('Security headers', () => {
    it('includes Helmet security headers', async () => {
      const app = createApp();
      const res = await request(app).get('/api/health');

      expect(res.headers['x-frame-options']).toBe('DENY');
      expect(res.headers).toHaveProperty('x-content-type-options');
      expect(res.headers).toHaveProperty('strict-transport-security');
    });
  });

  // --- Body size limit ---
  describe('Body size limit', () => {
    it('rejects oversized JSON body', async () => {
      const app = createApp();
      const largeBody = { data: 'x'.repeat(2000) };

      const res = await request(app)
        .post('/api/fuse')
        .send(largeBody);

      // Body parser throws PayloadTooLargeError, errorHandler catches it as 500
      expect(res.status).toBe(500);
    });
  });

  // --- Admin endpoints ---
  describe('Admin endpoints', () => {
    it('rejects without auth header', async () => {
      const app = createApp();
      const res = await request(app).post('/api/admin/receive');

      expect(res.status).toBe(401);
    });

    it('rejects with wrong key', async () => {
      const app = createApp();
      const res = await request(app)
        .post('/api/admin/receive')
        .set('X-Admin-Key', 'wrong');

      expect(res.status).toBe(401);
    });

    it('POST /api/admin/receive with valid key', async () => {
      const app = createApp();
      const res = await request(app)
        .post('/api/admin/receive')
        .set('X-Admin-Key', 'test-admin-key');

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('received');
      expect(res.body).toHaveProperty('qsrBalance');
    });

    it('POST /api/admin/cycle with valid key', async () => {
      const app = createApp();
      const res = await request(app)
        .post('/api/admin/cycle')
        .set('X-Admin-Key', 'test-admin-key');

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('received');
      expect(res.body).toHaveProperty('qsrBalance');
    });
  });
});
