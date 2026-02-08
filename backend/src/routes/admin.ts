import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { receiveAllPending } from '../services/receiveTx.js';
import { reconcileFusionIds } from '../cron/reconcile.js';
import { runUnfuseCycle } from '../services/unfuse.js';
import { getQsrBalance } from '../services/balance.js';
import { adminAuth } from '../middleware/adminAuth.js';
import { logger } from '../utils/logger.js';

const router = Router();

// All admin routes require API key authentication
router.use(adminAuth);

// Rate limit admin endpoints: 10 requests per minute
router.use(rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  message: { error: 'Too many admin requests. Slow down.' },
  standardHeaders: true,
  legacyHeaders: false,
}));

// POST /api/admin/receive — force receive all pending transactions
router.post('/receive', async (_req, res) => {
  try {
    const received = await receiveAllPending();
    const balance = await getQsrBalance();
    logger.info(`Manual receive triggered: ${received} transactions received`);
    res.json({ received, qsrBalance: balance });
  } catch (error) {
    logger.error('Manual receive failed', { error });
    res.status(500).json({ error: 'Receive failed' });
  }
});

// POST /api/admin/cycle — force full balance monitor cycle (receive + reconcile + unfuse)
router.post('/cycle', async (_req, res) => {
  try {
    const received = await receiveAllPending();
    await reconcileFusionIds();
    await runUnfuseCycle();
    const balance = await getQsrBalance();
    logger.info(`Manual cycle triggered: ${received} received, balance: ${balance} QSR`);
    res.json({ received, qsrBalance: balance });
  } catch (error) {
    logger.error('Manual cycle failed', { error });
    res.status(500).json({ error: 'Cycle failed' });
  }
});

export default router;
