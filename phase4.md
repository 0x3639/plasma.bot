# Phase 4: Testing Plan

## Context

Testing plan for the plasma.bot backend. Security audit & refactor is complete (merged in `9e162ee`). Uses Vitest + mongodb-memory-server + supertest.

## Setup

### Install dev dependencies (in `backend/`)
```
vitest @vitest/coverage-v8 mongodb-memory-server supertest @types/supertest
```

### Create `backend/vitest.config.ts`
- `root: 'src'`, `include: ['__tests__/**/*.test.ts']`
- `globalSetup` for MongoMemoryServer lifecycle
- `setupFiles` for per-file Mongoose connect/clean/disconnect
- `pool: 'forks'` (isolates module-level singletons like `reservedQsr`, `lock`)
- Coverage: v8 provider, include `services/`, `middleware/`, `routes/`, `utils/`, `cron/`

### Add scripts to `backend/package.json`
- `test`, `test:watch`, `test:coverage`

### Test setup files
- `src/__tests__/setup/globalSetup.ts` — start/stop MongoMemoryServer, export URI via env var
- `src/__tests__/setup/setupEach.ts` — Mongoose connect in `beforeAll`, clean collections in `afterEach`, disconnect in `afterAll`
- `src/__tests__/setup/mocks.ts` — shared mock factories: `createMockZenon()`, `createMockAddress()`, `createMockKeyPair()`, `createMockAccountInfo(qsr)`, `createMockFusionEntry(overrides)`

## Minimal source changes for testability

- **`services/balance.ts`** — add `_resetForTesting()` to zero out `reservedQsr`
- **`utils/logger.ts`** — export `sanitize` function (currently module-private)

## Test file structure

```
backend/src/__tests__/
├── setup/
│   ├── globalSetup.ts
│   ├── setupEach.ts
│   └── mocks.ts
├── unit/
│   ├── validation.test.ts        (Zod schema + isValidAddressFormat)
│   ├── balance.test.ts           (reserve/release/getAvailable/canAfford)
│   ├── sendQueue.test.ts         (mutex serialization, error recovery, 2s delay)
│   ├── adminAuth.test.ts         (timing-safe key comparison)
│   ├── rateLimiter.test.ts       (3-layer: DB active + in-flight + chain fallback)
│   ├── logger.test.ts            (sensitive data sanitization)
│   ├── unfuse.test.ts            (FIFO order, expirationHeight, threshold stop)
│   ├── reconcile.test.ts         (beneficiary+amount matching, dedup)
│   ├── plasma.test.ts            (fuseToAddress: block creation, DB record)
│   └── receiveTx.test.ts         (receiveAllPending: iteration, error handling)
├── integration/
│   ├── fuse.route.test.ts        (POST /api/fuse full middleware chain)
│   ├── status.route.test.ts      (GET /api/fusions, GET /api/fusions/:address)
│   ├── stats.route.test.ts       (GET /api/stats)
│   ├── health.route.test.ts      (GET /api/health)
│   ├── admin.route.test.ts       (admin auth + receive/cycle endpoints)
│   └── fullCycle.test.ts         (fuse -> reconcile -> unfuse end-to-end)
└── security/
    └── security.test.ts          (CORS, Helmet, JSON limit, error masking)
```

## Mocking strategy

| Module | Strategy |
|--------|----------|
| `services/zenon.ts` | **Always mocked** — requires live WebSocket |
| `services/wallet.ts` | **Always mocked** — requires real keyfile |
| `services/sendQueue.ts` | Tested directly in its own test; mocked elsewhere |
| `services/balance.ts` | Tested directly in its own test; mocked in integration tests |
| MongoDB | **Real** via mongodb-memory-server |

Integration tests use a `createTestApp()` factory that composes the Express app from modules (avoids importing `index.ts` which starts crons/connections).

## Key test cases (~135 total)

### Unit — validation.test.ts (~12 cases)
- Valid z1 address (40 chars, lowercase alphanumeric) accepted
- Rejects: missing z1, uppercase, too short/long, empty, special chars, spaces
- Zod: valid body, missing address/tier, invalid tier, extra fields stripped, numeric tier

### Unit — balance.test.ts (~12 cases)
- Reservation: starts at 0, accumulates, releases, floors at 0 on over-release
- getQsrBalance: null accountInfo -> 0, converts base units correctly
- canAffordFusion: respects reservations, exact boundary
- getAvailableQsr: balance minus reserved, floors at 0

### Unit — sendQueue.test.ts (~5 cases)
- Sequential execution of concurrent sends
- Lock recovery after error (next send still works)
- 2-second inter-TX delay enforced

### Unit — adminAuth.test.ts (~5 cases)
- 403 when ADMIN_API_KEY unconfigured
- 401 missing/wrong header
- Passes with correct key
- Handles different-length keys safely

### Unit — rateLimiter.test.ts (~7 cases)
- next() when clean DB
- 429 on active fusion, 429 on processing request, 429 on chain match
- Graceful fallback when chain check fails
- Allows unfused-status addresses

### Unit — logger.test.ts (~8 cases)
- Redacts mnemonic phrases, KEYFILE_PASSWORD patterns
- Redacts object keys: password, mnemonic, privatekey, secret
- Passes non-sensitive strings unchanged
- Handles null/undefined

### Unit — unfuse.test.ts (~10 cases)
- No-op when balance above threshold
- FIFO order (oldest fusedAt first)
- Skips non-revocable (expirationHeight > currentHeight)
- Marks chain-missing fusions as unfused
- Stops once expected balance >= threshold
- Continues after individual cancel errors
- getNextUnfuseTime estimates correctly

### Unit — reconcile.test.ts (~6 cases)
- Matches by beneficiary+amount, stores fusionId+expirationHeight
- Deduplicates already-used fusionIds
- Handles empty/partial chain responses

### Unit — plasma.test.ts (~6 cases)
- Creates Fusion in DB with correct fields (tier, qsrAmount in base units, txHash)
- Calls zenon.embedded.plasma.fuse with correct address
- Propagates sendQueue errors

### Unit — receiveTx.test.ts (~5 cases)
- Returns 0 when no unreceived blocks
- Receives each block, continues after individual failures

### Integration — fuse.route.test.ts (~10 cases)
- 200 success, 400 invalid input, 503 insufficient QSR, 429 duplicate address
- Verifies FuseRequest audit trail, QSR reservation released on failure

### Integration — routes (stats, status, health, admin) (~15 cases)
- Stats: correct aggregation, tier availability based on balance
- Status: pagination, address filtering, excludes non-active properly
- Health: ok status with balance/count
- Admin: auth enforcement, receive/cycle endpoints

### Integration — fullCycle.test.ts (~4 cases)
- Fuse -> reconcile -> unfuse lifecycle
- FIFO ordering across multiple fusions

### Security — security.test.ts (~8 cases)
- Helmet headers present, X-Powered-By removed
- CORS allows FRONTEND_URL, rejects unknown origins
- JSON body >1kb rejected
- Error details hidden in production mode

## Implementation order

1. **Infrastructure** — deps, vitest config, setup files, mock factory
2. **Pure unit tests** — validation.test.ts, logger.test.ts
3. **Service unit tests** — balance, sendQueue, adminAuth, plasma, receiveTx
4. **Complex unit tests** — rateLimiter, reconcile, unfuse
5. **Integration tests** — createTestApp, then health -> stats -> status -> admin -> fuse -> fullCycle
6. **Security tests** — headers, CORS, body limit, error masking
7. **Coverage report** — `npm run test:coverage`
