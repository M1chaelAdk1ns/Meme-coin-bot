import { Telegraf } from 'telegraf';
import { env, logger } from '@meme-bot/core';

export class TelegramBot {
  private bot?: Telegraf;

  start() {
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

    this.bot.start((ctx) => ctx.reply('Pump.fun bot ready in DRY_RUN mode.'));
    this.bot.command('status', (ctx) => ctx.reply('Feeds connected: TBD\nOpen positions: 0'));
    this.bot.command('config', (ctx) => ctx.reply(`Base size: ${env.BASE_SIZE_SOL} SOL\nMax trade: ${env.MAX_TRADE_SOL}`));
    this.bot.command('pause_entries', (ctx) => ctx.reply('Entries paused (not yet wired).'));
    this.bot.command('resume_entries', (ctx) => ctx.reply('Entries resumed (not yet wired).'));

    this.bot.launch();
    logger.info('telegram bot started');
  }
}
