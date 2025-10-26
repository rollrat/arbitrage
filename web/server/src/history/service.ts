import { type Env } from '../env'
import { getPool } from '../pg'

export type TickRow = { symbol: string; ts: number; spot: number; mark: number; basisBps: number }

export class HistoryService {
  constructor(private env: Env) { }

  async getTicks(params: { symbol: string; fromMs: number; toMs: number; limit?: number }): Promise<TickRow[]> {
    const pool = getPool(this.env)
    if (!pool) return []
    const limit = Math.max(1, Math.min(params.limit ?? 10000, 200000))
    const sql = `SELECT symbol, ts_ms AS ts, spot, mark, basis_bps AS "basisBps"
                 FROM ticks
                 WHERE symbol = $1 AND ts_ms >= $2 AND ts_ms <= $3
                 ORDER BY ts_ms ASC
               `
    const res = await pool.query(sql, [params.symbol, params.fromMs, params.toMs])
    return res.rows as TickRow[]
  }
}

