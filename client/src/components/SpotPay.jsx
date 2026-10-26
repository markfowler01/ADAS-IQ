// ⚡ Pays on the spot (Mark 2026-10-26): Showcase + Perfect Reflections hand the
// tech a check as soon as they have the invoice. Board: the card jumps the
// Ready to Invoice line with a live timer. Live Day: "10 min out" heads-up and
// "Got the check" → #financeadmin. Server: services/spotPay.js.
import { useEffect, useState } from 'react'
import { API_BASE, apiFetch } from '../utils/api.js'
import { useBig3Map, invalidateBig3Map } from './books/Big3Rules.jsx'

const GOLD = '#f5b301'
const keyOf = n => String(n || '').toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9]+/g, '')

// One shared poll of the open spot-pay jobs.
let _spots = [], _at = 0, _p = null
const subs = new Set()
async function refresh() {
  if (_p) return _p
  _p = apiFetch(`${API_BASE}/api/spot-pay/open`).then(r => r.ok ? r.json() : { spots: [] }).then(d => { _spots = d.spots || []; _at = Date.now(); subs.forEach(f => f(_spots)) }).catch(() => {}).finally(() => { _p = null })
  return _p
}
export function useSpotOpen() {
  const [spots, setSpots] = useState(_spots)
  useEffect(() => {
    subs.add(setSpots)
    if (Date.now() - _at > 20000) refresh()
    const t = setInterval(refresh, 30000)
    return () => { subs.delete(setSpots); clearInterval(t) }
  }, [])
  return spots
}
export const bumpSpots = () => { _at = 0; return refresh() }

export function useIsSpotShop() {
  const map = useBig3Map()
  return shopName => !!map[keyOf(shopName)]?.spot_pay
}

function useTick(ms = 30000) { const [, set] = useState(0); useEffect(() => { const t = setInterval(() => set(x => x + 1), ms); return () => clearInterval(t) }, [ms]); }
const mins = iso => Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 60000))

/** Card frame for a spot-pay car waiting on its invoice (gold, front of the line). */
export const spotFrame = { boxShadow: `0 0 0 3px ${GOLD}`, backgroundColor: '#fffbeb' }

/** Badge on board + field cards. */
export function SpotBadge({ job, spots }) {
  useTick()
  const isSpot = useIsSpotShop()
  if (!isSpot(job.shop_name)) return null
  const s = (spots || []).find(x => String(x.job_id) === String(job.id))
  const base = 'text-[11px] font-extrabold px-2 py-0.5 rounded-full inline-block'
  if (s?.billed_at) return <span className={base} style={{ backgroundColor: '#dcfce7', color: '#15803d', border: '1px solid #86efac' }}>🧾 INVOICE SENT · grab the check</span>
  if (s?.ready_at || job.status === 'ready_invoice') { const m = s?.ready_at ? mins(s.ready_at) : null; return <span className={base} style={{ backgroundColor: GOLD, color: '#1a1a1a' }} title="This shop writes the check as soon as it has the invoice">⚡ TECH WAITING FOR CHECK{m != null ? ` · ${m} min` : ''} · bill now</span> }
  if (s?.heads_up_at) return <span className={base} style={{ backgroundColor: '#fef3c7', color: '#92400e', border: `1px solid ${GOLD}` }}>⚡ Done in ~10 min · get Bill it ready</span>
  return <span className={base} style={{ backgroundColor: '#fef3c7', color: '#92400e', border: `1px solid ${GOLD}` }} title="Pays by check on the spot once invoiced">⚡ PAYS ON THE SPOT</span>
}

/** Live Day: "⚡ 10 min out" for a spot-pay car the tech is working. */
export function SpotHeadsUpButton({ job, spots }) {
  const isSpot = useIsSpotShop()
  const [busy, setBusy] = useState(false)
  if (!isSpot(job.shop_name) || job.status === 'ready_invoice' || job.status === 'complete' || job.invoiced) return null
  const s = (spots || []).find(x => String(x.job_id) === String(job.id))
  if (s?.heads_up_at) return <div className="text-xs font-bold text-center py-2 rounded-xl" style={{ backgroundColor: '#fef3c7', color: '#92400e' }}>⚡ Kat knows you're ~10 min out</div>
  return (
    <button type="button" disabled={busy} onClick={async e => { e.stopPropagation(); setBusy(true); try { await apiFetch(`${API_BASE}/api/spot-pay/${job.id}/heads-up`, { method: 'POST' }); await bumpSpots() } finally { setBusy(false) } }}
      className="w-full text-sm font-extrabold rounded-xl py-2.5" style={{ backgroundColor: GOLD, color: '#1a1a1a', opacity: busy ? 0.6 : 1 }}>
      {busy ? 'Telling Kat…' : '⚡ 10 min out · tell Kat to get the invoice ready'}
    </button>
  )
}

