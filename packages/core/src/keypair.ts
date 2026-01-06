import fs from 'fs';
import bs58 from 'bs58';
import { Keypair } from '@solana/web3.js';
import { env } from './config';

/**
 * Loads a Keypair from:
 * 1) KEYPAIR_B58 (base58 encoded 64-byte secret key)
 * 2) KEYPAIR_PATH (JSON array from Solana CLI id.json)
 */
export function loadKeypair(): Keypair {
  if (env.KEYPAIR_B58 && env.KEYPAIR_B58.trim().length > 0) {
    const secret = bs58.decode(env.KEYPAIR_B58.trim());
    return Keypair.fromSecretKey(secret);
  }

  if (env.KEYPAIR_PATH && env.KEYPAIR_PATH.trim().length > 0) {
    const raw = fs.readFileSync(env.KEYPAIR_PATH, 'utf8');
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) throw new Error('KEYPAIR_PATH must point to a JSON array (Solana id.json)');
    return Keypair.fromSecretKey(Uint8Array.from(arr));
  }

  throw new Error('Missing KEYPAIR_B58 or KEYPAIR_PATH. Refusing to start.');
}
