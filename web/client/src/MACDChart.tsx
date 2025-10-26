import React, { useEffect, useRef } from 'react'
import * as LWC from 'lightweight-charts'
import { publishRange, subscribeRange, getRange, publishCrosshair, subscribeCrosshair, getCrosshair } from './rangeBus'

export type MACDPoint = { time: number; macd: number; signal: number; hist: number }

export default function MACDChart({
  data,
  height = 140,
  background = '#0e0e0e',
  textColor = '#e5e5e5',
  gridColor = '#2a2a2a',
  sync = false,
  syncKey,
}: {
  data: MACDPoint[]
  height?: number
  background?: string
  textColor?: string
  gridColor?: string
  sync?: boolean
  syncKey?: string
}) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const chartRef = useRef<ReturnType<typeof LWC.createChart> | null>(null)
  const macdRef = useRef<ReturnType<ReturnType<typeof LWC.createChart>['addLineSeries']> | null>(null)
  const sigRef = useRef<ReturnType<ReturnType<typeof LWC.createChart>['addLineSeries']> | null>(null)
  const histRef = useRef<ReturnType<ReturnType<typeof LWC.createChart>['addHistogramSeries']> | null>(null)
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
    histRef.current = chart.addHistogramSeries({ color: '#999', base: 0 })
    macdRef.current = chart.addLineSeries({ color: '#f39c12', lineWidth: 2 })
    sigRef.current = chart.addLineSeries({ color: '#1abc9c', lineWidth: 2 })

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
          else chart.setCrosshairPosition(0 as any, t as any, (macdRef.current as any) )
        } finally { setTimeout(() => { applyingXhRef.current = false }, 0) }
      })
      const init = getRange(syncKey)
      if (init && init.from !== undefined && init.to !== undefined) {
        try { applyingRangeRef.current = true; chart.timeScale().setVisibleLogicalRange(init as any) } catch {} finally { setTimeout(() => { applyingRangeRef.current = false }, 0) }
      }
      const initT = getCrosshair(syncKey)
      if (initT != null) { try { chart.setCrosshairPosition(0 as any, initT as any, (macdRef.current as any)) } catch {} }
    }

    const onResize = () => {
      if (containerRef.current) chart.applyOptions({ width: containerRef.current.clientWidth, height })
    }
    onResize(); window.addEventListener('resize', onResize)
    return () => { window.removeEventListener('resize', onResize); chart.remove(); try { unsubRef.current?.() } catch {}; try { xhUnsubRef.current?.() } catch {} }
  }, [background, textColor, gridColor, height, sync, syncKey])

  useEffect(() => {
    const h = histRef.current, m = macdRef.current, s = sigRef.current
    if (!h || !m || !s) return
    const hist = (data ?? []).map(p => ({ time: Math.floor(p.time as any), value: p.hist, color: p.hist >= 0 ? '#27ae60' : '#e74c3c' }))
    const macd = (data ?? []).map(p => ({ time: Math.floor(p.time as any), value: p.macd }))
    const signal = (data ?? []).map(p => ({ time: Math.floor(p.time as any), value: p.signal }))
    h.setData(hist as any)
    m.setData(macd as any)
    s.setData(signal as any)
  }, [data])

  return <div ref={containerRef} style={{ width: '100%', height, background }} />
}

