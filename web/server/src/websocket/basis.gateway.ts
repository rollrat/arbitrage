import { WebSocketGateway, WebSocketServer, OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect } from '@nestjs/websockets';
import { Server, WebSocket } from 'ws';
import { basisSingleton as basisSvc } from '../basis/service';
import { BasisTick } from '../basis/calc';
import { loadEnv } from '../env';
import { connectWS } from '../binance/ws';

@WebSocketGateway({ path: '/ws' })
export class BasisGateway implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server!: Server;
  private svc = basisSvc;
  private clients = new Set<WebSocket>();
  private stopFns: Array<() => void> = [];

  afterInit() {
    this.svc.on('tick', (t: BasisTick) => this.broadcast(t));
    this.svc.start();

    const env = loadEnv();
    const s = env.SYMBOL.toLowerCase();
    const spotWsBase = env.BINANCE_TESTNET
      ? 'wss://testnet.binance.vision/stream?streams='
      : 'wss://stream.binance.com:9443/stream?streams=';
    const futWsBase = env.BINANCE_FUTURES_TESTNET
      ? 'wss://stream.binancefuture.com/stream?streams='
      : 'wss://fstream.binance.com/stream?streams=';

    const spotTradeUrl = `${spotWsBase}${s}@trade`;
    const futTradeUrl = `${futWsBase}${s}@trade`;
    const unwrap = (m: any) => (m && typeof m === 'object' && 'data' in m ? (m as any).data : m);

    const stop1 = connectWS(spotTradeUrl, (msg: any) => {
      const d = unwrap(msg);
      const p = d?.p, q = d?.q, ts = d?.T ?? d?.E;
      if (p != null && q != null) {
        const out = { type: 'spot_trade', symbol: env.SYMBOL, price: Number(p), qty: Number(q), ts: Number(ts) || Date.now() };
        this.broadcast(out as any);
      }
    });
    const stop2 = connectWS(futTradeUrl, (msg: any) => {
      const d = unwrap(msg);
      const p = d?.p, q = d?.q, ts = d?.T ?? d?.E;
      if (p != null && q != null) {
        const out = { type: 'futures_trade', symbol: env.SYMBOL, price: Number(p), qty: Number(q), ts: Number(ts) || Date.now() };
        this.broadcast(out as any);
      }
    });
    this.stopFns.push(stop1, stop2);
  }

  handleConnection(client: WebSocket) {
    this.clients.add(client);
    const last = this.svc.getLast();
    if (last) {
      try { client.send(JSON.stringify(last)); } catch {}
    }
  }

  handleDisconnect(client: WebSocket) {
    this.clients.delete(client);
  }

  private broadcast(t: any) {
    const msg = JSON.stringify(t);
    for (const c of this.clients) {
      if ((c as any).readyState === 1) {
        try { c.send(msg); } catch {}
      }
    }
  }
}
