import React, { useEffect, useRef } from 'react'
import * as LWC from 'lightweight-charts'
import { publishRange, subscribeRange, getRange, publishCrosshair, subscribeCrosshair, getCrosshair } from './rangeBus'

export type RSIPoint = { time: number; value: number }

export default function RSIChart({
  data,
  height = 120,
  background = '#0e0e0e',
  textColor = '#e5e5e5',
  gridColor = '#2a2a2a',
  sync = false,
  syncKey,
}: {
  data: RSIPoint[]
  height?: number
  background?: string
  textColor?: string
  gridColor?: string
  sync?: boolean
  syncKey?: string
}) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const chartRef = useRef<ReturnType<typeof LWC.createChart> | null>(null)
  const seriesRef = useRef<ReturnType<ReturnType<typeof LWC.createChart>['addLineSeries']> | null>(null)
  const applyingRangeRef = useRef(false)
  const applyingXhRef = useRef(false)
  const unsubRef = useRef<null | (() => void)>(null)
  const xhUnsubRef = useRef<null | (() => void)>(null)

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
    const series = chart.addLineSeries({ color: '#8ab4f8', lineWidth: 2 })
    seriesRef.current = series
    // RSI guide lines
    try { series.createPriceLine({ price: 70, color: '#888', lineWidth: 1, lineStyle: 2, axisLabelVisible: true, title: '70' }) } catch {}
    try { series.createPriceLine({ price: 50, color: '#555', lineWidth: 1, lineStyle: 2, axisLabelVisible: true, title: '50' }) } catch {}
    try { series.createPriceLine({ price: 30, color: '#888', lineWidth: 1, lineStyle: 2, axisLabelVisible: true, title: '30' }) } catch {}

    if (sync && syncKey) {
      chart.timeScale().subscribeVisibleLogicalRangeChange((range: any) => {
        if (applyingRangeRef.current) return
        if (!range || range.from === undefined || range.to === undefined) return
        publishRange(syncKey, { from: Number(range.from), to: Number(range.to) })
      })
      try { unsubRef.current?.() } catch {}
      unsubRef.current = subscribeRange(syncKey, (r) => {
        if (!r || r.from === undefined || r.to === undefined) return
        try { applyingRangeRef.current = true; chart.timeScale().setVisibleLogicalRange(r as any) } catch {} finally { setTimeout(() => { applyingRangeRef.current = false }, 0) }
      })

      chart.subscribeCrosshairMove((param: any) => {
        if (applyingXhRef.current) return
        const t = (param && typeof param.time === 'number') ? (param.time as number) : null
        publishCrosshair(syncKey, t)
      })
      try { xhUnsubRef.current?.() } catch {}
      xhUnsubRef.current = subscribeCrosshair(syncKey, (t) => {
        try {
          applyingXhRef.current = true
          if (t == null) chart.clearCrosshairPosition()
          else chart.setCrosshairPosition(50 as any, t as any, series as any)
        } finally { setTimeout(() => { applyingXhRef.current = false }, 0) }
      })
      const init = getRange(syncKey)
      if (init && init.from !== undefined && init.to !== undefined) {
        try { applyingRangeRef.current = true; chart.timeScale().setVisibleLogicalRange(init as any) } catch {} finally { setTimeout(() => { applyingRangeRef.current = false }, 0) }
      }
      const initT = getCrosshair(syncKey)
      if (initT != null) { try { chart.setCrosshairPosition(50 as any, initT as any, series as any) } catch {} }
    }

    const onResize = () => {
      if (containerRef.current) chart.applyOptions({ width: containerRef.current.clientWidth, height })
    }
    onResize(); window.addEventListener('resize', onResize)
    return () => { window.removeEventListener('resize', onResize); chart.remove(); try { unsubRef.current?.() } catch {}; try { xhUnsubRef.current?.() } catch {} }
  }, [background, textColor, gridColor, height, sync, syncKey])

  useEffect(() => {
    const s = seriesRef.current
    if (!s) return
    const arr = (data ?? []).filter(p => Number.isFinite(p.value) && Number.isFinite(p.time)).map(p => ({ time: Math.floor(p.time as any), value: p.value }))
    s.setData(arr as any)
  }, [data])

  return <div ref={containerRef} style={{ width: '100%', height, background }} />
}

