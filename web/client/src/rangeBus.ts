export type Range = { from: number; to: number }

const subs = new Map<string, Set<(r: Range) => void>>()
const state = new Map<string, Range>()

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

