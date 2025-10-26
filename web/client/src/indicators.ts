import { Candle } from './CandleChart'

export type LinePoint = { time: number; value: number }
export type MACDPoint = { time: number; macd: number; signal: number; hist: number }

// EMA that seeds with SMA over the first 'period' finite values, ignoring NaNs.
function emaFull(values: number[], period: number): number[] {
  const out = new Array<number>(values.length).fill(NaN)
  if (period <= 1) return values.slice()
  const k = 2 / (period + 1)
  // collect first 'period' finite values for seed
  let seedSum = 0
  let seedCount = 0
  let seedEndIndex = -1
  for (let i = 0; i < values.length && seedCount < period; i++) {
    const v = values[i]
    if (Number.isFinite(v)) {
      seedSum += v
      seedCount += 1
      seedEndIndex = i
    }
  }
  if (seedCount < period) return out // not enough data
  let prev = seedSum / period
  out[seedEndIndex] = prev
  for (let i = seedEndIndex + 1; i < values.length; i++) {
    const v = values[i]
    if (!Number.isFinite(v)) { out[i] = NaN; continue }
    prev = v * k + prev * (1 - k)
    out[i] = prev
  }
  return out
}

export function calcRSI(candles: Candle[], length = 14): LinePoint[] {
  if (length < 1) length = 14
  const closes = candles.map(c => c.close)
  const times = candles.map(c => Math.floor(c.time as any))
  const out: (number | null)[] = Array(closes.length).fill(null)
  let avgGain = 0
  let avgLoss = 0
  for (let i = 1; i <= length; i++) {
    const delta = closes[i] - closes[i - 1]
    if (delta > 0) avgGain += delta; else avgLoss -= delta
  }
  avgGain /= length
  avgLoss /= length
  // avoid division by zero
  let rs = avgLoss === 0 ? (avgGain === 0 ? 1 : Infinity) : avgGain / avgLoss
  out[length] = 100 - 100 / (1 + rs)
  for (let i = length + 1; i < closes.length; i++) {
    const delta = closes[i] - closes[i - 1]
    const gain = Math.max(0, delta)
    const loss = Math.max(0, -delta)
    avgGain = (avgGain * (length - 1) + gain) / length
    avgLoss = (avgLoss * (length - 1) + loss) / length
    rs = avgLoss === 0 ? (avgGain === 0 ? 1 : Infinity) : avgGain / avgLoss
    out[i] = 100 - 100 / (1 + rs)
  }
  const pts: LinePoint[] = []
  for (let i = 0; i < out.length; i++) {
    const v = out[i]
    if (v == null || !Number.isFinite(v)) continue
    pts.push({ time: times[i], value: v })
  }
  return pts
}

export function calcMACD(candles: Candle[], fast = 12, slow = 26, signal = 9): MACDPoint[] {
  const closes = candles.map(c => c.close)
  const times = candles.map(c => Math.floor(c.time as any))
  const emaFast = emaFull(closes, fast)
  const emaSlow = emaFull(closes, slow)
  // build macd only where both fast/slow are defined
  const macdVals: number[] = []
  const macdTimes: number[] = []
  for (let i = 0; i < closes.length; i++) {
    const f = emaFast[i], s = emaSlow[i]
    if (Number.isFinite(f) && Number.isFinite(s)) {
      macdVals.push(f - s)
      macdTimes.push(times[i])
    }
  }
  if (macdVals.length === 0) return []
  const signalEMA = emaFull(macdVals, signal)
  const out: MACDPoint[] = []
  for (let j = 0; j < macdVals.length; j++) {
    const m = macdVals[j]
    const sig = signalEMA[j]
    if (!Number.isFinite(m) || !Number.isFinite(sig)) continue
    out.push({ time: macdTimes[j], macd: m, signal: sig, hist: m - sig })
  }
  return out
}
