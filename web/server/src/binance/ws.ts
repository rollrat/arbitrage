import WebSocket from 'ws';

export type WSStop = () => void;

export function connectWS(url: string, onData: (msg: any) => void, onStatus?: (s: 'open'|'close'|'error') => void): WSStop {
  let ws: WebSocket | null = null;
  let retry = 1000;
  const open = () => {
    ws = new WebSocket(url);
    ws.on('open', () => {
      retry = 1000;
      onStatus?.('open');
    });
    ws.on('message', (buf) => {
      try {
        const txt = buf.toString('utf8');
        const msg = JSON.parse(txt);
        onData(msg);
      } catch {}
    });
    ws.on('close', () => {
      onStatus?.('close');
      setTimeout(open, retry = Math.min(retry * 2, 15000));
    });
    ws.on('error', () => {
      onStatus?.('error');
      try { ws?.close(); } catch {}
    });
  };
  open();
  return () => { try { ws?.close(); } catch {} };
}
import WebSocket from 'ws';

export type WSStop = () => void;

export function connectWS(
  url: string,
  onData: (msg: any) => void,
  onStatus?: (s: 'open' | 'close' | 'error') => void,
): WSStop {
  let ws: WebSocket | null = null;
  let retry = 1000;
  let heartbeat: NodeJS.Timeout | null = null;

  const cleanup = () => {
    if (heartbeat) { clearInterval(heartbeat as any); heartbeat = null; }
  };

  const open = () => {
    ws = new WebSocket(url);
    ws.on('open', () => {
      retry = 1000;
      onStatus?.('open');
      // keepalive ping (helps with NAT/proxy timeouts)
      cleanup();
      heartbeat = setInterval(() => { try { ws?.ping(); } catch {} }, 20000) as any;
    });
    ws.on('message', (buf) => {
      try {
        const txt = (buf as any).toString('utf8');
        const msg = JSON.parse(txt);
        onData(msg);
      } catch {
        // ignore non-JSON frames
      }
    });
    ws.on('close', () => {
      onStatus?.('close');
      cleanup();
      setTimeout(open, (retry = Math.min(retry * 2, 15000)));
    });
    ws.on('error', () => {
      onStatus?.('error');
      cleanup();
      try { ws?.close(); } catch {}
    });
  };
  open();
  return () => { cleanup(); try { ws?.close(); } catch {} };
}
