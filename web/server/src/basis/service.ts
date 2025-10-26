import { EventEmitter } from 'events';
import { loadEnv, type Env } from '../env';
import { getSpotPrice } from '../binance/spot';
import { getFuturesMark } from '../binance/futures';
import { BasisTick, computeBasisBps } from './calc';
import { connectWS } from '../binance/ws';
import { Pool } from 'pg';
import { getPool } from '../pg';

export class BasisService extends EventEmitter {
  private timer?: NodeJS.Timeout;
  private wsStops: Array<() => void> = [];
  private last?: BasisTick;
  private pg?: Pool;
  private tickBuf: Array<[string, number, number, number, number]> = [];
  private lastFlush = 0;
  private recent: BasisTick[] = [];

  constructor(private env: Env = loadEnv()) {
    super();
    this.pg = getPool(this.env);
  }

  public start() {
    if (this.timer || this.wsStops.length) return;
    if (this.env.USE_WS) {
      this.startWS();
    } else {
      const interval = Math.max(100, this.env.INTERVAL_MS);
      this.timer = setInterval(() => this.tick().catch(() => { }), interval);
      this.tick().catch(() => { });
    }
  }

  public stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
    for (const s of this.wsStops) { try { s(); } catch { } }
    this.wsStops = [];
  }

  public getLast(): BasisTick | undefined { return this.last; }
  public getRecent(windowMs: number): BasisTick[] {
    const now = Date.now();
    const from = now - Math.max(0, windowMs);
    // recent is kept in ascending order
    return this.recent.filter(t => t.ts >= from);
  }

  private restBaseUrls() {
    const spot = this.env.BINANCE_BASE_URL ?? (this.env.BINANCE_TESTNET ? 'https://testnet.binance.vision' : 'https://api.binance.com');
    const fut = this.env.BINANCE_FUTURES_BASE_URL ?? (this.env.BINANCE_FUTURES_TESTNET ? 'https://testnet.binancefuture.com' : 'https://fapi.binance.com');
    return { spot, fut };
  }

  private wsBaseUrls() {
    const spot = this.env.BINANCE_TESTNET
      ? 'wss://testnet.binance.vision/stream?streams='
      : 'wss://stream.binance.com:9443/stream?streams=';
    const fut = this.env.BINANCE_FUTURES_TESTNET
      ? 'wss://stream.binancefuture.com/stream?streams='
      : 'wss://fstream.binance.com/stream?streams=';
    return { spot, fut };
  }

  private async tick() {
    const { spot: spotBase, fut: futBase } = this.restBaseUrls();
    const symbol = this.env.SYMBOL;
    try {
      const [s, m] = await Promise.all([
        getSpotPrice(spotBase, symbol),
        getFuturesMark(futBase, symbol),
      ]);
      this.publish(s, m);
    } catch (e) {
      this.emit('error', e);
    }
  }

  private publish(spot: number, mark: number) {
    const basisBps = computeBasisBps(spot, mark);
    const t: BasisTick = { symbol: this.env.SYMBOL, spot, mark, basisBps, ts: Date.now() };
    this.last = t; this.emit('tick', t);
    // keep in-memory recent buffer (~30 minutes at ~10Hz -> cap by count)
    this.recent.push(t);
    if (this.recent.length > 20000) this.recent.splice(0, this.recent.length - 20000);
    if (this.pg) this.pushTick(t.symbol, t.ts, t.spot, t.mark, t.basisBps);
  }

  private startWS() {
    const { spot, fut } = this.wsBaseUrls();
    const s = this.env.SYMBOL.toLowerCase();
    const spotUrl = `${spot}${s}@bookTicker`;
    const futUrl = `${fut}${s}@markPrice@1s`;
    let spotMid = 0; let mark = 0;
    const push = () => { if (spotMid > 0 && mark > 0) this.publish(spotMid, mark); };

    const stop1 = connectWS(spotUrl, (msg: any) => {
      const d = msg?.data; // combined stream payload
      if (d && d.b && d.a) {
        const bid = parseFloat(d.b), ask = parseFloat(d.a);
        if (isFinite(bid) && isFinite(ask)) { spotMid = (bid + ask) / 2; push(); }
      }
    });
    const stop2 = connectWS(futUrl, (msg: any) => {
      const d = msg?.data; // { p: markPrice, i: symbol, ... }
      const p = d?.p ?? d?.markPrice;
      if (p != null) { const mp = parseFloat(p); if (isFinite(mp)) { mark = mp; push(); } }
    });
    this.wsStops.push(stop1, stop2);
  }

  private pushTick(symbol: string, ts_ms: number, spot: number, mark: number, basis: number) {
    this.tickBuf.push([symbol, ts_ms, spot, mark, basis]);
    const now = Date.now();
    if ((now - this.lastFlush) > 250 || this.tickBuf.length >= 200) {
      this.flushTicks().catch(() => { });
    }
  }

  private async flushTicks() {
    if (!this.pg || this.tickBuf.length === 0) return;
    const buf = this.tickBuf; this.tickBuf = []; this.lastFlush = Date.now();
    // ticks bulk insert
    const placeholders = buf.map((_, i) => `($${i * 5 + 1},$${i * 5 + 2},$${i * 5 + 3},$${i * 5 + 4},$${i * 5 + 5})`).join(',');
    const flat: any[] = [];
    for (const [sym, ts, sp, mk, bs] of buf) flat.push(sym, ts, sp, mk, bs);
    const sql = `INSERT INTO ticks(symbol, ts_ms, spot, mark, basis_bps) VALUES ${placeholders} ON CONFLICT (symbol, ts_ms) DO NOTHING`;
    try { await this.pg!.query(sql, flat); } catch { }

    // build/upsert 1s candles for basis/spot/mark
    const bySec = new Map<string, { symbol: string; type: string; ts_s: number; o: number; h: number; l: number; c: number }>();
    for (const [sym, ts, sp, mk, bs] of buf) {
      const sec = Math.floor(ts / 1000);
      const apply = (type: string, px: number) => {
        const key = `${sym}|${type}|${sec}`;
        const v = bySec.get(key) || { symbol: sym, type, ts_s: sec, o: px, h: px, l: px, c: px };
        v.h = Math.max(v.h, px); v.l = Math.min(v.l, px); v.c = px;
        if (!bySec.has(key)) bySec.set(key, v);
      };
      apply('basis', bs); apply('spot', sp); apply('mark', mk);
    }
    const arr = Array.from(bySec.values());
    if (arr.length) {
      const vals = arr.map((_, i) => `($${i * 7 + 1},$${i * 7 + 2},$${i * 7 + 3},$${i * 7 + 4},$${i * 7 + 5},$${i * 7 + 6},$${i * 7 + 7})`).join(',');
      const data: any[] = [];
      for (const r of arr) data.push(r.symbol, r.ts_s, r.type, r.o, r.h, r.l, r.c);
      const up = 'INSERT INTO candles_1s(symbol, ts_s, type, open, high, low, close) VALUES ' + vals + ' ON CONFLICT (symbol, ts_s, type) DO UPDATE SET high=GREATEST(EXCLUDED.high, candles_1s.high), low=LEAST(EXCLUDED.low, candles_1s.low), close=EXCLUDED.close';
      try { await this.pg!.query(up, data); } catch { }
    }
  }
}

// Simple shared instance so multiple consumers (gateway, controllers) reuse one stream
export const basisSingleton = new BasisService();
