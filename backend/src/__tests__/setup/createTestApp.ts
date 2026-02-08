import express from 'express';
import { setupSecurity } from '../../middleware/security.js';
import { errorHandler } from '../../middleware/errorHandler.js';

import fuseRoutes from '../../routes/fuse.js';
import statusRoutes from '../../routes/status.js';
import statsRoutes from '../../routes/stats.js';
import healthRoutes from '../../routes/health.js';
import adminRoutes from '../../routes/admin.js';

/**
 * Creates a test Express app with all routes but no startup side-effects
 * (no cron jobs, no DB connection, no wallet/zenon initialization).
 */
export function createTestApp() {
  const app = express();
  setupSecurity(app);

  app.use('/api/fuse', fuseRoutes);
  app.use('/api/fusions', statusRoutes);
  app.use('/api/stats', statsRoutes);
  app.use('/api/health', healthRoutes);
  app.use('/api/admin', adminRoutes);

  app.use(errorHandler);
  return app;
}
