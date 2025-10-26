import React, { useEffect, useMemo, useRef, useState } from 'react'
import LightChart, { LinePoint } from './LightChart'
import CandleChart, { Candle } from './CandleChart'
import { Tick, Trade } from './types'
import { resolveCoinIcon } from './coinIcon'
import Trades from './Trades'

const DEFAULT_WS = `${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}/ws`
const WS_URL: string = (import.meta as any).env?.VITE_WS_URL || DEFAULT_WS
const API_BASE: string = (import.meta as any).env?.VITE_API_BASE || ''

type TF = 'tick' | '1s' | '1m'

function useWs(onFirstOpen?: () => void) {
  const [tick, setTick] = useState<Tick | null>(null)
  const [status, setStatus] = useState<'connecting' | 'open' | 'closed'>('connecting')
  useEffect(() => {
    console.log('useWs')
    let ws: WebSocket | null = new WebSocket(WS_URL)
    let timer: any
    ws.onopen = () => { setStatus('open'); onFirstOpen?.() }
    ws.onclose = () => { setStatus('closed'); timer = setTimeout(() => { setStatus('connecting'); ws = new WebSocket(WS_URL) }, 1000) }
    ws.onerror = () => { try { ws?.close() } catch { } }
    ws.onmessage = (ev) => {
      try {
        const obj = JSON.parse(ev.data)
        // Only accept BasisTick-like payloads here
        if (obj && typeof obj === 'object' &&
          Number.isFinite(obj.spot) && Number.isFinite(obj.mark) && Number.isFinite(obj.basisBps) && Number.isFinite(obj.ts)) {
          setTick(obj as Tick)
        }
      } catch { }
    }
    return () => { clearTimeout(timer); try { ws?.close() } catch { } }
  }, [])
  return { tick, status }
}

function aggregateOHLC(ticks: Tick[], bucketMs: number, pick: (t: Tick) => number): Candle[] {
  const map = new Map<number, Candle>()
  for (const t of ticks) {
    const k = Math.floor((t.ts || Date.now()) / bucketMs)
    const price = pick(t)
    if (!Number.isFinite(price)) continue
    const prev = map.get(k)
    if (!prev) map.set(k, { time: Math.floor(k * (bucketMs / 1000)), open: price, high: price, low: price, close: price })
    else {
      prev.high = Math.max(prev.high, price)
      prev.low = Math.min(prev.low, price)
      prev.close = price
    }
  }
  // drop any incomplete candles defensively
  return Array.from(map.values())
    .filter(c => [c.open, c.high, c.low, c.close].every(Number.isFinite))
    .sort((a, b) => a.time - b.time)
}

