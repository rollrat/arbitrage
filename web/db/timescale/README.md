TimescaleDB Setup (multi-symbol)

1) Install TimescaleDB and create database:
   - PostgreSQL 14+/15+ with timescaledb extension

2) Apply schema:
   psql $PGDATABASE -h $PGHOST -U $PGUSER -f db/timescale/schema.sql

3) Server env (web/server/.env):
   PGHOST=localhost
   PGPORT=5432
   PGUSER=your_user
   PGPASSWORD=your_password
   PGDATABASE=your_db
   USE_TIMESCALE=true

4) Server runtime:
   - Server will insert raw ticks into ticks, and 1s candles into candles_1s (upsert)
   - 1m candles generated via continuous aggregate (candles_1m)

5) Query examples:
   SELECT * FROM ticks WHERE symbol='BTCUSDT' AND ts_ms BETWEEN $from AND $to ORDER BY ts_ms;
   SELECT * FROM candles_1s WHERE symbol='BTCUSDT' AND type='basis' ORDER BY ts_s;
   SELECT * FROM candles_1m WHERE symbol='BTCUSDT' AND type='spot' ORDER BY ts_s;
