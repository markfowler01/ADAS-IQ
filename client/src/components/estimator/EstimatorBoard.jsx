// Estimates board (2026-09-14): Draft → Sent → Approved → Invoiced, plus
// Declined. Kanban pattern like everything else in the app. Click a card
// to open the estimator; ＋ New estimate creates a draft and opens it.
import { useEffect, useMemo, useState } from 'react'
import { API_BASE, apiFetch } from '../../utils/api.js'
import Navbar from '../Navbar'
import { Eyebrow, Title, Chip, ORANGE, GREEN, BLUE } from '../ui/ReviewKit.jsx'
import { fmtCents } from '../../lib/estimatorCalc.js'
import EstimatorEditor from './EstimatorEditor.jsx'

const COLS = [
  { key: 'draft', label: 'Draft', fg: '#666', bg: '#f5f3f0', border: '#e0dbd6' },
  { key: 'sent', label: 'Sent · awaiting approval', fg: BLUE, bg: '#eff6ff', border: '#bfdbfe' },
  { key: 'approved', label: 'Approved · ready to bill', fg: GREEN, bg: '#f0fdf4', border: '#bbf7d0' },
  { key: 'invoiced', label: 'Invoiced', fg: '#7c3aed', bg: '#f5f3ff', border: '#ddd6fe' },
  { key: 'declined', label: 'Declined', fg: '#b91c1c', bg: '#fef2f2', border: '#fecaca' },
]
const age = iso => { if (!iso) return ''; const d = Math.floor((Date.now() - new Date(iso).getTime()) / 86400000); return d <= 0 ? 'today' : d === 1 ? '1 day' : `${d} days` }

