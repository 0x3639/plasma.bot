import { timingSafeEqual } from 'crypto';
import type { Request, Response, NextFunction } from 'express';
import { CONFIG } from '../config/index.js';
import { logger } from '../utils/logger.js';

export function adminAuth(req: Request, res: Response, next: NextFunction): void {
  if (!CONFIG.ADMIN_API_KEY) {
    logger.warn('Admin endpoint called but ADMIN_API_KEY is not configured');
    res.status(403).json({ error: 'Admin endpoints are disabled. Set ADMIN_API_KEY in .env.' });
    return;
  }

  const provided = req.header('X-Admin-Key') || '';

  if (!provided) {
    res.status(401).json({ error: 'Missing X-Admin-Key header' });
    return;
  }

  const expected = Buffer.from(CONFIG.ADMIN_API_KEY);
  const actual = Buffer.from(provided);

  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
    res.status(401).json({ error: 'Invalid admin key' });
    return;
  }

  next();
}
