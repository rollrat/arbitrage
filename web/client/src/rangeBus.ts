export type Range = { from: number; to: number }

const subs = new Map<string, Set<(r: Range) => void>>()
const state = new Map<string, Range>()
// crosshair bus (time in seconds, or null to clear)
const xhSubs = new Map<string, Set<(t: number | null) => void>>()
const xhState = new Map<string, number | null>()

export function publishRange(key: string, r: Range) {
  state.set(key, r)
  const set = subs.get(key)
  if (!set) return
  for (const fn of Array.from(set)) {
    try { fn(r) } catch {}
  }
}

export function subscribeRange(key: string, fn: (r: Range) => void): () => void {
  if (!subs.has(key)) subs.set(key, new Set())
  subs.get(key)!.add(fn)
  return () => { subs.get(key)?.delete(fn) }
}

export function getRange(key: string): Range | undefined {
  return state.get(key)
}

export function publishCrosshair(key: string, t: number | null) {
  xhState.set(key, t)
  const set = xhSubs.get(key)
  if (!set) return
  for (const fn of Array.from(set)) {
    try { fn(t) } catch {}
  }
}

export function subscribeCrosshair(key: string, fn: (t: number | null) => void): () => void {
  if (!xhSubs.has(key)) xhSubs.set(key, new Set())
  xhSubs.get(key)!.add(fn)
  return () => { xhSubs.get(key)?.delete(fn) }
}

export function getCrosshair(key: string): number | null | undefined {
  return xhState.get(key)
}
