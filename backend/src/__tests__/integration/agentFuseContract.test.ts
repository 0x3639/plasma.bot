import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { Fusion } from '../../models/Fusion.js';
import { FuseRequest } from '../../models/FuseRequest.js';
import { createMockAddress, createMockAccountInfo } from '../setup/mocks.js';
import { _resetForTesting } from '../../services/balance.js';

const mockGetAccountInfo = vi.fn();
const mockGetEntriesByAddress = vi.fn().mockResolvedValue({ list: [] });
const mockSend = vi.fn();

vi.mock('../../services/zenon.js', () => ({
  getZenon: () => ({
    ledger: {
      getAccountInfoByAddress: mockGetAccountInfo,
      getFrontierMomentum: vi.fn().mockResolvedValue({ height: 1000000 }),
    },
    embedded: { plasma: { fuse: vi.fn().mockReturnValue({ blockType: 4 }), getEntriesByAddress: mockGetEntriesByAddress } },
  }),
}));
vi.mock('../../services/wallet.js', () => ({
  getKeyPair: () => ({ getAddress: () => createMockAddress() }),
  getWalletAddress: () => createMockAddress(),
}));
vi.mock('../../services/sendQueue.js', async () => {
  const actual = await vi.importActual('../../services/sendQueue.js') as Record<string, unknown>;
  return {
    ...actual,
    serializedSend: async (block: unknown, keyPair: unknown, options: { beforeSend?: () => Promise<void> } = {}) => {
      if (options.beforeSend) await options.beforeSend();
      return mockSend(block, keyPair);
    },
  };
});
vi.mock('znn-typescript-sdk', async () => {
  const actual = await vi.importActual('znn-typescript-sdk') as Record<string, unknown>;
  return {
    ...actual,
    Address: { parse: (addr: string) => ({ toString: () => addr }) },
    QSR_ZTS: { toString: () => 'zts1qsrxxxxxxxxxxxxxmerced' },
  };
});
vi.mock('../../config/index.js', async () => {
  const actual = await vi.importActual('../../config/index.js') as Record<string, unknown>;
  return {
    ...actual,
    CONFIG: {
      ...(actual.CONFIG as Record<string, unknown>),
      AGENT_RATE_LIMIT_PER_IP_MAX: 1000,
      AGENT_GLOBAL_DAILY_MAX: 1,
    },
  };
});

import agentFuseRoutes from '../../routes/agentFuse.js';
import { SendQueueFullError } from '../../services/sendQueue.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const openapi = JSON.parse(readFileSync(path.join(here, '../../openapi.json'), 'utf8'));

/** Error codes the OpenAPI document declares for one status of the agent route. */
function declaredCodes(status: string): Set<string> {
  const response = openapi.paths['/api/agent/fuse'].post.responses[status];
  expect(response, `OpenAPI declares a ${status} response`).toBeDefined();
  const schema = response.content['application/json'].schema;
  const refs: string[] = schema.$ref ? [schema.$ref] : schema.oneOf.map((s: { $ref: string }) => s.$ref);
  const codes = new Set<string>();
  for (const ref of refs) {
    const name = ref.replace('#/components/schemas/', '');
    for (const c of openapi.components.schemas[name].properties.error.properties.code.enum) codes.add(c);
  }
  return codes;
}

function allDeclaredCodes(): Set<string> {
  const codes = new Set<string>();
  for (const status of Object.keys(openapi.paths['/api/agent/fuse'].post.responses)) {
    if (status === '200') continue;
    for (const c of declaredCodes(status)) codes.add(c);
  }
  return codes;
}

function createApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/agent/fuse', agentFuseRoutes);
  return app;
}

const addr = 'z1qrjdhy65zds69a96xlhheu4sy689k34x4hpse0';

