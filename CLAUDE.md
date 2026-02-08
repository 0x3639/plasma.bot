# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Zenon Network Plasma Bot — a full-stack app where users request temporary plasma by fusing QSR from a backend-controlled wallet to their Zenon address. The bot uses balance-threshold unfusing (FIFO, oldest first) and tiered fuse amounts (20/80/120 QSR).

## Commands

### Development (run from project root)
```bash
# Install all dependencies (npm workspaces)
npm install

# Backend dev server (port 3001, hot reload via tsx watch)
cd backend && npm run dev

# Frontend dev server (port 5173, proxies /api to :3001)
cd frontend && npm run dev

# Backend production build
cd backend && npm run build && npm start

# Frontend production build
cd frontend && npm run build

# Frontend lint
cd frontend && npm run lint
```

### Utility Scripts
```bash
# Generate a test wallet keyfile
cd backend && npx tsx scripts/generate-wallet.ts

# Sync on-chain fusion entries into MongoDB (recovery)
cd backend && npx tsx scripts/sync-chain.ts
```

### Prerequisites
- MongoDB running (dev: `docker run -d --name plasma-bot-mongo -p 27017:27017 mongo:7`)
- `backend/.env` configured (see `.env.example`)

## Architecture

NPM workspaces monorepo: `backend/` (Express + TypeScript) and `frontend/` (Vite + React + Tailwind v4).

### Backend

**Startup sequence** (`src/index.ts`): MongoDB connect → Zenon SDK init (WebSocket) → wallet decrypt from keyfile → start crons → HTTP server.

**Key services:**
- `services/wallet.ts` — Decrypts keyfile (Argon2id + AES-256-GCM via SDK's `KeyFile`), holds KeyPair in memory. Password cleared from env after boot.
- `services/sendQueue.ts` — **All `zenon.send()` calls MUST go through `serializedSend()`**. Zenon requires sequential account blocks; this mutex prevents race conditions.
- `services/plasma.ts` — Fuse operations. Converts QSR from human units to base units (8 decimals).
- `services/unfuse.ts` — FIFO unfuse: when balance < threshold, unfuse oldest fusions (>12h) first, stop when balance >= threshold.
- `services/balance.ts` — QSR balance always queried live from the Zenon node, never from DB.
- `services/receiveTx.ts` — Auto-receive unreceived blocks (cancelled fusions return QSR this way).

**Cron cycle** (every 5 min via `cron/balanceMonitor.ts`): receive pending tx → reconcile fusion IDs → run unfuse if balance < threshold.

**Fusion ID reconciliation** (`cron/reconcile.ts`): `zenon.send()` returns `txHash`, but `plasma.cancel()` needs the on-chain `fusionId`. The reconciler queries `getEntriesByAddress()` and matches by beneficiary + amount.

**Rate limiting**: IP-based (configurable N per 24h via `express-rate-limit`) + address-based (one active fusion per address, checked against MongoDB).

**Admin routes** (`/api/admin/*`): Protected by `X-Admin-Key` header with timing-safe comparison. Disabled (403) if `ADMIN_API_KEY` not set.

### Frontend

Single-page React app. Data fetching via `@tanstack/react-query` with 30s auto-polling. Vite proxies `/api/*` to backend in dev.

Design: SYRIUS-inspired dark theme (#0a0a14 background, #00ff41 neon green accents). Custom theme variables defined in `src/index.css` using Tailwind v4 `@theme` directive.

### MongoDB Models

- **Fusion** — tracks active fusions. `fusionId` is null until reconciled with chain. `qsrAmount` stored in base units (8 decimals).
- **FuseRequest** — audit log of all requests with IP tracking for rate limiting.

## Important Patterns

- **Transaction serialization is mandatory**: Never call `zenon.send()` directly — always use `serializedSend()` from `services/sendQueue.ts`.
- **Balance is live-only**: The wallet's QSR balance is always queried from the Zenon node, never cached or stored in DB.
- **Threshold vs. fusing**: `BALANCE_THRESHOLD_QSR` only triggers unfusing. Users can fuse all the way to 0.
- **WebSocket resilience**: The SDK auto-reconnects, but there's a gap where `socket not ready` errors can occur. Route handlers that query the node should catch errors gracefully (return 503).
- **Addresses link to ZenonHub**: All displayed z1... addresses link to `https://zenonhub.io/explorer/account/{address}`.

## SDK Reference (znn-typescript-sdk)

Key imports: `Zenon`, `Address`, `KeyFile`, `KeyStore`, `KeyPair`, `AccountBlockTemplate`, `QSR_ZTS`, `Hash`.

Key methods:
- `zenon.embedded.plasma.fuse(beneficiary, amount)` — create fuse block
- `zenon.embedded.plasma.cancel(fusionId)` — create unfuse block
- `zenon.embedded.plasma.getEntriesByAddress(address)` — get fusion entries
- `zenon.ledger.getAccountInfoByAddress(address)` — get balance
- `zenon.ledger.getUnreceivedBlocksByAddress(address)` — get unreceived blocks
- `AccountBlockTemplate.receive(hash)` — create receive block
