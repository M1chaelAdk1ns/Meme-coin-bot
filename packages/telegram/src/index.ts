import { Telegraf } from 'telegraf';
import { env, logger, runtimeFlags } from '@meme-bot/core';

export type StatusSnapshot = {
  wallet?: string;
  balanceSol?: number;
  dryRun: boolean;
  liveEnabled: boolean;
  openPositions: number;
  feedConnected?: boolean;
};

export class TelegramBot {
  private bot?: Telegraf;
  private getStatus?: () => Promise<StatusSnapshot>;

  start(getStatus?: () => Promise<StatusSnapshot>) {
    this.getStatus = getStatus;

    if (!env.TELEGRAM_BOT_TOKEN || !env.TELEGRAM_ADMIN_CHAT_ID) {
      logger.warn('telegram disabled: missing token or admin chat id');
      return;
    }

    this.bot = new Telegraf(env.TELEGRAM_BOT_TOKEN);
    const admin = env.TELEGRAM_ADMIN_CHAT_ID;

    this.bot.use(async (ctx, next) => {
      if (`${ctx.from?.id}` !== admin) return ctx.reply('unauthorized');
      return next();
    });

    this.bot.start((ctx) => ctx.reply('Pump.fun bot ready. Use /status'));

    this.bot.command('status', async (ctx) => {
      if (!this.getStatus) return ctx.reply('Status provider not wired yet.');
      const s = await this.getStatus();

      const lines = [
        `DRY_RUN: ${s.dryRun}`,
        `LIVE ENABLED: ${s.liveEnabled}`,
        `Entries paused: ${runtimeFlags.entriesPaused}`,
        s.wallet ? `Wallet: ${s.wallet}` : undefined,
        typeof s.balanceSol === 'number' ? `Balance: ${s.balanceSol.toFixed(4)} SOL` : undefined,
        `Open positions: ${s.openPositions}`,
        typeof s.feedConnected === 'boolean' ? `Feed connected: ${s.feedConnected}` : undefined
      ].filter(Boolean);

      return ctx.reply(lines.join('\n'));
    });

    this.bot.command('config', (ctx) =>
      ctx.reply(
        [
          `DRY_RUN: ${env.DRY_RUN}`,
          `LIVE: ${env.ENABLE_LIVE_TRADING}`,
          `Base: ${env.BASE_SIZE_SOL} SOL`,
          `Max trade: ${env.MAX_TRADE_SOL} SOL`,
          `PumpPortal trade-local: ${env.PUMP_TRADE_LOCAL_URL}`,
          `Pool: ${env.PORTAL_POOL}`,
          `Slippage: ${env.PORTAL_SLIPPAGE_PCT}%`,
          `Priority fee: ${env.PORTAL_PRIORITY_FEE_SOL} SOL`
        ].join('\n')
      )
    );

    this.bot.command('pause_entries', (ctx) => {
      runtimeFlags.entriesPaused = true;
      return ctx.reply('✅ Entries paused.');
    });

    this.bot.command('resume_entries', (ctx) => {
      runtimeFlags.entriesPaused = false;
      return ctx.reply('✅ Entries resumed.');
    });

    // Panic = immediately stop new entries.
    // (We’ll add "close all positions" once sell/exit management is implemented.)
    this.bot.command('panic', (ctx) => {
      runtimeFlags.entriesPaused = true;
      return ctx.reply('🚨 PANIC: entries paused immediately.');
    });

    this.bot.launch();
    logger.info('telegram bot started');
  }
}
