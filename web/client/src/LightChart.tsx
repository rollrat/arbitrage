import React, { useEffect, useRef } from 'react'
import * as LWC from 'lightweight-charts'

export type LinePoint = { time: number; value: number }

export default function LightChart({
  data,
  height = 320,
  color = '#3498db',
  background = '#111',
  textColor = '#ddd',
  resetSignal,
}: {
  data: LinePoint[]
  height?: number
  color?: string
  background?: string
  textColor?: string
  resetSignal?: number
}) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const chartRef = useRef<ReturnType<typeof LWC.createChart> | null>(null)
  const seriesRef = useRef<ReturnType<ReturnType<typeof LWC.createChart>['addLineSeries']> | null>(null)

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
      localization: { timeFormatter: (t: any) => new Date(((typeof t === 'number' ? t : 0)) * 1000).toLocaleTimeString() },
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
    return () => { window.removeEventListener('resize', onResize); chart.remove(); chartRef.current = null; seriesRef.current = null }
  }, [background, textColor, color, height])

  // reset to latest on signal
  useEffect(() => {
    if (!resetSignal) return
    try { chartRef.current?.timeScale().scrollToRealTime() } catch { }
  }, [resetSignal])

  useEffect(() => {
    const s = seriesRef.current
    if (!s) return
    const arr = (data ?? []).map(d => ({ time: d.time, value: d.value }))
    s.setData(arr as any)
  }, [data])

  return <div ref={containerRef} style={{ width: '100%', height, background }} />
}
