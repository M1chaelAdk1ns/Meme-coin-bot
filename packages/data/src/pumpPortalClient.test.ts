import { describe, it, expect, vi } from 'vitest';
import { PumpPortalClient } from './pumpPortalClient';
import { EventEmitter } from 'events';

class MockWS extends EventEmitter {
  readyState = 1;
  sendPayloads: string[] = [];
  constructor() {
    super();
    setTimeout(() => this.emit('open'), 0);
  }
  send(data: string) {
    this.sendPayloads.push(data);
  }
  ping() {}
  close() {}
}

vi.mock('ws', () => ({ default: MockWS as any }));

describe('PumpPortalClient', () => {
  it('emits parsed events and dedupes', async () => {
    const client = new PumpPortalClient('ws://test');
    const events: any[] = [];
    client.on('event', (e) => events.push(e));
    client.start();
    const instance = client as any;
    const ws: MockWS = instance.ws || new MockWS();
    const msg = JSON.stringify({ txType: 'create', mint: 'mint', slot: 1 });
    ws.emit('message', Buffer.from(msg));
    ws.emit('message', Buffer.from(msg));
    await new Promise((r) => setTimeout(r, 10));
    expect(events.length).toBe(1);
  });
});
