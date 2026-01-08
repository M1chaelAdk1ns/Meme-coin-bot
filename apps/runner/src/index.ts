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

// In-memory caches to avoid DB scans in hot paths
const tokenInfoByMint = new Map<string, TokenInfo>();
const openMints = new Set<string>();

// Throttle considerEntry per mint
const lastConsiderByMint = new Map<string, number>();
const CONSIDER_COOLDOWN_MS = 750;

// Throttle exits per mint so we don’t double-sell if ticks come in fast
const lastExitActionByMint = new Map<string, number>();
const EXIT_COOLDOWN_MS = 1200;

// Trailing giveback (simple, effective): if peak pnl was high then dumps hard, exit remainder
const TRAIL_GIVEBACK_PCT = 0.20;

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

function refreshOpenMintsFromDb() {
  openMints.clear();
  for (const p of storage.listOpenPositions()) {
    openMints.add(p.mint);
    positions.set(p.id, p);
  }
}

function currentExposureSol(): number {
  // simple exposure approximation: sum sizeSol of non-closed positions
  // (good enough for now; later we’ll switch to remaining size after partial TPs)
  const open = storage.listOpenPositions().filter((p) => p.state !== 'CLOSED');
  return open.reduce((acc, p) => acc + (Number(p.sizeSol) || 0), 0);
}

async function canEnterProposed(sizeSol: number): Promise<{ ok: boolean; reason?: string }> {
  if (openMints.size >= env.MAX_OPEN_POSITIONS) {
    return { ok: false, reason: `Max open positions reached (${env.MAX_OPEN_POSITIONS})` };
  }

  const exposure = currentExposureSol();
  if (exposure + sizeSol > env.MAX_TOTAL_EXPOSURE_SOL) {
    return {
      ok: false,
      reason: `Exposure cap: current ${exposure.toFixed(2)} SOL + new ${sizeSol.toFixed(2)} SOL > ${env.MAX_TOTAL_EXPOSURE_SOL.toFixed(2)} SOL`
    };
  }

  // Only check wallet balance when live trading could actually spend SOL
  if (!env.DRY_RUN && env.ENABLE_LIVE_TRADING) {
    const conn = connections[0];
    const balLamports = await conn.getBalance(payer.publicKey, 'confirmed');
    const balSol = balLamports / 1e9;

    if (balSol - sizeSol < env.MIN_SOL_BALANCE) {
      return {
        ok: false,
        reason: `Wallet guard: balance ${balSol.toFixed(4)} SOL, trade ${sizeSol.toFixed(2)} SOL would drop below MIN_SOL_BALANCE=${env.MIN_SOL_BALANCE}`
      };
    }
  }

  return { ok: true };
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

  refreshOpenMintsFromDb();
}

async function handleNewToken(msg: any) {
  const token: TokenInfo = {
    mint: msg.mint,
    creator: msg.creator || 'unknown',
    decimals: msg.decimals || 6,
    freezeAuthority: msg.freezeAuthority,
    mintAuthority: msg.mintAuthority
  };

  tokenInfoByMint.set(token.mint, token);
  storage.upsertToken(token);
  alerts.notify('info', `New token detected ${token.mint}`);
}

function latestPrice(mint: string): number | undefined {
  const arr = pricesByMint.get(mint);
  if (!arr || !arr.length) return undefined;
  return arr[arr.length - 1];
}

function pnlPct(pos: Position, px: number): number | undefined {
  if (!pos.entryPrice || pos.entryPrice <= 0) return undefined;
  return (px - pos.entryPrice) / pos.entryPrice;
}

async function executeSellPercent(mint: string, percent: string): Promise<{ ok: boolean; err?: string; sig?: string }> {
  if (env.DRY_RUN || !env.ENABLE_LIVE_TRADING) {
    return { ok: true };
  }

  const mintPk = new PublicKey(mint);

  const res = await transactionEngine.sendWithRetry(
    () =>
      adapter.buildSellTx({
        payer: payer.publicKey,
        mint: mintPk,
        amount: percent,
        denominatedInSol: false
      }),
    payer
  );

  if (!res.confirmed) return { ok: false, err: res.error };
  return { ok: true, sig: res.signature };
}

