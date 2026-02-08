import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { getQsrBalance } from '../services/balance.js';
import { Fusion } from '../models/Fusion.js';
import { getWalletAddress } from '../services/wallet.js';

const router = Router();
const startTime = Date.now();

// Rate limit health endpoint: 100 requests per minute per IP
router.use(rateLimit({
  windowMs: 60 * 1000,
  max: 100,
  message: { error: 'Too many requests. Please slow down.' },
  standardHeaders: true,
  legacyHeaders: false,
}));

// GET /api/health — bot status
router.get('/', async (_req, res) => {
  try {
    const [qsrBalance, activeFusionCount] = await Promise.all([
      getQsrBalance(),
      Fusion.countDocuments({ status: 'active' }),
    ]);

    res.json({
      status: 'ok',
      uptime: Math.floor((Date.now() - startTime) / 1000),
      walletAddress: getWalletAddress().toString(),
      qsrBalance,
      activeFusionCount,
    });
  } catch (error) {
    res.status(503).json({
      status: 'error',
      uptime: Math.floor((Date.now() - startTime) / 1000),
    });
  }
});

export default router;
