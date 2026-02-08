import { Router } from 'express';
import { Fusion } from '../models/Fusion.js';
import { CONFIG } from '../config/index.js';
import { isValidAddressFormat } from '../utils/address.js';

const router = Router();

// GET /api/fusions — all active fusions (paginated, newest first)
router.get('/', async (req, res) => {
  const page = Math.max(1, parseInt(req.query.page as string) || 1);
  const limit = Math.min(
    CONFIG.MAX_PAGE_SIZE,
    Math.max(1, parseInt(req.query.limit as string) || CONFIG.DEFAULT_PAGE_SIZE),
  );
  const skip = (page - 1) * limit;

  const [fusions, total] = await Promise.all([
    Fusion.find({ status: 'active' })
      .select('beneficiary tier qsrAmount fusedAt status')
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

  const page = Math.max(1, parseInt(req.query.page as string) || 1);
  const limit = Math.min(
    CONFIG.MAX_PAGE_SIZE,
    Math.max(1, parseInt(req.query.limit as string) || CONFIG.DEFAULT_PAGE_SIZE),
  );
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
