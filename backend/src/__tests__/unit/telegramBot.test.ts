import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const fake = vi.hoisted(() => {
  /**
   * Models Telegraf's real launch phases:
   *   launch() -> getMe (network) -> onLaunch -> deleteWebhook (network)
   *   -> startPolling(): Polling object created, first getUpdates via telegram.callApi
   * stop() throws until the Polling object exists.
   */
  class FakeTelegraf {
    static instances: FakeTelegraf[] = [];
    commands = new Map<string, (ctx: unknown) => unknown>();
    middlewares: Array<(ctx: unknown, next: () => Promise<void>) => unknown> = [];
    errorHandler: ((err: unknown, ctx: unknown) => unknown) | null = null;
    onLaunch: (() => void) | null = null;
    endLoop!: () => void;
    failLoop!: (err: Error) => void;
    stopped = false;
    launched = false;
    pollingReady = false;
    telegram = {
      callApi: async (_method: string, _payload?: unknown, _signal?: unknown): Promise<unknown> => undefined,
    };

    constructor(public token: string) {
      FakeTelegraf.instances.push(this);
    }
    use(fn: (ctx: unknown, next: () => Promise<void>) => unknown) { this.middlewares.push(fn); return this; }
    command(name: string, fn: (ctx: unknown) => unknown) { this.commands.set(name, fn); return this; }
    catch(fn: (err: unknown, ctx: unknown) => unknown) { this.errorHandler = fn; return this; }
    launch(_cfg: unknown, onLaunch?: () => void): Promise<void> {
      this.launched = true;
      this.onLaunch = onLaunch ?? null;
      return new Promise<void>((resolve, reject) => {
        this.endLoop = resolve;
        this.failLoop = reject;
      });
    }
    stop() {
      if (!this.pollingReady) throw new Error('Bot is not running!');
      this.stopped = true;
      this.endLoop();
    }
    /** getMe resolved: Telegraf fires onLaunch. Nothing is pollable yet. */
    getMeDone() { this.onLaunch?.(); }
    /** deleteWebhook resolved, startPolling(): first getUpdates goes out. */
    beginPolling() {
      this.pollingReady = true;
      void this.telegram.callApi('getUpdates', { timeout: 50, offset: 0 });
    }
    /** Convenience: full happy-path start. */
    start() { this.getMeDone(); this.beginPolling(); }
  }
  return { FakeTelegraf };
});

vi.mock('telegraf', () => ({ Telegraf: fake.FakeTelegraf }));

vi.mock('../../config/index.js', async () => {
  const actual = await vi.importActual('../../config/index.js') as Record<string, unknown>;
  return {
    ...actual,
    CONFIG: {
      ...(actual.CONFIG as Record<string, unknown>),
      TELEGRAM_BOT_TOKEN: 'test-token',
      TELEGRAM_ALLOWED_CHAT_IDS: [],
    },
  };
});

vi.mock('../../telegram/commands.js', () => ({
  handleFuseCommand: vi.fn().mockResolvedValue(undefined),
}));

import { startTelegramBot, stopTelegramBot, telegramErrorHandler } from '../../telegram/index.js';

const instances = () => fake.FakeTelegraf.instances;