export default function EstimatorBoard({ user, onLogout, currentScreen, onNavigate }) {
  const [list, setList] = useState([])
  const [loading, setLoading] = useState(true)
  const [openId, setOpenId] = useState(() => { try { return sessionStorage.getItem('adas_estimator_open') || null } catch { return null } })
  const [q, setQ] = useState('')
  const [creating, setCreating] = useState(false)
  const [err, setErr] = useState('')
  const isTech = user?.role === 'technician'

  const load = () => apiFetch(`${API_BASE}/api/estimator`).then(r => r.json()).then(d => { if (d.ok) setList(d.estimates || []); else setErr(d.error || 'load failed') }).catch(e => setErr(e.message)).finally(() => setLoading(false))
  useEffect(() => { load() }, [])
  useEffect(() => { try { openId ? sessionStorage.setItem('adas_estimator_open', openId) : sessionStorage.removeItem('adas_estimator_open') } catch {} }, [openId])

  async function create() {
    setCreating(true)
    try { const r = await apiFetch(`${API_BASE}/api/estimator`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }); const d = await r.json(); if (!r.ok) throw new Error(d.error); setOpenId(d.estimate.id) }
    catch (e) { setErr(e.message) } finally { setCreating(false) }
  }

  const needle = q.trim().toLowerCase()
  const shown = useMemo(() => needle ? list.filter(e => `${e.number} ${e.customer_name} ${e.year} ${e.make} ${e.model} ${e.ro_number} ${e.vin}`.toLowerCase().includes(needle)) : list, [list, needle])
  const sum = st => list.filter(e => e.status === st).reduce((s, e) => s + (e.grand_total_cents || 0), 0)

  if (openId) return (
    <div>
      <Navbar user={user} onLogout={onLogout} currentScreen={currentScreen} onNavigate={onNavigate} />
      <EstimatorEditor id={openId} user={user} onBack={() => { setOpenId(null); load() }} />
    </div>
  )

  return (
    <div className="min-h-screen" style={{ backgroundColor: '#f5f3f0' }}>
      <Navbar user={user} onLogout={onLogout} currentScreen={currentScreen} onNavigate={onNavigate} />
      <div className="max-w-[1500px] mx-auto px-3 sm:px-4 py-4">
        <div className="flex items-end justify-between gap-3 flex-wrap mb-3">
          <div>
            <Eyebrow>Estimator · repair estimates, quotes, approvals</Eyebrow>
            <Title sub={`${list.length} estimate${list.length === 1 ? '' : 's'} · open ${fmtCents(sum('draft') + sum('sent'))} · approved ${fmtCents(sum('approved'))} · invoiced ${fmtCents(sum('invoiced'))}`}>Estimates</Title>
          </div>
          <div className="flex items-center gap-2">
            <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search number, customer, vehicle, RO, VIN" className="px-3 py-2 text-sm rounded-lg w-64 max-w-full" style={{ border: '1px solid #e0dbd6', backgroundColor: 'white', outline: 'none' }} />
            {!isTech && <button onClick={create} disabled={creating} className="rounded-xl px-4 py-2 text-sm font-bold text-white" style={{ backgroundColor: ORANGE, opacity: creating ? .5 : 1 }}>{creating ? 'Creating…' : '＋ New estimate'}</button>}
          </div>
        </div>
        {err && <div className="text-sm px-3 py-2 rounded-lg mb-3" style={{ backgroundColor: '#fef2f2', color: '#b91c1c' }}>{err}</div>}

        <div className="flex gap-3 overflow-x-auto pb-4" style={{ alignItems: 'stretch', minHeight: '70vh' }}>
          {COLS.map(col => {
            const cards = shown.filter(e => e.status === col.key)
            return (
              <div key={col.key} className="flex-shrink-0 flex flex-col rounded-xl" style={{ width: 280, backgroundColor: col.bg, border: `1.5px solid ${col.border}` }}>
                <div className="px-3 py-2 flex items-center justify-between" style={{ borderBottom: `1px solid ${col.border}` }}>
                  <span className="text-sm font-bold" style={{ color: col.fg }}>{col.label}</span>
                  <span className="text-xs font-bold tabular-nums" style={{ color: col.fg }}>{cards.length}{cards.length ? ` · ${fmtCents(cards.reduce((s, e) => s + (e.grand_total_cents || 0), 0))}` : ''}</span>
                </div>
                <div className="p-2 space-y-2 flex-1">
                  {loading && <div className="text-xs px-1" style={{ color: '#999' }}>Loading…</div>}
                  {cards.map(e => (
                    <button key={e.id} onClick={() => setOpenId(e.id)} className="w-full text-left rounded-xl p-3" style={{ backgroundColor: 'white', border: `1.5px solid ${e.flags?.includes('over110') ? '#fca5a5' : '#e8e4e0'}`, boxShadow: '0 1px 2px rgba(0,0,0,.04)' }}>
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-[11px] font-bold px-1.5 py-0.5 rounded" style={{ backgroundColor: '#f2f2f2', color: '#555', fontFamily: 'IBM Plex Mono, monospace' }}>{e.number}</span>
                        <span className="text-[10px]" style={{ color: '#999' }}>{age(e.created_at)}</span>
                      </div>
                      <div className="font-bold text-sm mt-1.5 truncate" style={{ color: '#1a1a1a' }}>{e.customer_name || <span style={{ color: '#bbb' }}>No customer yet</span>}</div>
                      <div className="text-xs truncate" style={{ color: '#666' }}>{[e.year, e.make, e.model].filter(Boolean).join(' ') || 'No vehicle'}{e.ro_number ? ` · RO ${e.ro_number}` : ''}</div>
                      <div className="flex items-end justify-between mt-2">
                        <div className="flex gap-1 flex-wrap">
                          {e.customer_kind === 'retail' && <Chip tone="green">retail</Chip>}
                          {e.flags?.includes('over110') && <Chip tone="orange">⚠ 110%</Chip>}
                          {e.flags?.includes('no_permit') && <Chip>no permit</Chip>}
                          {e.insurer && <Chip tone="blue">{e.insurer}</Chip>}
                        </div>
                        <span className="font-extrabold tabular-nums" style={{ color: e.status === 'approved' || e.status === 'invoiced' ? GREEN : '#1a1a1a', fontSize: 16 }}>{fmtCents(e.grand_total_cents)}</span>
                      </div>
                    </button>
                  ))}
                  {!loading && cards.length === 0 && <div className="text-xs italic px-1 py-3 text-center" style={{ color: '#bbb' }}>—</div>}
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