async function manageExitsTick() {
  const open = storage.listOpenPositions().filter((p) => p.state === 'OPEN');

  for (const pos of open) {
    const px = latestPrice(pos.mint);
    if (!px) continue;

    let dirty = false;

    if (!pos.entryPrice) {
      pos.entryPrice = px;
      storage.savePosition(pos);
      continue;
    }

    const pnl = pnlPct(pos, px);
    if (pnl === undefined) continue;

    const prevPeak = typeof pos.peakPnlPct === 'number' ? pos.peakPnlPct : undefined;
    const peakBase = typeof prevPeak === 'number' ? prevPeak : pnl;
    if (pnl > peakBase) {
      pos.peakPnlPct = pnl;
      dirty = true;
    }

    const openTs = pos.entryTimestamp ?? pos.createdAt;
    const ageSec = (Date.now() - openTs) / 1000;
    if (ageSec >= env.TIME_STOP_SEC) {
      const last = lastExitActionByMint.get(pos.mint) || 0;
      if (Date.now() - last < EXIT_COOLDOWN_MS) continue;
      lastExitActionByMint.set(pos.mint, Date.now());

      alerts.notify('warn', `TIME STOP: exiting ${pos.mint} age=${ageSec.toFixed(0)}s pnl=${(pnl * 100).toFixed(1)}%`);
      fsm.transition(pos, 'PENDING_EXIT');

      const sell = await executeSellPercent(pos.mint, '100%');
      if (!sell.ok) {
        fsm.transition(pos, 'OPEN', { error: sell.err });
        continue;
      }

      fsm.transition(pos, 'CLOSED', { exitSignature: sell.sig });
      openMints.delete(pos.mint);
      continue;
    }

    if (pnl <= -pos.stopLossPct) {
      const last = lastExitActionByMint.get(pos.mint) || 0;
      if (Date.now() - last < EXIT_COOLDOWN_MS) continue;
      lastExitActionByMint.set(pos.mint, Date.now());

      alerts.notify('warn', `STOP LOSS: exiting ${pos.mint} pnl=${(pnl * 100).toFixed(1)}%`);
      fsm.transition(pos, 'PENDING_EXIT');

      const sell = await executeSellPercent(pos.mint, '100%');
      if (!sell.ok) {
        fsm.transition(pos, 'OPEN', { error: sell.err });
        continue;
      }

      fsm.transition(pos, 'CLOSED', { exitSignature: sell.sig });
      openMints.delete(pos.mint);
      continue;
    }

    const peakNow = typeof pos.peakPnlPct === 'number' ? pos.peakPnlPct : pnl;
    if (peakNow >= 0.35 && peakNow - pnl >= TRAIL_GIVEBACK_PCT) {
      const last = lastExitActionByMint.get(pos.mint) || 0;
      if (Date.now() - last < EXIT_COOLDOWN_MS) continue;
      lastExitActionByMint.set(pos.mint, Date.now());

      alerts.notify(
        'warn',
        `TRAIL EXIT: ${pos.mint} peak=${(peakNow * 100).toFixed(1)}% now=${(pnl * 100).toFixed(1)}%`
      );
      fsm.transition(pos, 'PENDING_EXIT');

      const sell = await executeSellPercent(pos.mint, '100%');
      if (!sell.ok) {
        fsm.transition(pos, 'OPEN', { error: sell.err });
        continue;
      }

      fsm.transition(pos, 'CLOSED', { exitSignature: sell.sig });
      openMints.delete(pos.mint);
      continue;
    }

    const tpFilled = pos.tpFilled ?? 0;
    const ladder = pos.takeProfits ?? [];
    const next = ladder[tpFilled];

    if (next) {
      const target = next.profit;
      if (pnl >= target) {
        const last = lastExitActionByMint.get(pos.mint) || 0;
        if (Date.now() - last < EXIT_COOLDOWN_MS) continue;
        lastExitActionByMint.set(pos.mint, Date.now());

        const pctToSell = Math.round(next.pct * 100);
        const sellStr = `${pctToSell}%`;

        alerts.notify('info', `TP HIT: ${pos.mint} pnl=${(pnl * 100).toFixed(1)}% -> sell ${sellStr}`);
        fsm.transition(pos, 'PENDING_EXIT');

        const sell = await executeSellPercent(pos.mint, sellStr);
        if (!sell.ok) {
          fsm.transition(pos, 'OPEN', { error: sell.err });
          continue;
        }

        pos.tpFilled = tpFilled + 1;
        dirty = true;

        fsm.transition(pos, 'OPEN');
      }
    }

    if (dirty) storage.savePosition(pos);
  }
}