describe('Telegram bot lifecycle', () => {
  beforeEach(() => {
    fake.FakeTelegraf.instances.length = 0;
    vi.useFakeTimers();
  });
  afterEach(() => {
    stopTelegramBot();
    vi.useRealTimers();
  });

  it('resolves once polling has started even though launch() never resolves', async () => {
    const starting = startTelegramBot();
    expect(instances()).toHaveLength(1);
    instances()[0].start();
    await expect(starting).resolves.toBeUndefined();
  });

  it('retries with backoff when the first launch fails before polling starts', async () => {
    const starting = startTelegramBot();
    instances()[0].failLoop(new Error('getaddrinfo ENOTFOUND api.telegram.org'));
    await expect(starting).resolves.toBeUndefined();
    expect(instances()).toHaveLength(1);

    await vi.advanceTimersByTimeAsync(1_000); // first backoff
    expect(instances()).toHaveLength(2);

    // The retry succeeds and the bot is up without a process restart.
    instances()[1].start();
    await vi.advanceTimersByTimeAsync(0);
    instances()[1].failLoop(new Error('later failure'));
    await vi.advanceTimersByTimeAsync(2_000);
    expect(instances()).toHaveLength(3);
  });

  it('retries when polling never starts within the launch timeout', async () => {
    const starting = startTelegramBot();
    await vi.advanceTimersByTimeAsync(15_000);
    await expect(starting).resolves.toBeUndefined();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(instances()).toHaveLength(2);
  });

  it('does not retry a failed first launch after an explicit stop', async () => {
    const starting = startTelegramBot();
    stopTelegramBot();
    instances()[0].failLoop(new Error('boom'));
    await starting;
    await vi.advanceTimersByTimeAsync(120_000);
    expect(instances()).toHaveLength(1);
  });

  it('is not "started" after getMe/onLaunch alone: readiness is the first getUpdates', async () => {
    const starting = startTelegramBot();
    let settled = false;
    starting.then(() => { settled = true; }, () => { settled = true; });

    instances()[0].getMeDone();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(settled).toBe(false);

    instances()[0].beginPolling();
    await starting;
    expect(settled).toBe(true);
  });

  it('stops a timed-out instance whenever it eventually starts polling, even much later', async () => {
    const starting = startTelegramBot();
    await vi.advanceTimersByTimeAsync(15_000);
    await starting;

    const slow = instances()[0];
    // getMe answered after the timeout, but deleteWebhook is still hanging:
    // nothing to stop yet, and nothing polling.
    slow.getMeDone();
    await vi.advanceTimersByTimeAsync(20 * 60 * 1000); // well past any retry budget
    expect(slow.stopped).toBe(false);
    expect(slow.pollingReady).toBe(false);

    // deleteWebhook finally resolves and Telegraf starts polling on the
    // instance nobody tracks any more: it is stopped immediately.
    slow.beginPolling();
    await vi.advanceTimersByTimeAsync(0);
    expect(slow.stopped).toBe(true);
  });

  it('a stop during the initial launch prevents the instance from polling', async () => {
    const starting = startTelegramBot();
    stopTelegramBot();

    instances()[0].start();
    await starting;
    await vi.advanceTimersByTimeAsync(0);
    expect(instances()[0].stopped).toBe(true);

    // And no supervisor relaunch follows.
    await vi.advanceTimersByTimeAsync(120_000);
    expect(instances()).toHaveLength(1);
  });

  it('applies the start timeout to relaunches as well', async () => {
    const starting = startTelegramBot();
    instances()[0].start();
    await starting;

    instances()[0].failLoop(new Error('polling died'));
    await vi.advanceTimersByTimeAsync(1_000); // backoff 1 -> relaunch #2
    expect(instances()).toHaveLength(2);

    // Relaunch #2 never starts polling.
    await vi.advanceTimersByTimeAsync(15_000); // relaunch timeout
    await vi.advanceTimersByTimeAsync(2_000);  // backoff 2 -> relaunch #3
    expect(instances()).toHaveLength(3);

    // The abandoned #2 is stopped the moment it starts polling.
    instances()[1].start();
    await vi.advanceTimersByTimeAsync(0);
    expect(instances()[1].stopped).toBe(true);
    expect(instances()[2].stopped).toBe(false);
  });

  it('relaunches a fresh instance when the polling loop dies', async () => {
    const starting = startTelegramBot();
    instances()[0].start();
    await starting;

    instances()[0].failLoop(new Error('polling died'));
    await vi.advanceTimersByTimeAsync(1_000); // first backoff

    expect(instances()).toHaveLength(2);
    expect(instances()[1].launched).toBe(true);
    expect(instances()[1].errorHandler).toBe(telegramErrorHandler);
  });

  it('a loop failure after start does not produce an unhandled rejection', async () => {
    const unhandled: unknown[] = [];
    const listener = (reason: unknown) => { unhandled.push(reason); };
    process.on('unhandledRejection', listener);
    try {
      const starting = startTelegramBot();
      instances()[0].start();
      await starting;

      instances()[0].failLoop(new Error('polling died'));
      await vi.advanceTimersByTimeAsync(1_000);
      // Let any rejection tracking settle (fake timers: flush the macrotask queue).
      await vi.advanceTimersByTimeAsync(0);

      expect(unhandled).toEqual([]);
      expect(instances()).toHaveLength(2);
    } finally {
      process.off('unhandledRejection', listener);
    }
  });

  it('backs off exponentially across repeated failures', async () => {
    const starting = startTelegramBot();
    instances()[0].start();
    await starting;

    instances()[0].failLoop(new Error('1'));
    await vi.advanceTimersByTimeAsync(1_000);
    expect(instances()).toHaveLength(2);

    instances()[1].failLoop(new Error('2'));
    await vi.advanceTimersByTimeAsync(1_999);
    expect(instances()).toHaveLength(2); // 2s backoff not yet elapsed
    await vi.advanceTimersByTimeAsync(1);
    expect(instances()).toHaveLength(3);
  });

  it('does not relaunch after an explicit stop', async () => {
    const starting = startTelegramBot();
    instances()[0].start();
    await starting;

    stopTelegramBot();
    await vi.advanceTimersByTimeAsync(120_000);

    expect(instances()).toHaveLength(1);
    expect(instances()[0].stopped).toBe(true);
  });

  it('registers a non-throwing update-error handler and a detached command', async () => {
    const starting = startTelegramBot();
    const bot = instances()[0];
    bot.start();
    await starting;

    expect(bot.errorHandler).toBe(telegramErrorHandler);
    const ctx = { update: { update_id: 1 }, chat: { id: 5 }, from: { id: 5 } };
    expect(() => bot.errorHandler!(new Error('403: bot was blocked by the user'), ctx)).not.toThrow();

    // The command handler returns synchronously (does not await the fuse).
    const result = bot.commands.get('fuse')!(ctx);
    expect(result).toBeUndefined();
  });

  it('filters chats: DMs pass, unlisted groups are dropped', async () => {
    const starting = startTelegramBot();
    const bot = instances()[0];
    bot.start();
    await starting;

    const filter = bot.middlewares[0];
    const next = vi.fn().mockResolvedValue(undefined);
    await filter({ chat: { type: 'private', id: 1 } }, next);
    expect(next).toHaveBeenCalledTimes(1);
    await filter({ chat: { type: 'group', id: -100 } }, next);
    expect(next).toHaveBeenCalledTimes(1);
  });
});