export default function App() {
  const [ticks, setTicks] = useState<Tick[]>([])
  const { tick, status } = useWs()
  const [tf, setTf] = useState<TF>('tick')
  // removed sharedRange state in favor of bus-based sync
  const [coinIconUrl, setCoinIconUrl] = useState<string | null>(null)
  const [spotTrades, setSpotTrades] = useState<Trade[]>([])
  const [futTrades, setFutTrades] = useState<Trade[]>([])
  // tick-mode line data (incremental)
  const [basisLine, setBasisLine] = useState<LinePoint[]>([])
  const [spotLine, setSpotLine] = useState<LinePoint[]>([])
  const [markLine, setMarkLine] = useState<LinePoint[]>([])
  const lastSecRef = useRef<number>(-Infinity)
  const tickIndexRef = useRef<number>(-1)
  const indexTimesRef = useRef<number[]>([])
  const [basisCandles, setBasisCandles] = useState<Candle[]>([])
  const [spotCandles, setSpotCandles] = useState<Candle[]>([])
  const [markCandles, setMarkCandles] = useState<Candle[]>([])
  const basisCandlesRef = useRef<Candle[]>([])
  const spotCandlesRef = useRef<Candle[]>([])
  const markCandlesRef = useRef<Candle[]>([])
  const candleFlushTimer = useRef<any>(null)

  // initial 10m backfill from server (if available)
  useEffect(() => {
    let aborted = false
    const now = Date.now()
    const from = now - 60 * 60 * 1000
    // const from = now - 1000;
    fetch(`${API_BASE}/api/history/ticks?from=${from}&to=${now}`)
      .then(r => (r.ok ? r.json() : []))
      .then((rows: any[]) => {
        if (aborted || !Array.isArray(rows)) return
        const mapped: Tick[] = rows.map(r => ({ symbol: r.symbol, spot: r.spot, mark: r.mark, basisBps: r.basisBps, ts: r.ts }))
        mapped.sort((a, b) => a.ts - b.ts)
        setTicks(mapped)
        // build initial tick lines once
        const bl: LinePoint[] = []
        const sl: LinePoint[] = []
        const ml: LinePoint[] = []
        indexTimesRef.current = []
        let idx = -1
        for (const t of mapped) {
          idx += 1
          indexTimesRef.current.push(t.ts)
          bl.push({ time: idx as any, value: t.basisBps })
          sl.push({ time: idx as any, value: t.spot })
          ml.push({ time: idx as any, value: t.mark })
        }
        tickIndexRef.current = idx
        setBasisLine(bl); setSpotLine(sl); setMarkLine(ml)
        // build initial candles for current tf
        const curBucket = (tf === '1m') ? 60000 : 1000
        const outB: Candle[] = []
        const outS: Candle[] = []
        const outM: Candle[] = []
        let key: number | null = null
        let cb: Candle | null = null
        let cs: Candle | null = null
        let cm: Candle | null = null
        for (const t of mapped) {
          const k = Math.floor(t.ts / curBucket)
          const time = k * (curBucket / 1000)
          if (key === null || k !== key) {
            if (cb) outB.push(cb); if (cs) outS.push(cs); if (cm) outM.push(cm)
            key = k
            const b = t.basisBps, s = t.spot, m = t.mark
            cb = { time, open: b, high: b, low: b, close: b }
            cs = { time, open: s, high: s, low: s, close: s }
            cm = { time, open: m, high: m, low: m, close: m }
          } else {
            const b = t.basisBps, s = t.spot, m = t.mark
            if (cb) { cb.high = Math.max(cb.high, b); cb.low = Math.min(cb.low, b); cb.close = b }
            if (cs) { cs.high = Math.max(cs.high, s); cs.low = Math.min(cs.low, s); cs.close = s }
            if (cm) { cm.high = Math.max(cm.high, m); cm.low = Math.min(cm.low, m); cm.close = m }
          }
        }
        if (cb) outB.push(cb); if (cs) outS.push(cs); if (cm) outM.push(cm)
        basisCandlesRef.current = outB; spotCandlesRef.current = outS; markCandlesRef.current = outM
        setBasisCandles(outB); setSpotCandles(outS); setMarkCandles(outM)
      })
      .catch(() => { /* ignore, fallback to WS only */ })
    return () => { aborted = true }
  }, [])

  const bucketMs = useMemo(() => {
    switch (tf) {
      case '1m':
        return 60000
      case '1s':
      case 'tick':
      default:
        // lightweight-charts 罹붾뱾 ?쒕━利덈뒗 珥덈떒?꾨쭔 吏????1珥?踰꾪궥
        return 1000
    }
  }, [tf])
  // keep all ticks strictly ascending by ts (ignore out-of-order)
  const lastTsRef = useRef<number>(0)
  useEffect(() => {
    if (!tick) return
    setTicks(arr => {
      const lastTs = arr.length ? arr[arr.length - 1].ts : lastTsRef.current
      if (tick.ts <= lastTs) return arr
      lastTsRef.current = tick.ts
      return [...arr, tick]
    })
    // append to tick lines incrementally (used only in tick mode rendering)
    const vBasis = tick.basisBps, vSpot = tick.spot, vMark = tick.mark
    if (Number.isFinite(vBasis) && Number.isFinite(vSpot) && Number.isFinite(vMark)) {
      const idx = (tickIndexRef.current = tickIndexRef.current + 1)
      indexTimesRef.current.push(tick.ts)
      setBasisLine(arr => [...arr, { time: idx as any, value: vBasis }])
      setSpotLine(arr => [...arr, { time: idx as any, value: vSpot }])
      setMarkLine(arr => [...arr, { time: idx as any, value: vMark }])
      // incrementally update candles into refs (batch UI publish)
      const k = Math.floor(tick.ts / bucketMs)
      const time = k * (bucketMs / 1000)
      const updRef = (ref: React.MutableRefObject<Candle[]>, price: number) => {
        if (!Number.isFinite(price)) return
        const a = ref.current
        const n = a.length
        if (n && a[n - 1].time === time) {
          const c = a[n - 1]
          c.high = Math.max(c.high, price)
          c.low = Math.min(c.low, price)
          c.close = price
        } else {
          a.push({ time, open: price, high: price, low: price, close: price })
        }
      }
      updRef(basisCandlesRef, vBasis)
      updRef(spotCandlesRef, vSpot)
      updRef(markCandlesRef, vMark)
      if (!candleFlushTimer.current) {
        candleFlushTimer.current = setTimeout(() => {
          candleFlushTimer.current = null
          setBasisCandles([...basisCandlesRef.current])
          setSpotCandles([...spotCandlesRef.current])
          setMarkCandles([...markCandlesRef.current])
        }, 80)
      }
    }
  }, [tick, bucketMs])

  // tick-mode lines are maintained incrementally above to avoid O(n) rebuilds
  // candles
  // rebuild candles on tf change only (single pass over ticks for all series)
  useEffect(() => {
    if (!ticks.length) {
      basisCandlesRef.current = []
      spotCandlesRef.current = []
      markCandlesRef.current = []
      setBasisCandles([]); setSpotCandles([]); setMarkCandles([])
      return
    }
    const outB: Candle[] = []
    const outS: Candle[] = []
    const outM: Candle[] = []
    let key: number | null = null
    let cb: Candle | null = null
    let cs: Candle | null = null
    let cm: Candle | null = null
    for (const t of ticks) {
      const kb = Math.floor(t.ts / bucketMs)
      const time = kb * (bucketMs / 1000)
      if (key === null || kb !== key) {
        if (cb) outB.push(cb)
        if (cs) outS.push(cs)
        if (cm) outM.push(cm)
        key = kb
        const b = t.basisBps, s = t.spot, m = t.mark
        cb = { time, open: b, high: b, low: b, close: b }
        cs = { time, open: s, high: s, low: s, close: s }
        cm = { time, open: m, high: m, low: m, close: m }
      } else {
        const b = t.basisBps, s = t.spot, m = t.mark
        if (cb) { cb.high = Math.max(cb.high, b); cb.low = Math.min(cb.low, b); cb.close = b }
        if (cs) { cs.high = Math.max(cs.high, s); cs.low = Math.min(cs.low, s); cs.close = s }
        if (cm) { cm.high = Math.max(cm.high, m); cm.low = Math.min(cm.low, m); cm.close = m }
      }
    }
    if (cb) outB.push(cb)
    if (cs) outS.push(cs)
    if (cm) outM.push(cm)
    basisCandlesRef.current = outB
    spotCandlesRef.current = outS
    markCandlesRef.current = outM
    setBasisCandles(outB)
    setSpotCandles(outS)
    setMarkCandles(outM)
  }, [bucketMs])

  // one-time initial candle build when ticks arrive (in case tf build ran before fetch completed)
  useEffect(() => {
    if (!ticks.length) return
    if (basisCandlesRef.current.length || spotCandlesRef.current.length || markCandlesRef.current.length) return
    const outB: Candle[] = []
    const outS: Candle[] = []
    const outM: Candle[] = []
    let key: number | null = null
    let cb: Candle | null = null
    let cs: Candle | null = null
    let cm: Candle | null = null
    for (const t of ticks) {
      const k = Math.floor(t.ts / bucketMs)
      const time = k * (bucketMs / 1000)
      if (key === null || k !== key) {
        if (cb) outB.push(cb); if (cs) outS.push(cs); if (cm) outM.push(cm)
        key = k
        const b = t.basisBps, s = t.spot, m = t.mark
        cb = { time, open: b, high: b, low: b, close: b }
        cs = { time, open: s, high: s, low: s, close: s }
        cm = { time, open: m, high: m, low: m, close: m }
      } else {
        const b = t.basisBps, s = t.spot, m = t.mark
        if (cb) { cb.high = Math.max(cb.high, b); cb.low = Math.min(cb.low, b); cb.close = b }
        if (cs) { cs.high = Math.max(cs.high, s); cs.low = Math.min(cs.low, s); cs.close = s }
        if (cm) { cm.high = Math.max(cm.high, m); cm.low = Math.min(cm.low, m); cm.close = m }
      }
    }
    if (cb) outB.push(cb); if (cs) outS.push(cs); if (cm) outM.push(cm)
    basisCandlesRef.current = outB; spotCandlesRef.current = outS; markCandlesRef.current = outM
    setBasisCandles(outB); setSpotCandles(outS); setMarkCandles(outM)
  }, [ticks.length, bucketMs])

  const symbol = tick?.symbol ?? 'BTCUSDT'

  // resolve local coin icon under public/coins
  useEffect(() => {
    resolveCoinIcon(symbol).then(setCoinIconUrl).catch(() => setCoinIconUrl(null))
  }, [symbol])

  // open an auxiliary ws for trade feed (spot & futures)
  useEffect(() => {
    let ws: WebSocket | null = new WebSocket(WS_URL)
    let timer: any
    const spotBuf: Trade[] = []
    const futBuf: Trade[] = []
    const flush = () => {
      if (spotBuf.length) {
        const chunk = spotBuf.splice(0, spotBuf.length)
        setSpotTrades(arr => {
          const next = [...arr, ...chunk]
          return next.length > 200 ? next.slice(-200) : next
        })
      }
      if (futBuf.length) {
        const chunk = futBuf.splice(0, futBuf.length)
        setFutTrades(arr => {
          const next = [...arr, ...chunk]
          return next.length > 200 ? next.slice(-200) : next
        })
      }
    }
    const flushTimer = setInterval(flush, 100)
    ws.onclose = () => { timer = setTimeout(() => { ws = new WebSocket(WS_URL) }, 1000) }
    ws.onerror = () => { try { ws?.close() } catch { } }
    ws.onmessage = (ev) => {
      try {
        const obj = JSON.parse(ev.data)
        if (obj?.type === 'spot_trade' && obj?.price && obj?.qty) {
          spotBuf.push(obj as Trade)
        } else if (obj?.type === 'futures_trade' && obj?.price && obj?.qty) {
          futBuf.push(obj as Trade)
        }
      } catch { }
    }
    return () => { clearTimeout(timer); clearInterval(flushTimer); try { ws?.close() } catch { } }
  }, [])

  // ?숈쟻?쇰줈 ????댄?/?뚮퉬肄?媛깆떊
  useEffect(() => {
    const base = (symbol || 'BTCUSDT')
    document.title = `${base} Basis Viewer`
    const link = document.querySelector("link[rel='icon']") as HTMLLinkElement | null
    if (link && coinIconUrl) link.href = coinIconUrl
  }, [symbol, coinIconUrl])

  return (
    <div style={{ fontFamily: 'Inter, ui-sans-serif', color: '#eee', background: '#0b0b0b', minHeight: '100vh', padding: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
        <h2 style={{ margin: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
          {coinIconUrl ? <img src={coinIconUrl} alt="coin" style={{ width: 20, height: 20 }} /> : null}
          Basis Viewer
        </h2>
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={() => setTf('tick')} style={{ padding: '4px 8px', background: tf === 'tick' ? '#444' : '#222', color: '#eee', border: '1px solid #333', borderRadius: 4 }}>Tick</button>
          <button onClick={() => setTf('1s')} style={{ padding: '4px 8px', background: tf === '1s' ? '#444' : '#222', color: '#eee', border: '1px solid #333', borderRadius: 4 }}>1s</button>
          <button onClick={() => setTf('1m')} style={{ padding: '4px 8px', background: tf === '1m' ? '#444' : '#222', color: '#eee', border: '1px solid #333', borderRadius: 4 }}>1m</button>
        </div>
      </div>

      <div style={{ marginBottom: 8, fontSize: 14 }}>
        <span>status: {status} | symbol: {symbol} | tf: {tf} | </span>
        <span>spot: {tick?.spot?.toFixed(2)} | mark: {tick?.mark?.toFixed(2)} | basis: {tick?.basisBps?.toFixed(2)} bps</span>
      </div>

      <div style={{ marginBottom: 4, fontSize: 13, color: '#ddd' }}>Basis</div>
      {tf === 'tick' ? (
        <LightChart data={basisLine} height={220} background="#0e0e0e" textColor="#e5e5e5" sync syncKey="tf-sync" indexToTs={indexTimesRef.current} />
      ) : (
        <CandleChart data={basisCandles} height={240} background="#0e0e0e" textColor="#e5e5e5" sync syncKey="c-sync" />
      )}

      <div style={{ marginBottom: 4, fontSize: 13, color: '#ddd' }}>Spot</div>
      {tf === 'tick' ? (
        <LightChart data={spotLine} height={220} background="#0e0e0e" textColor="#e5e5e5" sync syncKey="tf-sync" indexToTs={indexTimesRef.current} />
      ) : (
        <CandleChart data={spotCandles} height={240} background="#0e0e0e" textColor="#e5e5e5" sync syncKey="c-sync" />
      )}

      <div style={{ marginBottom: 4, fontSize: 13, color: '#ddd' }}>Mark</div>
      {tf === 'tick' ? (
        <LightChart data={markLine} height={220} background="#0e0e0e" textColor="#e5e5e5" sync syncKey="tf-sync" indexToTs={indexTimesRef.current} />
      ) : (
        <CandleChart data={markCandles} height={240} background="#0e0e0e" textColor="#e5e5e5" sync syncKey="c-sync" />
      )}

      <Trades spot={spotTrades} fut={futTrades} />
    </div>
  )
}


