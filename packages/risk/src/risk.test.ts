import { describe, it, expect } from 'vitest';
import { RiskEngine } from './index';

const engine = new RiskEngine();

describe('RiskEngine', () => {
  it('blocks when freeze authority present', () => {
    const report = engine.evaluate({
      token: { mint: 'mint', creator: 'c', freezeAuthority: 'auth' },
      recentTrades: []
    });
    expect(report.allow).toBe(false);
  });

  it('scores momentum vs sell pressure', () => {
    const report = engine.evaluate({
      token: { mint: 'mint', creator: 'c' },
      recentTrades: [
        { signature: '1', mint: 'mint', price: 0, solAmount: 1, side: 'buy', slot: 1, trader: 'a', timestamp: 1 },
        { signature: '2', mint: 'mint', price: 0, solAmount: 1, side: 'sell', slot: 2, trader: 'b', timestamp: 2 },
        { signature: '3', mint: 'mint', price: 0, solAmount: 1, side: 'sell', slot: 3, trader: 'c', timestamp: 3 }
      ]
    });
    expect(report.score).toBeLessThan(100);
    expect(report.reasons.length).toBeGreaterThan(0);
  });
});
