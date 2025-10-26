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
  onRangeChange,
}: {
  data: Candle[]
  height?: number
  background?: string
  textColor?: string
  upColor?: string
  downColor?: string
  gridColor?: string
  onRangeChange?: (r: { from: number; to: number }) => void
}) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const chartRef = useRef<ReturnType<typeof LWC.createChart> | null>(null)
  const seriesRef = useRef<ReturnType<ReturnType<typeof LWC.createChart>['addCandlestickSeries']> | null>(null)
  const applyingRef = useRef(false)
  const lastEmittedRef = useRef<{ from: number; to: number } | null>(null)
  const lastEmitTsRef = useRef(0)
  const prevLenRef = useRef(0)
  const lastTimeRef = useRef<number | null>(null)
  const unsubRef = useRef<null | (() => void)>(null)

  useEffect(() => {
    const el = containerRef.current
    if (!el) return

    const chart = LWC.createChart(el, {
      width: el.clientWidth || 800,
      height,
      layout: { background: { color: background }, textColor },
      rightPriceScale: { visible: true, borderVisible: false },
      timeScale: { timeVisible: true, secondsVisible: true, borderVisible: false, shiftVisibleRangeOnNewBar: true },
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
      try { unsubRef.current?.() } catch { }
    }
  }, [background, textColor, upColor, downColor, gridColor, height, onRangeChange])

  // incremental updates to avoid viewport shifts and heavy re-renders
  useEffect(() => {
    const s = seriesRef.current
    if (!s) return
    const chart = chartRef.current
    const timeScale = chart?.timeScale()
    // capture current logical range to restore after data mutation
    const preRange: any = timeScale?.getVisibleLogicalRange?.()
    const arr = (data ?? [])
      .filter(c => Number.isFinite(c.open) && Number.isFinite(c.high) && Number.isFinite(c.low) && Number.isFinite(c.close) && Number.isFinite(c.time))
      .map(c => ({ time: Math.floor(c.time as any), open: c.open, high: c.high, low: c.low, close: c.close }))

    const prevLen = prevLenRef.current
    const nextLen = arr.length

    if (prevLen === 0) {
      s.setData(arr as any)
      prevLenRef.current = nextLen
      lastTimeRef.current = nextLen ? (arr[nextLen - 1].time as number) : null
      return
    }

    if (nextLen < prevLen) {
      // timeframe changed or reset; reapply full data
      s.setData(arr as any)
      prevLenRef.current = nextLen
      lastTimeRef.current = nextLen ? (arr[nextLen - 1].time as number) : null
      return
    }

    if (nextLen === prevLen) {
      if (nextLen === 0) return
      const last = arr[nextLen - 1] as any
      if (lastTimeRef.current === (last.time as number)) {
        s.update(last)
      } else {
        // same count but different last bar key (edge case) → reset
        s.setData(arr as any)
      }
      lastTimeRef.current = last.time as number
      return
    }

    // append bars
    if (nextLen === prevLen + 1) {
      // fast-path single append
      s.update(arr[nextLen - 1] as any)
    } else {
      // multiple bars appended; reset to avoid internal index drift
      s.setData(arr as any)
    }
    prevLenRef.current = nextLen
    lastTimeRef.current = (arr[nextLen - 1].time as number)
  }, [data])

  return <div ref={containerRef} style={{ width: '100%', height, background }} />
}
export default React.memo(CandleChart)
