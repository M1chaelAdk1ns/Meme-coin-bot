import { z } from 'zod';
import dotenv from 'dotenv';

dotenv.config();

const envSchema = z.object({
  RPC_URLS: z.string().default('https://api.mainnet-beta.solana.com'),
  ENABLE_LIVE_TRADING: z.string().default('false'),
  DRY_RUN: z.string().default('true'),
  BASE_SIZE_SOL: z.string().default('0.4'),
  MAX_TRADE_SOL: z.string().default('0.75'),
  MAX_OPEN_POSITIONS: z.string().default('3'),
  MAX_TOTAL_EXPOSURE_SOL: z.string().default('1.2'),
  STOP_LOSS_PCT: z.string().default('0.25'),
  TIME_STOP_SEC: z.string().default('120'),
  TP_LADDER_JSON: z.string().default('[{"pct":0.25,"profit":0.3},{"pct":0.25,"profit":0.6},{"pct":0.25,"profit":1.0}]'),
  TRAIL_MODE: z.string().default('volatility'),
  TELEGRAM_BOT_TOKEN: z.string().optional(),
  TELEGRAM_ADMIN_CHAT_ID: z.string().optional(),
  SQLITE_PATH: z.string().default('bot.db'),
  PRIORITY_FEE_MICRO_LAMPORTS: z.string().default('5000'),
  COMPUTE_UNIT_LIMIT: z.string().default('1200000'),
  JITO_ENABLED: z.string().default('false'),
  LOG_LEVEL: z.string().default('info'),
  PUMP_PORTAL_URL: z.string().default('wss://pumpportal.fun/api/data')
});

export const rawEnv = envSchema.parse(process.env);

export const env = {
  RPC_URLS: rawEnv.RPC_URLS.split(',').map((s) => s.trim()).filter(Boolean),
  ENABLE_LIVE_TRADING: rawEnv.ENABLE_LIVE_TRADING === 'true',
  DRY_RUN: rawEnv.DRY_RUN !== 'false',
  BASE_SIZE_SOL: Number(rawEnv.BASE_SIZE_SOL),
  MAX_TRADE_SOL: Number(rawEnv.MAX_TRADE_SOL),
  MAX_OPEN_POSITIONS: Number(rawEnv.MAX_OPEN_POSITIONS),
  MAX_TOTAL_EXPOSURE_SOL: Number(rawEnv.MAX_TOTAL_EXPOSURE_SOL),
  STOP_LOSS_PCT: Number(rawEnv.STOP_LOSS_PCT),
  TIME_STOP_SEC: Number(rawEnv.TIME_STOP_SEC),
  TP_LADDER: JSON.parse(rawEnv.TP_LADDER_JSON) as { pct: number; profit: number }[],
  TRAIL_MODE: rawEnv.TRAIL_MODE,
  TELEGRAM_BOT_TOKEN: rawEnv.TELEGRAM_BOT_TOKEN,
  TELEGRAM_ADMIN_CHAT_ID: rawEnv.TELEGRAM_ADMIN_CHAT_ID,
  SQLITE_PATH: rawEnv.SQLITE_PATH,
  PRIORITY_FEE_MICRO_LAMPORTS: Number(rawEnv.PRIORITY_FEE_MICRO_LAMPORTS),
  COMPUTE_UNIT_LIMIT: Number(rawEnv.COMPUTE_UNIT_LIMIT),
  JITO_ENABLED: rawEnv.JITO_ENABLED === 'true',
  LOG_LEVEL: rawEnv.LOG_LEVEL,
  PUMP_PORTAL_URL: rawEnv.PUMP_PORTAL_URL
};
