// Quotes column for the Jobs board (Mark 2026-08-29 — quote pipeline
// Phase 1). Shows every quote sent to a shop and waiting for an answer.
// We flip approval by hand (no shop portal); technicians see the column
// read-only so they know what work may be coming.
import { API_BASE, apiFetch } from '../utils/api.js'
import { useState, useEffect, useCallback } from 'react'
import { insurerPricingBadge } from './MobileJobCard.jsx'

const ORANGE = '#CD4419'
const BLUE = '#1d4ed8'

export function useShopQuotes() {
  const [quotes, setQuotes] = useState([])
  const load = useCallback(() => {
    apiFetch(`${API_BASE}/api/shop-quotes`)
      .then(r => r.json())
      .then(d => { if (Array.isArray(d)) setQuotes(d) })
      .catch(() => {})
  }, [])
  useEffect(() => { load() }, [load])
  return { quotes, reload: load }
}

function statusBadge(q) {
  if (q.status === 'approved') return { text: '✅ APPROVED', bg: '#16a34a' }
  const days = q.days_waiting || 0
  return {
    text: `📤 QUOTED${days > 0 ? ` · ${days}d waiting` : ''}`,
    bg: days >= 3 ? '#b45309' : BLUE,
  }
}

function money(n) {
  return '$' + Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function QuoteCard({ q, readOnly, onAction, busy }) {
  const [open, setOpen] = useState(false)
  const badge = statusBadge(q)
  const insurer = insurerPricingBadge({ insurer: q.insurer })
  return (
    <div className="rounded-xl p-3 mb-2 shadow-sm cursor-pointer"
      style={{ backgroundColor: 'white', border: '1.5px solid #e3e0dc' }}
      onClick={() => !readOnly && setOpen(o => !o)}>
      <div className="flex items-center justify-between gap-2 mb-1.5">
        <span className="inline-block text-[10px] font-extrabold px-2 py-0.5 rounded-full text-white"
          style={{ background: badge.bg, letterSpacing: '0.05em' }}>{badge.text}</span>
        <span className="text-sm font-bold" style={{ color: '#1a1a1a' }}>{money(q.total)}</span>
      </div>
      <div className="text-sm font-semibold truncate" style={{ color: '#1a1a1a' }}>{q.shop}</div>
      <div className="text-xs truncate" style={{ color: '#666' }}>
        {q.vehicle}{q.ro_number ? ` · RO ${q.ro_number}` : ''}{q.cal_count ? ` · ${q.cal_count} cal${q.cal_count > 1 ? 's' : ''}` : ''}
      </div>
      {insurer && (
        <span className="inline-block mt-1.5 text-[10px] font-extrabold px-2 py-0.5 rounded-full text-white"
          style={{ background: insurer.bg, letterSpacing: '0.06em' }}>{insurer.label}</span>
      )}
      {open && !readOnly && (
        <div className="flex gap-1.5 mt-2 pt-2" style={{ borderTop: '1px solid #eee' }} onClick={e => e.stopPropagation()}>
          {q.status !== 'approved' && (
            <button disabled={busy} onClick={() => onAction(q, 'approve')}
              className="flex-1 text-[11px] font-bold py-1.5 rounded-lg text-white"
              style={{ backgroundColor: '#16a34a' }}>✅ Approved</button>
          )}
          <button disabled={busy} onClick={() => onAction(q, 'resend')}
            className="flex-1 text-[11px] font-bold py-1.5 rounded-lg"
            style={{ backgroundColor: '#f5f3f0', color: '#444' }}>📤 Resend</button>
          <button disabled={busy} onClick={() => onAction(q, 'dead')}
            className="flex-1 text-[11px] font-bold py-1.5 rounded-lg"
            style={{ backgroundColor: '#fee2e2', color: '#b91c1c' }}>✖ Dead</button>
        </div>
      )}
    </div>
  )
}

function useQuoteActions(reload) {
  const [busy, setBusy] = useState(false)
  async function onAction(q, action) {
    if (action === 'dead' && !window.confirm(`Mark the quote for ${q.shop} as dead? It leaves the board.`)) return
    if (action === 'approve' && !window.confirm(`${q.shop} approved this quote?`)) return
    setBusy(true)
    try {
      const url = action === 'resend'
        ? `${API_BASE}/api/shop-quotes/${q.estimate_id}/resend`
        : `${API_BASE}/api/shop-quotes/${q.estimate_id}/status`
      const r = await apiFetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(action === 'resend' ? {} : { status: action === 'approve' ? 'approved' : 'dead' }),
      })
      const d = await r.json()
      if (!r.ok) throw new Error(d.error || `Error ${r.status}`)
      if (action === 'resend') window.alert(`Quote re-sent to ${(d.sent_to || []).join(', ')}`)
      reload()
    } catch (e) { window.alert(e.message) }
    finally { setBusy(false) }
  }
  return { busy, onAction }
}

// Desktop: leftmost column, visually distinct from the job columns.
export function ShopQuotesColumn({ readOnly }) {
  const { quotes, reload } = useShopQuotes()
  const { busy, onAction } = useQuoteActions(reload)
  return (
    <div className="flex flex-col flex-shrink-0" style={{ width: '280px' }}>
      <div className="rounded-xl px-3 py-2.5 mb-3 flex items-center justify-between"
        style={{ backgroundColor: BLUE }}>
        <div className="flex items-center gap-2">
          <span className="text-white text-sm font-bold">📤 Quotes Out</span>
          <span className="text-xs font-bold px-1.5 py-0.5 rounded-full"
            style={{ backgroundColor: 'rgba(255,255,255,0.25)', color: 'white' }}>{quotes.length}</span>
        </div>
      </div>
      <div className="flex-1 overflow-y-auto pr-1">
        {quotes.length === 0 ? (
          <p className="text-xs text-center py-8" style={{ color: '#aaa' }}>
            No quotes waiting.<br />Send one from a Kinetic scrub.
          </p>
        ) : quotes.map(q => (
          <QuoteCard key={q.estimate_id} q={q} readOnly={readOnly} onAction={onAction} busy={busy} />
        ))}
      </div>
    </div>
  )
}

// Mobile: collapsible strip above the job list.
export function MobileQuotesStrip({ readOnly }) {
  const { quotes, reload } = useShopQuotes()
  const { busy, onAction } = useQuoteActions(reload)
  const [open, setOpen] = useState(false)
  if (quotes.length === 0) return null
  return (
    <div className="mb-3">
      <button onClick={() => setOpen(o => !o)}
        className="w-full py-3 rounded-2xl font-extrabold text-white text-sm tracking-wide flex items-center justify-center gap-2"
        style={{ backgroundColor: BLUE }}>
        📤 Quotes Out ({quotes.length}) {open ? '▲' : '▼'}
      </button>
      {open && (
        <div className="mt-2">
          {quotes.map(q => (
            <QuoteCard key={q.estimate_id} q={q} readOnly={readOnly} onAction={onAction} busy={busy} />
          ))}
        </div>
      )}
    </div>
  )
}
