import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { Fusion } from '../models/Fusion.js';
import { CONFIG } from '../config/index.js';
import { isValidAddressFormat } from '../utils/address.js';

const router = Router();

// Rate limit public read endpoints: 100 requests per minute per IP
router.use(rateLimit({
  windowMs: 60 * 1000,
  max: 100,
  message: { error: 'Too many requests. Please slow down.' },
  standardHeaders: true,
  legacyHeaders: false,
}));

const paginationSchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().min(1).max(CONFIG.MAX_PAGE_SIZE).default(CONFIG.DEFAULT_PAGE_SIZE),
});

// GET /api/fusions — all active fusions (paginated, newest first)
router.get('/', async (req, res) => {
  const parsed = paginationSchema.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid pagination parameters' });
    return;
  }
  const { page, limit } = parsed.data;
  const skip = (page - 1) * limit;

  const [fusions, total] = await Promise.all([
    Fusion.find({ status: 'active' })
      .select('beneficiary tier qsrAmount fusedAt status expirationHeight')
      .sort({ fusedAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean()
      .exec(),
    Fusion.countDocuments({ status: 'active' }),
  ]);

  const formatted = fusions.map((f) => ({
    beneficiary: f.beneficiary,
    tier: f.tier,
    qsrAmount: f.qsrAmount / Math.pow(10, CONFIG.QSR_DECIMALS),
    fusedAt: f.fusedAt,
    status: f.status,
    expirationHeight: f.expirationHeight ?? null,
  }));

  res.json({
    fusions: formatted,
    count: formatted.length,
    total,
    page,
    totalPages: Math.ceil(total / limit),
  });
});

// GET /api/fusions/:address — fusions for a specific address (paginated, newest first)
router.get('/:address', async (req, res) => {
  const { address } = req.params;

  if (!isValidAddressFormat(address)) {
    res.status(400).json({ error: 'Invalid Zenon address format' });
    return;
  }

  const parsed = paginationSchema.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid pagination parameters' });
    return;
  }
  const { page, limit } = parsed.data;
  const skip = (page - 1) * limit;

  const [fusions, total] = await Promise.all([
    Fusion.find({ beneficiary: address })
      .select('fusionId tier qsrAmount txHash fusedAt unfusedAt status')
      .sort({ fusedAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean()
      .exec(),
    Fusion.countDocuments({ beneficiary: address }),
  ]);

  const formatted = fusions.map((f) => ({
    fusionId: f.fusionId,
    tier: f.tier,
    qsrAmount: f.qsrAmount / Math.pow(10, CONFIG.QSR_DECIMALS),
    txHash: f.txHash,
    fusedAt: f.fusedAt,
    unfusedAt: f.unfusedAt,
    status: f.status,
  }));

  res.json({
    address,
    fusions: formatted,
    count: formatted.length,
    total,
    page,
    totalPages: Math.ceil(total / limit),
  });
});

export default router;
