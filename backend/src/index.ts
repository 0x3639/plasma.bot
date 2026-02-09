import express from 'express';
import morgan from 'morgan';
import { CONFIG } from './config/index.js';
import { connectDatabase, disconnectDatabase } from './config/database.js';
import { setupSecurity } from './middleware/security.js';
import { errorHandler } from './middleware/errorHandler.js';
import { initializeWallet } from './services/wallet.js';
import { initializeZenon, clearZenonConnection } from './services/zenon.js';
import { startBalanceMonitor, stopBalanceMonitor } from './cron/balanceMonitor.js';
import { startReceiveMonitor, stopReceiveMonitor } from './cron/receiveMonitor.js';
import { logger } from './utils/logger.js';

import fuseRoutes from './routes/fuse.js';
import statusRoutes from './routes/status.js';
import statsRoutes from './routes/stats.js';
import healthRoutes from './routes/health.js';
import adminRoutes from './routes/admin.js';
import donationRoutes from './routes/donations.js';

const app = express();

// Security middleware
setupSecurity(app);

// Request logging
app.use(morgan('short', {
  stream: { write: (msg: string) => logger.info(msg.trim()) },
}));

// API routes
app.use('/api/fuse', fuseRoutes);
app.use('/api/fusions', statusRoutes);
app.use('/api/stats', statsRoutes);
app.use('/api/health', healthRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/donations', donationRoutes);

// Error handler (must be last)
app.use(errorHandler);

async function startup(): Promise<void> {
  logger.info('Starting Plasma Bot...');

  // 1. Connect to MongoDB
  await connectDatabase();

  // 2. Initialize Zenon SDK connection
  await initializeZenon();

  // 3. Load wallet from encrypted keyfile
  await initializeWallet();

  // 4. Start cron jobs
  startBalanceMonitor();
  startReceiveMonitor();

  // 5. Start HTTP server
  app.listen(CONFIG.PORT, () => {
    logger.info(`Plasma Bot API listening on port ${CONFIG.PORT}`);
  });
}

async function shutdown(): Promise<void> {
  logger.info('Shutting down...');

  stopBalanceMonitor();
  stopReceiveMonitor();
  clearZenonConnection();
  await disconnectDatabase();

  logger.info('Shutdown complete');
  process.exit(0);
}

// Graceful shutdown handlers
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

// Prevent unhandled errors from crashing the process
process.on('unhandledRejection', (reason) => {
  logger.error('Unhandled promise rejection', { error: reason });
});
process.on('uncaughtException', (error) => {
  logger.error('Uncaught exception -- exiting', { error });
  process.exit(1);
});

// Start
startup().catch((error) => {
  logger.error('Startup failed', { error });
  process.exit(1);
});
