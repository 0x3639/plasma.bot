import { Telegraf, type Context } from 'telegraf';
import { CONFIG } from '../config/index.js';
import { handleFuseCommand } from './commands.js';
import { logger } from '../utils/logger.js';

let bot: Telegraf | null = null;
let stopped = false;

const LAUNCH_TIMEOUT_MS = 15_000;
const RESTART_BACKOFF_MIN_MS = 1_000;
const RESTART_BACKOFF_MAX_MS = 60_000;
// A polling run that lasted at least this long before ending is considered to
// have been healthy; the next restart starts from the minimum backoff again.
const HEALTHY_RUN_MS = 5 * 60 * 1000;
function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    if (typeof timer.unref === 'function') timer.unref();
  });
}

/**
 * Update-error handler. Telegraf's default rethrows, which rejects the
 * polling batch and stops the long-polling loop for every user; ours logs and
 * returns so one bad update (e.g. a reply to a user who blocked the bot)
 * cannot take the Telegram interface down.
 */
export function telegramErrorHandler(error: unknown, ctx: Context): void {
  logger.error('Unhandled Telegram update error', {
    error,
    updateId: ctx.update?.update_id,
    chatId: ctx.chat?.id,
    telegramUserId: ctx.from?.id,
  });
}

/**
 * Build a configured (not yet launched) bot instance.
 */
export function createBot(token: string = CONFIG.TELEGRAM_BOT_TOKEN): Telegraf {
  const instance = new Telegraf(token);

  // Chat filter middleware: allow DMs always, restrict groups to allowed list
  instance.use(async (ctx, next) => {
    const chatType = ctx.chat?.type;

    // Private chats (DMs) are always allowed
    if (chatType === 'private') {
      return next();
    }

    // Group/supergroup chats: check allow list
    if (chatType === 'group' || chatType === 'supergroup') {
      const chatId = ctx.chat?.id;
      if (chatId && CONFIG.TELEGRAM_ALLOWED_CHAT_IDS.includes(chatId)) {
        return next();
      }
      // Silently ignore unauthorized groups
      return;
    }

    // Ignore channels and other chat types
  });

  // Register the /fuse command. The handler is detached: a fuse can wait in
  // the send queue for a while, and Telegraf awaits the whole polling batch
  // before fetching the next one, so awaiting it here would stall every other
  // user's updates (and trip Telegraf's handler timeout). handleFuseCommand
  // never rejects — it is its own error boundary — and bounds its own
  // concurrency (MAX_IN_FLIGHT_COMMANDS) since the batch no longer does.
  instance.command('fuse', (ctx) => {
    void handleFuseCommand(ctx);
  });

  instance.catch(telegramErrorHandler);

  return instance;
}

interface Launch {
  instance: Telegraf;
  /** Resolves once the instance has issued its first getUpdates call. */
  started: Promise<void>;
  /** Settles when the polling loop exits (normally after stop, or with its error). */
  ended: Promise<void>;
}

/**
 * Give up on an instance we no longer track (its launch timed out or failed
 * before it started polling, or the bot was stopped while it was launching).
 *
 * `launch()` may still be mid-flight (a slow `getMe`/`deleteWebhook`) and will
 * go on to start polling later, so an abandoned instance must be stopped the
 * moment it actually starts polling or it would become an untracked second
 * poller. `started` is derived from the instance's first `getUpdates` call
 * (see launchPolling), at which point Telegraf's polling object exists and
 * `stop()` is guaranteed to work; if the launch instead ends before that
 * (rejected `getMe`, bad token) there is nothing to stop.
 */
function abandonInstance(launch: Launch, reason: string): void {
  let settled = false;
  launch.ended.finally(() => { settled = true; }).catch(() => undefined);

  launch.started
    .then(() => {
      if (settled) return;
      try {
        launch.instance.stop(reason);
        logger.info('Abandoned Telegram instance stopped', { reason });
      } catch (error) {
        logger.error('Could not stop abandoned Telegram instance', { reason, error });
      }
    })
    .catch(() => undefined);
}

/**
 * Launch long polling.
 *
 * `bot.launch()` in polling mode resolves only when polling ENDS (it awaits the
 * loop), so it cannot be awaited for "started". Telegraf's `onLaunch` callback
 * is no better: it fires after `getMe` but BEFORE `deleteWebhook` and
 * `startPolling`, so nothing is pollable (or stoppable) yet. Actual readiness
 * is the first `getUpdates` request, observed through the public
 * `telegram.callApi` entry point every request goes through.
 */
function launchPolling(instance: Telegraf, dropPendingUpdates: boolean): Launch {
  let markStarted!: () => void;
  const started = new Promise<void>((resolve) => { markStarted = resolve; });

  const telegram = instance.telegram;
  const originalCallApi = telegram.callApi.bind(telegram);
  telegram.callApi = ((method, payload, signal) => {
    if (method === 'getUpdates') markStarted();
    return originalCallApi(method, payload, signal);
  }) as typeof telegram.callApi;

  const ended = instance.launch({ dropPendingUpdates });
  // `ended` is awaited by whoever supervises this launch; if that supervision
  // is dropped (abandoned instance) a loop failure must not become an
  // unhandled rejection.
  ended.catch(() => undefined);
  return { instance, started, ended };
}

