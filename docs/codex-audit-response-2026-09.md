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

## Shared lifecycle

The web, agent-API and Telegram handlers now all delegate to `services/fuseExecutor.ts` for the
send/persist/release lifecycle, which is the "shared admission or lifecycle boundary" the audit
recommended for these invariants.

## Tests added

- `telegramCommands.test.ts` — uppercase alias rejected against DB, processing lock and chain state; canonical storage; concurrent burst bounded by the per-user max; sequential requests admit exactly the max; replies that reject never escape and never alter a completed request or double-release a reservation.
- `telegramBot.test.ts` — start resolves on `onLaunch`; failed/timed-out first launch rejects; loop death triggers relaunch with exponential backoff; explicit stop suppresses relaunch; non-throwing error handler registered.
- `fuseExecutor.test.ts` — success holds the reservation once; swept lease aborts without signing; queue-full and send-failure paths.
- `reconcile.test.ts` — refreshed lease survives the sweep; swept lease cannot be reacquired.
- `sendQueue.test.ts` — `beforeSend` ordering, hook failure does not poison the queue, depth bound and recovery.
- `routes.test.ts` — huge/oversized `page` values return 400; DB rejection returns the generic 500 on both listing routes.
