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

// 5-ticker cap (per Mark): keep above-the-fold real estate tight.
// Blend: 4 ADAS-tech tickers + 1 collision-industry ticker.
export const TICKERS = [
  { symbol: 'MBLY',  name: 'Mobileye' },
  { symbol: 'APTV',  name: 'Aptiv' },
  { symbol: 'TSLA',  name: 'Tesla' },
  { symbol: 'NVDA',  name: 'Nvidia' },
  { symbol: 'LKQ',   name: 'LKQ Corp' },  // collision parts giant — only collision-industry pick
]

async function fetchOne({ symbol, name }) {
  const headers = { 'User-Agent': 'Mozilla/5.0 (compatible; ADAS-Brew/1.0)' }
  const baseUrl = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}`

  // Two parallel calls per ticker:
  //   - default range: meta.previousClose = ACTUAL prior trading day close → day change
  //   - range=ytd:     meta.chartPreviousClose = Dec 31 close → YTD baseline
  // Yahoo strips previousClose when `range` is set, so one call can't do both.
  try {
    const [dayRes, ytdRes] = await Promise.all([
      axios.get(baseUrl, { headers, timeout: 7000, validateStatus: s => s < 500 }).catch(() => null),
      axios.get(`${baseUrl}?range=ytd&interval=1d`, { headers, timeout: 7000, validateStatus: s => s < 500 }).catch(() => null),
    ])

    const dayMeta = dayRes?.data?.chart?.result?.[0]?.meta
    if (!dayMeta) return null

    const price = Number(dayMeta.regularMarketPrice)
    const prevClose = Number(dayMeta.previousClose ?? dayMeta.chartPreviousClose)
    if (!Number.isFinite(price) || !Number.isFinite(prevClose) || prevClose === 0) return null

    const changeAbs = price - prevClose
    const changePct = (changeAbs / prevClose) * 100

    // YTD baseline from the second call's chartPreviousClose
    let ytdPct = null
    const ytdMeta = ytdRes?.data?.chart?.result?.[0]?.meta
    const yearStart = Number(ytdMeta?.chartPreviousClose)
    if (Number.isFinite(yearStart) && yearStart > 0) {
      ytdPct = ((price - yearStart) / yearStart) * 100
    }

    return {
      symbol,
      name,
      price,
      prevClose,
      changeAbs,
      changePct,
      ytdPct,
      direction: changeAbs >= 0 ? 'up' : 'down',
      url: `https://finance.yahoo.com/quote/${encodeURIComponent(symbol)}`,
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
