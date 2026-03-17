import { Router } from 'express';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join, resolve } from 'path';

const router = Router();

// Resolve to backend/src/openapi.json from the package root.
// Works in both dev (running from src/) and prod (running from dist/)
// because the JSON file lives at backend/src/openapi.json in both cases.
const __filename = fileURLToPath(import.meta.url);
const packageRoot = resolve(dirname(__filename), '..', '..');
const spec = JSON.parse(readFileSync(join(packageRoot, 'src', 'openapi.json'), 'utf-8'));

router.get('/', (_req, res) => {
  res.json(spec);
});

export default router;
