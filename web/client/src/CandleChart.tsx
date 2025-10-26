import React, { useEffect, useRef } from 'react'
import * as LWC from 'lightweight-charts'
import { publishRange, subscribeRange, getRange, publishCrosshair, subscribeCrosshair, getCrosshair } from './rangeBus'

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
  initRightSig,
  onRangeChange,
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
  initRightSig?: number
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
  const xhUnsubRef = useRef<null | (() => void)>(null)
  const applyingRangeRef = useRef(false)
  const applyingXhRef = useRef(false)
  const lastPriceRef = useRef<number | null>(null)
  const didInitScrollRef = useRef(false)
  const lastInitSigRef = useRef<number | null>(null)

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

    // range sync (pan/zoom)
    if (sync) {
      try {
        chart.timeScale().subscribeVisibleLogicalRangeChange((range: any) => {
          if (applyingRangeRef.current) return
          if (!range || range.from === undefined || range.to === undefined) return
          const next = { from: Number(range.from), to: Number(range.to) }
          const prev = lastEmittedRef.current
          const eps = 0.01
          const same = !!prev && Math.abs(prev.from - next.from) < eps && Math.abs(prev.to - next.to) < eps
          if (same) return
          const now = Date.now()
          const MIN_INTERVAL = 16
          if (now - lastEmitTsRef.current < MIN_INTERVAL) return
          lastEmitTsRef.current = now
          lastEmittedRef.current = next
          if (syncKey) publishRange(syncKey, next)
          else onRangeChange?.(next)
        })
      } catch { }

      // apply initial/external range
      try { unsubRef.current?.() } catch { }
      if (syncKey) {
        unsubRef.current = subscribeRange(syncKey, (r) => {
          if (!r || r.from === undefined || r.to === undefined) return
          try { applyingRangeRef.current = true; chart.timeScale().setVisibleLogicalRange(r as any) } catch { } finally { setTimeout(() => { applyingRangeRef.current = false }, 0) }
        })
        const init = getRange(syncKey)
        if (init && init.from !== undefined && init.to !== undefined) {
          try { applyingRangeRef.current = true; chart.timeScale().setVisibleLogicalRange(init as any) } catch { } finally { setTimeout(() => { applyingRangeRef.current = false }, 0) }
        }
      }
    }

    // crosshair sync (mouse move)
    if (sync && syncKey) {
      chart.subscribeCrosshairMove((param: any) => {
        if (applyingXhRef.current) return
        const t = (param && typeof param.time === 'number') ? (param.time as number) : null
        publishCrosshair(syncKey, t)
      })
      try { xhUnsubRef.current?.() } catch { }
      xhUnsubRef.current = subscribeCrosshair(syncKey, (t) => {
        try {
          applyingXhRef.current = true
          if (t == null) {
            chart.clearCrosshairPosition()
          } else {
            const price = (lastPriceRef.current ?? 0)
            const s = seriesRef.current as any
            // set vertical line at time t; price can be last known close
            chart.setCrosshairPosition(price as any, t as any, s)
          }
        } finally {
          setTimeout(() => { applyingXhRef.current = false }, 0)
        }
      })
      const initT = getCrosshair(syncKey)
      if (initT != null) {
        try {
          applyingXhRef.current = true
          const price = (lastPriceRef.current ?? 0)
          const s = seriesRef.current as any
          chart.setCrosshairPosition(price as any, initT as any, s)
        } finally { setTimeout(() => { applyingXhRef.current = false }, 0) }
      }
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
      try { unsubRef.current?.() } catch { }
      try { xhUnsubRef.current?.() } catch { }
    }
  }, [background, textColor, upColor, downColor, gridColor, height, onRangeChange, sync, syncKey])

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
      lastPriceRef.current = nextLen ? (arr[nextLen - 1].close as number) : null
      // align to the right edge on first paint so latest is visible
      if (timeScale && !didInitScrollRef.current) {
        try { timeScale.scrollToRealTime() } catch { }
        didInitScrollRef.current = true
      }
      return
    }

    if (nextLen < prevLen) {
      // timeframe changed or reset; reapply full data
      s.setData(arr as any)
      prevLenRef.current = nextLen
      lastTimeRef.current = nextLen ? (arr[nextLen - 1].time as number) : null
      lastPriceRef.current = nextLen ? (arr[nextLen - 1].close as number) : null
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
      lastPriceRef.current = last.close as number
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
    lastPriceRef.current = (arr[nextLen - 1].close as number)
  }, [data])

  // explicit one-shot initial align to latest from parent
  useEffect(() => {
    if (initRightSig == null) return
    if (lastInitSigRef.current === initRightSig) return
    lastInitSigRef.current = initRightSig
    const chart = chartRef.current
    const timeScale = chart?.timeScale()
    if (!timeScale) return
    const len = data?.length || 0
    if (!len) return
    const desired = 120
    const fromIdx = Math.max(0, len - desired)
    const fromTime = Math.floor((data![fromIdx].time as any))
    const toTime = Math.floor((data![len - 1].time as any))
    try {
      timeScale.setVisibleRange({ from: fromTime, to: toTime } as any)
      didInitScrollRef.current = true
    } catch {}
  }, [initRightSig])

  return <div ref={containerRef} style={{ width: '100%', height, background }} />
}
export default React.memo(CandleChart)