describe('agent fuse API contract (OpenAPI <-> implementation)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    _resetForTesting();
    mockGetAccountInfo.mockResolvedValue(createMockAccountInfo(10_000));
    mockGetEntriesByAddress.mockResolvedValue({ list: [] });
    mockSend.mockResolvedValue({ hash: { toString: () => 'tx' } });
  });

  it('every error code the route can emit is declared in openapi.json', () => {
    const declared = allDeclaredCodes();
    const sources = ['../../routes/agentFuse.ts', '../../middleware/rateLimiter.ts'];
    const emitted = new Set<string>();
    for (const rel of sources) {
      const src = readFileSync(path.join(here, rel), 'utf8');
      for (const m of src.matchAll(/code: '([A-Z_]+)'/g)) emitted.add(m[1]);
    }
    expect(emitted.size).toBeGreaterThan(5);
    for (const code of emitted) {
      expect(declared, `OpenAPI declares ${code}`).toContain(code);
    }
  });

  it('README and llms.txt list every declared error code', () => {
    const declared = allDeclaredCodes();
    for (const rel of ['../../../../README.md', '../../../../frontend/public/llms.txt']) {
      const doc = readFileSync(path.join(here, rel), 'utf8');
      for (const code of declared) expect(doc, `${rel} mentions ${code}`).toContain(code);
    }
  });

  it('page maximum in openapi.json matches the runtime bound', async () => {
    const { CONFIG } = await import('../../config/index.js');
    const page = openapi.paths['/api/fusions/{address}'].get.parameters.find((p: { name: string }) => p.name === 'page');
    expect(page.schema.maximum).toBe(CONFIG.MAX_PAGE_NUMBER);
    expect(page.schema.minimum).toBe(1);
  });

  async function expectCode(res: request.Response, status: number) {
    expect(res.status).toBe(status);
    expect(res.body.success).toBe(false);
    expect(declaredCodes(String(status))).toContain(res.body.error.code);
    return res.body.error.code as string;
  }

  it('415 UNSUPPORTED_MEDIA_TYPE', async () => {
    const res = await request(createApp()).post('/api/agent/fuse').set('Content-Type', 'text/plain').send('x');
    expect(await expectCode(res, 415)).toBe('UNSUPPORTED_MEDIA_TYPE');
  });

  it('400 VALIDATION_FAILED', async () => {
    const res = await request(createApp()).post('/api/agent/fuse').send({ address: 'nope', tier: 'low' });
    expect(await expectCode(res, 400)).toBe('VALIDATION_FAILED');
  });

  it('429 ADDRESS_UNAVAILABLE', async () => {
    await Fusion.create({ beneficiary: addr, tier: 'low', qsrAmount: 2000000000, txHash: 't', status: 'active', fusedAt: new Date() });
    const res = await request(createApp()).post('/api/agent/fuse').send({ address: addr, tier: 'low' });
    expect(await expectCode(res, 429)).toBe('ADDRESS_UNAVAILABLE');
  });

  it('429 GLOBAL_LIMIT_REACHED', async () => {
    await FuseRequest.create({ beneficiary: 'z1other', tier: 'low', ipAddress: '1.1.1.1', source: 'api', status: 'completed' });
    const res = await request(createApp()).post('/api/agent/fuse').send({ address: addr, tier: 'low' });
    expect(await expectCode(res, 429)).toBe('GLOBAL_LIMIT_REACHED');
  });

  it('503 INSUFFICIENT_BALANCE', async () => {
    mockGetAccountInfo.mockResolvedValue(createMockAccountInfo(0));
    const res = await request(createApp()).post('/api/agent/fuse').send({ address: addr, tier: 'low' });
    expect(await expectCode(res, 503)).toBe('INSUFFICIENT_BALANCE');
  });

  it('503 SERVICE_UNAVAILABLE', async () => {
    mockGetAccountInfo.mockRejectedValue(new Error('socket not ready'));
    const res = await request(createApp()).post('/api/agent/fuse').send({ address: addr, tier: 'low' });
    expect(await expectCode(res, 503)).toBe('SERVICE_UNAVAILABLE');
  });

  it('503 SERVICE_BUSY', async () => {
    mockSend.mockRejectedValueOnce(new SendQueueFullError());
    const res = await request(createApp()).post('/api/agent/fuse').send({ address: addr, tier: 'low' });
    expect(await expectCode(res, 503)).toBe('SERVICE_BUSY');
  });

  it('500 FUSE_FAILED', async () => {
    mockSend.mockRejectedValueOnce(new Error('node rejected block'));
    const res = await request(createApp()).post('/api/agent/fuse').send({ address: addr, tier: 'low' });
    expect(await expectCode(res, 500)).toBe('FUSE_FAILED');
  });

  it('200 success matches FuseSuccess', async () => {
    const res = await request(createApp()).post('/api/agent/fuse').send({ address: addr, tier: 'low' });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ success: true, txHash: 'tx', address: addr, tier: 'low', amount: 20 });
  });
});
