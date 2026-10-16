// 🔁 Catalyst "Concurrency limit reached for the feature COMPONENT" (seen app-wide
// since 2026-10-15: Hours tab, shop card notes, jobs, backups). Catalyst caps how
// many Datastore / ZCQL / Cache calls run at the same instant; a page that fires a
// few requests at once can trip it. Instead of failing the screen, every SDK call
// waits a beat and tries again (up to 4 tries, ~3 s total — well inside the 30 s
// gateway). Patched once, at the prototype, so every route gets it for free.
import { createRequire } from 'module'
const require = createRequire(import.meta.url)

const isLimit = e => /concurrency limit/i.test(String(e?.message || e?.errorInfo?.message || e || ''))
const sleep = ms => new Promise(r => setTimeout(r, ms))
let retries = 0
export const concurrencyRetries = () => retries

function wrap(proto, names, label) {
  for (const name of names) {
    const orig = proto?.[name]
    if (typeof orig !== 'function' || orig.__retry) continue
    const fn = async function (...args) {
      for (let attempt = 0; ; attempt++) {
        try { return await orig.apply(this, args) } catch (e) {
          if (!isLimit(e) || attempt >= 3) throw e
          retries++
          await sleep(200 * 2 ** attempt + Math.random() * 250)   // ~0.3s, 0.6s, 1s
          if (attempt === 0) console.log(`[retry] ${label}.${name} hit the concurrency limit, retrying`)
        }
      }
    }
    fn.__retry = true
    proto[name] = fn
  }
}

export function installConcurrencyRetry() {
  try { wrap(require('zcatalyst-sdk-node/lib/zcql/zcql.js').ZCQL.prototype, ['executeZCQLQuery'], 'zcql') } catch (e) { console.warn('[retry] zcql patch skipped:', e.message) }
  try { wrap(require('zcatalyst-sdk-node/lib/datastore/table.js').Table.prototype, ['insertRow', 'insertRows', 'getAllRows', 'getPagedRows', 'getRow', 'deleteRow', 'deleteRows', 'updateRow', 'updateRows'], 'table') } catch (e) { console.warn('[retry] table patch skipped:', e.message) }
  try { wrap(require('zcatalyst-sdk-node/lib/cache/segment.js').Segment.prototype, ['put', 'update', 'getValue', 'get', 'delete'], 'cache') } catch (e) { console.warn('[retry] cache patch skipped:', e.message) }
}
