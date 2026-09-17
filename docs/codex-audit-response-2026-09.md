# Codex Security Audit Response — 2026-09

Audit: Codex Daybreak static review of revision `328e0b2` (6 findings: 3 medium, 3 low).
All six were accepted and remediated on branch `fix/codex-security-audit-2026-09`.

| # | Finding | Severity | Fix |
|---|---------|----------|-----|
| 1 | Uppercase Telegram addresses bypass the one-fusion limit | Medium | Telegram `/fuse` and `/fuse status` canonicalize via `canonicalizeAddress()` (`Address.parse(x).toString()`) before every check, lock, record and reply. `fuseToAddress` stores the canonical form for every entry point. `scripts/canonicalize-addresses.mjs` lowercases legacy records and runs in the deploy migration step. |
| 2 | One failed Telegram reply can stop the bot for every user | Medium | `bot.catch()` installs a logging (non-throwing) update-error handler. Every reply is best-effort (`reply()` never rejects) and `handleFuseCommand` is its own error boundary. The command handler is detached so a queued fuse cannot stall the polling batch. `startTelegramBot` now uses Telegraf's `onLaunch` callback (polling-mode `launch()` never resolves, so the old 15s race always logged a spurious failure) and supervises the loop: if it ends while not stopped, a fresh instance is launched with 1s→60s exponential backoff. |
| 3 | Concurrent Telegram commands exceed the per-user daily quota | Medium | `confirmTelegramUserSlot()` re-counts the user's requests after the `processing` record is inserted (same count-after-insert argument as the global cap): at most `max` requests can observe `count <= max`. Losers are rolled back to `rate_limited`, which frees their address lock and global slot and is excluded from the user count so a burst does not burn remaining quota. |
| 4 | The stale sweeper releases quota and address locks for live queued sends | Low | Processing leases are revalidated inside the send-queue slot (`assertFuseLeaseHeld`, via `serializedSend`'s new `beforeSend` hook): if the sweeper already released the lease, nothing is signed and the reservation is released immediately. The lease check bumps `updatedAt`, and the sweeper now keys off `updatedAt`, so a job mid-send is never released. The send queue is bounded (`MAX_QUEUE_DEPTH = 50`) so callers get a fast `503 SERVICE_BUSY` instead of waiting past the lease window. |
| 5 | Oversized pagination values leave fusion-list requests unanswered | Low | `page` is bounded by `CONFIG.MAX_PAGE_NUMBER` (10 000), keeping `skip` a safe integer. Both listing routes are wrapped in `asyncHandler`, which forwards rejections to the error middleware (generic 500). |
| 6 | A failed Telegram reply corrupts completed-fusion accounting | Low | Transaction outcome and notification are separated: `executeFuse()` settles record state and the reservation before any reply is attempted. Reservations are owned tokens (`QsrReservation`) whose `release()` / `scheduleRelease()` are idempotent, so no path can decrement the shared counter twice. |

## Round 2 (Codex re-review of round 1)

| Finding | Fix |
|---------|-----|
| Deploy race: the previous backend container keeps serving old (non-canonicalizing) code while the canonicalization migration runs, so it can write an uppercase record the migration never sees. | `canonicalizeStoredAddresses()` now also runs at backend startup, after the DB connect and before any entry point is served; startup fails closed if it errors. The deploy migration is kept as an explicit, observable step. |
| Detached Telegram command handlers remove the polling batch's back-pressure, leaving pre-admission DB/node work unbounded. | `handleFuseCommand` bounds concurrency: at most `MAX_IN_FLIGHT_COMMANDS` (16) commands in flight (extra callers get an immediate "busy" reply and no work is done) and at most one in-flight command per Telegram user. `confirmTelegramUserSlot` stays as the durable DB-level guarantee. |
| A launch timeout cannot stop Telegraf while `getMe()` is pending, so a timed-out instance could later become an untracked poller; relaunches had no start timeout. | Every launch (first and relaunch) goes through `launchAndAwaitStart` with the same timeout. A launch that fails or times out is *abandoned*: its `onLaunch` hook stops the instance as soon as Telegraf's polling object exists, so it can never poll untracked. |

## Round 3 (Codex re-review of round 2)

| Finding | Fix |
|---------|-----|
| Overload/duplicate-user rejection replies ran before admission accounting and were unbounded (P3). | `rejectCommand()` coalesces to one pending rejection reply per user and caps total pending rejection replies at `MAX_IN_FLIGHT_REJECTION_REPLIES` (8); anything beyond is dropped without starting a network operation. Rejection logging is throttled to one line per 10s with a dropped count. |
| `started` was derived from Telegraf's `onLaunch`, which fires before `deleteWebhook`/`startPolling`; abandonment retries were time-boxed, and a stop during the first launch was not handled. | Readiness is now the instance's first real `getUpdates` request, observed through the public `telegram.callApi` entry point. At that moment the polling object exists, so an abandoned launch is stopped deterministically (no retry budget); if the launch ends first there is nothing to stop. `startTelegramBot` abandons the instance if `stopTelegramBot()` ran while it was launching. |
| OpenAPI/README/llms.txt missed emitted codes and the pagination bound. | Added `415 UNSUPPORTED_MEDIA_TYPE`, `GLOBAL_LIMIT_REACHED` under 429, `SERVICE_UNAVAILABLE`, and `page.maximum = 10000`. A contract test now (a) asserts every `code:` literal the agent route can emit is declared in `openapi.json`, (b) asserts README and llms.txt list every declared code, (c) checks the page maximum against `CONFIG`, and (d) exercises each status end-to-end. |
| Nit: queue bound did not guarantee draining inside the lease. | `MAX_QUEUE_DEPTH` is now 15, sized against the worst-case 32s/job so a full queue drains in 8 min < the 10-minute lease. |
| Nit: collision-failed records stayed uppercase. | They are lowercased in the same write (the unique partial index no longer applies once the record is failed). |

## Shared lifecycle

The web, agent-API and Telegram handlers now all delegate to `services/fuseExecutor.ts` for the
send/persist/release lifecycle, which is the "shared admission or lifecycle boundary" the audit
recommended for these invariants.

## Tests added

- `telegramCommands.test.ts` — uppercase alias rejected against DB, processing lock and chain state; canonical storage; a one-user burst is rejected up front (one in-flight command per user); the global in-flight bound rejects extra commands without doing any work; a flood of 50 rejections with replies that never settle starts at most 8 replies, one per user, and drops the rest; sequential requests admit exactly the max; replies that reject never escape and never alter a completed request or double-release a reservation.
- `telegramBot.test.ts` — the fake models Telegraf's real phases (`getMe`/`onLaunch`, then `deleteWebhook`, then first `getUpdates`); start resolves only on the first `getUpdates`; failed/timed-out first launch rejects; a timed-out instance is stopped the instant it starts polling, even 20 minutes later; a stop during the initial launch prevents polling; relaunches honour the start timeout; loop death triggers relaunch with exponential backoff and no unhandled rejection; explicit stop suppresses relaunch; non-throwing error handler registered.
- `telegramRateLimiter.test.ts` — concurrent post-insert confirmations admit at most the per-user max; sequential admit exactly the max; `rate_limited` rollbacks do not consume quota.
- `canonicalizeRecords.test.ts` — startup canonicalization of both collections; colliding processing lock is failed and lowercased; idempotent no-op.
- `agentFuseContract.test.ts` — OpenAPI/README/llms.txt contract checks and one request per emitted status/code.
- `fuseExecutor.test.ts` — success holds the reservation once; swept lease aborts without signing; queue-full and send-failure paths.
- `reconcile.test.ts` — refreshed lease survives the sweep; swept lease cannot be reacquired.
- `sendQueue.test.ts` — `beforeSend` ordering, hook failure does not poison the queue, depth bound and recovery.
- `routes.test.ts` — huge/oversized `page` values return 400; DB rejection returns the generic 500 on both listing routes.
