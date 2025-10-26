import React, { useEffect, useRef } from 'react'
import * as LWC from 'lightweight-charts'
import { publishRange, subscribeRange, getRange } from './rangeBus'

export type LinePoint = { time: number; value: number }

export default function LightChart({
  data,
  height = 320,
  color = '#3498db',
  background = '#111',
  textColor = '#ddd',
  resetSignal,
  sync = false,
  syncKey,
  syncRange,
  onRangeChange,
  indexToTs,
}: {
  data: LinePoint[]
  height?: number
  color?: string
  background?: string
  textColor?: string
  resetSignal?: number
  sync?: boolean
  syncKey?: string
  syncRange?: { from: number; to: number } | null
  onRangeChange?: (r: { from: number; to: number }) => void
  indexToTs?: number[]
}) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const chartRef = useRef<ReturnType<typeof LWC.createChart> | null>(null)
  const seriesRef = useRef<ReturnType<ReturnType<typeof LWC.createChart>['addLineSeries']> | null>(null)
  const lastTimeRef = useRef<number | null>(null)
  const initRef = useRef(false)
  const prevLenRef = useRef(0)
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
      grid: { vertLines: { color: '#2a2a2a' }, horzLines: { color: '#2a2a2a' } },
      localization: {
        timeFormatter: (t: any) => {
          const idx = typeof t === 'number' ? t : Number(t)
          if (Array.isArray(indexToTs) && Number.isInteger(idx) && indexToTs[idx] != null) {
            return new Date(indexToTs[idx]).toLocaleTimeString()
          }
          return String(idx)
        },
      },
    })
    chartRef.current = chart

    const series = chart.addLineSeries({ color, lineWidth: 2 })
    seriesRef.current = series

    const onResize = () => {
      if (containerRef.current) {
        chart.applyOptions({ width: containerRef.current.clientWidth, height })
      }
    }
    onResize()
    window.addEventListener('resize', onResize)

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
          const MIN_INTERVAL = 80
          if (now - lastEmitTsRef.current < MIN_INTERVAL) return
          lastEmitTsRef.current = now
          lastEmittedRef.current = next
          if (syncKey) publishRange(syncKey, next)
          else onRangeChange?.(next)
        })
      } catch {}
    }

    return () => {
      window.removeEventListener('resize', onResize)
      chart.remove()
      chartRef.current = null
      seriesRef.current = null
      initRef.current = false
      prevLenRef.current = 0
      lastTimeRef.current = null
      try { unsubRef.current?.() } catch {}
    }
  }, [background, textColor, color, height, sync, onRangeChange, syncKey, indexToTs])

  // reset to latest on signal
  useEffect(() => {
    if (!resetSignal) return
    try { chartRef.current?.timeScale().scrollToRealTime() } catch { }
  }, [resetSignal])

  // apply external sync range (bus or props)
  useEffect(() => {
    if (!sync) return
    const c = chartRef.current
    if (!c) return
    if (syncKey) {
      try { unsubRef.current?.() } catch {}
      unsubRef.current = subscribeRange(syncKey, (r) => {
        if (!r || r.from === undefined || r.to === undefined) return
        try { applyingRef.current = true; c.timeScale().setVisibleLogicalRange(r as any) } catch {} finally { setTimeout(() => { applyingRef.current = false }, 0) }
      })
      const init = getRange(syncKey)
      if (init && init.from !== undefined && init.to !== undefined) {
        try { applyingRef.current = true; c.timeScale().setVisibleLogicalRange(init as any) } catch {} finally { setTimeout(() => { applyingRef.current = false }, 0) }
      }
      return
    }
    if (!syncRange || syncRange.from === undefined || syncRange.to === undefined) return
    try {
      const cur: any = c.timeScale().getVisibleLogicalRange?.()
      const eps = 0.01
      if (cur && cur.from !== undefined && cur.to !== undefined) {
        const same = Math.abs(Number(cur.from) - syncRange.from) < eps && Math.abs(Number(cur.to) - syncRange.to) < eps
        if (same) return
      }
      applyingRef.current = true
      c.timeScale().setVisibleLogicalRange(syncRange as any)
    } catch {} finally {
      setTimeout(() => { applyingRef.current = false }, 0)
    }
  }, [sync, syncRange, syncKey])

  useEffect(() => {
    const s = seriesRef.current
    if (!s) return
    const arr = data ?? []
    if (!initRef.current) {
      // initial full set (uniquify ascending)
      const uniq: { time: number; value: number }[] = []
      let last = -Infinity
      for (const p of arr) {
        const t = Number(p.time)
        const v = Number(p.value)
        if (!Number.isFinite(t) || !Number.isFinite(v)) continue
        if (t > last) { uniq.push({ time: t, value: v }); last = t }
        else if (t === last) { uniq[uniq.length - 1] = { time: t, value: v } }
      }
      s.setData(uniq as any)
      lastTimeRef.current = uniq.length ? uniq[uniq.length - 1].time : null
      prevLenRef.current = arr.length
      initRef.current = true
      return
    }
    // incremental: append/update only the tail
    const start = Math.min(Math.max(0, prevLenRef.current), arr.length - 1)
    for (let i = start; i < arr.length; i++) {
      const p = arr[i]
      const t = Number(p.time)
      const v = Number(p.value)
      if (!Number.isFinite(t) || !Number.isFinite(v)) continue
      if (lastTimeRef.current == null) {
        s.update({ time: t as any, value: v } as any)
        lastTimeRef.current = t
      } else if (t > lastTimeRef.current) {
        s.update({ time: t as any, value: v } as any)
        lastTimeRef.current = t
      } else if (t === lastTimeRef.current) {
        s.update({ time: t as any, value: v } as any)
      } else {
        // out-of-order: ignore
      }
    }
    prevLenRef.current = arr.length
  }, [data])

  return <div ref={containerRef} style={{ width: '100%', height, background }} />
}

