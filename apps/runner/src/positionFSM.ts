import { Position, PositionState } from '@meme-bot/core';
import { v4 as uuid } from 'uuid';

export class PositionFSM {
  constructor(private persist: (pos: Position) => void) {}

  create(mint: string, sizeSol: number, stopLossPct: number, takeProfits: { pct: number; profit: number }[], trailMode: string): Position {
    const position: Position = {
      id: uuid(),
      mint,
      state: 'PENDING_ENTRY',
      sizeSol,
      stopLossPct,
      takeProfits,
      trailMode,
      createdAt: Date.now(),
      updatedAt: Date.now()
    };
    this.persist(position);
    return position;
  }

  transition(pos: Position, next: PositionState) {
    pos.state = next;
    pos.updatedAt = Date.now();
    this.persist(pos);
  }
}
