import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { QSR_ZTS, PLASMA_ADDRESS } from 'znn-typescript-sdk';
import { getZenon } from '../services/zenon.js';
import { getWalletAddress } from '../services/wallet.js';
import { CONFIG } from '../config/index.js';
import { logger } from '../utils/logger.js';

const router = Router();

// Rate limit: 30 requests per minute per IP
router.use(rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  message: { error: 'Too many requests. Please slow down.' },
  standardHeaders: true,
  legacyHeaders: false,
}));

// In-memory cache
let cachedResult: { donations: DonationEntry[]; totalDonated: number; donorCount: number } | null = null;
let cacheTimestamp = 0;
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

interface DonationEntry {
  address: string;
  totalQsr: number;
  count: number;
}

const QSR_DIVISOR = Math.pow(10, CONFIG.QSR_DECIMALS);
const MAX_PAGES = 20; // Safety limit: 20 pages × 1024 = ~20k blocks max

function isEmbeddedAddress(addr: string): boolean {
  return addr.startsWith('z1qxemdeddedx');
}

async function fetchDonationsFromNode(): Promise<{ donations: DonationEntry[]; totalDonated: number; donorCount: number }> {
  const zenon = getZenon();
  const botAddress = getWalletAddress();
  const botAddressStr = botAddress.toString();
  const qsrZtsStr = QSR_ZTS.toString();
  const plasmaAddressStr = PLASMA_ADDRESS.toString();

  const donorMap = new Map<string, { totalQsr: number; count: number }>();

  for (let page = 0; page < MAX_PAGES; page++) {
    const blockList = await zenon.ledger.getAccountBlocksByPage(botAddress, page, 1024);

    if (!blockList || !blockList.list || blockList.list.length === 0) {
      break;
    }

    for (const block of blockList.list) {
      // Only receive blocks (UserReceive=3, ContractReceive=5)
      if (block.blockType !== 3 && block.blockType !== 5) continue;

      // Must have a paired send block with sender info
      if (!block.pairedAccountBlock) continue;

      const senderAddr = block.pairedAccountBlock.address?.toString();
      const tokenStd = block.pairedAccountBlock.tokenStandard?.toString();
      const amount = block.pairedAccountBlock.amount;

      if (!senderAddr || !tokenStd || !amount) continue;

      // Only QSR
      if (tokenStd !== qsrZtsStr) continue;

      // Exclude: plasma contract (unfuse returns), bot itself, any embedded contract
      if (senderAddr === plasmaAddressStr) continue;
      if (senderAddr === botAddressStr) continue;
      if (isEmbeddedAddress(senderAddr)) continue;

      const qsrAmount = Number(amount.toString()) / QSR_DIVISOR;
      if (qsrAmount <= 0) continue;

      const existing = donorMap.get(senderAddr);
      if (existing) {
        existing.totalQsr += qsrAmount;
        existing.count += 1;
      } else {
        donorMap.set(senderAddr, { totalQsr: qsrAmount, count: 1 });
      }
    }

    // If fewer than 1024 results, we've reached the end
    if (blockList.list.length < 1024) break;
  }

  const donations: DonationEntry[] = Array.from(donorMap.entries())
    .map(([address, data]) => ({
      address,
      totalQsr: Math.round(data.totalQsr * 100) / 100, // 2 decimal places
      count: data.count,
    }))
    .sort((a, b) => b.totalQsr - a.totalQsr);

  const totalDonated = donations.reduce((sum, d) => sum + d.totalQsr, 0);

  return {
    donations,
    totalDonated: Math.round(totalDonated * 100) / 100,
    donorCount: donations.length,
  };
}

// GET /api/donations
router.get('/', async (_req, res) => {
  try {
    const now = Date.now();

    if (cachedResult && now - cacheTimestamp < CACHE_TTL_MS) {
      return res.json(cachedResult);
    }

    const result = await fetchDonationsFromNode();
    cachedResult = result;
    cacheTimestamp = now;

    res.json(result);
  } catch (error) {
    logger.error('Donations endpoint failed', { error });
    res.status(503).json({ error: 'Node connection unavailable. Please try again.' });
  }
});

export default router;
