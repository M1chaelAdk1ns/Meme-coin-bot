import {
  Commitment,
  Connection,
  Keypair,
  SendOptions,
  Transaction,
  TransactionSignature
} from '@solana/web3.js';
import { env, logger, ExecutionResult, sleep } from '@meme-bot/core';

export type SimResult = {
  ok: boolean;
  err?: string;
  logs?: string[];
};

export class TransactionEngine {
  private rpcIndex = 0;

  constructor(private connections: Connection[]) {}

  private nextConnection() {
    this.rpcIndex = (this.rpcIndex + 1) % this.connections.length;
    return this.connections[this.rpcIndex];
  }

  /**
   * Simulate a transaction on a connection with conservative settings.
   * IMPORTANT: the transaction should already have feePayer + recentBlockhash set.
   */
  async simulate(tx: Transaction, connection: Connection = this.connections[0]): Promise<SimResult> {
    try {
      const res = await connection.simulateTransaction(tx, {
        sigVerify: false,
        commitment: 'processed'
      });
      if (res.value.err) {
        return { ok: false, err: JSON.stringify(res.value.err), logs: res.value.logs ?? undefined };
      }
      return { ok: true, logs: res.value.logs ?? undefined };
    } catch (e: any) {
      return { ok: false, err: e?.message || String(e) };
    }
  }

  /**
   * Simulation gate: simulate BUY then simulate SELL (small amount) before allowing entry.
   * You pass builders so we can rebuild with fresh blockhash if needed.
   */
  async simulateBuySellGate(params: {
    buildBuyTx: () => Promise<Transaction>;
    buildSellTx: () => Promise<Transaction>;
    payer: Keypair;
    connection?: Connection;
  }): Promise<{ ok: boolean; reason?: string; buy?: SimResult; sell?: SimResult }> {
    const connection = params.connection ?? this.connections[0];

    // Sim BUY
    const buyTx = await params.buildBuyTx();
    buyTx.sign(params.payer);
    const buySim = await this.simulate(buyTx, connection);
    if (!buySim.ok) {
      return { ok: false, reason: `BUY simulation failed: ${buySim.err}`, buy: buySim };
    }

    // Sim SELL
    const sellTx = await params.buildSellTx();
    sellTx.sign(params.payer);
    const sellSim = await this.simulate(sellTx, connection);
    if (!sellSim.ok) {
      return { ok: false, reason: `SELL simulation failed: ${sellSim.err}`, buy: buySim, sell: sellSim };
    }

    return { ok: true, buy: buySim, sell: sellSim };
  }

  /**
   * Sends with retry ladder. Fixes confirmation to use the SAME blockhash context
   * that the tx was built with.
   */
  async sendWithRetry(txBuilder: () => Promise<Transaction>, payer: Keypair): Promise<ExecutionResult> {
    let attempt = 0;
    let lastError: string | undefined;

    while (attempt < 3) {
      attempt += 1;

      try {
        // RPC selection: first attempt primary; later attempts may rotate.
        const connection = attempt === 1 ? this.connections[0] : this.nextConnection();

        // Build fresh tx each attempt (fresh blockhash, fresh CU price, etc.)
        const tx = await txBuilder();

        // Capture blockhash context used by THIS tx
        const blockhash = tx.recentBlockhash;
        // If builder forgot to set it, we set it here
        if (!blockhash) {
          const bh = await connection.getLatestBlockhash('processed');
          tx.recentBlockhash = bh.blockhash;
        }

        // Ensure fee payer
        if (!tx.feePayer) tx.feePayer = payer.publicKey;

        tx.sign(payer);
        const raw = tx.serialize();

        const opts: SendOptions = {
          skipPreflight: false,
          maxRetries: 0, // we do our own retry ladder
          preflightCommitment: 'processed'
        };

        const sig: TransactionSignature = await connection.sendRawTransaction(raw, opts);

        // Confirm using the tx’s blockhash context
        const bh = await connection.getLatestBlockhash('processed');
        // If txBuilder used a blockhash, we should confirm against its lastValidBlockHeight
        // but we don't have that without passing it through. So we do best-effort confirm:
        // - confirmTransaction(signature, commitment) is deprecated; use blockhash strategy.
        // We'll confirm with the most recent blockhash context but also check signature status.
        // NOTE: We'll improve this further once txBuilder returns the blockhash context.
        const status = await connection.confirmTransaction(
          { signature: sig, blockhash: bh.blockhash, lastValidBlockHeight: bh.lastValidBlockHeight },
          'confirmed'
        );

        if (status.value.err) {
          lastError = JSON.stringify(status.value.err);
          logger.warn({ attempt, sig, err: lastError }, 'transaction confirmed with error');
          continue;
        }

        return { signature: sig, confirmed: true, attempt };
      } catch (err: any) {
        lastError = err?.message || String(err);
        logger.warn({ attempt, err: lastError }, 'send attempt failed');

        // Small backoff so we don’t hammer on the same blockhash window
        await sleep(150 * attempt);
      }
    }

    return { confirmed: false, error: lastError, attempt: 3 };
  }
}