/** Live Day: checks to pick up (invoice sent, no check logged yet). */
export function ChecksToPickUp() {
  const spots = useSpotOpen()
  const ready = spots.filter(s => s.billed_at && !s.check)
  const [open, setOpen] = useState(null)
  const [num, setNum] = useState(''), [amt, setAmt] = useState('')
  const [busy, setBusy] = useState(false), [msg, setMsg] = useState('')
  if (!ready.length && !msg) return null
  async function save(s) {
    setBusy(true); setMsg('')
    try {
      const r = await apiFetch(`${API_BASE}/api/spot-pay/${s.job_id}/check`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ number: num, amount: Number(amt), shop: s.shop }) })
      const d = await r.json().catch(() => ({})); if (!r.ok) throw new Error(d.error || `HTTP ${r.status}`)
      setMsg(d.spot?.mismatch ? `⚠️ Logged. The check doesn't match the invoice (${s.invoice_total ? `$${s.invoice_total.toFixed(2)}` : ''}). Finance has it.` : '✅ Logged. Finance has it.')
      setOpen(null); setNum(''); setAmt(''); await bumpSpots()
    } catch (e) { setMsg(e.message) } finally { setBusy(false) }
  }
  return (
    <div className="rounded-2xl p-3 mb-3" style={{ backgroundColor: '#f0fdf4', border: '2px solid #86efac' }}>
      <div className="font-extrabold text-sm mb-1" style={{ color: '#15803d' }}>💵 Checks to pick up</div>
      {msg && <div className="text-xs font-semibold mb-1" style={{ color: '#15803d' }}>{msg}</div>}
      {ready.map(s => (
        <div key={s.job_id} className="py-1.5" style={{ borderTop: '1px solid #bbf7d0' }}>
          <div className="flex items-center justify-between gap-2">
            <div className="text-sm min-w-0"><b>{s.shop}</b> · {s.car}<div className="text-xs" style={{ color: '#555' }}>Invoice {s.invoice_number}{s.invoice_total ? ` · $${s.invoice_total.toFixed(2)}` : ''} sent</div></div>
            {open !== s.job_id && <button onClick={() => { setOpen(s.job_id); setAmt(s.invoice_total ? String(s.invoice_total) : ''); setMsg('') }} className="text-xs font-extrabold rounded-lg px-3 py-2 text-white flex-shrink-0" style={{ backgroundColor: '#15803d' }}>Got the check</button>}
          </div>
          {open === s.job_id && (
            <div className="flex gap-2 mt-2">
              <input value={num} onChange={e => setNum(e.target.value)} placeholder="Check #" inputMode="numeric" className="flex-1 min-w-0 rounded-lg px-2 py-2 text-sm" style={{ border: '1px solid #86efac' }} />
              <input value={amt} onChange={e => setAmt(e.target.value)} placeholder="Amount" inputMode="decimal" className="w-28 rounded-lg px-2 py-2 text-sm" style={{ border: '1px solid #86efac' }} />
              <button disabled={busy || !(Number(amt) > 0)} onClick={() => save(s)} className="text-xs font-extrabold rounded-lg px-3 text-white" style={{ backgroundColor: '#15803d', opacity: busy || !(Number(amt) > 0) ? 0.5 : 1 }}>{busy ? '…' : 'Log it'}</button>
            </div>
          )}
        </div>
      ))}
    </div>
  )
}

/** CRM Billing tab toggle. */
export function SpotPayToggle({ shop }) {
  const map = useBig3Map()
  const cur = !!map[keyOf(shop?.shop_name)]?.spot_pay
  const [on, setOn] = useState(cur)
  const [busy, setBusy] = useState(false)
  useEffect(() => setOn(cur), [cur])
  if (!shop?.id) return null
  async function save(next) {
    setBusy(true)
    try { const r = await apiFetch(`${API_BASE}/api/shops/${shop.id}/spot-pay`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ on: next }) }); const d = await r.json(); if (!r.ok) throw new Error(d.error || `HTTP ${r.status}`); setOn(!!d.spot_pay); invalidateBig3Map() }
    catch (e) { alert(e.message) } finally { setBusy(false) }
  }
  return (
    <div className="rounded-xl p-3 mb-3 flex items-center justify-between gap-2 flex-wrap" style={{ backgroundColor: on ? '#fffbeb' : 'white', border: `1.5px solid ${on ? GOLD : '#e8e4e0'}` }}>
      <div className="min-w-0">
        <div className="text-sm font-bold" style={{ color: '#1a1a1a' }}>⚡ Pays on the spot{on ? ' · ON' : ''}</div>
        <div className="text-[11px]" style={{ color: '#666' }}>The shop writes the check as soon as it has the invoice. Ready to Invoice jumps the line, Kat gets pinged, the tech is told when it's sent.</div>
      </div>
      <button disabled={busy} onClick={() => save(!on)} className="text-xs font-bold rounded-lg px-3 py-1.5" style={on ? { backgroundColor: GOLD, color: '#1a1a1a' } : { backgroundColor: '#f5f3f0', color: '#555' }}>{busy ? '…' : on ? 'ON' : 'OFF'}</button>
    </div>
  )
}
