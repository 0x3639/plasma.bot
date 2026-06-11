# Adversarial Security Audit — Plasma Bot

**Date:** 2026-05-29
**Branch:** `security-audit-2026-05`
**Scope:** Full codebase — backend (Express/TS), frontend (React/Vite), Telegram bot, infra config.
**Method:** Parallel adversarial review across auth/admin, input-validation/injection, crypto/secrets, business-logic/fund-safety, and frontend/Telegram. Every HIGH finding below was re-verified against source by hand.

This is an **adversarial** audit (what can an attacker do to drain/lock the wallet or bypass controls?), broader than a diff review. Findings are ordered by severity. Each notes whether a fix is applied on this branch.

---

## Threat model

The bot holds a hot wallet of real QSR and fuses it (locks 20/80/120 QSR for ~21h) to user-supplied Zenon addresses across three entry points that **share one in-memory reservation counter and one wallet**:

- `POST /api/fuse` — web UI (IP-limited 4/24h + 1 active fusion/address)
- `POST /api/agent/fuse` — "agent" API (IP-limited 10/24h + 1 active fusion/address)
- Telegram `/fuse` — per-user-limited

The economic controls are the only thing standing between an attacker and the wallet's QSR. The audit focused on whether those controls actually hold.

---

## HIGH-1 — `/api/agent/fuse` dispenses real on-chain QSR for free, with no payment verification

- **File:** `backend/src/routes/agentFuse.ts:77-151`; route wired at `backend/src/index.ts:40`
- **Category:** Missing authorization on a fund-spending endpoint / payment bypass
- **Confidence:** 9/10

`docs/402-payment-flow.md` specifies that agent fuses must be **paid** (HTTP 402 → ZNN invoice → on-chain payment verified → then fuse). That payment layer was never implemented — there is no invoice model, payment service, or payment-monitor cron in the codebase. The live endpoint takes `{ address, tier }` and immediately calls `fuseToAddress()` (`agentFuse.ts:120`), which executes a real `zenon.embedded.plasma.fuse()` locking up to 120 QSR. No payment header, invoice, on-chain receipt, or auth is checked.

**Exploit:** Zenon addresses are free and unlimited. An attacker generates N fresh addresses and (rotating across a small IP pool to beat the 10/IP/day cap) repeatedly POSTs to `/api/agent/fuse`, draining the wallet's entire spendable QSR into fusions on attacker-controlled addresses at zero cost. The endpoint is advertised to agents via `openapi.json`/`llms.txt`.

