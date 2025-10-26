import { WebSocketGateway, WebSocketServer, OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect } from '@nestjs/websockets';
import { Server, WebSocket } from 'ws';
import { BasisService } from '../basis/service';
import { BasisTick } from '../basis/calc';

@WebSocketGateway({ path: '/ws' })
export class BasisGateway implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server!: Server;
  private svc = new BasisService();
  private clients = new Set<WebSocket>();

  afterInit() {
    this.svc.on('tick', (t: BasisTick) => this.broadcast(t));
    this.svc.start();
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

  private broadcast(t: BasisTick) {
    const msg = JSON.stringify(t);
    for (const c of this.clients) {
      if ((c as any).readyState === 1) {
        try { c.send(msg); } catch {}
      }
    }
  }
}
