import 'dotenv/config';

export const CONFIG = {
  PORT: parseInt(process.env.PORT || '3001', 10),
  NODE_ENV: process.env.NODE_ENV || 'development',
  FRONTEND_URL: process.env.FRONTEND_URL || 'http://localhost:5173',

  // Zenon Node
  ZNN_NODE_URL: process.env.ZNN_NODE_URL || 'wss://node.zenonhub.io:35998',

  // Wallet
  KEYFILE_PATH: process.env.KEYFILE_PATH || '/etc/plasma-bot/wallet.json',
  KEYFILE_PASSWORD: process.env.KEYFILE_PASSWORD || '',

  // Admin
  ADMIN_API_KEY: process.env.ADMIN_API_KEY || '',

  // MongoDB
  MONGODB_URI: process.env.MONGODB_URI || 'mongodb://localhost:27017/plasma-bot',

  // Fuse tiers (QSR amounts in human-readable units)
  FUSE_TIERS: {
    low: { label: 'Low', qsr: 20 },
    medium: { label: 'Medium', qsr: 80 },
    high: { label: 'High', qsr: 120 },
  } as const,

  // Balance threshold: when wallet drops below this, start unfusing oldest fusions
  BALANCE_THRESHOLD_QSR: parseInt(process.env.BALANCE_THRESHOLD_QSR || '500', 10),

  // Rate limiting
  RATE_LIMIT_PER_IP_WINDOW_MS: 24 * 60 * 60 * 1000, // 24 hours
  RATE_LIMIT_PER_IP_MAX: parseInt(process.env.RATE_LIMIT_PER_IP_MAX || '4', 10),

  // Cron intervals
  BALANCE_CHECK_INTERVAL_MS: 5 * 60 * 1000,  // 5 minutes
  RECEIVE_CHECK_INTERVAL_MS: 10 * 60 * 1000, // 10 minutes

  // Pagination defaults
  DEFAULT_PAGE_SIZE: 20,
  MAX_PAGE_SIZE: 100,

  // QSR decimals (8 decimal places)
  QSR_DECIMALS: 8,
} as const;

export type FuseTier = keyof typeof CONFIG.FUSE_TIERS;
