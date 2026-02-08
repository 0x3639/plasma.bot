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

  const isProduction = CONFIG.NODE_ENV === 'production';

  res.status(500).json({
    error: isProduction
      ? 'An unexpected error occurred. Please try again later.'
      : err.message,
  });
}
