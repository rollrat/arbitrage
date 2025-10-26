Docker Compose (TimescaleDB)

1) Create env file
   cp .env.timescale.example .env
   # then edit credentials/port as needed

2) Bring up TimescaleDB
   docker compose up -d
   # First startup will run db/timescale/schema.sql automatically

3) Verify
   docker compose ps
   docker exec -it timescaledb psql -U $TS_USER -d $TS_DB -c "\dt+"

4) Connect from server
   In server/.env set:
   USE_TIMESCALE=true
   PGHOST=localhost
   PGPORT=${TS_PORT}
   PGUSER=${TS_USER}
   PGPASSWORD=${TS_PASSWORD}
   PGDATABASE=${TS_DB}

Notes
- schema.sql is applied only on first init (empty data dir). To re-apply, remove the volume:
  docker compose down -v  # WARNING: deletes DB data
  docker compose up -d
- Data volume: timescale-data (named volume)
