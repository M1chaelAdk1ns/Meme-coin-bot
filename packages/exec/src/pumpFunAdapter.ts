import { Connection, PublicKey, VersionedTransaction } from '@solana/web3.js';
import { env } from '@meme-bot/core';

export type PumpFunTradeParams = {
  payer: PublicKey;
  mint: PublicKey;

  /**
   * For BUY:
   *  - amount: number (SOL)
   *  - denominatedInSol: true
   *
   * For SELL:
   *  - amount: number (token count) OR string percent like "10%" / "100%"
   *  - denominatedInSol: false
   */
  amount: number | string;
  denominatedInSol: boolean;

  slippagePct?: number;
  priorityFeeSol?: number;
  pool?: string; // keep string so PumpPortal can support more without code changes
};

export class PumpFunAdapter {
  constructor(private connection: Connection) {}

  private async buildPortalTx(params: PumpFunTradeParams, action: 'buy' | 'sell'): Promise<VersionedTransaction> {
    const body = {
      publicKey: params.payer.toBase58(),
      action,
      mint: params.mint.toBase58(),
      amount: params.amount,
      denominatedInSol: params.denominatedInSol ? 'true' : 'false',
      slippage: params.slippagePct ?? env.PORTAL_SLIPPAGE_PCT,
      priorityFee: params.priorityFeeSol ?? env.PORTAL_PRIORITY_FEE_SOL,
      pool: params.pool ?? env.PORTAL_POOL
    };

    const resp = await fetch(env.PUMP_TRADE_LOCAL_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });

    if (!resp.ok) {
      const text = await resp.text().catch(() => '');
      throw new Error(`trade-local failed (${resp.status}): ${text || resp.statusText}`);
    }

    const buf = new Uint8Array(await resp.arrayBuffer());
    return VersionedTransaction.deserialize(buf);
  }

  async buildBuyTx(params: PumpFunTradeParams): Promise<VersionedTransaction> {
    // Force BUY to be SOL-denominated
    return this.buildPortalTx(
      {
        ...params,
        denominatedInSol: true,
        pool: params.pool ?? env.PORTAL_POOL
      },
      'buy'
    );
  }

  async buildSellTx(params: PumpFunTradeParams): Promise<VersionedTransaction> {
    // SELL: default to token-denominated. Most common safe call is percent like "10%" or "100%"
    return this.buildPortalTx(
      {
        ...params,
        denominatedInSol: false,
        pool: params.pool ?? env.PORTAL_POOL
      },
      'sell'
    );
  }
}