/**
 * Launch a fresh instance and wait for polling to start, with a timeout.
 * On timeout or early loop exit the instance is abandoned (and stopped as
 * soon as it starts polling, if it ever does) and the error is thrown.
 */
async function launchAndAwaitStart(dropPendingUpdates: boolean): Promise<Launch> {
  const launch = launchPolling(createBot(), dropPendingUpdates);

  let timeoutTimer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timeoutTimer = setTimeout(
      () => reject(new Error(`Telegram bot launch timed out after ${LAUNCH_TIMEOUT_MS / 1000}s`)),
      LAUNCH_TIMEOUT_MS,
    );
    if (typeof timeoutTimer.unref === 'function') timeoutTimer.unref();
  });
  // If the loop settles before `started` fires (bad token, network error),
  // surface that as the launch failure instead of waiting for the timeout.
  const endedBeforeStart = launch.ended.then(() => {
    throw new Error('Telegram polling ended before it started');
  });
  endedBeforeStart.catch(() => undefined);

  try {
    await Promise.race([launch.started, endedBeforeStart, timeout]);
  } catch (error) {
    abandonInstance(launch, 'launch-failed');
    throw error;
  } finally {
    clearTimeout(timeoutTimer);
  }

  return launch;
}

/**
 * Start the Telegram bot (if TELEGRAM_BOT_TOKEN is set).
 * Uses long-polling — no webhook server or extra port needed.
 *
 * Resolves once polling has started, or once a failed first launch has been
 * handed to the supervisor. The polling loop is supervised from then on: if
 * the first launch fails (transient DNS/Telegram error, slow getMe) or the
 * loop ever ends while the bot has not been stopped, a fresh instance is
 * launched with bounded exponential backoff. A permanently bad token
 * therefore shows up as a repeating (max once per minute) relaunch error
 * rather than a single line at boot.
 */
export async function startTelegramBot(): Promise<void> {
  if (!CONFIG.TELEGRAM_BOT_TOKEN) {
    logger.info('Telegram bot disabled (no TELEGRAM_BOT_TOKEN)');
    return;
  }

  stopped = false;
  logger.info('Telegram bot launching...');

  let launch: Launch;
  try {
    // Drop any pending updates from before restart
    launch = await launchAndAwaitStart(true);
  } catch (error) {
    if (stopped) return;
    logger.error('Telegram bot failed to start; will retry', { error });
    void supervisePolling(null);
    return;
  }

  if (stopped) {
    // stopTelegramBot() ran while we were launching: do not leave this
    // instance polling untracked.
    abandonInstance(launch, 'shutdown');
    return;
  }
  bot = launch.instance;

  logger.info('Telegram bot started (long-polling)');

  void supervisePolling(launch);
}

async function supervisePolling(initial: Launch | null): Promise<void> {
  let current: Launch | null = initial;
  let attempt = 0;
  let runStartedAt = Date.now();

  for (;;) {
    if (current) {
      try {
        await current.ended;
        if (stopped) return;
        logger.warn('Telegram polling stopped unexpectedly; restarting');
      } catch (error) {
        if (stopped) return;
        logger.error('Telegram polling failed; restarting', { error });
      }
      if (Date.now() - runStartedAt >= HEALTHY_RUN_MS) attempt = 0;
    }

    attempt++;
    const backoff = Math.min(RESTART_BACKOFF_MAX_MS, RESTART_BACKOFF_MIN_MS * 2 ** (attempt - 1));
    logger.info('Telegram bot restart scheduled', { attempt, backoffMs: backoff });
    await delay(backoff);
    if (stopped) return;

    runStartedAt = Date.now();
    try {
      // Do not drop pending updates on a restart: commands sent during the
      // gap should still be served. Same start timeout as the first launch.
      current = await launchAndAwaitStart(false);
      if (stopped) {
        // Stopped while we were launching: do not leave this one running.
        abandonInstance(current, 'shutdown');
        return;
      }
      bot = current.instance;
      logger.info('Telegram bot restarted (long-polling)', { attempt });
    } catch (error) {
      if (stopped) return;
      logger.error('Telegram bot relaunch failed', { error, attempt });
      current = null; // go straight to the next backoff
    }
  }
}

/**
 * Gracefully stop the Telegram bot. Also stops the supervisor from relaunching.
 */
export function stopTelegramBot(): void {
  stopped = true;
  if (bot) {
    try {
      bot.stop('shutdown');
    } catch {
      // stop() throws if polling never started; nothing to stop.
    }
    bot = null;
    logger.info('Telegram bot stopped');
  }
}
