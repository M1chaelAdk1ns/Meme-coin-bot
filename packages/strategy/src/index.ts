import { StrategySignal, TradeEvent } from '@meme-bot/core';

export type StrategyContext = {
  trades: TradeEvent[];
  priceHistory: number[];
};

export interface Strategy {
  name: string;
  evaluate(ctx: StrategyContext): StrategySignal;
}

export class LaunchMomentumStrategy implements Strategy {
  name = 'launch-momentum';
  evaluate(ctx: StrategyContext): StrategySignal {
    const windowTrades = ctx.trades.slice(-20);
    const buys = windowTrades.filter((t) => t.side === 'buy');
    const sells = windowTrades.filter((t) => t.side === 'sell');
    const velocity = buys.length / Math.max(1, (windowTrades.at(-1)?.timestamp || 0) - (windowTrades[0]?.timestamp || 0)) * 1000;
    const netFlow = buys.reduce((a, t) => a + t.solAmount, 0) - sells.reduce((a, t) => a + t.solAmount, 0);
    const unique = new Set(windowTrades.map((t) => t.trader)).size;

    if (windowTrades.length < 5 || velocity < 1 || netFlow <= 0 || unique < 3) {
      return { action: 'skip', confidence: 0.2, sizeMultiplier: 1, rationale: 'Insufficient early momentum' };
    }

    return {
      action: 'enter',
      confidence: Math.min(1, velocity / 5),
      sizeMultiplier: 1 + Math.min(0.5, netFlow / 5),
      rationale: 'High early momentum with positive net flow',
      suggestedStopsTPs: { stopLossPct: 0.25 }
    };
  }
}

export class PullbackReclaimStrategy implements Strategy {
  name = 'pullback-reclaim';
  evaluate(ctx: StrategyContext): StrategySignal {
    const history = ctx.priceHistory;
    if (history.length < 6) return { action: 'skip', confidence: 0.1, sizeMultiplier: 1, rationale: 'Not enough price history' };
    const recent = history.slice(-6);
    const max = Math.max(...recent.slice(0, 3));
    const dip = Math.min(...recent.slice(2, 4));
    const reclaim = recent[5];
    const dippedEnough = dip < max * 0.9;
    const reclaimed = reclaim > max * 0.98;

    if (dippedEnough && reclaimed) {
      return {
        action: 'enter',
        confidence: 0.65,
        sizeMultiplier: 1,
        rationale: 'Pullback followed by reclaim',
        suggestedStopsTPs: { stopLossPct: 0.2 }
      };
    }
    return { action: 'skip', confidence: 0.15, sizeMultiplier: 1, rationale: 'No clean reclaim detected' };
  }
}

export class StrategyEngine {
  constructor(private strategies: Strategy[]) {}

  decide(ctx: StrategyContext): StrategySignal {
    const signals = this.strategies.map((s) => s.evaluate(ctx));
    const enterSignals = signals.filter((s) => s.action === 'enter');
    if (!enterSignals.length) {
      return { action: 'skip', confidence: 0, sizeMultiplier: 1, rationale: 'All strategies skipped' };
    }
    const avgConfidence = enterSignals.reduce((a, s) => a + s.confidence, 0) / enterSignals.length;
    const avgSize = enterSignals.reduce((a, s) => a + s.sizeMultiplier, 0) / enterSignals.length;
    return {
      action: 'enter',
      confidence: avgConfidence,
      sizeMultiplier: avgSize,
      rationale: enterSignals.map((s) => s.rationale).join('; '),
      suggestedStopsTPs: enterSignals[0].suggestedStopsTPs
    };
  }
}
