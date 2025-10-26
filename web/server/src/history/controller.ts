import { Controller, Get, Query, Res } from '@nestjs/common'
import { loadEnv } from '../env'
import { HistoryService } from './service'

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
      const rows = await this.svc.getTicks({ symbol: s, fromMs, toMs, limit: lim })
      return res?.status(200).json(rows)
    } catch (e: any) {
      return res?.status(500).json({ error: e?.message || 'internal_error' })
    }
  }
}
