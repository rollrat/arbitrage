import { Controller, Get, Query, Res } from '@nestjs/common'
import { loadEnv } from '../env'
import { HistoryService } from './service'
import { basisSingleton } from '../basis/service'

@Controller('api/history')
export class HistoryController {
  private env = loadEnv()
  private svc = new HistoryService(this.env)

  @Get('ticks')
  async getTicks(
    @Query('symbol') symbol: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('limit') limit?: string,
    @Res() res?: any,
  ) {
    try {
      const s = (symbol || this.env.SYMBOL || 'BTCUSDT').toUpperCase()
      const now = Date.now()
      const fromMs = Number(from ?? (now - 10 * 60 * 1000))
      const toMs = Number(to ?? now)
      const lim = limit ? Number(limit) : undefined
      let rows = await this.svc.getTicks({ symbol: s, fromMs, toMs, limit: lim })
      // Fallback to in-memory recent buffer whenever DB has no rows or is unavailable
      if (!rows || rows.length === 0) {
        // ensure the live service is running so recent buffer fills
        try { basisSingleton.start() } catch { }
        const recent = basisSingleton.getRecent(toMs - fromMs)
        rows = recent
          .filter(t => t.symbol.toUpperCase() === s && t.ts >= fromMs && t.ts <= toMs)
          .map(t => ({ symbol: t.symbol, ts: t.ts, spot: t.spot, mark: t.mark, basisBps: t.basisBps }))
      }
      return res?.status(200).json(rows || [])
    } catch (e: any) {
      return res?.status(500).json({ error: e?.message || 'internal_error' })
    }
  }
}
