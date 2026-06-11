import 'dotenv/config';

export const CONFIG = {
  PORT: parseInt(process.env.PORT || '3001', 10),
  // Default to 'production' so a deploy that forgets to set NODE_ENV gets the
  // safe behavior (generic error messages); dev must opt in explicitly.
  NODE_ENV: process.env.NODE_ENV || 'production',
  FRONTEND_URL: process.env.FRONTEND_URL || 'http://localhost:5173',

  // Zenon Node
  ZNN_NODE_URL: process.env.ZNN_NODE_URL || 'wss://node.zenonhub.io:35998',

  // Wallet
  KEYFILE_PATH: process.env.KEYFILE_PATH || '/etc/plasma-bot/wallet.json',
  KEYFILE_PASSWORD: process.env.KEYFILE_PASSWORD || '',

  // Admin
  ADMIN_API_KEY: process.env.ADMIN_API_KEY || '',

  // Telegram Bot
  TELEGRAM_BOT_TOKEN: process.env.TELEGRAM_BOT_TOKEN || '',
  TELEGRAM_RATE_LIMIT_PER_USER_MAX: parseInt(process.env.TELEGRAM_RATE_LIMIT_PER_USER_MAX || '4', 10),
  TELEGRAM_ALLOWED_CHAT_IDS: process.env.TELEGRAM_ALLOWED_CHAT_IDS
    ? process.env.TELEGRAM_ALLOWED_CHAT_IDS.split(',').map(Number)
    : [] as number[],

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
  AGENT_RATE_LIMIT_PER_IP_MAX: parseInt(process.env.AGENT_RATE_LIMIT_PER_IP_MAX || '10', 10),
  // Global daily cap on the keyless public agent endpoint. Per-IP limits are
  // bypassable (IPs and Zenon addresses are free/unlimited), so this is the
  // wallet's backstop against a multi-address/multi-IP drain. Counts agent
  // fuses (source: 'api') dispensed in the rolling 24h window.
  AGENT_GLOBAL_DAILY_MAX: parseInt(process.env.AGENT_GLOBAL_DAILY_MAX || '100', 10),
  // Per-source global daily caps for the other two entry points. Telegram
  // accounts and client IPs are both cheap to an attacker, so per-user/per-IP
  // limits alone don't bound total dispensation for these sources either.
  TELEGRAM_GLOBAL_DAILY_MAX: parseInt(process.env.TELEGRAM_GLOBAL_DAILY_MAX || '100', 10),
  WEB_GLOBAL_DAILY_MAX: parseInt(process.env.WEB_GLOBAL_DAILY_MAX || '200', 10),

  // How long to hold an in-memory QSR reservation after a fuse is sent.
  // zenon.send() returning does NOT mean the wallet balance has dropped yet —
  // the block must be produced into a momentum first. Holding the reservation
  // across this window prevents concurrent requests from over-spending against
  // a stale (pre-debit) balance read.
  RESERVATION_HOLD_MS: parseInt(process.env.RESERVATION_HOLD_MS || '30000', 10),

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
