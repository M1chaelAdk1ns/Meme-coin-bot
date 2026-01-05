import { Connection, PublicKey, Transaction, TransactionInstruction, ComputeBudgetProgram } from '@solana/web3.js';
import { env } from '@meme-bot/core';

export type PumpFunTradeParams = {
  payer: PublicKey;
  mint: PublicKey;
  amountSol: number;
};

export class PumpFunAdapter {
  constructor(private connection: Connection) {}

  async buildBuyTx(params: PumpFunTradeParams): Promise<Transaction> {
    const ix: TransactionInstruction = new TransactionInstruction({
      programId: new PublicKey('11111111111111111111111111111111'), // TODO real pump.fun program
      keys: [],
      data: Buffer.from([])
    });
    const tx = new Transaction();
    tx.add(
      ComputeBudgetProgram.setComputeUnitLimit({ units: env.COMPUTE_UNIT_LIMIT }),
      ComputeBudgetProgram.setComputeUnitPrice({ microLamports: env.PRIORITY_FEE_MICRO_LAMPORTS }),
      ix
    );
    tx.feePayer = params.payer;
    tx.recentBlockhash = (await this.connection.getLatestBlockhash()).blockhash;
    return tx;
  }

  async buildSellTx(params: PumpFunTradeParams): Promise<Transaction> {
    const ix: TransactionInstruction = new TransactionInstruction({
      programId: new PublicKey('11111111111111111111111111111111'), // TODO real pump.fun program
      keys: [],
      data: Buffer.from([])
    });
    const tx = new Transaction();
    tx.add(
      ComputeBudgetProgram.setComputeUnitLimit({ units: env.COMPUTE_UNIT_LIMIT }),
      ComputeBudgetProgram.setComputeUnitPrice({ microLamports: env.PRIORITY_FEE_MICRO_LAMPORTS }),
      ix
    );
    tx.feePayer = params.payer;
    tx.recentBlockhash = (await this.connection.getLatestBlockhash()).blockhash;
    return tx;
  }
}
