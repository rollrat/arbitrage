import fs from 'fs';
import path from 'path';

export type Env = {
  USE_WS?: boolean;
  USE_TIMESCALE?: boolean;
  PGHOST?: string; PGPORT?: number; PGUSER?: string; PGPASSWORD?: string; PGDATABASE?: string;
  PORT: number;
  SYMBOL: string;
  INTERVAL_MS: number;
  BINANCE_TESTNET: boolean;
  BINANCE_BASE_URL?: string;
  BINANCE_FUTURES_TESTNET: boolean;
  BINANCE_FUTURES_BASE_URL?: string;
};

export function loadEnv(): Env {
  const envPath = path.resolve(process.cwd(), '.env');
  if (fs.existsSync(envPath)) {
    const raw = fs.readFileSync(envPath, 'utf8');
    for (const line of raw.split(/\r?\n/)) {
      const s = line.trim();
      if (!s || s.startsWith('#') || !s.includes('=')) continue;
      const [k, v] = s.split('=', 2);
      process.env[k.trim()] = (v ?? '').trim().replace(/^"|"$/g, '').replace(/^'|'$/g, '');
    }
  }
  const get = (k: string, d?: string) => process.env[k] ?? d;
  const bool = (s?: string) => (s ?? '').toLowerCase() === 'true' || (s ?? '') === '1';
  const num = (s?: string, d = 0) => (s ? Number(s) : d);
  return {
    PORT: num(get('PORT'), 4000),
    SYMBOL: get('SYMBOL', 'BTCUSDT')!,
    INTERVAL_MS: num(get('INTERVAL_MS'), 1),
    BINANCE_TESTNET: bool(get('BINANCE_TESTNET')),
    BINANCE_BASE_URL: get('BINANCE_BASE_URL'),
    BINANCE_FUTURES_TESTNET: bool(get('BINANCE_FUTURES_TESTNET')),
    BINANCE_FUTURES_BASE_URL: get('BINANCE_FUTURES_BASE_URL'),
    USE_WS: bool(get('USE_WS')),
    USE_TIMESCALE: bool(get("USE_TIMESCALE")),
    PGHOST: get("PGHOST"),
    PGPORT: num(get("PGPORT")),
    PGUSER: get("PGUSER"),
    PGPASSWORD: get("PGPASSWORD"),
    PGDATABASE: get("PGDATABASE"),
  };
}

