import type { Request, Response, NextFunction } from 'express';
import { CONFIG } from '../config/index.js';
import { logger } from '../utils/logger.js';

export function errorHandler(
  err: Error,
  req: Request,
  res: Response,
  _next: NextFunction,
): void {
  logger.error('Unhandled error', {
    error: err.message,
    url: req.originalUrl,
    method: req.method,
  });

  // Echo internals only on explicit dev opt-in; anything else (production,
  // unset, typo'd env) gets the generic message so a misconfigured deploy
  // can't leak internal error strings.
  const isDevelopment = CONFIG.NODE_ENV === 'development';

  res.status(500).json({
    error: isDevelopment
      ? err.message
      : 'An unexpected error occurred. Please try again later.',
  });
}
