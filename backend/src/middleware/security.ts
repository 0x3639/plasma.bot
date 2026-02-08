import helmet from 'helmet';
import cors from 'cors';
import express, { type Express } from 'express';
import { CONFIG } from '../config/index.js';

export function setupSecurity(app: Express): void {
  app.use(helmet());

  app.use(cors({
    origin: CONFIG.FRONTEND_URL,
    methods: ['GET', 'POST'],
    credentials: true,
  }));

  app.use(express.json({ limit: '10kb' }));

  // Trust first proxy (nginx) for correct IP detection
  app.set('trust proxy', 1);
}
