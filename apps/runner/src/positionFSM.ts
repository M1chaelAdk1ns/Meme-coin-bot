import { Position, PositionState } from '@meme-bot/core';
import { v4 as uuid } from 'uuid';

export class PositionFSM {
  constructor(private persist: (pos: Position) => void) {}

  create(
    mint: string,
    sizeSol: number,
    stopLossPct: number,
    takeProfits: { pct: number; profit: number }[],
    trailMode: string
  ): Position {
    const now = Date.now();
    const position: Position = {
      id: uuid(),
      mint,
      state: 'PENDING_ENTRY',
      sizeSol,
      stopLossPct,
      takeProfits,
      trailMode,
      tpFilled: 0,
      createdAt: now,
      updatedAt: now
    };
    this.persist(position);
    return position;
  }

  transition(
    pos: Position,
    next: PositionState,
    meta?: { entrySignature?: string; exitSignature?: string; error?: string }
  ) {
    const now = Date.now();

    if (meta?.entrySignature) pos.entrySignature = meta.entrySignature;
    if (meta?.exitSignature) pos.exitSignature = meta.exitSignature;
    if (meta?.error) pos.lastError = meta.error;

    if (next === 'OPEN' && !pos.entryTimestamp) {
      pos.entryTimestamp = now;
    }

    pos.state = next;
    pos.updatedAt = now;
    this.persist(pos);
  }
}
