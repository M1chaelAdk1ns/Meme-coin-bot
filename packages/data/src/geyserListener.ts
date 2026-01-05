import { EventEmitter } from 'events';

export type GeyserSlotUpdate = {
  slot: number;
  blockhash: string;
  timestamp: number;
};

export interface GeyserListener {
  start(): void;
  stop(): void;
  onSlot(callback: (slot: GeyserSlotUpdate) => void): void;
}

export class StubGeyserListener extends EventEmitter implements GeyserListener {
  start() {
    this.emit('ready');
  }

  stop() {
    this.removeAllListeners();
  }

  onSlot(callback: (slot: GeyserSlotUpdate) => void) {
    this.on('slot', callback);
  }
}
