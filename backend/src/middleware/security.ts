import helmet from 'helmet';
import cors from 'cors';
import express, { type Express } from 'express';
import { CONFIG } from '../config/index.js';

export function setupSecurity(app: Express): void {
  app.use(helmet({
    contentSecurityPolicy: {
      directives: { defaultSrc: ["'self'"] },
    },
    strictTransportSecurity: { maxAge: 31536000, includeSubDomains: true },
    frameguard: { action: 'deny' },
  }));

  // Agent API is public/machine-readable: allow any origin (POST only).
  // Registered BEFORE the global FRONTEND_URL-locked CORS so it takes precedence.
  app.use('/api/agent', cors({
    origin: '*',
    methods: ['POST'],
    allowedHeaders: ['Content-Type'],
  }));

  // Public read-only stats endpoint: allow any origin (GET only).
  app.use('/api/stats', cors({
    origin: '*',
    methods: ['GET'],
    allowedHeaders: ['Content-Type'],
  }));

  app.use(cors({
    origin: CONFIG.FRONTEND_URL,
    methods: ['GET', 'POST'],
  }));

  app.use(express.json({ limit: '1kb' }));

  // Trust proxy: Caddy overwrites X-Forwarded-For with CF-Connecting-IP,
  // so there's exactly 1 trusted hop (Caddy) between Cloudflare and Express.
  app.set('trust proxy', 1);
}
