import type { Request, Response, NextFunction, RequestHandler } from 'express';
import type { ParamsDictionary } from 'express-serve-static-core';

/**
 * Express 4 ignores a rejected promise returned by a route handler: the error
 * never reaches the error middleware and the request stays open until a
 * client or proxy timeout. This wrapper forwards the rejection to `next()` so
 * the generic error handler answers the request.
 */
export function asyncHandler<P = ParamsDictionary>(
  fn: (req: Request<P>, res: Response, next: NextFunction) => Promise<unknown>,
): RequestHandler<P> {
  return (req, res, next) => {
    fn(req, res, next).catch(next);
  };
}
