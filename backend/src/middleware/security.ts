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

  app.use(cors({
    origin: CONFIG.FRONTEND_URL,
    methods: ['GET', 'POST'],
  }));

  app.use(express.json({ limit: '1kb' }));

  // Trust first proxy (nginx) for correct IP detection
  app.set('trust proxy', 1);
}
