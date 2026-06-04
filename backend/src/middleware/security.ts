import helmet from 'helmet';
import cors from 'cors';
import express, { type Express, type Request } from 'express';
import { CONFIG } from '../config/index.js';

export function setupSecurity(app: Express): void {
  app.use(helmet({
    contentSecurityPolicy: {
      directives: { defaultSrc: ["'self'"] },
    },
    strictTransportSecurity: { maxAge: 31536000, includeSubDomains: true },
    frameguard: { action: 'deny' },
  }));

  // The public, machine-readable endpoints (agent fuse + stats) must be callable
  // cross-origin by browser/extension clients; every other endpoint stays locked
  // to FRONTEND_URL. A SINGLE cors delegate decides per request, so the same policy
  // is applied to both the preflight and the actual response.
  //
  // Note: stacking a permissive `app.use('/api/agent', cors({ origin: '*' }))`
  // before the global lock does NOT work — the global `cors()` still matches those
  // paths and runs afterward on the actual (non-preflight) request, overwriting
  // Access-Control-Allow-Origin back to FRONTEND_URL. The delegate avoids that by
  // never registering two cors middlewares for the same request.
  const PUBLIC_CORS_PATHS = ['/api/agent', '/api/stats'];
  app.use(
    cors<Request>((req, callback) => {
      if (PUBLIC_CORS_PATHS.some((p) => req.path.startsWith(p))) {
        callback(null, { origin: '*', methods: ['GET', 'POST'], allowedHeaders: ['Content-Type'] });
      } else {
        callback(null, { origin: CONFIG.FRONTEND_URL, methods: ['GET', 'POST'] });
      }
    }),
  );

  app.use(express.json({ limit: '1kb' }));

  // Trust proxy: Caddy overwrites X-Forwarded-For with CF-Connecting-IP,
  // so there's exactly 1 trusted hop (Caddy) between Cloudflare and Express.
  app.set('trust proxy', 1);
}
