import { z } from 'zod';
import type { Request, Response, NextFunction } from 'express';
import { isValidAddressFormat } from '../utils/address.js';

export const fuseRequestSchema = z.object({
  address: z.string()
    .min(1, 'Address is required')
    .refine(isValidAddressFormat, {
      message: 'Invalid Zenon address. Must start with z1 and be 40 characters.',
    }),
  tier: z.enum(['low', 'medium', 'high'], {
    errorMap: () => ({ message: 'Tier must be low, medium, or high' }),
  }),
});

export type FuseRequestBody = z.infer<typeof fuseRequestSchema>;

export function validateBody(schema: z.ZodSchema) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const result = schema.safeParse(req.body);
    if (!result.success) {
      res.status(400).json({
        error: 'Validation failed',
        details: result.error.errors.map((e) => ({
          field: e.path.join('.'),
          message: e.message,
        })),
      });
      return;
    }
    req.body = result.data;
    next();
  };
}
