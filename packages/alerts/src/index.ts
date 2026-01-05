import { logger } from '@meme-bot/core';

type AlertLevel = 'info' | 'warn' | 'error';

export class AlertService {
  notify(level: AlertLevel, message: string) {
    if (level === 'info') logger.info(message);
    else if (level === 'warn') logger.warn(message);
    else logger.error(message);
  }
}
