import React, { useEffect, useRef } from 'react'
import * as LWC from 'lightweight-charts'

export type LinePoint = { time: number; value: number }

export default function LightChart({
  data,
  height = 320,
  color = '#3498db',
  background = '#111',
  textColor = '#ddd',
}: {
  data: LinePoint[]
  height?: number
  color?: string
  background?: string
  textColor?: string
}) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const chartRef = useRef<ReturnType<typeof LWC.createChart> | null>(null)
  const seriesRef = useRef<ReturnType<ReturnType<typeof LWC.createChart>['addLineSeries']> | null>(null)

  useEffect(() => {
    if (!containerRef.current) return
    // 차트 생성
    const chart = LWC.createChart(containerRef.current, {
      layout: { background: { color: background }, textColor },
      rightPriceScale: { visible: true, borderVisible: false },
      timeScale: { timeVisible: true, secondsVisible: true, borderVisible: false },
      grid: { vertLines: { color: '#2a2a2a' }, horzLines: { color: '#2a2a2a' } },
      height,
      localization: { timeFormatter: (t: any) => new Date(((typeof t==='number'?t:0))*1000).toLocaleTimeString() },
    })
    chartRef.current = chart

    if (typeof chart.addLineSeries !== 'function') {
      console.error('lightweight-charts addLineSeries unavailable. Ensure version 4.x is installed.')
      return () => { chart.remove(); chartRef.current = null; seriesRef.current = null }
    }

    const series = chart.addLineSeries({ color, lineWidth: 2 })
    seriesRef.current = series

    const handleResize = () => {
      if (containerRef.current) {
        chart.applyOptions({ width: containerRef.current.clientWidth, height })
      }
    }
    handleResize()
    window.addEventListener('resize', handleResize)

    return () => {
      window.removeEventListener('resize', handleResize)
      chart.remove()
      chartRef.current = null
      seriesRef.current = null
    }
  }, [textColor, color, height])

  useEffect(() => {
    const s = seriesRef.current
    if (!s) return
    const arr = (data ?? []).map(d => ({ time: d.time, value: d.value }))
    s.setData(arr as any)
  }, [data])

  return <div ref={containerRef} style={{ width: '100%', height, background }} />
}

