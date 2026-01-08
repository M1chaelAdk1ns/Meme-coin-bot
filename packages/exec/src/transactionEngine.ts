import {
  Connection,
  Keypair,
  SendOptions,
  Transaction,
  TransactionSignature,
  VersionedTransaction
} from '@solana/web3.js';
import { ExecutionResult, logger, sleep } from '@meme-bot/core';

export type AnyTx = Transaction | VersionedTransaction;

export type SimResult = {
  ok: boolean;
  err?: string;
  logs?: string[];
};

function signTx(tx: AnyTx, payer: Keypair) {
  if (tx instanceof Transaction) {
    tx.sign(payer);
    return;
  }
  tx.sign([payer]);
}

function serializeTx(tx: AnyTx): Uint8Array {
  if (tx instanceof Transaction) {
    return tx.serialize();
  }
  return tx.serialize();
}

export class TransactionEngine {
  private rpcIndex = 0;

  constructor(private connections: Connection[]) {}

  private nextConnection() {
    this.rpcIndex = (this.rpcIndex + 1) % this.connections.length;
    return this.connections[this.rpcIndex];
  }

  async simulate(tx: AnyTx, connection: Connection = this.connections[0]): Promise<SimResult> {
    try {
      const res = await connection.simulateTransaction(tx as any, {
        sigVerify: false,
        commitment: 'processed'
      });
      if (res.value.err) return { ok: false, err: JSON.stringify(res.value.err), logs: res.value.logs ?? undefined };
      return { ok: true, logs: res.value.logs ?? undefined };
    } catch (e: any) {
      return { ok: false, err: e?.message || String(e) };
    }
  }

  async simulateBuySellGate(params: {
    buildBuyTx: () => Promise<AnyTx>;
    buildSellTx: () => Promise<AnyTx>;
    payer: Keypair;
    connection?: Connection;
  }): Promise<{ ok: boolean; reason?: string; buy?: SimResult; sell?: SimResult }> {
    const connection = params.connection ?? this.connections[0];

    const buyTx = await params.buildBuyTx();
    signTx(buyTx, params.payer);
    const buySim = await this.simulate(buyTx, connection);
    if (!buySim.ok) return { ok: false, reason: `BUY simulation failed: ${buySim.err}`, buy: buySim };

    const sellTx = await params.buildSellTx();
    signTx(sellTx, params.payer);
    const sellSim = await this.simulate(sellTx, connection);
    if (!sellSim.ok) return { ok: false, reason: `SELL simulation failed: ${sellSim.err}`, buy: buySim, sell: sellSim };

    return { ok: true, buy: buySim, sell: sellSim };
  }

  async sendWithRetry(txBuilder: () => Promise<AnyTx>, payer: Keypair): Promise<ExecutionResult> {
    let attempt = 0;
    let lastError: string | undefined;

    while (attempt < 3) {
      attempt += 1;

      try {
        const connection = attempt === 1 ? this.connections[0] : this.nextConnection();
        const tx = await txBuilder();

        // sign + send
        signTx(tx, payer);
        const raw = serializeTx(tx);

        const opts: SendOptions = {
          skipPreflight: false,
          maxRetries: 0,
          preflightCommitment: 'processed'
        };

        const sig: TransactionSignature = await connection.sendRawTransaction(raw, opts);

        // best-effort confirm
        const bh = await connection.getLatestBlockhash('processed');
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
        await sleep(150 * attempt);
      }
    }

    return { confirmed: false, error: lastError, attempt: 3 };
  }
}
