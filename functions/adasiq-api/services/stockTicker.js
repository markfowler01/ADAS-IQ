// Daily stock ticker for the ADAS Brew newsletter.
//
// Fetches the 5 ADAS-relevant tickers from Yahoo Finance's unofficial chart
// endpoint (no API key, free, rate-limit comfortable for one daily call).
//
// Failure mode: any ticker that fails individually is dropped from the list.
// If ALL fail, fetchTopStocks() returns [] and renderDigest skips the markets
// block — newsletter still ships cleanly.
//
// To swap tickers, edit TICKERS below.

import axios from 'axios'

export const TICKERS = [
  { symbol: 'MBLY',  name: 'Mobileye' },
  { symbol: 'APTV',  name: 'Aptiv' },
  { symbol: 'TSLA',  name: 'Tesla' },
  { symbol: 'NVDA',  name: 'Nvidia' },
  { symbol: 'LKQ',   name: 'LKQ Corp' },  // collision parts giant — most shop-relevant ticker
]

async function fetchOne({ symbol, name }) {
  try {
    const res = await axios.get(
      `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}`,
      {
        // Yahoo blocks requests without a UA
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; ADAS-Brew/1.0)' },
        timeout: 7000,
        validateStatus: s => s < 500,
      }
    )
    const result = res.data?.chart?.result?.[0]
    if (!result) return null
    const meta = result.meta || {}
    const price = Number(meta.regularMarketPrice)
    const prevClose = Number(meta.chartPreviousClose ?? meta.previousClose)
    if (!Number.isFinite(price) || !Number.isFinite(prevClose) || prevClose === 0) return null
    const changeAbs = price - prevClose
    const changePct = (changeAbs / prevClose) * 100
    return {
      symbol,
      name,
      price,
      prevClose,
      changeAbs,
      changePct,
      direction: changeAbs >= 0 ? 'up' : 'down',
    }
  } catch (e) {
    return null
  }
}

/**
 * Fetch the 5 tickers in parallel. ~1 sec total. Drops any that fail.
 * @returns {Promise<Array>} ticker objects (may be empty)
 */
export async function fetchTopStocks() {
  const results = await Promise.all(TICKERS.map(fetchOne))
  return results.filter(Boolean)
}
