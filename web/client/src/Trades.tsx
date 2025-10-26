import React from 'react'
import type { Trade } from './types'

function fmtTime(ts: number) {
  try { return new Date(ts).toLocaleTimeString() } catch { return '' }
}

function TradeList({ title, items, color }: { title: string; items: Trade[]; color: string }) {
  return (
    <div style={{ flex: 1, minWidth: 0 }}>
      <div style={{ marginBottom: 6, color: '#ddd', fontSize: 13 }}>{title}</div>
      <div style={{ border: '1px solid #2b2b2b', borderRadius: 6, overflow: 'hidden', background: '#0e0e0e' }}>
        <div style={{ display: 'grid', gridTemplateColumns: '100px 1fr 1fr', gap: 8, padding: '6px 8px', color: '#aaa', fontSize: 12, borderBottom: '1px solid #222' }}>
          <div>Time</div>
          <div>Price</div>
          <div>Qty</div>
        </div>
        <div style={{ maxHeight: 200, overflowY: 'auto' }}>
          {items.slice(-100).map((t, i) => (
            <div key={t.ts + ':' + i} style={{ display: 'grid', gridTemplateColumns: '100px 1fr 1fr', gap: 8, padding: '6px 8px', fontSize: 12, borderBottom: '1px dotted #1a1a1a' }}>
              <div style={{ color: '#999' }}>{fmtTime(t.ts)}</div>
              <div style={{ color }}>{t.price}</div>
              <div style={{ color: '#bbb' }}>{t.qty}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

export default function Trades({ spot, fut }: { spot: Trade[]; fut: Trade[] }) {
  return (
    <div style={{ display: 'flex', gap: 12, marginTop: 16 }}>
      <TradeList title="Spot Trades" items={spot} color="#26a69a" />
      <TradeList title="Futures Trades" items={fut} color="#ef5350" />
    </div>
  )
}

