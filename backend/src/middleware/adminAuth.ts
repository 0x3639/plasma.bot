import { createHash, timingSafeEqual } from 'crypto';
import type { Request, Response, NextFunction } from 'express';
import { CONFIG } from '../config/index.js';
import { logger } from '../utils/logger.js';

/** Hash-then-compare prevents leaking the key length via timing. */
function safeCompare(a: string, b: string): boolean {
  const hashA = createHash('sha256').update(a).digest();
  const hashB = createHash('sha256').update(b).digest();
  return timingSafeEqual(hashA, hashB);
}

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

  if (!safeCompare(provided, CONFIG.ADMIN_API_KEY)) {
    res.status(401).json({ error: 'Invalid admin key' });
    return;
  }

  next();
}
