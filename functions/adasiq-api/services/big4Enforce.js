// 🔒 Big 4 lines on a Books quote always match the rule the person approved
// (Mark 2026-10-02, test quote T CH11819: PCSI was off on screen, yet the quote
// went out charging $99 — "I need this fixed so it can never happen").
// Used right after a quote is built and by the quote editor. Pure Books calls.
import axios from 'axios'

const API = 'https://www.zohoapis.com/books/v3'
const H = t => ({ Authorization: `Zoho-oauthtoken ${t}` })
const org = () => ({ organization_id: process.env.ZOHO_ORGANIZATION_ID })

const B4 = {
  cal_id:    [/^calibration identification report/i],
  pcsi:      [/^post collision safety inspection/i],
  pre_scan:  [/^pre-?scan/i],
  post_scan: [/^post-?scan/i, /^post-calibration scan/i],
  snapshot:  [/^calibration snapshot/i],
}
export function big4KeyOf(name) { const n = String(name || '').trim(); for (const [k, res] of Object.entries(B4)) if (res.some(re => re.test(n))) return k; return null }
export function big4State(b3, lines) {
  const out = {}
  for (const b of b3.BIG3) {
    const li = (lines || []).find(l => big4KeyOf(l.name) === b.key)
    out[b.key] = !li ? 'off' : (/\(included\)|\(l-m\)/i.test(li.name || '') || !(Number(li.rate) > 0)) ? 'included' : 'charge'
  }
  return out
}
export async function itemNamed(token, name) {
  const r = await axios.get(`${API}/items`, { headers: H(token), params: { ...org(), search_text: name, filter_by: 'Status.Active' }, timeout: 15000 })
  return (r.data?.items || []).find(i => String(i.name || '').toLowerCase() === String(name).toLowerCase()) || null
}
export async function getEst(token, id) {
  const r = await axios.get(`${API}/estimates/${id}`, { headers: H(token), params: org(), timeout: 15000, validateStatus: s => s < 500 })
  return r.data?.estimate || null
}

/**
 * Rewrite the quote so each Big 4 line is exactly `want[key]` (charge / included / off).
 * lineEdits: { [line_item_id]: { remove, rate, quantity } } — the quote editor's own edits.
 * Returns { changed, fixed: ['pcsi: charge → off', …], total }.
 */
export async function enforceBig4(token, estimateId, want = {}, lineEdits = {}) {
  const b3 = await import('./big3.js')
  const est = await getEst(token, estimateId)
  if (!est) throw new Error('Estimate not found in Zoho Books')
  const cur = big4State(b3, est.line_items || [])
  // Snapshot replaces Post-Scan: never force a Post-Scan line back onto a snapshot quote.
  const keys = b3.BIG3.map(b => b.key).filter(k => want[k] && !(k === 'post_scan' && (want.snapshot === 'charge' || cur.snapshot === 'charge')))
  const fix = keys.filter(k => want[k] !== cur[k])
  const hasEdits = Object.values(lineEdits || {}).some(e => e && (e.remove || (e.rate != null && e.rate !== '') || (e.quantity != null && e.quantity !== '')))
  if (!fix.length && !hasEdits) return { changed: false, fixed: [], total: Number(est.total) || 0 }
  const lines = []
  for (const li of est.line_items || []) {
    const e = lineEdits[String(li.line_item_id)] || {}
    const k = big4KeyOf(li.name)
    if (e.remove) continue
    if (k && fix.includes(k)) continue                        // replaced below (or dropped for 'off')
    lines.push({ line_item_id: li.line_item_id, ...(li.item_id ? { item_id: li.item_id } : { name: li.name }), description: li.description || '',
      rate: e.rate != null && e.rate !== '' ? Number(e.rate) : li.rate, quantity: e.quantity != null && e.quantity !== '' ? Number(e.quantity) : li.quantity })
  }
  const missing = [], added = []
  for (const k of fix) {
    if (want[k] === 'off') continue
    const b = b3.BIG3.find(x => x.key === k)
    const name = want[k] === 'included' ? b.base : b.paid
    if (!name) continue
    let it = await itemNamed(token, name)
    if (!it && want[k] === 'charge' && b.paidFallback) it = await itemNamed(token, b.paidFallback)
    if (!it) { missing.push(name); continue }
    added.push({ item_id: it.item_id, description: it.description || '', rate: want[k] === 'included' ? 0 : (Number(it.rate) || 0), quantity: 1 })
  }
  if (missing.length) throw new Error(`Not in the Books catalog: ${missing.join(', ')}`)
  // Big 4 lines lead the quote, the way they're built.
  const all = [...added, ...lines]
  if (!all.length) throw new Error('The quote needs at least one line.')
  const u = await axios.put(`${API}/estimates/${estimateId}`, { line_items: all }, { headers: H(token), params: org(), timeout: 20000, validateStatus: s => s < 500 })
  if (u.data?.code !== 0) throw new Error(u.data?.message || `Books said ${u.status}`)
  return { changed: true, fixed: fix.map(k => `${k}: ${cur[k]} → ${want[k]}`), total: Number(u.data?.estimate?.total) || 0 }
}
