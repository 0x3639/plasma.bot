import { Router } from 'express';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join, resolve } from 'path';

const router = Router();

// Resolve from the backend package root so it works in both dev (src/) and prod (dist/)
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const packageRoot = resolve(__dirname, '..', '..');
const specPath = join(packageRoot, 'src', 'openapi.json');
const spec = JSON.parse(readFileSync(specPath, 'utf-8'));

router.get('/', (_req, res) => {
  res.json(spec);
});

export default router;
