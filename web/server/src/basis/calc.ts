export type BasisTick = {
  symbol: string;
  spot: number;
  mark: number;
  basisBps: number;
  ts: number;
};

export function computeBasisBps(spot: number, mark: number): number {
  if (!spot || spot <= 0) return 0;
  return ((mark - spot) / spot) * 10000.0;
}
