import { getJson } from './http';

export async function getFuturesMark(baseUrl: string, symbol: string): Promise<number> {
  const url = `${baseUrl.replace(/\/$/, '')}/fapi/v1/premiumIndex?symbol=${symbol}`;
  const data = await getJson<{ markPrice: string }>(url);
  return parseFloat((data as any).markPrice);
}
