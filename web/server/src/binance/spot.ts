import { getJson } from './http';

export async function getSpotPrice(baseUrl: string, symbol: string): Promise<number> {
  const url = `${baseUrl.replace(/\/$/, '')}/api/v3/ticker/price?symbol=${symbol}`;
  const data = await getJson<{ price: string }>(url);
  return parseFloat(data.price);
}
