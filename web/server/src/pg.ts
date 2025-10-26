import { Pool } from 'pg'
import { type Env } from './env'

let pool: Pool | undefined

export function getPool(env: Env): Pool | undefined {
  if (pool) return pool
  if (env.USE_TIMESCALE && env.PGHOST && env.PGDATABASE) {
    pool = new Pool({
      host: env.PGHOST,
      port: env.PGPORT || 5432,
      user: env.PGUSER,
      password: env.PGPASSWORD,
      database: env.PGDATABASE,
      max: 4,
    })
  }
  return pool
}

