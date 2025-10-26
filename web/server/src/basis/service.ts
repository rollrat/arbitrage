import { EventEmitter } from 'events';
import { loadEnv } from '../env';
import { getSpotPrice } from '../binance/spot';
import { getFuturesMark } from '../binance/futures';
import { BasisTick, computeBasisBps } from './calc';

export class BasisService extends EventEmitter {
  private timer?: NodeJS.Timeout;
  private last?: BasisTick;
  constructor(private env = loadEnv()) { super(); }

  public start() {
    if (this.timer) return;
    const interval = Math.max(500, this.env.INTERVAL_MS);
    this.timer = setInterval(() => this.tick().catch(() => {}), interval);
    // kick
    this.tick().catch(() => {});
  }

  public stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }

  public getLast(): BasisTick | undefined { return this.last; }

  private baseUrls() {
    const spot = this.env.BINANCE_BASE_URL ?? (this.env.BINANCE_TESTNET ? 'https://testnet.binance.vision' : 'https://api.binance.com');
    const fut = this.env.BINANCE_FUTURES_BASE_URL ?? (this.env.BINANCE_FUTURES_TESTNET ? 'https://testnet.binancefuture.com' : 'https://fapi.binance.com');
    return { spot, fut };
  }

  private async tick() {
    const { spot: spotBase, fut: futBase } = this.baseUrls();
    const symbol = this.env.SYMBOL;
    try {
      const [s, m] = await Promise.all([
        getSpotPrice(spotBase, symbol),
        getFuturesMark(futBase, symbol),
      ]);
      const basisBps = computeBasisBps(s, m);
      const tick: BasisTick = { symbol, spot: s, mark: m, basisBps, ts: Date.now() };
      this.last = tick;
      this.emit('tick', tick);
    } catch (e) {
      this.emit('error', e);
    }
  }
}
