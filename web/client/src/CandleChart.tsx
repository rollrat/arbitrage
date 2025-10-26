import React, { useEffect, useRef } from 'react'
import * as LWC from 'lightweight-charts'
import { publishRange, subscribeRange, getRange } from './rangeBus'

export type Candle = { time: number; open: number; high: number; low: number; close: number }

function CandleChart({
  data,
  height = 240,
  background = '#0e0e0e',
  textColor = '#e5e5e5',
  upColor = '#26a69a',
  downColor = '#ef5350',
  gridColor = '#2a2a2a',
  sync = false,
  syncKey,
  syncRange,
  onRangeChange,
  resetSignal,
}: {
  data: Candle[]
  height?: number
  background?: string
  textColor?: string
  upColor?: string
  downColor?: string
  gridColor?: string
  sync?: boolean
  syncKey?: string
  syncRange?: { from: number; to: number } | null
  onRangeChange?: (r: { from: number; to: number }) => void
  resetSignal?: number
}) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const chartRef = useRef<ReturnType<typeof LWC.createChart> | null>(null)
  const seriesRef = useRef<ReturnType<ReturnType<typeof LWC.createChart>['addCandlestickSeries']> | null>(null)
  const applyingRef = useRef(false)
  const lastEmittedRef = useRef<{ from: number; to: number } | null>(null)
  const lastEmitTsRef = useRef(0)
  const unsubRef = useRef<null | (() => void)>(null)

  useEffect(() => {
    const el = containerRef.current
    if (!el) return

    const chart = LWC.createChart(el, {
      width: el.clientWidth || 800,
      height,
      layout: { background: { color: background }, textColor },
      rightPriceScale: { visible: true, borderVisible: false },
      timeScale: { timeVisible: true, secondsVisible: true, borderVisible: false },
      grid: { vertLines: { color: gridColor }, horzLines: { color: gridColor } },
    })
    chartRef.current = chart

    const series = chart.addCandlestickSeries({
      upColor,
      downColor,
      borderVisible: false,
      wickUpColor: upColor,
      wickDownColor: downColor,
    })
    seriesRef.current = series

    if (sync) {
      try {
        chart.timeScale().subscribeVisibleLogicalRangeChange((range: any) => {
          if (applyingRef.current) return
          if (!range || range.from === undefined || range.to === undefined) return
          const next = { from: Number(range.from), to: Number(range.to) }
          const prev = lastEmittedRef.current
          const eps = 0.01
          const same = !!prev && Math.abs(prev.from - next.from) < eps && Math.abs(prev.to - next.to) < eps
          if (same) return
          const now = Date.now()
          const MIN_INTERVAL = 30
          if (now - lastEmitTsRef.current < MIN_INTERVAL) return
          lastEmitTsRef.current = now
          lastEmittedRef.current = next
          if (syncKey) publishRange(syncKey, next)
          else onRangeChange?.(next)
        })
      } catch { }
    }

    const onResize = () => {
      if (containerRef.current) {
        chart.applyOptions({ width: containerRef.current.clientWidth, height })
      }
    }
    onResize()
    window.addEventListener('resize', onResize)

    return () => {
      window.removeEventListener('resize', onResize)
      chart.remove()
      chartRef.current = null
      seriesRef.current = null
      lastEmittedRef.current = null
      applyingRef.current = false
      lastEmitTsRef.current = 0
      try { unsubRef.current?.() } catch {}
    }
  }, [background, textColor, upColor, downColor, gridColor, height, sync, onRangeChange, syncKey])

  // apply external sync range safely
  useEffect(() => {
    if (!sync) return
    const c = chartRef.current
    if (!c) return
    if (syncKey) {
      try { unsubRef.current?.() } catch {}
      unsubRef.current = subscribeRange(syncKey, (r) => {
        if (!r || r.from === undefined || r.to === undefined) return
        try { applyingRef.current = true; c.timeScale().setVisibleLogicalRange(r as any) } catch { } finally { setTimeout(() => { applyingRef.current = false }, 0) }
      })
      const init = getRange(syncKey)
      if (init && init.from !== undefined && init.to !== undefined) {
        try { applyingRef.current = true; c.timeScale().setVisibleLogicalRange(init as any) } catch {} finally { setTimeout(() => { applyingRef.current = false }, 0) }
      }
      return
    }
    if (!syncRange || syncRange.from === undefined || syncRange.to === undefined) return
    try { 
      // 현재 범위와 거의 동일하면 재적용 생략
      const cur: any = c.timeScale().getVisibleLogicalRange?.()
      const eps = 0.01
      if (cur && cur.from !== undefined && cur.to !== undefined) {
        const same = Math.abs(Number(cur.from) - syncRange.from) < eps && Math.abs(Number(cur.to) - syncRange.to) < eps
        if (same) return
      }
      applyingRef.current = true
      c.timeScale().setVisibleLogicalRange(syncRange as any)
    } catch { } finally {
      // small timeout to avoid immediate echo
      setTimeout(() => { applyingRef.current = false }, 0)
    }
  }, [sync, syncRange, syncKey])

  // reset to latest on signal
  useEffect(() => {
    if (!resetSignal) return
    try { chartRef.current?.timeScale().scrollToRealTime() } catch { }
  }, [resetSignal])

  // set data
  useEffect(() => {
    const s = seriesRef.current
    if (!s) return
    const arr = (data ?? [])
      .filter(c => Number.isFinite(c.open) && Number.isFinite(c.high) && Number.isFinite(c.low) && Number.isFinite(c.close) && Number.isFinite(c.time))
      .map(c => ({ time: Math.floor(c.time as any), open: c.open, high: c.high, low: c.low, close: c.close }))
    s.setData(arr as any)
  }, [data])

  return <div ref={containerRef} style={{ width: '100%', height, background }} />
}
export default React.memo(CandleChart)

