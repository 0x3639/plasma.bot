# Telegram Bot Integration Plan

## Context

Add a Telegram bot to the Plasma Bot so users can fuse QSR via Telegram commands (DMs or group chats) instead of only through the web UI. The bot runs in the same container as the backend and reuses existing services directly (same process, no HTTP roundtrip).

## Commands

| Command | Description |
|---------|-------------|
| `/fuse 20 z1...` | Fuse 20 QSR (low tier) |
| `/fuse 80 z1...` | Fuse 80 QSR (medium tier) |
| `/fuse 120 z1...` | Fuse 120 QSR (high tier) |
| `/fuse health` | Bot health status (uptime, balance, active fusions) |
| `/fuse status` | List all active fusions (max 10, with total count) |
| `/fuse status z1...` | Fusions for a specific address |
| `/fuse` (no args) | Show usage/help |

## Architecture Decisions

### Same container, direct service calls
The bot runs inside the existing backend container and calls `fuseToAddress()`, `getQsrBalance()`, `tryReserveQsr()` etc. directly. This shares the in-memory QSR reservation counter with web requests, preventing double-spending across both interfaces. No extra ports, no inter-service auth, no additional Docker config.

### Library: Telegraf
TypeScript-native, middleware architecture, uses long-polling (no webhook server, no extra port needed). Outbound HTTPS only — works within the existing Docker `internal` network.

### Bot is optional
Only starts if `TELEGRAM_BOT_TOKEN` env var is set. Zero impact when disabled.

### Channel & DM policy
- **DMs (private chats)**: Always allowed — any user can DM the bot directly
- **Group chats**: Restricted to chat IDs listed in `TELEGRAM_ALLOWED_CHAT_IDS`. Bot silently ignores messages from unauthorized groups
- `TELEGRAM_ALLOWED_CHAT_IDS` is required when deploying to groups — empty means no groups allowed (DMs still work)

### Rate limiting
- **Per-user**: MongoDB-backed, counts FuseRequest docs with `source: 'telegram'` + matching `telegramUserId` in last 24h (default: 4/24h, configurable)
- **Per-address**: One active fusion per address — extracted into a shared function used by both web and Telegram

### Audit trail
FuseRequest model gains `source` ('web'|'telegram') and `telegramUserId` fields. All Telegram fuse requests are fully auditable.

### Token security (follows existing secrets pattern)
| Environment | Source | Storage |
|-------------|--------|---------|
| **Local dev** | `backend/.env` file | On-disk (gitignored) |
| **Production** | GitHub Secrets → `deploy.yml` | Shell env var only — passed via Docker Compose `${VAR}` substitution, **never written to disk** on the server |

This is identical to how `KEYFILE_PASSWORD` and `ADMIN_API_KEY` are handled.

## New Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `TELEGRAM_BOT_TOKEN` | Bot token from @BotFather (empty = bot disabled) | (empty) |
| `TELEGRAM_RATE_LIMIT_PER_USER_MAX` | Max fuse requests per Telegram user per 24h | `4` |
| `TELEGRAM_ALLOWED_CHAT_IDS` | Comma-separated group chat IDs (empty = DMs only) | (empty) |

## Files

### Modified
| File | Change |
|------|--------|
| `backend/package.json` | Add `telegraf` dependency |
| `backend/src/config/index.ts` | Add Telegram config properties |
| `backend/src/models/FuseRequest.ts` | Add `source`, `telegramUserId` fields + index |
| `backend/src/middleware/rateLimiter.ts` | Extract `checkAddressAvailability()` shared function |
| `backend/src/index.ts` | Add Telegram bot to startup/shutdown sequence |
| `backend/src/utils/logger.ts` | Add TELEGRAM_BOT_TOKEN to sensitive patterns |
| `docker-compose.yml` | Add TELEGRAM_BOT_TOKEN + TELEGRAM_ALLOWED_CHAT_IDS env vars |
| `.github/workflows/deploy.yml` | Add token/chat IDs to secrets + migration step |

### Created
| File | Purpose |
|------|---------|
| `backend/src/telegram/index.ts` | Bot lifecycle (start/stop) + chat filter middleware |
| `backend/src/telegram/commands.ts` | Command parsing and handlers |
| `backend/src/telegram/formatting.ts` | Telegram HTML message formatting |
| `backend/src/telegram/rateLimiter.ts` | Per-user rate limiting |
| `backend/scripts/add-telegram-fields.mjs` | Migration script |
