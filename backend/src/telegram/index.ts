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
  // never rejects — it is its own error boundary.
  instance.command('fuse', (ctx) => {
    void handleFuseCommand(ctx);
  });

  instance.catch(telegramErrorHandler);

  return instance;
}

/**
 * Launch long polling.
 *
 * `bot.launch()` in polling mode resolves only when polling ENDS (it awaits the
 * loop), so it cannot be awaited for "started". The `onLaunch` callback fires
 * once `getMe` succeeds and polling is about to begin; `ended` settles when the
 * loop exits, normally (after stop) or with the error that killed it.
 */
function launchPolling(instance: Telegraf, dropPendingUpdates: boolean): {
  started: Promise<void>;
  ended: Promise<void>;
} {
  let markStarted!: () => void;
  const started = new Promise<void>((resolve) => { markStarted = resolve; });
  const ended = instance.launch({ dropPendingUpdates }, () => markStarted());
  return { started, ended };
}

function safeStop(instance: Telegraf, reason: string): void {
  try {
    instance.stop(reason);
  } catch {
    // stop() throws if polling never started; nothing to stop.
  }
}

/**
 * Start the Telegram bot (if TELEGRAM_BOT_TOKEN is set).
 * Uses long-polling — no webhook server or extra port needed.
 *
 * Resolves once polling has started; rejects if the first launch fails or
 * times out. After a successful start the polling loop is supervised: if it
 * ever ends while the bot has not been stopped, a fresh instance is launched
 * with bounded exponential backoff.
 */
export async function startTelegramBot(): Promise<void> {
  if (!CONFIG.TELEGRAM_BOT_TOKEN) {
    logger.info('Telegram bot disabled (no TELEGRAM_BOT_TOKEN)');
    return;
  }

  stopped = false;
  const instance = createBot();
  bot = instance;

  logger.info('Telegram bot launching...');

  // Drop any pending updates from before restart
  const { started, ended } = launchPolling(instance, true);

  let timeoutTimer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timeoutTimer = setTimeout(
      () => reject(new Error(`Telegram bot launch timed out after ${LAUNCH_TIMEOUT_MS / 1000}s`)),
      LAUNCH_TIMEOUT_MS,
    );
    if (typeof timeoutTimer.unref === 'function') timeoutTimer.unref();
  });
  // If the loop settles before `started` fires (bad token, network error),
  // surface that as the startup failure instead of waiting for the timeout.
  const endedBeforeStart = ended.then(() => {
    throw new Error('Telegram polling ended before it started');
  });

  try {
    await Promise.race([started, endedBeforeStart, timeout]);
  } catch (error) {
    safeStop(instance, 'launch-failed');
    if (bot === instance) bot = null;
    throw error;
  } finally {
    clearTimeout(timeoutTimer);
  }

  logger.info('Telegram bot started (long-polling)');

  void supervisePolling(ended);
}

async function supervisePolling(initialLoop: Promise<void>): Promise<void> {
  let loop = initialLoop;
  let attempt = 0;
  let runStartedAt = Date.now();

  for (;;) {
    try {
      await loop;
      if (stopped) return;
      logger.warn('Telegram polling stopped unexpectedly; restarting');
    } catch (error) {
      if (stopped) return;
      logger.error('Telegram polling failed; restarting', { error });
    }

    if (Date.now() - runStartedAt >= HEALTHY_RUN_MS) attempt = 0;
    attempt++;
    const backoff = Math.min(RESTART_BACKOFF_MAX_MS, RESTART_BACKOFF_MIN_MS * 2 ** (attempt - 1));
    logger.info('Telegram bot restart scheduled', { attempt, backoffMs: backoff });
    await delay(backoff);
    if (stopped) return;

    const instance = createBot();
    bot = instance;
    runStartedAt = Date.now();
    // Do not drop pending updates on a restart: commands sent during the gap
    // should still be served.
    const launched = launchPolling(instance, false);
    launched.started
      .then(() => logger.info('Telegram bot restarted (long-polling)', { attempt }))
      .catch(() => undefined);
    loop = launched.ended;
  }
}

/**
 * Gracefully stop the Telegram bot. Also stops the supervisor from relaunching.
 */
export function stopTelegramBot(): void {
  stopped = true;
  if (bot) {
    safeStop(bot, 'shutdown');
    bot = null;
    logger.info('Telegram bot stopped');
  }
}
