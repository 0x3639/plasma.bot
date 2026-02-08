import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

// Must mock CONFIG before importing adminAuth
vi.mock('../../config/index.js', () => ({
  CONFIG: {
    ADMIN_API_KEY: 'test-admin-key-123',
    NODE_ENV: 'test',
  },
}));

import { adminAuth } from '../../middleware/adminAuth.js';

function createApp() {
  const app = express();
  app.use('/admin', adminAuth, (_req, res) => {
    res.status(200).json({ ok: true });
  });
  return app;
}

describe('adminAuth middleware', () => {
  it('allows request with valid admin key', async () => {
    const app = createApp();
    const res = await request(app)
      .get('/admin')
      .set('X-Admin-Key', 'test-admin-key-123');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
  });

  it('rejects request without X-Admin-Key header', async () => {
    const app = createApp();
    const res = await request(app).get('/admin');

    expect(res.status).toBe(401);
    expect(res.body.error).toContain('Missing');
  });

  it('rejects request with wrong admin key', async () => {
    const app = createApp();
    const res = await request(app)
      .get('/admin')
      .set('X-Admin-Key', 'wrong-key');

    expect(res.status).toBe(401);
    expect(res.body.error).toContain('Invalid');
  });

  it('rejects empty admin key header', async () => {
    const app = createApp();
    const res = await request(app)
      .get('/admin')
      .set('X-Admin-Key', '');

    expect(res.status).toBe(401);
    expect(res.body.error).toContain('Missing');
  });

  it('is timing-safe (different length keys)', async () => {
    const app = createApp();
    const res = await request(app)
      .get('/admin')
      .set('X-Admin-Key', 'short');

    expect(res.status).toBe(401);
  });
});

describe('adminAuth with no ADMIN_API_KEY configured', () => {
  it('returns 403 when ADMIN_API_KEY is empty', async () => {
    // Dynamically re-mock with empty key
    const { CONFIG } = await import('../../config/index.js');
    const original = CONFIG.ADMIN_API_KEY;
    (CONFIG as any).ADMIN_API_KEY = '';

    const app = createApp();
    const res = await request(app)
      .get('/admin')
      .set('X-Admin-Key', 'anything');

    expect(res.status).toBe(403);
    expect(res.body.error).toContain('disabled');

    // Restore
    (CONFIG as any).ADMIN_API_KEY = original;
  });
});
