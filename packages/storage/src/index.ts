import Database from 'better-sqlite3';
import { Position, RiskReport, TradeEvent, TokenInfo } from '@meme-bot/core';
import { env, logger } from '@meme-bot/core';

export class Storage {
  private db: Database.Database;
  constructor(path: string = env.SQLITE_PATH) {
    this.db = new Database(path);
    this.bootstrap();
  }

  private bootstrap() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS tokens(
        mint TEXT PRIMARY KEY,
        creator TEXT,
        freezeAuthority TEXT,
        mintAuthority TEXT,
        createdAt INTEGER
      );
      CREATE TABLE IF NOT EXISTS risk_reports(
        mint TEXT,
        score INTEGER,
        allow INTEGER,
        reasons TEXT,
        createdAt INTEGER
      );
      CREATE TABLE IF NOT EXISTS trades(
        signature TEXT PRIMARY KEY,
        mint TEXT,
        side TEXT,
        solAmount REAL,
        trader TEXT,
        slot INTEGER,
        timestamp INTEGER
      );
      CREATE TABLE IF NOT EXISTS positions(
        id TEXT PRIMARY KEY,
        mint TEXT,
        state TEXT,
        sizeSol REAL,
        tokens REAL,
        entryPrice REAL,
        stopLossPct REAL,
        takeProfits TEXT,
        trailMode TEXT,
        createdAt INTEGER,
        updatedAt INTEGER
      );
    `);
    logger.info('storage ready');
  }

  upsertToken(info: TokenInfo) {
    this.db.prepare(`INSERT OR REPLACE INTO tokens(mint, creator, freezeAuthority, mintAuthority, createdAt)
      VALUES (@mint,@creator,@freezeAuthority,@mintAuthority, strftime('%s','now'))`).run(info);
  }

  saveRiskReport(mint: string, report: RiskReport) {
    this.db.prepare(`INSERT INTO risk_reports(mint, score, allow, reasons, createdAt)
      VALUES (@mint, @score, @allow, @reasons, strftime('%s','now'))`).run({
      mint,
      score: report.score,
      allow: report.allow ? 1 : 0,
      reasons: report.reasons.join('|')
    });
  }

  saveTrade(event: TradeEvent) {
    this.db.prepare(`INSERT OR IGNORE INTO trades(signature, mint, side, solAmount, trader, slot, timestamp)
      VALUES (@signature,@mint,@side,@solAmount,@trader,@slot,@timestamp)`).run(event);
  }

  savePosition(pos: Position) {
    this.db.prepare(`INSERT OR REPLACE INTO positions(id, mint, state, sizeSol, tokens, entryPrice, stopLossPct, takeProfits, trailMode, createdAt, updatedAt)
      VALUES (@id,@mint,@state,@sizeSol,@tokens,@entryPrice,@stopLossPct,@takeProfits,@trailMode,@createdAt,@updatedAt)`).run({
      ...pos,
      takeProfits: JSON.stringify(pos.takeProfits)
    });
  }

  listOpenPositions(): Position[] {
    const rows = this.db.prepare(`SELECT * FROM positions WHERE state != 'CLOSED'`).all();
    return rows.map((r: any) => ({
      ...r,
      takeProfits: JSON.parse(r.takeProfits)
    }));
  }
}
