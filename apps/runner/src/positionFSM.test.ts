import { describe, it, expect } from 'vitest';
import { PositionFSM } from './positionFSM';
import { Position } from '@meme-bot/core';

const records: Position[] = [];
const fsm = new PositionFSM((p) => records.push({ ...p }));

describe('PositionFSM', () => {
  it('creates and transitions deterministically', () => {
    records.length = 0;

    const pos = fsm.create('mint', 0.4, 0.2, [], 'volatility');
    expect(pos.state).toBe('PENDING_ENTRY');

    fsm.transition(pos, 'OPEN');
    expect(pos.state).toBe('OPEN');
    expect(typeof pos.entryTimestamp).toBe('number');

    fsm.transition(pos, 'CLOSED');
    expect(pos.state).toBe('CLOSED');

    expect(records.length).toBe(3);
  });
});

