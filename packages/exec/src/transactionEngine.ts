import {
  Connection,
  Keypair,
  PublicKey,
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

export type FillDeltas = {
  ok: boolean;
  signature: string;
  // token delta for the given mint for payer-owned token accounts
  tokenDelta?: number;
  // SOL delta for payer (post - pre) in SOL; negative means spent
  solDelta?: number;
  feeLamports?: number;
  err?: string;
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

// Extract account keys (supports legacy + v0)
function getAccountKeys(tx: any): PublicKey[] {
  try {
    // VersionedTransaction
    const msg = tx?.message;
    if (msg?.staticAccountKeys?.length) return msg.staticAccountKeys as PublicKey[];
    if (msg?.accountKeys?.length) return msg.accountKeys as PublicKey[];
  } catch {
    // ignore
  }
  return [];
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

  /**
   * Fetch a confirmed tx and compute:
   * - payer SOL delta (post - pre) in SOL
   * - payer token delta (post - pre) for a specific mint across payer-owned token accounts
   *
   * Notes:
   * - Works for both legacy and v0 tx shapes (best-effort).
   * - If RPC doesn't return token balances, tokenDelta may be undefined.
   */
  async getFillDeltas(params: {
    signature: string;
    payer: PublicKey;
    mint?: PublicKey;
    connection?: Connection;
    maxWaitMs?: number;
  }): Promise<FillDeltas> {
    const connection = params.connection ?? this.connections[0];
    const maxWaitMs = params.maxWaitMs ?? 5000;
    const start = Date.now();

    while (Date.now() - start < maxWaitMs) {
      try {
        const tx = await connection.getTransaction(params.signature, {
          commitment: 'confirmed',
          maxSupportedTransactionVersion: 0
        } as any);

        if (!tx || !tx.meta) {
          // RPC may be slightly behind even after confirm
          await sleep(200);
          continue;
        }

        const meta: any = tx.meta;
        const feeLamports: number | undefined = typeof meta.fee === 'number' ? meta.fee : undefined;

        // payer SOL delta
        let solDelta: number | undefined;
        try {
          const keys = getAccountKeys(tx.transaction);
          const payerIndex = keys.findIndex((k) => k.toBase58() === params.payer.toBase58());
          if (payerIndex >= 0 && Array.isArray(meta.preBalances) && Array.isArray(meta.postBalances)) {
            const pre = meta.preBalances[payerIndex] ?? 0;
            const post = meta.postBalances[payerIndex] ?? 0;
            solDelta = (post - pre) / 1e9;
          }
        } catch {
          // ignore
        }

        // payer token delta (sum across payer-owned token accounts for the mint)
        let tokenDelta: number | undefined;
        if (params.mint && Array.isArray(meta.preTokenBalances) && Array.isArray(meta.postTokenBalances)) {
          const mintStr = params.mint.toBase58();
          const payerStr = params.payer.toBase58();

          const sumTokenUi = (arr: any[]) =>
            arr
              .filter((b) => b && b.mint === mintStr && b.owner === payerStr)
              .reduce((acc, b) => {
                const ui = b.uiTokenAmount?.uiAmount;
                if (typeof ui === 'number') return acc + ui;
                // fallback: amount string / decimals
                const amtStr = b.uiTokenAmount?.amount;
                const dec = b.uiTokenAmount?.decimals;
                if (typeof amtStr === 'string' && typeof dec === 'number') {
                  const amt = Number(amtStr);
                  if (Number.isFinite(amt)) return acc + amt / Math.pow(10, dec);
                }
                return acc;
              }, 0);

          const preSum = sumTokenUi(meta.preTokenBalances);
          const postSum = sumTokenUi(meta.postTokenBalances);
          tokenDelta = postSum - preSum;
        }

        return {
          ok: true,
          signature: params.signature,
          tokenDelta,
          solDelta,
          feeLamports
        };
      } catch (e: any) {
        // transient RPC errors: keep trying within window
        const msg = e?.message || String(e);
        await sleep(200);
        if (Date.now() - start >= maxWaitMs) {
          return { ok: false, signature: params.signature, err: msg };
        }
      }
    }

    return { ok: false, signature: params.signature, err: 'getTransaction timed out (RPC lag?)' };
  }

  /**
   * Convenience helper:
   * - sendWithRetry()
   * - then fetch deltas from chain for payer + (optional) mint
   */
  async sendWithRetryAndFetchFill(params: {
    txBuilder: () => Promise<AnyTx>;
    payer: Keypair;
    mint?: PublicKey;
    connection?: Connection;
    maxWaitMs?: number;
  }): Promise<{ exec: ExecutionResult; fill?: FillDeltas }> {
    const exec = await this.sendWithRetry(params.txBuilder, params.payer);
    if (!exec.confirmed || !exec.signature) return { exec };

    const fill = await this.getFillDeltas({
      signature: exec.signature,
      payer: params.payer.publicKey,
      mint: params.mint,
      connection: params.connection,
      maxWaitMs: params.maxWaitMs
    });

    return { exec, fill };
  }
}