**Resolution (applied):** Product decision is to keep the endpoint **public with no API key or 402 gate**, so the fix is to bound the blast radius rather than gate access:
- **Global daily cap** (`AGENT_GLOBAL_DAILY_MAX`, default 100): a new `agentGlobalDailyLimiter` counts agent fuses (`source: 'api'`, including in-flight `processing`) in the rolling 24h window and 429s once the cap is hit. This is the hard backstop — per-IP limits don't bound total dispensation because IPs and addresses are both free to an attacker. The limiter **fails closed** (503) if the count can't be read.
- Combined with HIGH-2 (one in-flight request per address), HIGH-3 (reservation can't be out-run), and HIGH-4 (no phantom locks), the worst-case daily drain is now bounded to `AGENT_GLOBAL_DAILY_MAX × 120 QSR` instead of "entire wallet".

Operators should set `AGENT_GLOBAL_DAILY_MAX` to expected legitimate agent volume. The endpoint remains an unauthenticated faucet by design; the cap makes that economically survivable.

---

## HIGH-2 — No DB uniqueness on active fusions + TOCTOU address check → duplicate fusions per address

- **Files:** `backend/src/middleware/rateLimiter.ts:23-69`, `backend/src/routes/fuse.ts:18-28`, `backend/src/routes/agentFuse.ts:83-93`, `backend/src/models/Fusion.ts:64-65`
- **Category:** Race condition / anti-abuse bypass / fund drain
- **Confidence:** 8/10

`checkAddressAvailability()` reads for an existing `active` Fusion / `processing` FuseRequest, but the `processing` FuseRequest is only written **inside the handler, after** the middleware passes. Two concurrent requests for the same address both pass the check before either writes its record. The `Fusion` model has only a **non-unique** `{ beneficiary, status }` index (`Fusion.ts:65`) — nothing at the DB layer rejects a second active fusion.

**Exploit:** Fire many concurrent requests for one address (across `/api/fuse` and `/api/agent/fuse` simultaneously). All pass the availability gate, all fuse → multiple simultaneous active fusions on one address, multiplying QSR locked far beyond the one-per-address policy.

**Fix (applied):** Added a unique **partial index** on `FuseRequest { beneficiary }` where `status: 'processing'`. The `processing` audit record each handler already creates now doubles as a per-address mutex: a concurrent second request for the same address fails the insert with `E11000`, which all three entry points (`fuse.ts`, `agentFuse.ts`, `commands.ts`) catch and turn into a 429. A Fusion-level unique index was deliberately **not** used — an address can legitimately have multiple on-chain entries, and reconcile creates records for orphaned chain entries, so a hard `beneficiary` uniqueness constraint there would break legitimate reconciliation.

---

## HIGH-3 — Reservation released before the chain reflects the spend → wallet over-spend window

- **Files:** `backend/src/services/balance.ts:17-19`, `backend/src/routes/fuse.ts:82-85`, `backend/src/routes/agentFuse.ts:147-149`, `backend/src/telegram/commands.ts` (fuse finally block)
- **Category:** TOCTOU / fund safety
- **Confidence:** 8/10

The in-memory QSR reservation is released in a `finally` block the instant `fuseToAddress()` returns. But `zenon.send()` returning only means the block was *published* — the wallet's on-chain QSR balance does not drop until the fuse block is produced into a momentum (seconds–tens of seconds later). The comment "chain balance now reflects the result" (`fuse.ts:83`) is incorrect.

**Exploit:** Request A reserves 120, sends, releases 120 immediately. Before the node reflects the spend, `getQsrBalance()` still returns the pre-spend balance and `reservedQsr` is back to 0, so request B's `tryReserveQsr(120, staleBalance)` succeeds. The wallet issues more fuse blocks than its balance backs → failed/stuck account blocks that can wedge the serialized send pipeline.

**Fix (applied):** Hold the reservation past send completion — release on a timer longer than one momentum / inter-tx delay rather than synchronously in `finally`, so a concurrent request sees the reservation until a fresh balance read can reflect the debit.

---

## HIGH-4 — `fuseToAddress` records an `active` Fusion even when the on-chain fuse never lands

- **File:** `backend/src/services/plasma.ts:34-49`
- **Category:** State integrity / fund-safety
- **Confidence:** 7/10

`serializedSend()` resolves on a returned hash, not on-chain success. A fuse can be rejected (e.g. insufficient QSR after HIGH-3), yet `Fusion.create({ status: 'active' })` always runs. This phantom "active" fusion blocks the beneficiary from future legitimate fuses, is never matched by reconcile (`fusionId` stays `null` forever), and corrupts stats.

**Fix (applied):** Create the Fusion as `pending` and let reconcile promote it to `active` once a matching on-chain entry is confirmed; the unfuse/availability logic treats `pending` as occupying the address but distinguishes it from confirmed `active`.

---

## MEDIUM-1 — Reconcile matches chain entries by `(beneficiary, amount)` only → can bind/cancel the wrong fusion

- **File:** `backend/src/cron/reconcile.ts:40-57`
- **Category:** fusionId mis-association → unfuse the wrong fusion
- **Confidence:** 7/10

When two unreconciled DB fusions share beneficiary + tier amount (possible under HIGH-2, or a user fusing the same tier twice over time), reconcile binds the first chain `entryId` to the first DB record with no tie-break. A mis-bound `fusionId` means `runUnfuseCycle()` can cancel a *different* on-chain fusion than intended — reclaiming QSR from a fusion the user still expects to be active.

**Fix (applied):** Disambiguate using the fuse block hash (`txHash`) where the SDK exposes it, and tie-break remaining ambiguous matches deterministically by `fusedAt`, so the oldest DB record maps to the oldest matching chain entry.

---

## MEDIUM-2 — Telegram HTML replies are not escaped (defense-in-depth)

- **File:** `backend/src/telegram/formatting.ts:5-7, 25-38`
- **Category:** Output encoding / HTML injection (currently mitigated upstream)
- **Confidence:** 6/10 (real fragility, not currently exploitable)

All replies use `parse_mode: 'HTML'` and interpolate values straight into `<a>/<code>/<b>` tags with no escaping. Today this is safe only because every interpolated value is bech32/hex/enum-validated upstream. The moment any code path formats an unvalidated string (e.g. echoing user text in an error), it becomes HTML/phishing-link injection in bot messages.

**Fix (applied):** Add an `escapeHtml()` helper and apply it to every interpolated value, so safety is by construction rather than by caller discipline.

---

## MEDIUM-3 — Hardcoded wallet password in `generate-wallet.ts`

- **File:** `backend/scripts/generate-wallet.ts:12`
- **Category:** Key management / hardcoded credential
- **Confidence:** 8/10

`const PASSWORD = 'dev-password-do-not-use-in-production'` is committed to git. Any keyfile generated with it (the current dev wallet) can be decrypted offline by anyone with the repo + the keyfile, recovering the full mnemonic/private key. The password's encryption provides zero real protection.

**Fix (applied):** Read the password from an env var / interactive prompt (like `change-password.ts` already does); refuse to run with the old constant.

---

## OPERATIONAL — Live secrets present in local `backend/.env` (action required, not code-fixable)

- **File:** `backend/.env` (git-ignored, **not** committed — verified via `git log -S`)
- **Category:** Secrets at rest / key reuse
- **Severity:** HIGH if the value is reused in production

`backend/.env` contains a live `ADMIN_API_KEY` and a Google API key in plaintext. `.env` is correctly git-ignored and was never committed, so this is **not** a repo leak — but:

- **Rotate the `ADMIN_API_KEY` now** if this value is (or ever was) the production admin key. The admin endpoints (`/api/admin/receive`, `/api/admin/cycle`) trigger wallet operations. Confirm production injects a *different*, secret-managed key.
- **Remove the Google API key** from `.env` — it is unused anywhere in `src/` and is billable if abused. Rotate it.
- `chmod 600 backend/.env`.

This cannot be fixed in code by the audit; it is an operator action. Flagged here so it is not lost.

---

## H/M — Rate-limit IP bypass if the origin is reachable outside Cloudflare

- **Files:** `backend/src/middleware/security.ts:24` (`trust proxy: 1`), `backend/src/middleware/rateLimiter.ts:11-17, 72-85`, `Caddyfile`
- **Category:** Rate-limit bypass via spoofable `X-Forwarded-For`
- **Confidence:** 7/10 (infra-gated)

`trust proxy: 1` makes `req.ip` derive from `X-Forwarded-For`. Caddy sets `X-Forwarded-For` from `CF-Connecting-IP`. This is safe **only while every request transits Cloudflare**. The Caddyfile has no `trusted_proxies` / Cloudflare-IP allowlist, so if the origin's :443 is reachable directly from the internet, an attacker connects to the origin and sends an arbitrary `CF-Connecting-IP`, rotating it per request to defeat all per-IP limits (and poisoning the `FuseRequest.ipAddress` audit trail).

**Fix:** Infra — restrict origin :443 to Cloudflare CIDRs and/or add `trusted_proxies` (Cloudflare ranges) to the Caddy reverse_proxy; optionally a shared edge-secret header the app verifies. Documented in the audit-response notes; not a code change in this repo's app layer beyond the recommendation. Address-based limits (HIGH-2 fix) remain the real economic gate regardless.

---

## Verified NOT vulnerable (checked, no action)

- **Admin auth** (`middleware/adminAuth.ts`): SHA-256 + `timingSafeEqual`, length-safe, 403 when key unset. No bypass.
- **CORS** (`security.ts`): pinned to `FRONTEND_URL`, no `credentials:true`. No credentialed cross-origin.
- **NoSQL/operator injection**: blocked by `zod .strict()` + `z.string()`/`z.enum`/`z.coerce.number()` on all body/query/param inputs before any Mongoose query. No `$where`/selector injection reachable.
- **Address ReDoS**: `/^z1[a-z0-9]{38}$/` is linear/anchored/fixed-length. Body capped at 1 KB.
- **Frontend XSS**: no `dangerouslySetInnerHTML`/`innerHTML`/`eval`; all API data rendered as auto-escaped JSX; external links carry `rel="noopener noreferrer"`; no secrets in client bundle.
- **Telegram**: no shell/eval, token never logged, no admin/cancel/unfuse command exposed over the bot, message args are always primitive strings (no NoSQL injection).
- **Crypto core**: SDK uses AES-256-GCM with per-encryption random salt+nonce, GCM tag verification, Argon2id KDF, `crypto.randomBytes`. No nonce/IV reuse. No key material returned by any endpoint or error.
- **Logger**: redacts mnemonics/private keys/passwords/admin+telegram keys by regex and key-name, including in `Error.message`/`stack`.

---

## Fix status summary

| ID | Finding | Fix location | Status |
|----|---------|--------------|--------|
| HIGH-1 | Free agent fuse (no payment) | `rateLimiter.ts`, `agentFuse.ts`, config | applied (global cap; stays public by decision) |
| HIGH-2 | Duplicate fusions / TOCTOU | `Fusion.ts`, `FuseRequest.ts`, routes | applied |
| HIGH-3 | Early reservation release | `balance.ts`, routes, telegram | applied |
| HIGH-4 | Phantom active fusion | `plasma.ts`, reconcile, unfuse | applied |
| MED-1 | Reconcile wrong-fusion bind | `reconcile.ts`, `plasma.ts` | applied |
| MED-2 | Telegram HTML escaping | `formatting.ts` | applied |
| MED-3 | Hardcoded wallet password | `generate-wallet.ts` | applied |
| OPS | Live secrets in `.env` | operator action | flagged |
| H/M | XFF IP-spoof bypass | Caddy/infra | applied (Cloudflare Authenticated Origin Pulls mTLS in Caddyfile) |

---

# Re-audit addendum — 2026-06-10

A second adversarial pass over the codebase *with the fixes above applied*, run as
three parallel reviews (fund-safety/races, web/auth/injection, telegram/crypto/infra),
each finding re-verified against source before being fixed. All fixes below are
applied on this branch; `npm run build` and the full test suite (108 tests) pass.

## R-HIGH-1 — Agent global daily cap was read-then-act → a concurrent burst bypassed it

- **Files:** `backend/src/middleware/rateLimiter.ts`, `backend/src/routes/agentFuse.ts`
- The HIGH-1 cap was enforced only by middleware that did `countDocuments` *before*
  the handler inserted its `processing` record. N concurrent requests (fresh
  addresses, rotated IPs, single burst) all observed `count < cap` before any record
  committed — re-opening the unbounded-drain scenario the cap exists to prevent.
- **Fix:** the cap is now also re-checked **after** the request's own `processing`
  record is inserted (`confirmGlobalCapSlot`). Each request's post-insert count
  includes itself plus everything committed before it, so at most `cap` requests can
  observe `count <= cap`; losers are rolled back to `failed` (freeing their slot) and
  rejected with 429. The middleware pre-check remains as a cheap fast-path rejection.

## R-HIGH-2 — No global daily cap on the Telegram or web entry points

- **Files:** `backend/src/telegram/commands.ts`, `backend/src/routes/fuse.ts`,
  `backend/src/middleware/rateLimiter.ts`, `backend/src/config/index.ts`
- The HIGH-1 backstop counted only `source: 'api'`. Telegram had just a per-user
  limit (accounts are cheap/virtual-number scriptable) and web just the per-IP limit
  — total dispensation from those sources was unbounded by anything but wallet
  balance.
- **Fix:** per-source global daily caps for all three entry points
  (`AGENT_GLOBAL_DAILY_MAX`, `TELEGRAM_GLOBAL_DAILY_MAX` default 100,
  `WEB_GLOBAL_DAILY_MAX` default 200), all enforced with the same pre-check +
  post-create atomic confirmation, all failing closed (503 / error reply) when the
  cap can't be verified.

## R-MED-1 — A node/DB error after the `processing` insert stranded the address lock

- **Files:** `backend/src/routes/fuse.ts`, `backend/src/routes/agentFuse.ts`,
  `backend/src/telegram/commands.ts`, `backend/src/cron/reconcile.ts`,
  `backend/src/cron/balanceMonitor.ts`
- All three handlers called `getQsrBalance()` (a WebSocket node call that routinely
  throws during SDK reconnects) right after creating the `processing` record, outside
  any try/catch. A throw left the record `processing` forever: the unique partial
  index + availability check then blocked that address for up to the 90-day TTL, and
  (agent path) the record held a global-cap slot. Express 4 also doesn't forward
  async rejections, so the client got a hung connection instead of an error.
- **Fix:** every post-create step is wrapped; on failure the record is marked
  `failed` and a 503/error reply is sent. The non-duplicate `FuseRequest.create`
  error path now responds 503 instead of rethrowing, and the async address-limiter
  middlewares catch DB errors → 503. As defense in depth, a new sweeper
  (`failStaleProcessingRequests`, runs each 5-min cron cycle, DB-only so it works
  during node outages) fails any `processing` record older than 10 minutes, making
  the per-address lock self-healing across crashes.

## R-MED-2 — Reservation released instantly on a send "failure" that may still land

- **Files:** `backend/src/routes/fuse.ts`, `backend/src/routes/agentFuse.ts`,
  `backend/src/telegram/commands.ts`
- The HIGH-3 fix held the reservation 30s on success but released it synchronously
  on error. `serializedSend` throws on a 30s timeout — and a timed-out block can
  still be produced into a momentum seconds later, re-opening exactly the
  stale-balance over-spend window HIGH-3 closed.
- **Fix:** error paths now also use `scheduleReleaseQsr()`, holding the reservation
  across the confirmation window. (A definitively-failed send briefly over-reserves
  30s — fail-safe in the right direction.)

## R-MED-3 — Logger redaction only covered `message` and `error` fields

- **File:** `backend/src/utils/logger.ts`
- Winston spreads structured metadata as sibling top-level keys on `info`; only
  `info.message`/`info.error` were sanitized, so any call like
  `logger.info('...', { apiKey })` would write the secret verbatim.
- **Fix:** the sanitize format now runs over every enumerable field of `info`.

## R-LOW-1 — `getEntriesByAddress` used a single page; absence was treated as meaningful

- **Files:** `backend/src/services/plasma.ts` (new `getAllFusionEntries()`),
  `backend/src/cron/reconcile.ts`, `backend/src/services/unfuse.ts`,
  `backend/src/middleware/rateLimiter.ts`
- All callers fetched only page 0 (1024 entries). Beyond 1024 simultaneous fusions:
  unfuse would mark off-page fusions `unfused` **without sending a cancel** (silently
  stranding QSR), reconcile would fail landed pendings as "never landed" (freeing the
  address for a duplicate fuse), and the availability chain-fallback would miss
  entries. Latent today (needs >1024 active entries) but silent and incorrect.
- **Fix:** shared `getAllFusionEntries()` pages until exhausted and **throws** rather
  than return a partial list, so consumers abort instead of acting on partial data.
  Reconcile's stale-pending sweep now also runs on an empty (but successful) chain
  query, so a never-landed pending can't lock its address forever when the wallet has
  zero entries.

## R-LOW-2 — Error responses defaulted to echoing internals

- **Files:** `backend/src/middleware/errorHandler.ts`, `backend/src/config/index.ts`
- `errorHandler` returned raw `err.message` whenever `NODE_ENV !== 'production'`, and
  the config default was `development` — a deploy that forgot to set `NODE_ENV`
  leaked internal error strings.
- **Fix:** `NODE_ENV` now defaults to `production`, and the handler echoes
  `err.message` only on explicit `development`.

## R-LOW-3 — Deploy workflow wrote secrets through an unquoted heredoc

- **File:** `.github/workflows/deploy.yml`
- `.env.secrets` was written with `<< SECRETSEOF` (unquoted), so the remote shell
  re-expanded `$`, backticks and `$(...)` inside secret values — silently corrupting
  strong random passwords or, worst case, executing their content on the deploy host.
  (`.env.production` already used the quoted form.)
- **Fix:** quoted the delimiter (`<< 'SECRETSEOF'`); values are written literally.

## Re-verified, still NOT vulnerable

- CORS pinned to `FRONTEND_URL`, no credentials; no per-path wildcard delegate in the tree.
- No NoSQL operator injection: every request value reaching a query is zod-validated
  (`.strict()`, regex/enum/coerced-number) or `Address.parse`d first.
- No PII in public routes: `FuseRequest` (IPs, telegram IDs) is never returned by any endpoint.
- Admin auth (SHA-256 + `timingSafeEqual`), logger key-name redaction, frontend (no
  `dangerouslySetInnerHTML`/secrets), Docker (non-root, `no-new-privileges`, mongo not
  exposed), workflow permissions (`contents: read`), Telegram HTML escaping — all sound.
- XFF spoofing is closed at the infra layer: Caddy now requires Cloudflare
  Authenticated Origin Pulls (mTLS) and overwrites `X-Forwarded-For` from
  `CF-Connecting-IP` with `trust proxy: 1`.

## Re-audit fix status

| ID | Finding | Status |
|----|---------|--------|
| R-HIGH-1 | Global cap TOCTOU burst bypass | applied + tested |
| R-HIGH-2 | No telegram/web global cap | applied + tested |
| R-MED-1 | Stranded `processing` lock / hung responses | applied + tested (sweeper) |
| R-MED-2 | Reservation freed on ambiguous send failure | applied |
| R-MED-3 | Logger meta fields unredacted | applied |
| R-LOW-1 | Single-page chain entry reads | applied |
| R-LOW-2 | Error-message echo by default | applied |
| R-LOW-3 | Unquoted secrets heredoc | applied |
