import { Connection, Keypair, SendOptions, Transaction } from '@solana/web3.js';
import { env, logger, ExecutionResult } from '@meme-bot/core';

export class TransactionEngine {
  private rpcIndex = 0;

  constructor(private connections: Connection[]) {}

  private nextConnection() {
    this.rpcIndex = (this.rpcIndex + 1) % this.connections.length;
    return this.connections[this.rpcIndex];
  }

  async sendWithRetry(txBuilder: () => Promise<Transaction>, payer: Keypair): Promise<ExecutionResult> {
    let attempt = 0;
    let lastError: string | undefined;
    while (attempt < 3) {
      attempt += 1;
      try {
        const connection = attempt === 3 ? this.nextConnection() : this.connections[0];
        const tx = await txBuilder();
        tx.sign(payer);
        const raw = tx.serialize();
        const opts: SendOptions = { skipPreflight: false, maxRetries: 3, preflightCommitment: 'confirmed' };
        const sig = await connection.sendRawTransaction(raw, opts);
        const confirmed = await connection.confirmTransaction({ signature: sig, ...(await connection.getLatestBlockhash()) }, 'confirmed');
        if (confirmed.value.err) {
          lastError = JSON.stringify(confirmed.value.err);
          continue;
        }
        return { signature: sig, confirmed: true, attempt };
      } catch (err: any) {
        lastError = err?.message || String(err);
        logger.warn({ attempt, err: lastError }, 'send attempt failed');
      }
    }
    return { confirmed: false, error: lastError, attempt: 3 };
  }
}
