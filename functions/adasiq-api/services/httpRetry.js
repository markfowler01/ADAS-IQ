// Small helper: retry an HTTP call on transient failure (5xx + network errors).
// Not for 4xx (auth, bad request) — those need human fix, not another attempt.
//
// Why this exists: our upstream calls (GitHub, Meta Graph API, Resend) all
// occasionally return 5xx during upstream incidents. Without retry, each blip
// fires a Cliq alert and a manual /run-bonus. With 3 attempts + exponential
// backoff we absorb the vast majority of transient blips silently.
//
// Usage:
//   const result = await retryOnTransient(
//     () => axios.put(url, body, opts),
//     { label: 'github commit', maxAttempts: 3 }
//   )
//
// The wrapped fn is treated as transient-failed when:
//   - it throws AND (err.response?.status >= 500 OR no err.response OR err.code
//     in the network-error set)
//   - it returns a response whose status is >= 500 (only when the axios call
//     is configured with validateStatus that lets 5xx through as a value)

const NET_ERR_CODES = new Set(['ECONNRESET', 'ETIMEDOUT', 'ECONNABORTED', 'ENOTFOUND', 'EAI_AGAIN', 'ECONNREFUSED'])

function isTransientError(err) {
  if (!err) return false
  if (err.response && typeof err.response.status === 'number') {
    return err.response.status >= 500 && err.response.status <= 599
  }
  if (err.code && NET_ERR_CODES.has(err.code)) return true
  const msg = String(err.message || '').toLowerCase()
  if (msg.includes('timeout') || msg.includes('network') || msg.includes('socket hang up')) return true
  return false
}

function isTransientResponse(res) {
  return res && typeof res.status === 'number' && res.status >= 500 && res.status <= 599
}

/**
 * Run `fn` up to maxAttempts times, retrying on transient failures with
 * exponential backoff. Returns whatever fn returns on success, or throws /
 * returns the last transient response after all retries exhausted.
 *
 * @param {() => Promise<any>} fn        the axios call (or any promise)
 * @param {object} opts
 * @param {string} opts.label            human label for logs (e.g. 'IG publish')
 * @param {number} opts.maxAttempts      total attempts including the first (default 3)
 * @param {number} opts.initialDelayMs   delay before first retry (default 1000)
 * @param {number} opts.backoffMultiplier  multiply delay by this each retry (default 3)
 * @returns {Promise<any>}
 */
export async function retryOnTransient(fn, {
  label = 'http',
  maxAttempts = 3,
  initialDelayMs = 1000,
  backoffMultiplier = 3,
} = {}) {
  let lastError = null
  let lastResponse = null
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const res = await fn()
      if (isTransientResponse(res)) {
        lastResponse = res
        if (attempt < maxAttempts) {
          const delay = initialDelayMs * Math.pow(backoffMultiplier, attempt - 1)
          console.warn(`[retry ${label}] attempt ${attempt}/${maxAttempts} got ${res.status}, waiting ${delay}ms`)
          await new Promise(r => setTimeout(r, delay))
          continue
        }
        console.warn(`[retry ${label}] exhausted ${maxAttempts} attempts, last status ${res.status}`)
        return res  // caller can inspect status
      }
      // Non-transient success/failure — return it, caller handles 4xx etc.
      return res
    } catch (err) {
      lastError = err
      if (!isTransientError(err) || attempt >= maxAttempts) {
        if (isTransientError(err)) console.warn(`[retry ${label}] exhausted ${maxAttempts} attempts, last error: ${err.message}`)
        throw err
      }
      const delay = initialDelayMs * Math.pow(backoffMultiplier, attempt - 1)
      console.warn(`[retry ${label}] attempt ${attempt}/${maxAttempts} threw ${err.message}, waiting ${delay}ms`)
      await new Promise(r => setTimeout(r, delay))
    }
  }
  if (lastError) throw lastError
  return lastResponse
}
