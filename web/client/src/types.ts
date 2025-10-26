export type Tick = {
  symbol: string
  spot: number
  mark: number
  basisBps: number
  ts: number
}

export type Trade = {
  type: 'spot_trade' | 'futures_trade'
  symbol: string
  price: number
  qty: number
  ts: number
}

