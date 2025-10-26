import React, { useEffect, useMemo, useState } from 'react'
import LightChart, { LinePoint } from './LightChart'
import CandleChart, { Candle } from './CandleChart'
import { Tick } from './types'

const DEFAULT_WS = `${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}/ws`
const WS_URL: string = (import.meta as any).env?.VITE_WS_URL || DEFAULT_WS
const API_BASE: string = (import.meta as any).env?.VITE_API_BASE || ''

type TF = 'tick' | '1s' | '1m'

function useWs(onFirstOpen?: () => void) {
  const [tick, setTick] = useState<Tick | null>(null)
  const [status, setStatus] = useState<'connecting' | 'open' | 'closed'>('connecting')
  useEffect(() => {
    let ws: WebSocket | null = new WebSocket(WS_URL)
    let timer: any
    ws.onopen = () => { setStatus('open'); onFirstOpen?.() }
    ws.onclose = () => { setStatus('closed'); timer = setTimeout(() => { setStatus('connecting'); ws = new WebSocket(WS_URL) }, 1000) }
    ws.onerror = () => { try { ws?.close() } catch { } }
    ws.onmessage = (ev) => { try { const t = JSON.parse(ev.data); setTick(t) } catch { } }
    return () => { clearTimeout(timer); try { ws?.close() } catch { } }
  }, [])
  return { tick, status }
}

function aggregateOHLC(ticks: Tick[], bucketMs: number, pick: (t: Tick) => number): Candle[] {
  const map = new Map<number, Candle>()
  for (const t of ticks) {
    const k = Math.floor((t.ts || Date.now()) / bucketMs)
    const price = pick(t)
    const prev = map.get(k)
    if (!prev) map.set(k, { time: k * (bucketMs / 1000), open: price, high: price, low: price, close: price })
    else { prev.high = Math.max(prev.high, price); prev.low = Math.min(prev.low, price); prev.close = price }
  }
  return Array.from(map.values()).sort((a, b) => a.time - b.time)
}

export default function App() {
  const [ticks, setTicks] = useState<Tick[]>([])
  const { tick, status } = useWs()
  const [tf, setTf] = useState<TF>('tick')
  const [sharedRange, setSharedRange] = useState<{ from: number; to: number } | null>(null)

  // initial 10m backfill from server (if available)
  useEffect(() => {
    let aborted = false
    const now = Date.now()
    const from = now - 10 * 60 * 1000
    fetch(`${API_BASE}/api/history/ticks?from=${from}&to=${now}`)
      .then(r => (r.ok ? r.json() : []))
      .then((rows: any[]) => {
        if (aborted || !Array.isArray(rows)) return
        const mapped: Tick[] = rows.map(r => ({ symbol: r.symbol, spot: r.spot, mark: r.mark, basisBps: r.basisBps, ts: r.ts }))
        mapped.sort((a, b) => a.ts - b.ts)
        setTicks(mapped)
      })
      .catch(() => { /* ignore, fallback to WS only */ })
    return () => { aborted = true }
  }, [])

  // keep all ticks (avoid duplicates by ts)
  useEffect(() => {
    if (!tick) return
    setTicks(arr => {
      const n = arr.length
      if (n > 0 && arr[n - 1].ts === tick.ts) return arr
      return [...arr, tick]
    })
  }, [tick])

  const bucketMs = useMemo(() => tf === '1m' ? 60000 : 1000, [tf])

  // basis line (tick mode)
  const basisLine: LinePoint[] = useMemo(
    () => ticks.map(t => ({ time: (t.ts / 1000), value: t.basisBps })),
    [ticks]
  )

  // candles
  const basisCandles = useMemo(() => aggregateOHLC(ticks, bucketMs, t => t.basisBps), [ticks, bucketMs])
  const spotCandles = useMemo(() => aggregateOHLC(ticks, bucketMs, t => t.spot), [ticks, bucketMs])
  const markCandles = useMemo(() => aggregateOHLC(ticks, bucketMs, t => t.mark), [ticks, bucketMs])

  const symbol = tick?.symbol ?? 'BTCUSDT'

  return (
    <div style={{ fontFamily: 'Inter, ui-sans-serif', color: '#eee', background: '#0b0b0b', minHeight: '100vh', padding: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
        <h2 style={{ margin: 0 }}>Basis Viewer</h2>
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={() => setTf('tick')} style={{ padding: '4px 8px', background: tf === 'tick' ? '#444' : '#222', color: '#eee', border: '1px solid #333', borderRadius: 4 }}>틱</button>
          <button onClick={() => setTf('1s')} style={{ padding: '4px 8px', background: tf === '1s' ? '#444' : '#222', color: '#eee', border: '1px solid #333', borderRadius: 4 }}>1초</button>
          <button onClick={() => setTf('1m')} style={{ padding: '4px 8px', background: tf === '1m' ? '#444' : '#222', color: '#eee', border: '1px solid #333', borderRadius: 4 }}>1분</button>
        </div>
      </div>

      <div style={{ marginBottom: 8, fontSize: 14 }}>
        <span>status: {status} | symbol: {symbol} | </span>
        <span>spot: {tick?.spot?.toFixed(2)} | mark: {tick?.mark?.toFixed(2)} | basis: {tick?.basisBps?.toFixed(2)} bps</span>
      </div>

      {tf === 'tick' ? (
        <>
          <LightChart data={basisLine} height={220} background="#0e0e0e" textColor="#e5e5e5" />
          <div style={{ marginTop: 4, fontSize: 12, color: '#aaa' }}>basis (bps)</div>
        </>
      ) : (
        <>
          <div style={{ marginBottom: 4, fontSize: 13, color: '#ddd' }}>Basis (candles)</div>
          <CandleChart data={basisCandles} height={240} background="#0e0e0e" textColor="#e5e5e5" sync syncRange={sharedRange} onRangeChange={setSharedRange} />
        </>
      )}

      <div style={{ marginTop: 16, marginBottom: 4, fontSize: 13, color: '#ddd' }}>Spot (candles)</div>
      <CandleChart data={spotCandles} height={240} background="#0e0e0e" textColor="#e5e5e5" sync={tf !== 'tick'} syncRange={sharedRange} onRangeChange={setSharedRange} />
      <div style={{ marginTop: 16, marginBottom: 4, fontSize: 13, color: '#ddd' }}>Mark (candles)</div>
      <CandleChart data={markCandles} height={240} background="#0e0e0e" textColor="#e5e5e5" sync={tf !== 'tick'} syncRange={sharedRange} onRangeChange={setSharedRange} />
    </div>
  )
}
