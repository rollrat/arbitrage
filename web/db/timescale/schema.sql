-- TimescaleDB schema for multi-symbol ticks and candles
CREATE EXTENSION IF NOT EXISTS timescaledb;

-- raw ticks (ms)
CREATE TABLE IF NOT EXISTS ticks (
  symbol TEXT NOT NULL,
  ts_ms  BIGINT NOT NULL,
  spot   DOUBLE PRECISION,
  mark   DOUBLE PRECISION,
  basis_bps DOUBLE PRECISION,
  PRIMARY KEY (symbol, ts_ms)
);
SELECT create_hypertable('ticks','ts_ms', if_not_exists => TRUE);

-- 1s candles (server aggregates pushed here)
CREATE TABLE IF NOT EXISTS candles_1s (
  symbol TEXT NOT NULL,
  ts_s   BIGINT NOT NULL,
  type   TEXT NOT NULL CHECK (type IN ('basis','spot','mark')),
  open   DOUBLE PRECISION,
  high   DOUBLE PRECISION,
  low    DOUBLE PRECISION,
  close  DOUBLE PRECISION,
  PRIMARY KEY (symbol, ts_s, type)
);
SELECT create_hypertable('candles_1s','ts_s', if_not_exists => TRUE);

-- 1m continuous aggregate built from 1s
CREATE MATERIALIZED VIEW IF NOT EXISTS candles_1m
WITH (timescaledb.continuous) AS
SELECT
  symbol,
  type,
  EXTRACT(EPOCH FROM time_bucket('1 minute', to_timestamp(ts_s)))::BIGINT AS ts_s,
  FIRST(open, to_timestamp(ts_s)) AS open,
  MAX(high) AS high,
  MIN(low)  AS low,
  LAST(close, to_timestamp(ts_s)) AS close
FROM candles_1s
GROUP BY symbol, type, time_bucket('1 minute', to_timestamp(ts_s));

-- Optional: refresh policy for the last 2 hours every minute
SELECT add_continuous_aggregate_policy('candles_1m',
  start_offset => INTERVAL '2 hours',
  end_offset   => INTERVAL '1 minute',
  schedule_interval => INTERVAL '1 minute');

-- Retention policies (tune as needed)
SELECT add_retention_policy('ticks',       INTERVAL '3 days', if_not_exists => TRUE);
SELECT add_retention_policy('candles_1s',  INTERVAL '14 days', if_not_exists => TRUE);
-- 1m keep for 180 days
SELECT add_retention_policy('candles_1m',  INTERVAL '180 days', if_not_exists => TRUE);

-- Compression (optional)
ALTER TABLE ticks SET (
  timescaledb.compress,
  timescaledb.compress_segmentby = 'symbol'
);
SELECT add_compression_policy('ticks', INTERVAL '1 day', if_not_exists => TRUE);

ALTER TABLE candles_1s SET (
  timescaledb.compress,
  timescaledb.compress_segmentby = 'symbol,type'
);
SELECT add_compression_policy('candles_1s', INTERVAL '1 day', if_not_exists => TRUE);

ALTER MATERIALIZED VIEW candles_1m SET (
  timescaledb.compress,
  timescaledb.compress_segmentby = 'symbol,type'
);
SELECT add_compression_policy('candles_1m', INTERVAL '7 days', if_not_exists => TRUE);
