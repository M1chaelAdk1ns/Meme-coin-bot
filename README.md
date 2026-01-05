# Pump.fun Meme Coin Bot (TypeScript)

This monorepo provides a production-grade starting point for a pump.fun-focused trading bot written in TypeScript. It ships with DRY_RUN defaults, a live PumpPortal websocket ingestion pipeline, a modular risk/strategy stack, transaction execution stubs, SQLite persistence, and a Telegram UI.

## Quickstart (Windows)
1. Install [Node.js 20+](https://nodejs.org/) and Git.
2. Clone the repo and install dependencies:
   ```bash
   npm install
   ```
3. Copy `.env.example` to `.env` and adjust settings. DRY_RUN is enabled by default.
4. Run the bot in paper-trade mode:
   ```bash
   npm run start --workspace @meme-bot/runner
   ```

## Environment
Key settings live in `.env` and are validated with `zod`.

- `DRY_RUN` defaults to `true`. Set `ENABLE_LIVE_TRADING=true` to send real transactions after configuring keys and RPCs.
- `RPC_URLS` supports a comma-separated list for retry ladders.
- Telemetry/logging uses `pino` to STDOUT.

## Telegram Commands
- `/start` – welcome message.
- `/status` – feed connectivity and open positions summary.
- `/config` – base sizing and max trade limits.
- `/pause_entries` / `/resume_entries` – toggles entry attempts (placeholder wiring).

Set `TELEGRAM_BOT_TOKEN` and `TELEGRAM_ADMIN_CHAT_ID` in the environment to enable the bot.

## Architecture
```
packages/
  core       – shared types, config, logging helpers
  data       – PumpPortal websocket client + Geyser listener stub
  risk       – survivability-first risk engine
  strategy   – strategy framework with Launch Momentum + Pullback Reclaim
  exec       – transaction engine with compute budget + pump.fun adapter scaffold
  storage    – SQLite persistence via better-sqlite3
  alerts     – alert abstraction (logs/console)
  telegram   – Telegraf-based admin bot
apps/
  runner     – end-to-end orchestrator (DRY_RUN pipeline)
  cli        – small helper to inspect stored positions
```

The `apps/runner` app wires live data ingestion, risk evaluation, strategy voting, position state machine, and (in live mode) transaction execution via RPC. Compute budget instructions and priority fees are added automatically.

## DRY_RUN vs Live Trading
- **DRY_RUN (default):** positions are simulated, trades are logged/persisted without submitting transactions.
- **Live:** set `DRY_RUN=false` and `ENABLE_LIVE_TRADING=true`, supply a funded keypair (to be integrated) and reliable RPC/Jito. The transaction engine retries with fresh blockhashes and escalating priority fees.

## Adding a New Strategy
1. Implement the `Strategy` interface in `packages/strategy`.
2. Export it from `src/index.ts`.
3. Register it in `apps/runner` by adding to the `StrategyEngine` constructor array.

## Known Risks & Safety Notes
- Pump.fun layouts can change; the adapter contains TODO placeholders for production instruction data.
- Always test in DRY_RUN before enabling live trading.
- Respect max trade sizing (`MAX_TRADE_SOL <= 0.75`).
- Ensure Telegram admin chat IDs are correct to avoid unauthorized control.

## Tests
Run unit tests:
```bash
npm test
```
