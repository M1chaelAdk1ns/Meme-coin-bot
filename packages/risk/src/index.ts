import { RiskReport, TokenInfo, TradeEvent } from '@meme-bot/core';

export type RiskContext = {
  token: TokenInfo;
  recentTrades: TradeEvent[];
};

export class RiskEngine {
  evaluate(ctx: RiskContext): RiskReport {
    const reasons: string[] = [];
    let score = 100;
    const { token, recentTrades } = ctx;

    if (token.freezeAuthority) {
      reasons.push('Freeze authority present');
      score -= 50;
    }
    if (token.mintAuthority) {
      reasons.push('Mint authority not revoked');
      score -= 35;
    }

    const sells = recentTrades.filter((t) => t.side === 'sell').length;
    const buys = recentTrades.filter((t) => t.side === 'buy').length;
    if (sells > buys * 2) {
      reasons.push('Sell pressure too high');
      score -= 20;
    }

    const unique = new Set(recentTrades.map((t) => t.trader)).size;
    if (unique < 3) {
      reasons.push('Too few unique traders');
      score -= 15;
    }

    const allow = score >= 60 && !reasons.includes('Freeze authority present');

    return {
      score: Math.max(0, Math.min(100, score)),
      allow,
      reasons,
      dataCompleteness: 'medium'
    };
  }
}
