# Security Audit — Zenon Plasma Bot

**Date:** 2026-03-17
**Scope:** Full codebase — agent API, web API, Telegram bot, infrastructure
**Branch:** `security/audit-hardening`

---

## Findings Summary

| # | Severity | Title | Status |
|---|----------|-------|--------|
| 1 | CRITICAL | Rate limit bypass via IP spoofing (`trust proxy: 2`) | **Fixed** |
| 2 | HIGH | Unreceived blocks capped at 50 (no pagination) | **Fixed** |
| 3 | MEDIUM | Agent endpoint accepts any Content-Type | **Fixed** |
| 4 | LOW | Zod schema allows extra fields (no `.strict()`) | **Fixed** |
| 5 | LOW | Docker missing `no-new-privileges` + resource limits | **Fixed** |
| 6 | MEDIUM | CI/CD secrets exported as shell env vars | **Fixed** |
| 7 | — | Balance race condition in `tryReserveQsr` | **Not a bug** |
| 8 | — | Wallet private key in memory | **Accepted risk** |
| 9 | — | Admin auth timing | **Not a bug** |
| 10 | — | CSRF on API endpoints | **Not applicable** |
| 11 | — | Wallet address in `/api/stats` | **Intentional** |

---

## Detailed Findings

### 1. CRITICAL — Rate Limit Bypass via IP Spoofing

**File:** `backend/src/middleware/security.ts:23`

**Problem:** `app.set('trust proxy', 2)` tells Express to trust the 2nd-from-right entry in the `X-Forwarded-For` header chain. An attacker can inject a fake `X-Forwarded-For` header with arbitrary IPs, making Express extract the attacker-chosen IP. This completely bypasses all IP-based rate limiting.

**Root cause:** The Caddyfile **overwrites** `X-Forwarded-For` with `{header.CF-Connecting-IP}` (Cloudflare's real client IP). This means Caddy is the only trusted proxy hop — the correct value is `1`, not `2`.

**Fix:** Changed `trust proxy` from `2` to `1`.

**Impact:** Without this fix, an attacker could fuse unlimited plasma by rotating spoofed IPs.

---

### 2. HIGH — Unreceived Blocks Capped at 50

**File:** `backend/src/services/receiveTx.ts`

**Problem:** `getUnreceivedBlocksByAddress(address, 0, 50)` fetches at most 50 unreceived blocks. If more accumulate (node downtime, mass cancellations), only 50 are processed per 5-minute cron cycle. Since balance is derived from on-chain state, unreceived QSR returns are invisible to the balance check, making the wallet appear to have less QSR than it actually does. This could trigger unnecessary unfusing or reject valid fuse requests.

**Fix:** Replaced single fetch with a pagination loop. Always fetches page 0 (received blocks disappear from the list). Safety cap at 20 pages (1000 blocks) with a warning log if hit.

---

### 3. MEDIUM — Agent Endpoint Accepts Any Content-Type

**File:** `backend/src/routes/agentFuse.ts`

**Problem:** The agent API (`POST /api/agent/fuse`) doesn't enforce `Content-Type: application/json`. While `express.json()` only parses `application/json` bodies (so other content types result in `undefined` body, caught by Zod), returning a proper `415 Unsupported Media Type` is the correct behavior for a machine-readable API. It also prevents malformed requests from counting against the rate limit quota.

**Fix:** Added `requireJson` middleware as the first handler in the chain, before the rate limiter. Returns `415 UNSUPPORTED_MEDIA_TYPE`.

---

### 4. LOW — Zod Schema Allows Extra Fields

**File:** `backend/src/middleware/validate.ts`

**Problem:** `fuseRequestSchema` uses `z.object()` without `.strict()`, which silently strips unrecognized fields. This is a defense-in-depth concern — extra fields could indicate a confused client, payload stuffing, or probing.

**Fix:** Added `.strict()` to the schema. Now returns a validation error if extra fields are present. Applies to both the web and agent endpoints.

---

### 5. LOW — Docker Missing Security Hardening

**File:** `docker-compose.yml`

**Problem:** Docker containers run without `no-new-privileges` restriction and without memory limits. A compromised process could escalate privileges via setuid binaries, and a memory leak or attack could exhaust host resources.

**Fix:**
- Added `security_opt: [no-new-privileges:true]` to all 3 services (mongodb, backend, caddy)
- Added memory limits: 512M for mongodb, 256M for backend, 128M for caddy

---

### 6. MEDIUM — CI/CD Secrets Exported as Shell Environment Variables

**File:** `.github/workflows/deploy.yml`

**Problem:** Secrets were `export`ed as shell environment variables during deploy. This means they were visible in `/proc/<pid>/environ` for the duration of the SSH session, and any child process inherits them. If any command in the deploy script logs its environment or crashes with a core dump, secrets could leak.

**Fix:** Secrets are now written directly to `.env.secrets` (chmod 600) and loaded via docker-compose `env_file`. No more shell-level `export` of secret values. The `environment:` block was removed from the backend service in docker-compose.yml.

---

## Accepted Risks & Non-Issues

### 7. Balance Race Condition in `tryReserveQsr` — Not a Bug

`tryReserveQsr` checks balance and reserves atomically using an in-memory counter. Two concurrent requests could both pass the balance check if the counter hasn't been decremented yet. However:
- The reservation is an in-memory atomic operation (single-threaded Node.js event loop)
- The actual on-chain fuse is serialized through `serializedSend()`
- If the on-chain transaction fails, the reservation is released in the `finally` block
- Worst case: a fuse succeeds when balance is slightly below threshold, which only affects when unfusing triggers — not a security issue

### 8. Wallet Private Key in Memory — Accepted Risk

The wallet's `KeyPair` is held in memory after decryption at startup. The password is cleared from `process.env` after boot. This is inherent to the application's design — the bot must sign transactions autonomously. Mitigations in place:
- Password cleared from env after first use
- Docker `no-new-privileges` prevents privilege escalation
- Container runs as non-root user
- Keyfile mounted read-only
- The host keyfile is stored in `/etc/plasma-bot/` with restricted permissions

Alternatives like HSMs or remote signing are out of scope for this project's threat model.

### 9. Admin Auth Timing — Not a Bug

Admin routes use `crypto.timingSafeEqual` for API key comparison (`backend/src/middleware/admin.ts`). This already prevents timing attacks. The early return when `ADMIN_API_KEY` is not configured (403) is not a timing concern since it doesn't reveal information about the key.

### 10. CSRF on API Endpoints — Not Applicable

The API uses `express.json()` with a 1KB limit and CORS restricted to the configured frontend origin. Browser-based CSRF attacks cannot set `Content-Type: application/json` via form submissions, and the CORS policy blocks cross-origin fetch/XHR. The agent API additionally requires `Content-Type: application/json` (enforced by the new `requireJson` middleware). No CSRF tokens are needed.

### 11. Wallet Address in `/api/stats` — Intentional

The bot's wallet address is exposed in the stats endpoint. This is by design — the address is public on the Zenon blockchain and links to ZenonHub for transparency. It contains no sensitive information.

---

## Recommendations for Future Work

- **Rate limit persistence:** Current rate limiting is in-memory (`express-rate-limit`). A restart resets all counters. Consider Redis-backed rate limiting if abuse becomes an issue.
- **Structured logging audit:** Verify no sensitive data (IPs beyond rate limiting, wallet details) is logged at INFO level.
- **Dependency audit:** Run `npm audit` regularly; pin major versions in production.
