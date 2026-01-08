export type RiskReport = {
  score: number;
  allow: boolean;
  reasons: string[];
  dataCompleteness: 'low' | 'medium' | 'high';

  category?: 'ok' | 'scam' | 'honeypot_suspected' | 'low_liquidity' | 'whale_risk' | 'unknown';
  metrics?: Record<string, number | string | boolean>;
};

export type StrategySignal = {
  action: 'enter' | 'skip';
  confidence: number;
  sizeMultiplier: number;
  suggestedStopsTPs?: {
    stopLossPct?: number;
    takeProfits?: { pct: number; profit: number }[];
  };
  rationale: string;
};

export type PositionState = 'IDLE' | 'PENDING_ENTRY' | 'OPEN' | 'PENDING_EXIT' | 'CLOSED';

export type Position = {
  id: string;
  mint: string;
  state: PositionState;

  sizeSol: number;

  tokens?: number;
  entryPrice?: number;

  entrySignature?: string;
  entryTimestamp?: number;
  lastError?: string;

  // Exit tracking
  tpFilled?: number;          // number of TP ladder steps already executed
  peakPnlPct?: number;        // highest pnl% seen while open

  createdAt: number;
  updatedAt: number;

  stopLossPct: number;
  takeProfits: { pct: number; profit: number }[];
  trailMode: string;
};

export type TradeEvent = {
  signature: string;
  mint: string;
  price: number;
  solAmount: number;
  side: 'buy' | 'sell';
  slot: number;
  trader: string;
  timestamp: number;
};

export type TokenInfo = {
  mint: string;
  creator: string;
  decimals?: number;
  freezeAuthority?: string | null;
  mintAuthority?: string | null;
};

export type ExecutionResult = {
  signature?: string;
  confirmed: boolean;
  error?: string;
  fee?: number;
  attempt: number;
};
