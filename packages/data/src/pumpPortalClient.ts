import WebSocket from 'ws';
import { dedupeKey, logger, env, RollingDedupe } from '@meme-bot/core';
import { EventEmitter } from 'events';

export type PumpPortalEvent =
  | { type: 'newToken'; data: any }
  | { type: 'trade'; data: any };

export class PumpPortalClient extends EventEmitter {
  private ws?: WebSocket;
  private dedupe = new RollingDedupe(6000);
  private heartbeat?: NodeJS.Timeout;

  constructor(private url: string = env.PUMP_PORTAL_URL) {
    super();
  }

  start() {
    this.connect();
  }

  private connect(retry = 0) {
    this.ws = new WebSocket(this.url);

    this.ws.on('open', () => {
      logger.info({ url: this.url }, 'pump portal connected');
      this.subscribeNewToken();
      this.emit('connected');
      this.startHeartbeat();
    });

    this.ws.on('message', (buf) => this.handleMessage(buf.toString()));

    this.ws.on('close', () => {
      logger.warn('pump portal connection closed, retrying');
      this.stopHeartbeat();
      setTimeout(() => this.connect(retry + 1), Math.min(5000 * (retry + 1), 15000));
    });

    this.ws.on('error', (err) => {
      logger.error({ err }, 'pump portal error');
      this.ws?.close();
    });
  }

  private startHeartbeat() {
    this.stopHeartbeat();
    this.heartbeat = setInterval(() => {
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
      this.ws.ping();
    }, 15000);
  }

  private stopHeartbeat() {
    if (this.heartbeat) clearInterval(this.heartbeat);
  }

  subscribeTokenTrades(mint: string) {
    this.ws?.send(JSON.stringify({ method: 'subscribeTokenTrade', keys: [mint] }));
  }

  private subscribeNewToken() {
    this.ws?.send(JSON.stringify({ method: 'subscribeNewToken' }));
  }

  private handleMessage(raw: string) {
    try {
      const msg = JSON.parse(raw);

      // Better dedupe key: signature + mint + slot + txType (when available)
      const key = dedupeKey([msg.txType || '', msg.signature || '', msg.mint || '', msg.slot || '']);
      if (this.dedupe.has(key)) return;
      this.dedupe.add(key);

      if (msg.txType === 'create') {
        this.emit('event', { type: 'newToken', data: msg } satisfies PumpPortalEvent);
      } else if (msg.txType === 'trade') {
        this.emit('event', { type: 'trade', data: msg } satisfies PumpPortalEvent);
      }
    } catch (err) {
      logger.warn({ err, raw }, 'failed to parse pump portal message');
    }
  }
}
