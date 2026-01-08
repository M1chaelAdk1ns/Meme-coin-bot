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

function fmtBool(b: boolean) {
  return b ? 'YES' : 'NO';
}

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
      try {
        if (`${ctx.from?.id}` !== admin) return ctx.reply('unauthorized');
        return next();
      } catch (e: any) {
        logger.warn({ err: e?.message || String(e) }, 'telegram middleware error');
        // best-effort reply
        try {
          return ctx.reply('Error handling request.');
        } catch {
          return;
        }
      }
    });

    this.bot.start((ctx) => ctx.reply('Pump.fun bot ready. Use /status'));

    this.bot.command('status', async (ctx) => {
      try {
        if (!this.getStatus) return ctx.reply('Status provider not wired yet.');
        const s = await this.getStatus();

        const lines = [
          `DRY_RUN: ${fmtBool(s.dryRun)}`,
          `LIVE ENABLED: ${fmtBool(s.liveEnabled)}`,
          `Entries paused: ${fmtBool(runtimeFlags.entriesPaused)}`,
          s.wallet ? `Wallet: ${s.wallet}` : undefined,
          typeof s.balanceSol === 'number' ? `Balance: ${s.balanceSol.toFixed(4)} SOL` : undefined,
          `Open positions: ${s.openPositions}`,
          typeof s.feedConnected === 'boolean' ? `Feed connected: ${fmtBool(s.feedConnected)}` : undefined
        ].filter(Boolean);

        return ctx.reply(lines.join('\n'));
      } catch (e: any) {
        logger.warn({ err: e?.message || String(e) }, 'telegram /status error');
        return ctx.reply('Failed to fetch status.');
      }
    });

    this.bot.command('config', async (ctx) => {
      try {
        return ctx.reply(
          [
            `DRY_RUN: ${fmtBool(env.DRY_RUN)}`,
            `LIVE: ${fmtBool(env.ENABLE_LIVE_TRADING)}`,
            `Entries paused: ${fmtBool(runtimeFlags.entriesPaused)}`,
            `Base: ${env.BASE_SIZE_SOL} SOL`,
            `Max trade: ${env.MAX_TRADE_SOL} SOL`,
            `Max open: ${env.MAX_OPEN_POSITIONS}`,
            `Max exposure: ${env.MAX_TOTAL_EXPOSURE_SOL} SOL`,
            `Min balance: ${env.MIN_SOL_BALANCE} SOL`,
            `PumpPortal trade-local: ${env.PUMP_TRADE_LOCAL_URL}`,
            `Pool: ${env.PORTAL_POOL}`,
            `Slippage: ${env.PORTAL_SLIPPAGE_PCT}%`,
            `Priority fee: ${env.PORTAL_PRIORITY_FEE_SOL} SOL`
          ].join('\n')
        );
      } catch (e: any) {
        logger.warn({ err: e?.message || String(e) }, 'telegram /config error');
        return ctx.reply('Failed to fetch config.');
      }
    });

    const setEntriesPaused = async (ctx: any, paused: boolean, label: string) => {
      try {
        const before = runtimeFlags.entriesPaused;
        runtimeFlags.entriesPaused = paused;

        if (before === paused) {
          return ctx.reply(`Entries already ${paused ? 'paused' : 'running'}.`);
        }

        logger.warn({ paused }, `entries ${paused ? 'paused' : 'resumed'} via telegram (${label})`);
        return ctx.reply(`${paused ? '✅ Entries paused.' : '✅ Entries resumed.'}`);
      } catch (e: any) {
        logger.warn({ err: e?.message || String(e) }, `telegram ${label} error`);
        return ctx.reply('Failed to update entries state.');
      }
    };

    this.bot.command('pause_entries', (ctx) => setEntriesPaused(ctx, true, '/pause_entries'));
    this.bot.command('resume_entries', (ctx) => setEntriesPaused(ctx, false, '/resume_entries'));

    // Panic = immediately stop new entries.
    // (We’ll add "close all positions" later once exits are fully reliable.)
    this.bot.command('panic', (ctx) => setEntriesPaused(ctx, true, '/panic'));

    this.bot.launch();
    logger.info('telegram bot started');
  }
}
