import { Connection, Keypair, PublicKey } from '@solana/web3.js';
import { env, clamp, loadKeypair, runtimeFlags } from '@meme-bot/core';
import { PumpPortalClient } from '@meme-bot/data';
import { RiskEngine } from '@meme-bot/risk';
import { StrategyEngine, LaunchMomentumStrategy, PullbackReclaimStrategy } from '@meme-bot/strategy';
import { PumpFunAdapter, TransactionEngine } from '@meme-bot/exec';
import { Storage } from '@meme-bot/storage';
import { AlertService } from '@meme-bot/alerts';
import { TelegramBot } from '@meme-bot/telegram';
import { PositionFSM } from './positionFSM';
import { Position, TradeEvent, TokenInfo } from '@meme-bot/core';

const storage = new Storage();
const alerts = new AlertService();

const riskEngine = new RiskEngine();
const strategyEngine = new StrategyEngine([new LaunchMomentumStrategy(), new PullbackReclaimStrategy()]);

const connections = env.RPC_URLS.map((u) => new Connection(u, 'confirmed'));
const transactionEngine = new TransactionEngine(connections);
const adapter = new PumpFunAdapter(connections[0]);

const payer: Keypair = loadKeypair();
const fsm = new PositionFSM((p) => storage.savePosition(p));

const telegram = new TelegramBot();
let feedConnected = false;

const tradesByMint = new Map<string, TradeEvent[]>();
const pricesByMint = new Map<string, number[]>();
const positions = new Map<string, Position>();

function recordTrade(event: TradeEvent) {
  const arr = tradesByMint.get(event.mint) || [];
  arr.push(event);
  tradesByMint.set(event.mint, arr.slice(-200));
  storage.saveTrade(event);
}

function recordPrice(mint: string, price: number) {
  const arr = pricesByMint.get(mint) || [];
  arr.push(price);
  pricesByMint.set(mint, arr.slice(-200));
}

async function assertWalletReady() {
  const conn = connections[0];
  const balLamports = await conn.getBalance(payer.publicKey, 'confirmed');
  const balSol = balLamports / 1e9;

  alerts.notify('info', `Wallet: ${payer.publicKey.toBase58()} | Balance: ${balSol.toFixed(4)} SOL`);

  if (balSol < env.MIN_SOL_BALANCE) {
    throw new Error(`Balance too low (${balSol.toFixed(4)} SOL). Need at least ${env.MIN_SOL_BALANCE} SOL.`);
  }

  if (env.ENABLE_LIVE_TRADING && env.DRY_RUN) {
    alerts.notify('warn', 'ENABLE_LIVE_TRADING=true but DRY_RUN=true. Live trading will NOT occur.');
  }

  if (env.ENABLE_LIVE_TRADING && !env.DRY_RUN) {
    alerts.notify('warn', 'LIVE TRADING ENABLED. Double-check your settings.');
  }
}

async function handleNewToken(msg: any) {
  const token: TokenInfo = {
    mint: msg.mint,
    creator: msg.creator || 'unknown',
    decimals: msg.decimals || 6,
    freezeAuthority: msg.freezeAuthority,
    mintAuthority: msg.mintAuthority
  };
  storage.upsertToken(token);
  alerts.notify('info', `New token detected ${token.mint}`);
}

async function considerEntry(mint: string) {
  if (runtimeFlags.entriesPaused) return;

  const trades = tradesByMint.get(mint) || [];
  const prices = pricesByMint.get(mint) || [];

  // Prevent duplicates: DB check (ok for now; we’ll optimize to in-memory next)
  const tokenRow = storage.listOpenPositions().find((p) => p.mint === mint);
  if (tokenRow) return;

  if (trades.length < 5) return;

  const risk = riskEngine.evaluate({ token: { mint, creator: 'unknown' }, recentTrades: trades.slice(-30) });
  storage.saveRiskReport(mint, risk);

  if (!risk.allow) {
    alerts.notify('warn', `Risk blocked ${mint}: ${risk.reasons.join(', ')}`);
    return;
  }

  const signal = strategyEngine.decide({ trades, priceHistory: prices });
  if (signal.action === 'skip') return;

  const size = clamp(env.BASE_SIZE_SOL * signal.sizeMultiplier, 0.1, env.MAX_TRADE_SOL);

  const pos = fsm.create(
    mint,
    size,
    signal.suggestedStopsTPs?.stopLossPct || env.STOP_LOSS_PCT,
    env.TP_LADDER,
    env.TRAIL_MODE
  );

  positions.set(pos.id, pos);
  alerts.notify('info', `Entering ${mint} size ${size.toFixed(2)} SOL (DRY_RUN=${env.DRY_RUN})`);

  // DRY RUN or live disabled: just mark open
  if (env.DRY_RUN || !env.ENABLE_LIVE_TRADING) {
    fsm.transition(pos, 'OPEN');
    return;
  }

  // Simulation gate (buy + sell) before real entry
  const gate = await transactionEngine.simulateBuySellGate({
    payer,
    buildBuyTx: () => adapter.buildBuyTx({ payer: payer.publicKey, mint: new PublicKey(mint), amountSol: size }),
    buildSellTx: () => adapter.buildSellTx({ payer: payer.publicKey, mint: new PublicKey(mint), amountSol: size * 0.2 })
  });

  if (!gate.ok) {
    alerts.notify('warn', `Sim gate blocked ${mint}: ${gate.reason}`);
    fsm.transition(pos, 'CLOSED');
    return;
  }

  const result = await transactionEngine.sendWithRetry(
    () => adapter.buildBuyTx({ payer: payer.publicKey, mint: new PublicKey(mint), amountSol: size }),
    payer
  );

  if (result.confirmed) {
    fsm.transition(pos, 'OPEN');
  } else {
    alerts.notify('error', `Entry failed ${mint}: ${result.error}`);
    fsm.transition(pos, 'CLOSED');
  }
}

function startFeed() {
  const pump = new PumpPortalClient();

  pump.on('connected', () => {
    feedConnected = true;
    alerts.notify('info', 'PumpPortal connected');
  });

  pump.on('event', (evt) => {
    if (evt.type === 'newToken') {
      void handleNewToken(evt.data);
      pump.subscribeTokenTrades(evt.data.mint);
    }

    if (evt.type === 'trade') {
      const e: TradeEvent = {
        signature: evt.data.signature,
        mint: evt.data.mint,
        price: Number(evt.data.price || 0),
        solAmount: Number(evt.data.solAmount || 0),
        side: evt.data.isBuy ? 'buy' : 'sell',
        slot: evt.data.slot,
        trader: evt.data.trader || 'unknown',
        timestamp: Date.now()
      };

      recordTrade(e);
      if (e.price) recordPrice(e.mint, e.price);

      void considerEntry(e.mint);
    }
  });

  pump.start();
}

// Telegram /status wiring
telegram.start(async () => {
  const conn = connections[0];
  const balLamports = await conn.getBalance(payer.publicKey, 'confirmed');
  return {
    wallet: payer.publicKey.toBase58(),
    balanceSol: balLamports / 1e9,
    dryRun: env.DRY_RUN,
    liveEnabled: env.ENABLE_LIVE_TRADING,
    openPositions: storage.listOpenPositions().length,
    feedConnected
  };
});

(async () => {
  await assertWalletReady();
  startFeed();
})().catch((e) => {
  alerts.notify('error', `Startup failed: ${e?.message || e}`);
  process.exit(1);
});
