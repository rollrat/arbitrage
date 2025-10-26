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
}: {
  data: Candle[]
  height?: number
  background?: string
  textColor?: string
  upColor?: string
  downColor?: string
  gridColor?: string
}) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const chartRef = useRef<ReturnType<typeof LWC.createChart> | null>(null)
  const seriesRef = useRef<ReturnType<ReturnType<typeof LWC.createChart>['addCandlestickSeries']> | null>(null)

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

    if (typeof chart.addCandlestickSeries !== 'function') {
      console.error('lightweight-charts addCandlestickSeries unavailable. Ensure v4 is installed.')
      return () => { chart.remove(); chartRef.current = null; seriesRef.current = null }
    }

    const series = chart.addCandlestickSeries({
      upColor, downColor, borderVisible: false, wickUpColor: upColor, wickDownColor: downColor,
    })
    seriesRef.current = series

    const onResize = () => {
      if (containerRef.current) {
        chart.applyOptions({ width: containerRef.current.clientWidth, height })
      }
    }
    onResize()
    window.addEventListener('resize', onResize)
    return () => { window.removeEventListener('resize', onResize); chart.remove(); chartRef.current = null; seriesRef.current = null }
  }, [background, textColor, upColor, downColor, gridColor, height])

  useEffect(() => {
    const s = seriesRef.current
    if (!s) return
    s.setData((data ?? []).map(c => ({ time: Math.floor(c.time), open: c.open, high: c.high, low: c.low, close: c.close })) as any)
  }, [data])

  return <div ref={containerRef} style={{ width: '100%', height, background }} />
}
