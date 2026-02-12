import { Telegraf } from 'telegraf';
import { CONFIG } from '../config/index.js';
import { handleFuseCommand } from './commands.js';
import { logger } from '../utils/logger.js';

let bot: Telegraf | null = null;

/**
 * Start the Telegram bot (if TELEGRAM_BOT_TOKEN is set).
 * Uses long-polling — no webhook server or extra port needed.
 */
export async function startTelegramBot(): Promise<void> {
  if (!CONFIG.TELEGRAM_BOT_TOKEN) {
    logger.info('Telegram bot disabled (no TELEGRAM_BOT_TOKEN)');
    return;
  }

  bot = new Telegraf(CONFIG.TELEGRAM_BOT_TOKEN);

  // Chat filter middleware: allow DMs always, restrict groups to allowed list
  bot.use(async (ctx, next) => {
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

  // Register the /fuse command
  bot.command('fuse', handleFuseCommand);

  // Launch with long-polling, drop any pending updates from before restart
  await bot.launch({ dropPendingUpdates: true });

  logger.info('Telegram bot started (long-polling)');
}

/**
 * Gracefully stop the Telegram bot.
 */
export function stopTelegramBot(): void {
  if (bot) {
    bot.stop('shutdown');
    bot = null;
    logger.info('Telegram bot stopped');
  }
}
