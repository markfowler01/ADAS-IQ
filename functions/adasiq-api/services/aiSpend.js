// 💵 Every Claude dollar, by feature (Mark 2026-10-02: "is there any way to build
// this so it runs leaner" → first see where it goes). Patches the SDK once so
// EVERY messages.create in the app (scrubs, marketing drafters, photo sorting,
// OEM watcher …) is priced from its usage and added to today's totals, keyed by
// the file that made the call. Totals live in Cache `ai_spend_YYYYMMDD`
// ({ total, by: { feature: $ }, calls: { feature: n } }), 48h. Close, not
// accounting-exact: two instances can add at the same moment.
import Anthropic from '@anthropic-ai/sdk'
import catalyst from 'zcatalyst-sdk-node'
import { costOf } from './spend.js'

const dayKey = () => `ai_spend_${new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles' }).format(new Date()).replace(/-/g, '')}`

// "services/linkedInDrafter" from the caller's stack — the feature that spent it.
function featureFromStack() {
  const lines = String(new Error().stack || '').split('\n').slice(2)
  for (const l of lines) {
    if (/node_modules|aiSpend\.js|spend\.js/.test(l)) continue
    const m = l.match(/(services|routes)\/([\w./-]+?)\.js/)
    if (m) return `${m[1]}/${m[2]}`
  }
  return 'other'
}

async function add(feature, dollars) {
  const req = globalThis.__catalystReq
  if (!req || !(dollars > 0)) return
  try {
    const seg = catalyst.initialize(req).cache().segment()
    const k = dayKey()
    let cur = { total: 0, by: {}, calls: {} }
    try { cur = JSON.parse(await seg.getValue(k)) || cur } catch { /* first call today */ }
    cur.total = Math.round(((cur.total || 0) + dollars) * 10000) / 10000
    cur.by = cur.by || {}; cur.calls = cur.calls || {}
    cur.by[feature] = Math.round(((cur.by[feature] || 0) + dollars) * 10000) / 10000
    cur.calls[feature] = (cur.calls[feature] || 0) + 1
    await seg.put(k, JSON.stringify(cur).slice(0, 60000), 48)
  } catch (e) { console.warn('[ai-spend] add failed:', e.message) }
}

let installed = false
export function installAiSpendTracking() {
  if (installed) return
  installed = true
  const proto = Anthropic.Messages.prototype
  const create = proto.create
  proto.create = function (params, opts) {
    const feature = featureFromStack()
    const p = create.call(this, params, opts)
    if (params?.stream) return p   // streams: usage arrives in events; skipped (none in the app today)
    // Keep the SDK's APIPromise intact for callers (.withResponse etc.); price on the side.
    Promise.resolve(p).then(r => add(feature, costOf(params?.model || r?.model, r?.usage))).catch(() => {})
    return p
  }
}

/** Today's (or a past day's) totals, biggest feature first. */
export async function spendDay(req, ymd = '') {
  const k = ymd ? `ai_spend_${String(ymd).replace(/-/g, '')}` : dayKey()
  try {
    const cur = JSON.parse(await catalyst.initialize(req).cache().segment().getValue(k)) || {}
    const rows = Object.entries(cur.by || {}).map(([f, d]) => ({ feature: f, dollars: d, calls: (cur.calls || {})[f] || 0 })).sort((a, b) => b.dollars - a.dollars)
    return { day: k.slice(9), total: cur.total || 0, rows }
  } catch { return { day: k.slice(9), total: 0, rows: [] } }
}
