import pino from 'pino';
import { env } from './config';

export const logger = pino({
  level: env.LOG_LEVEL,
  base: { service: 'meme-coin-bot' },
  timestamp: pino.stdTimeFunctions.isoTime
});

export type Logger = typeof logger;
