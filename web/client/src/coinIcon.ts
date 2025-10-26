export function baseAssetFromSymbol(symbol: string): string {
  const m = symbol.toUpperCase().match(/^(.*?)(USDT|USD|BUSD|USDC)$/)
  return (m ? m[1] : symbol).toUpperCase()
}

function tryLoad(url: string, timeoutMs = 2000): Promise<string | null> {
  return new Promise(resolve => {
    const img = new Image()
    const timer = setTimeout(() => {
      cleanup(); resolve(null)
    }, timeoutMs)
    const cleanup = () => { img.onload = null; img.onerror = null; clearTimeout(timer) }
    img.onload = () => { cleanup(); resolve(url) }
    img.onerror = () => { cleanup(); resolve(null) }
    img.src = url
  })
}

export async function resolveCoinIcon(symbol: string): Promise<string | null> {
  const base = baseAssetFromSymbol(symbol)
  const lcBase = base.toLowerCase()
  const lcSym = symbol.toLowerCase()
  const candidates = [
    `/coins/${lcBase}.svg`,
    `/coins/${lcBase}.png`,
    `/coins/${lcBase}.webp`,
    `/coins/${lcBase}.jpg`,
    `/coins/${lcSym}.svg`,
    `/coins/${lcSym}.png`,
    `/coins/${lcSym}.webp`,
    `/coins/${lcSym}.jpg`,
    `/coins/${base}.svg`,
    `/coins/${base}.png`,
  ]
  for (const url of candidates) {
    const ok = await tryLoad(url)
    if (ok) return ok
  }
  return null
}