async function considerEntry(mint: string) {
  if (runtimeFlags.entriesPaused) return;

  const now = Date.now();
  const last = lastConsiderByMint.get(mint) || 0;
  if (now - last < CONSIDER_COOLDOWN_MS) return;
  lastConsiderByMint.set(mint, now);

  const trades = tradesByMint.get(mint) || [];
  const prices = pricesByMint.get(mint) || [];

  if (openMints.has(mint)) return;
  if (trades.length < 5) return;

  const token = tokenInfoByMint.get(mint) || { mint, creator: 'unknown', decimals: 6 };

  const risk = riskEngine.evaluate({ token, recentTrades: trades.slice(-30) });
  storage.saveRiskReport(mint, risk);

  if (!risk.allow) {
    alerts.notify('warn', `Risk blocked ${mint}: ${risk.reasons.join(', ')}`);
    return;
  }

  const signal = strategyEngine.decide({ trades, priceHistory: prices });
  if (signal.action === 'skip') return;

  const size = clamp(env.BASE_SIZE_SOL * signal.sizeMultiplier, 0.1, env.MAX_TRADE_SOL);

  // 🔒 Hard risk gates (positions/exposure/wallet)
  const gate = await canEnterProposed(size);
  if (!gate.ok) {
    alerts.notify('warn', `Entry blocked ${mint}: ${gate.reason}`);
    return;
  }

  const pos = fsm.create(
    mint,
    size,
    signal.suggestedStopsTPs?.stopLossPct || env.STOP_LOSS_PCT,
    env.TP_LADDER,
    env.TRAIL_MODE
  );

  const entryPxFallback = prices.length ? prices[prices.length - 1] : undefined;
  if (entryPxFallback) pos.entryPrice = entryPxFallback;

  positions.set(pos.id, pos);
  openMints.add(mint);

  alerts.notify('info', `Entering ${mint} size ${size.toFixed(2)} SOL (DRY_RUN=${env.DRY_RUN})`);

  if (env.DRY_RUN || !env.ENABLE_LIVE_TRADING) {
    fsm.transition(pos, 'OPEN');
    return;
  }

  const mintPk = new PublicKey(mint);

  const simGate = await transactionEngine.simulateBuySellGate({
    payer,
    buildBuyTx: () =>
      adapter.buildBuyTx({
        payer: payer.publicKey,
        mint: mintPk,
        amount: size,
        denominatedInSol: true
      }),
    buildSellTx: () =>
      adapter.buildSellTx({
        payer: payer.publicKey,
        mint: mintPk,
        amount: '10%',
        denominatedInSol: false
      })
  });

  if (!simGate.ok) {
    alerts.notify('warn', `Sim gate blocked ${mint}: ${simGate.reason}`);
    fsm.transition(pos, 'CLOSED', { error: simGate.reason });
    openMints.delete(mint);
    return;
  }

  const { exec, fill } = await transactionEngine.sendWithRetryAndFetchFill({
    txBuilder: () =>
      adapter.buildBuyTx({
        payer: payer.publicKey,
        mint: mintPk,
        amount: size,
        denominatedInSol: true
      }),
    payer,
    mint: mintPk,
    maxWaitMs: 6000
  });

  if (exec.confirmed && exec.signature) {
    if (fill?.ok) {
      const tokens = typeof fill.tokenDelta === 'number' ? fill.tokenDelta : undefined;
      const solDelta = typeof fill.solDelta === 'number' ? fill.solDelta : undefined;
      const solSpent = typeof solDelta === 'number' ? -solDelta : undefined;

      if (tokens && tokens > 0 && solSpent && solSpent > 0) {
        pos.tokens = tokens;
        pos.entryPrice = solSpent / tokens;
        storage.savePosition(pos);
        alerts.notify(
          'info',
          `Fill: ${mint} spent ${solSpent.toFixed(4)} SOL, got ${tokens.toFixed(4)} tokens, entry ~ ${pos.entryPrice.toFixed(8)} SOL/token`
        );
      } else {
        alerts.notify(
          'warn',
          `Fill parse incomplete for ${mint} (tokens=${tokens ?? 'n/a'}, solSpent=${solSpent ?? 'n/a'}). Using fallback entryPrice.`
        );
      }
    } else if (fill && !fill.ok) {
      alerts.notify('warn', `Fill fetch failed for ${mint}: ${fill.err}. Using fallback entryPrice.`);
    }

    fsm.transition(pos, 'OPEN', { entrySignature: exec.signature });
  } else {
    alerts.notify('error', `Entry failed ${mint}: ${exec.error}`);
    fsm.transition(pos, 'CLOSED', { error: exec.error });
    openMints.delete(mint);
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

  setInterval(() => {
    void manageExitsTick().catch((e) => {
      alerts.notify('error', `exit manager error: ${e?.message || e}`);
    });
  }, 1000);

  startFeed();
})().catch((e) => {
  alerts.notify('error', `Startup failed: ${e?.message || e}`);
  process.exit(1);
});
