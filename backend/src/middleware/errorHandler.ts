import type { Request, Response, NextFunction } from 'express';
import { CONFIG } from '../config/index.js';
import { logger } from '../utils/logger.js';

/**
 * Errors raised by express.json() (via http-errors / raw-body) before any
 * route runs. They carry an HTTP status and a `type`; everything else is an
 * unexpected internal error.
 */
interface BodyParserError extends Error {
  status?: number;
  statusCode?: number;
  type?: string;
  expose?: boolean;
}

interface ClientError {
  status: number;
  code: string;
  message: string;
}

function classifyBodyParserError(err: BodyParserError): ClientError | null {
  const status = err.status ?? err.statusCode;
  if (typeof status !== 'number' || status < 400 || status >= 500) return null;

  switch (err.type) {
    case 'entity.parse.failed':
      return { status: 400, code: 'INVALID_JSON', message: 'Request body is not valid JSON' };
    case 'entity.too.large':
      return { status: 413, code: 'PAYLOAD_TOO_LARGE', message: 'Request body exceeds the 1 KB limit' };
    case 'charset.unsupported':
    case 'encoding.unsupported':
      return { status: 415, code: 'UNSUPPORTED_MEDIA_TYPE', message: 'Unsupported request encoding' };
    default:
      return { status, code: 'BAD_REQUEST', message: 'Malformed request' };
  }
}

export function errorHandler(
  err: Error,
  req: Request,
  res: Response,
  _next: NextFunction,
): void {
  // Client-caused body errors keep their 4xx status and, on the agent API,
  // the documented structured envelope, so a malformed or oversized body is
  // not reported as a server failure.
  const clientError = classifyBodyParserError(err as BodyParserError);
  if (clientError) {
    logger.warn('Rejected request body', {
      code: clientError.code,
      url: req.originalUrl,
      method: req.method,
    });
    if (req.originalUrl.startsWith('/api/agent/')) {
      res.status(clientError.status).json({
        success: false,
        error: { code: clientError.code, message: clientError.message },
      });
    } else {
      res.status(clientError.status).json({ error: clientError.message });
    }
    return;
  }

  logger.error('Unhandled error', {
    error: err.message,
    url: req.originalUrl,
    method: req.method,
  });

  // Echo internals only on explicit dev opt-in; anything else (production,
  // unset, typo'd env) gets the generic message so a misconfigured deploy
  // can't leak internal error strings.
  const isDevelopment = CONFIG.NODE_ENV === 'development';

  const body = isDevelopment
    ? err.message
    : 'An unexpected error occurred. Please try again later.';

  if (req.originalUrl.startsWith('/api/agent/')) {
    res.status(500).json({ success: false, error: { code: 'INTERNAL_ERROR', message: body } });
  } else {
    res.status(500).json({ error: body });
  }
}
