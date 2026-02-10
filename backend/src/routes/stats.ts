import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { getQsrBalance } from '../services/balance.js';
import { getNextUnfuseTime } from '../services/unfuse.js';
import { Fusion } from '../models/Fusion.js';
import { CONFIG } from '../config/index.js';
import { getWalletAddress } from '../services/wallet.js';
import { getZenon } from '../services/zenon.js';
import { logger } from '../utils/logger.js';

const router = Router();

// In-memory cache: collapses N clients polling every 10s into 1 node query per 5s
let cachedStats: Record<string, unknown> | null = null;
let cacheTimestamp = 0;
const CACHE_TTL_MS = 5 * 1000; // 5 seconds

export function resetStatsCache(): void {
  cachedStats = null;
  cacheTimestamp = 0;
}

// Rate limit public read endpoints: 100 requests per minute per IP
router.use(rateLimit({
  windowMs: 60 * 1000,
  max: 100,
  message: { error: 'Too many requests. Please slow down.' },
  standardHeaders: true,
  legacyHeaders: false,
}));

// GET /api/stats — public stats for the landing page QSR banner
router.get('/', async (_req, res) => {
  try {
    const now = Date.now();
    if (cachedStats && now - cacheTimestamp < CACHE_TTL_MS) {
      return res.json(cachedStats);
    }

    const zenon = getZenon();
    const [qsrBalance, activeFusions, nextUnfuseAt, frontierMomentum] = await Promise.all([
      getQsrBalance(),
      Fusion.aggregate([
        { $match: { status: 'active' } },
        {
          $group: {
            _id: null,
            totalQsrFused: { $sum: '$qsrAmount' },
            count: { $sum: 1 },
          },
        },
      ]),
      getNextUnfuseTime(),
      zenon.ledger.getFrontierMomentum(),
    ]);
    const currentHeight = Number(frontierMomentum?.height || 0);

    const stats = activeFusions[0] || { totalQsrFused: 0, count: 0 };

    // Users can fuse until wallet hits 0 — threshold only triggers unfusing
    const availableTiers: string[] = [];
    for (const [tierKey, tierConfig] of Object.entries(CONFIG.FUSE_TIERS)) {
      if (qsrBalance >= tierConfig.qsr) {
        availableTiers.push(tierKey);
      }
    }

    const result = {
      walletAddress: getWalletAddress().toString(),
      qsrAvailable: qsrBalance,
      qsrFused: stats.totalQsrFused / Math.pow(10, CONFIG.QSR_DECIMALS),
      qsrBalance,
      activeFusionCount: stats.count,
      availableTiers,
      nextUnfuseAt: nextUnfuseAt?.toISOString() || null,
      currentHeight,
    };

    cachedStats = result;
    cacheTimestamp = Date.now();

    res.json(result);
  } catch (error) {
    logger.error('Stats endpoint failed', { error });
    res.status(503).json({ error: 'Node connection unavailable. Please try again.' });
  }
});

export default router;
