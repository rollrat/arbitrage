import React, { useEffect, useRef } from 'react'
import * as LWC from 'lightweight-charts'

export type Candle = { time: number; open: number; high: number; low: number; close: number }

export default function CandleChart({
  data,
  height = 240,
  background = '#0e0e0e',
  textColor = '#e5e5e5',
  upColor = '#26a69a',
  downColor = '#ef5350',
  gridColor = '#2a2a2a',
  sync = false,
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
  syncRange?: { from: number; to: number } | null
  onRangeChange?: (r: { from: number; to: number }) => void
  resetSignal?: number
}) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const chartRef = useRef<ReturnType<typeof LWC.createChart> | null>(null)
  const seriesRef = useRef<ReturnType<ReturnType<typeof LWC.createChart>['addCandlestickSeries']> | null>(null)
  const applyingRef = useRef(false)
  const lastEmittedRef = useRef<{ from: number; to: number } | null>(null)

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
          if (!prev || prev.from !== next.from || prev.to !== next.to) {
            lastEmittedRef.current = next
            onRangeChange?.(next)
          }
        })
      } catch {}
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
    }
  }, [background, textColor, upColor, downColor, gridColor, height, sync, onRangeChange])

  // apply external sync range safely
  useEffect(() => {
    if (!sync) return
    const c = chartRef.current
    if (!c || !syncRange || syncRange.from === undefined || syncRange.to === undefined) return
    try {
      applyingRef.current = true
      c.timeScale().setVisibleLogicalRange(syncRange as any)
    } catch {} finally {
      // small timeout to avoid immediate echo
      setTimeout(() => { applyingRef.current = false }, 0)
    }
  }, [sync, syncRange])

  // reset to latest on signal
  useEffect(() => {
    if (!resetSignal) return
    try { chartRef.current?.timeScale().scrollToRealTime() } catch {}
  }, [resetSignal])

  // set data
  useEffect(() => {
    const s = seriesRef.current
    if (!s) return
    const arr = (data ?? []).map(c => ({ time: Math.floor(c.time), open: c.open, high: c.high, low: c.low, close: c.close }))
    s.setData(arr as any)
  }, [data])

  return <div ref={containerRef} style={{ width: '100%', height, background }} />
}
