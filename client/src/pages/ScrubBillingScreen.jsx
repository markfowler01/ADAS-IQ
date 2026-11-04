// 💳 Scrub billing (Mark 2026-11-04). Mark only. Every account that pays for
// CCC scrubs, the body shops under each one, this month's scrubs and dollars,
// charges on/off, prices, and the 🎚 filters (e.g. nothing older than 2013).
// Rules live in functions/adasiq-api/services/scrubBilling.js. This screen
// only records and shows; it never sends an invoice or charges a card.
import { useEffect, useState } from 'react'
import { API_BASE, apiFetch } from '../utils/api.js'
import Navbar from '../components/Navbar'

const INK = '#1a1a1a', ORANGE = '#CD4419', GREEN = '#15803d', PURPLE = '#7c3aed'
const money = n => `$${(Number(n) || 0).toFixed(2).replace(/\.00$/, '')}`
const thisMonth = () => new Date().toISOString().slice(0, 7)
const box = { border: '1.5px solid #e8e4e0', borderRadius: 14, padding: 16, backgroundColor: '#fff' }
const input = 'w-full rounded-lg px-3 py-2 text-sm border'
const call = async (path, method = 'GET', body) => {
  const r = await apiFetch(`${API_BASE}/api/scrub-billing${path}`, { method, headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined })
  const d = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(d.error || `HTTP ${r.status}`)
  return d
}

function Pill({ bg, children }) {
  return <span className="inline-flex items-center text-[11px] font-extrabold rounded-full px-2.5 py-1 whitespace-nowrap" style={{ backgroundColor: bg, color: 'white' }}>{children}</span>
}
function ChargePill({ a, link }) {
  if (a?.type === 'house') return <Pill bg={GREEN}>🆓 NEVER CHARGED · Absolute ADAS</Pill>
  if (a?.free || link?.free) return <Pill bg={GREEN}>🆓 CHARGES OFF</Pill>
  if (a?.status === 'pending_review') return <Pill bg="#b45309">🕓 WAITING FOR YOUR OK</Pill>
  if (a?.status === 'denied') return <Pill bg="#6b7280">🚫 DENIED</Pill>
  if (a?.status === 'past_due') return <Pill bg="#7f1d1d">⛔ PAST DUE · estimates held</Pill>
  if (a?.status === 'paused') return <Pill bg="#b45309">⏸ PAUSED · not charged</Pill>
  const p = link?.price ?? a?.price ?? 3
  return <Pill bg={ORANGE}>💵 {money(p)} / VIN</Pill>
}
const filterWords = f => {
  if (!f) return []
  const out = []
  if (f.min_year && f.max_year) out.push(`${f.min_year}–${f.max_year}`); else if (f.min_year) out.push(`${f.min_year}+`); else if (f.max_year) out.push(`≤${f.max_year}`)
  if (f.makes_only?.length) out.push(`only ${f.makes_only.join(', ')}`)
  if (f.makes_skip?.length) out.push(`skip ${f.makes_skip.join(', ')}`)
  if (f.insurers_only?.length) out.push(`only ${f.insurers_only.join(', ')}`)
  if (f.insurers_skip?.length) out.push(`skip ${f.insurers_skip.join(', ')}`)
  if (f.locked_only) out.push('locked only')
  if (f.skip_supplements) out.push('no supplements')
  return out
}
function FilterPill({ f }) {
  const w = filterWords(f)
  return w.length ? <Pill bg={PURPLE}>🎚 {w.join(' · ')}</Pill> : <span className="text-[11px]" style={{ color: '#999' }}>🎚 no filters</span>
}

// 🎚 Filter editor — one account (all its body shops) or one body shop.
function FilterEditor({ target, onClose, onSaved }) {
  const f0 = target.filters || {}
  const [f, setF] = useState({ min_year: f0.min_year || '', max_year: f0.max_year || '', makes_only: (f0.makes_only || []).join(', '), makes_skip: (f0.makes_skip || []).join(', '), insurers_only: (f0.insurers_only || []).join(', '), insurers_skip: (f0.insurers_skip || []).join(', '), locked_only: !!f0.locked_only, skip_supplements: !!f0.skip_supplements })
  const [busy, setBusy] = useState(false), [err, setErr] = useState('')
  const set = (k, v) => setF(x => ({ ...x, [k]: v }))
  const save = async (clear = false) => {
    setBusy(true); setErr('')
    try { await call('/filters', 'PUT', { ...(target.kind === 'account' ? { account_id: target.id } : { shop_name: target.shop_name }), filters: clear ? {} : f }); onSaved() } catch (e) { setErr(e.message) } finally { setBusy(false) }
  }
  const row = (label, k, ph) => (
    <label className="grid gap-1 text-sm font-semibold" style={{ color: '#444' }}>{label}
      <input className={input} style={{ borderColor: '#e0dbd6' }} value={f[k]} placeholder={ph} onChange={e => set(k, e.target.value)} />
    </label>
  )
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ backgroundColor: 'rgba(0,0,0,.45)' }} onClick={onClose}>
      <div className="w-full max-w-md rounded-2xl p-5 grid gap-3" style={{ backgroundColor: '#fff', maxHeight: '90vh', overflowY: 'auto' }} onClick={e => e.stopPropagation()}>
        <div>
          <div className="text-lg font-extrabold" style={{ color: INK }}>🎚 Scrub filters</div>
          <div className="text-sm" style={{ color: '#666' }}>{target.label}. {target.kind === 'account' ? 'Applies to every body shop under this account.' : 'Just this body shop. The account’s filters still apply too, and the stricter one wins.'}</div>
        </div>
        <div className="grid grid-cols-2 gap-2">{row('Oldest model year', 'min_year', 'e.g. 2013')}{row('Newest model year', 'max_year', 'blank = any')}</div>
        {row('Only these makes', 'makes_only', 'blank = all makes')}
        {row('Skip these makes', 'makes_skip', 'e.g. Tesla, Rivian')}
        {row('Only these insurers', 'insurers_only', 'blank = all')}
        {row('Skip these insurers', 'insurers_skip', 'e.g. GEICO')}
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={f.locked_only} onChange={e => set('locked_only', e.target.checked)} /> Locked estimates only (not every save)</label>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={f.skip_supplements} onChange={e => set('skip_supplements', e.target.checked)} /> Skip supplements</label>
        <div className="text-xs" style={{ color: '#888' }}>A car that doesn’t pass isn’t scrubbed and isn’t charged. It still shows below as “filtered”. A car with no year on the estimate is still scrubbed.</div>
        {err && <div className="text-sm" style={{ color: '#b91c1c' }}>{err}</div>}
        <div className="flex gap-2 justify-end flex-wrap">
          <button className="text-sm font-bold rounded-xl px-3 py-2" style={{ border: '1px solid #e0dbd6' }} disabled={busy} onClick={() => save(true)}>Clear all</button>
          <button className="text-sm font-bold rounded-xl px-3 py-2" style={{ border: '1px solid #e0dbd6' }} onClick={onClose}>Cancel</button>
          <button className="text-sm font-extrabold rounded-xl px-4 py-2" style={{ backgroundColor: PURPLE, color: 'white' }} disabled={busy} onClick={() => save(false)}>{busy ? 'Saving…' : 'Save filters'}</button>
        </div>
      </div>
    </div>
  )
}

// New / edit account.
function AccountEditor({ acct, onClose, onSaved }) {
  const [a, setA] = useState({ id: acct?.id || '', name: acct?.name || '', type: acct?.type || 'cal_shop', price: acct?.price ?? 3, trial: acct?.trial ?? 25, free: !!acct?.free, status: acct?.status || 'active', email: acct?.email || '' })
  const [busy, setBusy] = useState(false), [err, setErr] = useState('')
  const set = (k, v) => setA(x => ({ ...x, [k]: v }))
  const save = async () => { setBusy(true); setErr(''); try { await call('/account', 'PUT', a); onSaved() } catch (e) { setErr(e.message) } finally { setBusy(false) } }
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ backgroundColor: 'rgba(0,0,0,.45)' }} onClick={onClose}>
      <div className="w-full max-w-md rounded-2xl p-5 grid gap-3" style={{ backgroundColor: '#fff' }} onClick={e => e.stopPropagation()}>
        <div className="text-lg font-extrabold" style={{ color: INK }}>{acct ? `Edit ${acct.name}` : '➕ New paying account'}</div>
        <input className={input} style={{ borderColor: '#e0dbd6' }} placeholder="Company name" value={a.name} onChange={e => set('name', e.target.value)} />
        <div className="flex gap-1.5">
          {[['cal_shop', '🔧 Calibration shop'], ['body_shop', '🚗 Body shop (direct)']].map(([k, l]) => (
            <button key={k} className="text-xs font-bold rounded-full px-3 py-1.5" onClick={() => set('type', k)} style={a.type === k ? { backgroundColor: INK, color: 'white' } : { border: '1px solid #e0dbd6', color: '#555' }}>{l}</button>
          ))}
        </div>
        <div className="grid grid-cols-2 gap-2">
          <label className="grid gap-1 text-sm font-semibold" style={{ color: '#444' }}>$ per VIN<input type="number" step="0.25" className={input} style={{ borderColor: '#e0dbd6' }} value={a.price} onChange={e => set('price', e.target.value)} /></label>
          <label className="grid gap-1 text-sm font-semibold" style={{ color: '#444' }}>Free scrubs to start<input type="number" className={input} style={{ borderColor: '#e0dbd6' }} value={a.trial} onChange={e => set('trial', e.target.value)} /></label>
        </div>
        <input className={input} style={{ borderColor: '#e0dbd6' }} placeholder="Billing email" value={a.email} onChange={e => set('email', e.target.value)} />
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={a.free} onChange={e => set('free', e.target.checked)} /> 🆓 Charges off (counted, never billed)</label>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={a.status === 'paused'} onChange={e => set('status', e.target.checked ? 'paused' : 'active')} /> ⏸ Paused</label>
        {err && <div className="text-sm" style={{ color: '#b91c1c' }}>{err}</div>}
        <div className="flex gap-2 justify-end">
          <button className="text-sm font-bold rounded-xl px-3 py-2" style={{ border: '1px solid #e0dbd6' }} onClick={onClose}>Cancel</button>
          <button className="text-sm font-extrabold rounded-xl px-4 py-2" style={{ backgroundColor: ORANGE, color: 'white' }} disabled={busy || !a.name} onClick={save}>{busy ? 'Saving…' : 'Save'}</button>
        </div>
      </div>
    </div>
  )
}

// Link a body shop under an account (or move it).
function LinkEditor({ init, accounts, onClose, onSaved }) {
  const [l, setL] = useState({ shop_name: init?.shop_name || '', ccc_shop_id: init?.ccc_shop_id || '', account_id: init?.account_id || accounts.find(a => a.type !== 'house')?.id || 'house', price: init?.price ?? '', free: !!init?.free })
  const [busy, setBusy] = useState(false), [err, setErr] = useState('')
  const set = (k, v) => setL(x => ({ ...x, [k]: v }))
  const save = async () => { setBusy(true); setErr(''); try { await call('/link', 'PUT', l); onSaved() } catch (e) { setErr(e.message) } finally { setBusy(false) } }
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ backgroundColor: 'rgba(0,0,0,.45)' }} onClick={onClose}>
      <div className="w-full max-w-md rounded-2xl p-5 grid gap-3" style={{ backgroundColor: '#fff' }} onClick={e => e.stopPropagation()}>
        <div className="text-lg font-extrabold" style={{ color: INK }}>🔗 Body shop → who pays</div>
        <input className={input} style={{ borderColor: '#e0dbd6' }} placeholder="Body shop name (as on the CCC estimate)" value={l.shop_name} onChange={e => set('shop_name', e.target.value)} />
        <input className={input} style={{ borderColor: '#e0dbd6' }} placeholder="CCC shop ID (optional, beats the name)" value={l.ccc_shop_id} onChange={e => set('ccc_shop_id', e.target.value)} />
        <select className={input} style={{ borderColor: '#e0dbd6' }} value={l.account_id} onChange={e => set('account_id', e.target.value)}>
          {accounts.map(a => <option key={a.id} value={a.id}>{a.type === 'house' ? '🏠 Absolute ADAS (never charged)' : a.name}</option>)}
        </select>
        <label className="grid gap-1 text-sm font-semibold" style={{ color: '#444' }}>Own $ per VIN (blank = account price)<input type="number" step="0.25" className={input} style={{ borderColor: '#e0dbd6' }} value={l.price ?? ''} onChange={e => set('price', e.target.value)} /></label>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={l.free} onChange={e => set('free', e.target.checked)} /> 🆓 Charges off for this body shop</label>
        {err && <div className="text-sm" style={{ color: '#b91c1c' }}>{err}</div>}
        <div className="flex gap-2 justify-end">
          <button className="text-sm font-bold rounded-xl px-3 py-2" style={{ border: '1px solid #e0dbd6' }} onClick={onClose}>Cancel</button>
          <button className="text-sm font-extrabold rounded-xl px-4 py-2" style={{ backgroundColor: ORANGE, color: 'white' }} disabled={busy || !l.shop_name} onClick={save}>{busy ? 'Saving…' : 'Save link'}</button>
        </div>
      </div>
    </div>
  )
}


// 🧑‍🔧 Phase 2: the ADAS IQ shop portal — signup switch, ADAS IQ Books status,
// body-shop requests to approve, and the portal link.
const PORTAL_LINK = `${window.location.origin}${window.location.pathname}?iq=portal`
function PortalPanel({ cfg, onChange }) {
  const [busy, setBusy] = useState(''), [msg, setMsg] = useState(''), [err, setErr] = useState('')
  const reqs = (cfg.link_requests || []).filter(r => r.status === 'pending')
  const acctName = id => cfg.accounts.find(a => a.id === id)?.name || id
  const run = async (tag, fn) => { setBusy(tag); setErr(''); setMsg(''); try { await fn() } catch (e) { setErr(e.message) } finally { setBusy('') } }
  const decide = (r, action, move = false) => run(r.id, async () => {
    try { await call(`/link-request/${r.id}`, 'POST', { action, move }); onChange() }
    catch (e) { if (/already bills to/.test(e.message) && window.confirm(`${e.message}\n\nMove it to ${acctName(r.account_id)}?`)) { await call(`/link-request/${r.id}`, 'POST', { action, move: true }); onChange() } else throw e }
  })
  return (
    <div style={box} className="grid gap-3">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div>
          <div className="font-extrabold" style={{ color: INK }}>🧑‍🔧 ADAS IQ shop portal</div>
          <div className="text-xs" style={{ color: '#888' }}>Where paying shops sign in, add a card, list body shops and set 🎚 filters. ADAS IQ brand only.</div>
        </div>
        <button className="text-xs font-bold rounded-xl px-3 py-1.5" style={{ border: '1px solid #e0dbd6' }} onClick={() => { try { navigator.clipboard?.writeText(PORTAL_LINK) } catch {} setMsg('Portal link copied.') }}>📋 Copy portal link</button>
      </div>
      <div className="flex items-center gap-2 flex-wrap">
        {cfg.signup_open ? <Pill bg={GREEN}>🟢 SIGNUP OPEN · anyone with the link can join</Pill> : <Pill bg="#6b7280">🔒 SIGNUP CLOSED · invite only</Pill>}
        <button className="text-xs font-bold rounded-xl px-3 py-1.5" style={{ border: '1px solid #e0dbd6' }} disabled={busy === 'open'}
          onClick={() => run('open', async () => { if (!cfg.signup_open && !window.confirm('The terms are still a DRAFT. Open public signup anyway?')) return; await call('/signup-open', 'POST', { open: !cfg.signup_open }); onChange() })}>
          {cfg.signup_open ? 'Close signup' : 'Open signup'}
        </button>
      </div>
      <div className="flex items-center gap-2 flex-wrap">
        {cfg.books?.ok ? <Pill bg={GREEN}>📒 INVOICES GO TO {String(cfg.books.name || '').toUpperCase()} BOOKS</Pill> : <Pill bg="#b91c1c">📒 CAN’T REACH {cfg.books?.which === 'iq' ? 'ADAS IQ' : 'ABSOLUTE ADAS'} BOOKS{cfg.books?.error ? ` · ${cfg.books.error}` : ''}</Pill>}
        <button className="text-xs font-bold rounded-xl px-3 py-1.5" style={{ border: '1px solid #e0dbd6' }} disabled={busy === 'org'}
          onClick={() => { const to = cfg.books?.which === 'iq' ? 'absolute' : 'iq'; run('org', async () => { if (!window.confirm(to === 'iq' ? 'Send new scrub invoices to ADAS IQ’s own Books (org 945498731)? Only once the ADAS IQ LLC and its Zoho Payments are set up.' : 'Send new scrub invoices to Absolute ADAS’s Books?')) return; await call('/books-org', 'POST', { org: to }); onChange() }) }}>
          Switch to {cfg.books?.which === 'iq' ? 'Absolute ADAS' : 'ADAS IQ'} Books
        </button>
        <span className="text-[11px]" style={{ color: '#888' }}>Invoices go in on the 1st. Shops pay from the invoice with Zoho Payments.</span>
      </div>
      {reqs.length > 0 && (
        <div className="grid gap-1.5">
          <div className="text-[11px] font-bold uppercase tracking-wide" style={{ color: '#999' }}>🔗 Body shops waiting for your OK ({reqs.length})</div>
          {reqs.map(r => (
            <div key={r.id} className="flex items-center justify-between gap-2 rounded-lg px-2 py-1.5" style={{ backgroundColor: '#fff7ed' }}>
              <div className="text-sm min-w-0"><b>{r.shop_name}</b> <span style={{ color: '#888' }}>→ {acctName(r.account_id)}</span></div>
              <div className="flex gap-1.5">
                <button className="text-[11px] font-extrabold rounded-full px-2.5 py-1" style={{ backgroundColor: GREEN, color: 'white' }} disabled={busy === r.id} onClick={() => decide(r, 'approve')}>✓ Approve</button>
                <button className="text-[11px] font-bold rounded-full px-2.5 py-1" style={{ border: '1px solid #e0dbd6' }} disabled={busy === r.id} onClick={() => decide(r, 'deny')}>✕</button>
              </div>
            </div>
          ))}
          <div className="text-[11px]" style={{ color: '#888' }}>Approving puts that body shop’s estimates on the account’s bill and in its portal. Only approve shops that really send to them.</div>
        </div>
      )}
      {msg && <div className="text-sm" style={{ color: GREEN }}>{msg}</div>}
      {err && <div className="text-sm" style={{ color: '#b91c1c' }}>{err}</div>}
    </div>
  )
}

// ✉️ Invite a login for an account → a set-password link Mark sends himself.
function InviteEditor({ acct, onClose }) {
  const [f, setF] = useState({ name: '', email: acct?.email || '' }), [link, setLink] = useState(''), [busy, setBusy] = useState(false), [err, setErr] = useState('')
  const go = async () => { setBusy(true); setErr(''); try { const d = await call('/invite', 'POST', { account_id: acct.id, ...f }); setLink(d.link) } catch (e) { setErr(e.message) } finally { setBusy(false) } }
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ backgroundColor: 'rgba(0,0,0,.45)' }} onClick={onClose}>
      <div className="w-full max-w-md rounded-2xl p-5 grid gap-3" style={{ backgroundColor: '#fff' }} onClick={e => e.stopPropagation()}>
        <div className="text-lg font-extrabold" style={{ color: INK }}>✉️ Portal login for {acct.name}</div>
        {!link ? <>
          <input className={input} style={{ borderColor: '#e0dbd6' }} placeholder="Their name" value={f.name} onChange={e => setF(x => ({ ...x, name: e.target.value }))} />
          <input className={input} style={{ borderColor: '#e0dbd6' }} placeholder="Their email" value={f.email} onChange={e => setF(x => ({ ...x, email: e.target.value }))} />
          {err && <div className="text-sm" style={{ color: '#b91c1c' }}>{err}</div>}
          <div className="flex gap-2 justify-end"><button className="text-sm font-bold rounded-xl px-3 py-2" style={{ border: '1px solid #e0dbd6' }} onClick={onClose}>Cancel</button><button className="text-sm font-extrabold rounded-xl px-4 py-2" style={{ backgroundColor: ORANGE, color: 'white' }} disabled={busy || !f.email} onClick={go}>{busy ? 'Making…' : 'Make invite link'}</button></div>
        </> : <>
          <div className="text-sm" style={{ color: '#555' }}>Send this to {f.name || f.email} yourself. It works for 7 days. They pick a password and accept the terms.</div>
          <textarea readOnly className={input} style={{ borderColor: '#e0dbd6', minHeight: 90, fontSize: 12 }} value={link} onFocus={e => e.target.select()} />
          <div className="flex gap-2 justify-end"><button className="text-sm font-extrabold rounded-xl px-4 py-2" style={{ backgroundColor: INK, color: 'white' }} onClick={() => { try { navigator.clipboard?.writeText(link) } catch {} onClose() }}>📋 Copy and close</button></div>
        </>}
      </div>
    </div>
  )
}


// 🧾 Phase 3: invoices for the month on the picker. Built on the 1st by the app
// (or the Build button); charged when Mark presses Charge, or by itself once
// they go into ADAS IQ's Zoho Books (org 945498731); paid there = paid here.
const INV_PILL = { draft: ['#6b7280', '📝 BUILT · not in Books yet'], sent: ['#2563eb', '📒 IN BOOKS · waiting for payment'], paid: [GREEN, '✅ PAID'], paid_manual: [GREEN, '✅ PAID (outside Stripe)'], failed: ['#b91c1c', '❌ CARD FAILED'], void: ['#9ca3af', '🚫 VOID'] }
function InvoicesPanel({ month, onChange }) {
  const [d, setD] = useState(null), [busy, setBusy] = useState(''), [err, setErr] = useState(''), [open, setOpen] = useState('')
  const load = () => call(`/invoices?month=${month}`).then(setD).catch(e => setErr(e.message))
  useEffect(() => { load() }, [month])
  const run = async (tag, fn, confirmMsg) => {
    if (confirmMsg && !window.confirm(confirmMsg)) return
    setBusy(tag); setErr('')
    try { await fn(); await load(); onChange?.() } catch (e) { setErr(e.message) } finally { setBusy('') }
  }
  const over = month < thisMonth()
  const drafts = (d?.invoices || []).filter(i => i.status === 'draft')
  const draftTotal = drafts.reduce((t, i) => t + i.total, 0)
  return (
    <div style={box} className="grid gap-3">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div>
          <div className="font-extrabold" style={{ color: INK }}>🧾 Invoices for {month}</div>
          <div className="text-xs" style={{ color: '#888' }}>The app builds these on the 1st (after 2 AM PT) and puts them in ADAS IQ’s Zoho Books. Paid in Books = paid here, by itself. Unpaid 30 days → new estimates are held.</div>
        </div>
      </div>
      {!d?.invoices?.length && (
        <div className="flex items-center gap-2 flex-wrap text-sm" style={{ color: '#888' }}>
          {over ? 'No invoices for this month yet.' : 'This month isn’t over yet. Invoices get built on the 1st.'}
          {over && <button className="text-xs font-extrabold rounded-xl px-3 py-1.5" style={{ backgroundColor: INK, color: 'white' }} disabled={busy === 'close'} onClick={() => run('close', () => call('/invoices/close', 'POST', { month }))}>{busy === 'close' ? 'Building…' : `Build ${month} invoices`}</button>}
        </div>
      )}
      {drafts.length > 0 && (
        <button className="text-sm font-extrabold rounded-xl px-4 py-2 justify-self-start" style={{ backgroundColor: ORANGE, color: 'white' }} disabled={busy === 'all'}
          onClick={() => run('all', () => call('/invoices/push', 'POST', { month }))}>
          {busy === 'all' ? 'Sending to Books…' : `📒 Put ${drafts.length} in Books · ${money(draftTotal)}`}
        </button>
      )}
      <div className="grid gap-1.5">
        {(d?.invoices || []).map(i => {
          const [bg, label] = INV_PILL[i.status] || ['#6b7280', i.status]
          return (
            <div key={i.number} className="rounded-lg px-3 py-2" style={{ backgroundColor: '#fafaf9', border: '1px solid #f0ece8' }}>
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <button className="text-left min-w-0" onClick={() => setOpen(open === i.number ? '' : i.number)}>
                  <div className="text-sm font-extrabold">{i.account_name} <span className="font-normal text-xs" style={{ color: '#888' }}>· {i.number} · {i.vins} VINs{i.filtered_count ? ` · ${i.filtered_count} filtered free` : ''}</span></div>
                  <div className="mt-0.5"><Pill bg={bg}>{label}</Pill>{i.books_error ? <span className="text-[11px] ml-2" style={{ color: '#b91c1c' }}>⚠️ Books: {i.books_error}</span> : null}{i.past_due_at ? <span className="ml-2"><Pill bg="#7f1d1d">⛔ PAST DUE · estimates held</Pill></span> : null}</div>
                </button>
                <div className="flex items-center gap-1.5">
                  <span className="text-lg font-extrabold" style={{ color: i.status.startsWith('paid') ? GREEN : INK }}>{money(i.total)}</span>
                  {i.books_invoice_id && <a className="text-[11px] font-extrabold rounded-full px-2.5 py-1" style={{ backgroundColor: '#2563eb', color: 'white' }} href={`https://books.zoho.com/app/${i.books_org === 'iq' ? '945498731' : (d?.absolute_org || '')}#/invoices/${i.books_invoice_id}`} target="_blank" rel="noreferrer">📒 Books</a>}
                  {['draft', 'sent', 'failed'].includes(i.status) && <button className="text-[11px] font-bold rounded-full px-2 py-1" style={{ border: '1px solid #e0dbd6' }} disabled={busy === i.number} onClick={() => run(i.number, () => call(`/invoices/${i.number}/mark-paid`, 'POST'), `Record ${i.number} as paid by check / ACH? It goes into Books as a payment.`)}>Paid by check</button>}
                  {['draft', 'sent', 'failed'].includes(i.status) && <button className="text-[11px] font-bold rounded-full px-2 py-1" style={{ border: '1px solid #e0dbd6' }} disabled={busy === i.number} onClick={() => run(i.number, () => call(`/invoices/${i.number}/void`, 'POST'), `Void ${i.number}? It’s voided in Books too and the shop won’t owe it.`)}>Void</button>}
                </div>
              </div>
              {open === i.number && (
                <div className="mt-2 grid gap-1 text-xs" style={{ color: '#555' }}>
                  {i.lines.map(l => <div key={l.text} className="flex justify-between gap-2"><span>{l.text}</span><b>{money(l.amount)}</b></div>)}
                  {i.reminder && <>
                    <div className="font-bold mt-2" style={{ color: INK }}>Reminder to send them (edit it first, it’s not sent by the app):</div>
                    <textarea readOnly className={input} style={{ borderColor: '#e0dbd6', minHeight: 120, fontSize: 12 }} value={i.reminder} onFocus={e => e.target.select()} />
                  </>}
                </div>
              )}
            </div>
          )
        })}
      </div>
      {err && <div className="text-sm" style={{ color: '#b91c1c' }}>{err}</div>}
    </div>
  )
}


// ✅ Approve / deny (Mark 2026-11-04): new signups wait here, and adas-iq.com
// early-access requests can be invited or dismissed. Every decision hands back
// a message DRAFT for Mark to edit and send himself.
function MessageDraft({ title, text, onClose }) {
  const [t, setT] = useState(text)
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ backgroundColor: 'rgba(0,0,0,.45)' }} onClick={onClose}>
      <div className="w-full max-w-lg rounded-2xl p-5 grid gap-3" style={{ backgroundColor: '#fff' }} onClick={e => e.stopPropagation()}>
        <div className="text-lg font-extrabold" style={{ color: INK }}>{title}</div>
        <div className="text-sm" style={{ color: '#555' }}>Done in the app. Here’s a message to send them. Edit it, then copy it into your email. The app doesn’t send it.</div>
        <textarea className={input} style={{ borderColor: '#e0dbd6', minHeight: 220, fontSize: 13 }} value={t} onChange={e => setT(e.target.value)} />
        <div className="flex gap-2 justify-end"><button className="text-sm font-extrabold rounded-xl px-4 py-2" style={{ backgroundColor: INK, color: 'white' }} onClick={() => { try { navigator.clipboard?.writeText(t) } catch {} onClose() }}>📋 Copy and close</button></div>
      </div>
    </div>
  )
}

function ReviewPanel({ cfg, onChange }) {
  const [apps, setApps] = useState([]), [busy, setBusy] = useState(''), [err, setErr] = useState(''), [draft, setDraft] = useState(null)
  const [terms, setTerms] = useState({})   // per account / applicant: { price, trial, type }
  const loadApps = () => call('/applicants').then(d => setApps(d.applicants || [])).catch(() => setApps([]))
  useEffect(() => { loadApps() }, [])
  const waiting = cfg.accounts.filter(a => a.status === 'pending_review')
  const open = apps.filter(a => !a.decision)
  const t = id => terms[id] || {}
  const setT = (id, k, v) => setTerms(x => ({ ...x, [id]: { ...x[id], [k]: v } }))
  const user = id => (cfg.users || []).find(u => u.account_id === id)
  const reqs = id => (cfg.link_requests || []).filter(r => r.account_id === id && r.status === 'pending')
  const review = (a, action) => run(a.id, async () => {
    if (action === 'deny' && !window.confirm(`Deny ${a.name}? Their login stops working.`)) return
    const d = await call(`/account/${a.id}/review`, 'POST', { action, price: t(a.id).price, trial: t(a.id).trial })
    setDraft({ title: action === 'deny' ? `🚫 ${a.name} denied` : `✅ ${a.name} approved${d.conflicts?.length ? ` · ⚠️ already on another account: ${d.conflicts.join(', ')}` : ''}`, text: d.message })
    onChange()
  })
  const lead = (l, action) => run(l.id, async () => {
    if (action === 'dismiss') { await call(`/applicants/${l.id}`, 'POST', { action }); return loadApps() }
    const d = await call(`/applicants/${l.id}`, 'POST', { action: 'invite', name: l.name, company: l.company, email: l.email, type: t(l.id).type || 'cal_shop', price: t(l.id).price, trial: t(l.id).trial })
    setDraft({ title: `✉️ ${l.company} invited`, text: d.message }); loadApps(); onChange()
  })
  const run = async (tag, fn) => { setBusy(tag); setErr(''); try { await fn() } catch (e) { setErr(e.message) } finally { setBusy('') } }
  const priceInputs = id => (
    <div className="flex gap-1.5 items-center text-[11px]" style={{ color: '#666' }}>
      $<input type="number" step="0.25" className="rounded border px-1.5 py-1 w-16" style={{ borderColor: '#e0dbd6' }} placeholder={String(cfg.defaults?.price ?? 3)} value={t(id).price ?? ''} onChange={e => setT(id, 'price', e.target.value)} />/VIN ·
      <input type="number" className="rounded border px-1.5 py-1 w-14" style={{ borderColor: '#e0dbd6' }} placeholder={String(cfg.defaults?.trial ?? 25)} value={t(id).trial ?? ''} onChange={e => setT(id, 'trial', e.target.value)} /> free
    </div>
  )
  if (!waiting.length && !open.length) return draft ? <MessageDraft {...draft} onClose={() => setDraft(null)} /> : null
  return (
    <div style={{ ...box, borderColor: '#fdba74', backgroundColor: '#fffbf5' }} className="grid gap-3">
      {waiting.length > 0 && <div className="grid gap-2">
        <div className="font-extrabold" style={{ color: INK }}>🕓 Waiting for your OK ({waiting.length})</div>
        {waiting.map(a => (
          <div key={a.id} className="rounded-xl p-3 grid gap-2" style={{ backgroundColor: '#fff', border: '1px solid #f0ece8' }}>
            <div className="flex justify-between gap-2 flex-wrap">
              <div className="min-w-0">
                <div className="font-extrabold">{a.type === 'cal_shop' ? '🔧' : '🚗'} {a.name}</div>
                <div className="text-xs" style={{ color: '#666' }}>{user(a.id)?.name || ''} · {a.email}{a.phone ? ` · ${a.phone}` : ''} · signed up {String(a.created_at || '').slice(0, 10)}{(cfg.contracts || []).some(c => c.account_id === a.id) ? ' · ✅ terms accepted' : ''}</div>
                {reqs(a.id).length > 0 && <div className="text-xs mt-1" style={{ color: '#555' }}>Body shops: {reqs(a.id).map(r => r.shop_name).join(', ')}</div>}
              </div>
              {priceInputs(a.id)}
            </div>
            <div className="flex gap-2">
              <button className="text-xs font-extrabold rounded-xl px-3 py-1.5" style={{ backgroundColor: GREEN, color: 'white' }} disabled={busy === a.id} onClick={() => review(a, 'approve')}>✓ Approve{reqs(a.id).length ? ` + ${reqs(a.id).length} body shop${reqs(a.id).length === 1 ? '' : 's'}` : ''}</button>
              <button className="text-xs font-bold rounded-xl px-3 py-1.5" style={{ border: '1px solid #e0dbd6', color: '#b91c1c' }} disabled={busy === a.id} onClick={() => review(a, 'deny')}>✕ Deny</button>
            </div>
          </div>
        ))}
      </div>}
      {open.length > 0 && <div className="grid gap-2">
        <div className="font-extrabold" style={{ color: INK }}>🎯 Early-access requests from adas-iq.com ({open.length})</div>
        {open.map(l => (
          <div key={l.id} className="rounded-xl p-3 grid gap-2" style={{ backgroundColor: '#fff', border: '1px solid #f0ece8' }}>
            <div className="flex justify-between gap-2 flex-wrap">
              <div className="min-w-0">
                <div className="font-extrabold">{l.company}</div>
                <div className="text-xs" style={{ color: '#666' }}>{l.name} · {l.email} · {String(l.at || '').slice(0, 10)}</div>
                {l.pain && <div className="text-xs mt-1 italic" style={{ color: '#555' }}>“{l.pain}”</div>}
              </div>
              <div className="grid gap-1 justify-items-end">
                <div className="flex gap-1">{[['cal_shop', '🔧 Cal shop'], ['body_shop', '🚗 Body shop']].map(([k, lb]) => <button key={k} className="text-[11px] font-bold rounded-full px-2 py-0.5" onClick={() => setT(l.id, 'type', k)} style={(t(l.id).type || 'cal_shop') === k ? { backgroundColor: INK, color: 'white' } : { border: '1px solid #e0dbd6', color: '#555' }}>{lb}</button>)}</div>
                {priceInputs(l.id)}
              </div>
            </div>
            <div className="flex gap-2">
              <button className="text-xs font-extrabold rounded-xl px-3 py-1.5" style={{ backgroundColor: GREEN, color: 'white' }} disabled={busy === l.id} onClick={() => lead(l, 'invite')}>✓ Approve + make invite</button>
              <button className="text-xs font-bold rounded-xl px-3 py-1.5" style={{ border: '1px solid #e0dbd6', color: '#b91c1c' }} disabled={busy === l.id} onClick={() => lead(l, 'dismiss')}>✕ Dismiss</button>
            </div>
          </div>
        ))}
      </div>}
      {err && <div className="text-sm" style={{ color: '#b91c1c' }}>{err}</div>}
      {draft && <MessageDraft {...draft} onClose={() => setDraft(null)} />}
    </div>
  )
}

// "4 of 6 signed up" + the steps, on every paying account's card.
function SignupSteps({ s, status, statuses }) {
  if (!s) return null
  return (
    <div className="mt-2 rounded-lg px-2 py-1.5" style={{ backgroundColor: s.complete ? '#f0fdf4' : '#fffbeb' }}>
      <div className="text-[11px] font-extrabold" style={{ color: s.complete ? GREEN : '#92400e' }}>{s.complete ? '✅ Fully signed up' : `${s.done} of ${s.total} signed up`} · {statuses?.[status] || status}</div>
      {!s.complete && <div className="flex gap-x-2 gap-y-0.5 flex-wrap mt-0.5">{s.steps.map(x => <span key={x.key} className="text-[11px]" style={{ color: x.done ? GREEN : '#9ca3af' }}>{x.done ? '✓' : '○'} {x.label}</span>)}</div>}
    </div>
  )
}


// 🔌 ADAS IQ engine connection: ADAS IQ (its own project) sends estimates to
// this app's scrubber so its results are exactly the same. Key made in the
// ADAS IQ owner console → Settings, pasted here once.
function IqEnginePanel() {
  const [st, setSt] = useState(null), [key, setKey] = useState(''), [busy, setBusy] = useState(false), [msg, setMsg] = useState('')
  const load = () => call('/iq-engine').then(setSt).catch(() => setSt({ connected: false }))
  useEffect(() => { load() }, [])
  const save = async () => { setBusy(true); setMsg(''); try { await call('/iq-engine', 'POST', { key }); setKey(''); setMsg('✓ Connected.'); load() } catch (e) { setMsg(e.message) } finally { setBusy(false) } }
  return (
    <div style={box} className="flex items-center gap-2 flex-wrap">
      <div className="font-extrabold" style={{ color: INK }}>🔌 ADAS IQ engine</div>
      {st?.connected ? <Pill bg={GREEN}>✅ CONNECTED · ADAS IQ scrubs run on this scrubber</Pill> : <Pill bg="#6b7280">NOT CONNECTED</Pill>}
      <input type="password" autoComplete="off" className="rounded-lg px-3 py-1.5 text-sm border flex-1 min-w-[200px]" style={{ borderColor: '#e0dbd6' }} placeholder="Paste the key from ADAS IQ → Settings (iqk_…)" value={key} onChange={e => setKey(e.target.value)} />
      <button className="text-xs font-extrabold rounded-xl px-3 py-1.5" style={{ backgroundColor: INK, color: 'white' }} disabled={!key || busy} onClick={save}>{busy ? 'Saving…' : 'Connect'}</button>
      {msg && <span className="text-sm" style={{ color: msg.startsWith('✓') ? GREEN : '#b91c1c' }}>{msg}</span>}
    </div>
  )
}

export default function ScrubBillingScreen({ user, onLogout, currentScreen, onNavigate }) {
  const [month, setMonth] = useState(thisMonth())
  const [cfg, setCfg] = useState(null)
  const [sum, setSum] = useState(null)
  const [err, setErr] = useState('')
  const [edit, setEdit] = useState(null)   // { kind: 'filters'|'account'|'link', ... }
  const load = async () => {
    setErr('')
    try { const [c, s] = await Promise.all([call('/config'), call(`/summary?month=${month}`)]); setCfg(c); setSum(s) } catch (e) { setErr(e.message) }
  }
  useEffect(() => { load() }, [month])
  const saved = () => { setEdit(null); load() }

  const accounts = cfg?.accounts || []
  const links = cfg?.links || []
  const used = id => sum?.accounts?.find(b => b.account_id === id)
  return (
    <div className="min-h-screen" style={{ backgroundColor: '#fafaf9' }}>
      <Navbar user={user} onLogout={onLogout} currentScreen={currentScreen} onNavigate={onNavigate} />
      <div className="p-4 max-w-5xl mx-auto grid gap-3">
        <div className="flex items-end justify-between gap-3 flex-wrap">
          <div>
            <h1 className="text-2xl font-bold" style={{ color: INK }}>💳 Scrub billing</h1>
            <p className="text-sm" style={{ color: '#777' }}>Who pays for CCC scrubs. Counting only: no invoices or card charges yet.</p>
          </div>
          <div className="flex gap-2 items-center">
            <input type="month" className="rounded-lg px-3 py-2 text-sm border" style={{ borderColor: '#e0dbd6' }} value={month} onChange={e => setMonth(e.target.value)} />
            <button className="text-sm font-extrabold rounded-xl px-3 py-2" style={{ backgroundColor: ORANGE, color: 'white' }} onClick={() => setEdit({ kind: 'account' })}>➕ Account</button>
            <button className="text-sm font-bold rounded-xl px-3 py-2" style={{ border: '1.5px solid #e0dbd6', backgroundColor: '#fff' }} onClick={() => setEdit({ kind: 'link' })}>🔗 Link body shop</button>
          </div>
        </div>
        {err && <div className="rounded-lg px-3 py-2 text-sm" style={{ backgroundColor: '#fef2f2', color: '#b91c1c' }}>{err}</div>}

        {sum && (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            {[['Scrubs', sum.scrubs, INK], ['Billable', sum.billable, ORANGE], ['🎚 Filtered', sum.filtered || 0, PURPLE], ['To bill', money(sum.total), GREEN]].map(([l, v, c]) => (
              <div key={l} style={box}><div className="text-xs font-semibold" style={{ color: '#888' }}>{l}</div><div className="text-2xl font-extrabold" style={{ color: c }}>{v}</div></div>
            ))}
          </div>
        )}

        <IqEnginePanel />

        {cfg && <ReviewPanel cfg={cfg} onChange={load} />}

        {cfg && <InvoicesPanel month={month} onChange={load} />}

        {cfg && <PortalPanel cfg={cfg} onChange={load} />}

        {cfg && (
          <div className="grid gap-3 md:grid-cols-2">
            {accounts.map(a => {
              const u = used(a.id)
              const mine = links.filter(l => l.account_id === a.id)
              return (
                <div key={a.id} style={{ ...box, borderColor: a.type === 'house' ? '#bbf7d0' : '#e8e4e0' }}>
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="text-lg font-extrabold truncate" style={{ color: INK }}>{a.type === 'house' ? '🏠' : a.type === 'cal_shop' ? '🔧' : '🚗'} {a.name}</div>
                      <div className="flex gap-1.5 flex-wrap mt-1"><ChargePill a={a} /><FilterPill f={a.filters} /></div>
                    </div>
                    <div className="text-right">
                      <div className="text-xl font-extrabold" style={{ color: GREEN }}>{money(u?.total)}</div>
                      <div className="text-[11px]" style={{ color: '#888' }}>{u?.scrubs || 0} scrubs · {u?.billable || 0} billable{u?.filtered ? ` · ${u.filtered} filtered` : ''}</div>
                    </div>
                  </div>
                  {a.type !== 'house' && <SignupSteps s={a.signup} status={a.status} statuses={cfg.statuses} />}
                  {a.type !== 'house' && <div className="text-[11px] mt-1 font-semibold" style={{ color: a.address?.zip ? GREEN : '#b45309' }}>{a.address?.zip ? `📒 bills to ${a.email} · ${a.address.city || ''} ${a.address.state || ''} ${a.address.zip}` : '📒 no billing address yet'}</div>}
                  {a.type !== 'house' && a.trial ? <div className="text-[11px] mt-1" style={{ color: '#888' }}>First {a.trial} scrubs free{a.email ? ` · bills to ${a.email}` : ''}</div> : null}
                  <div className="mt-3 grid gap-1">
                    <div className="text-[11px] font-bold uppercase tracking-wide" style={{ color: '#999' }}>Body shops{a.type === 'house' ? ' (plus every shop not linked anywhere)' : ''}</div>
                    {mine.length === 0 && <div className="text-sm" style={{ color: '#aaa' }}>{a.type === 'house' ? 'Every unlinked shop lands here.' : 'None linked yet.'}</div>}
                    {mine.map(l => {
                      const s = u?.shops?.find(x => x.shop.toLowerCase() === l.shop_name.toLowerCase())
                      return (
                        <div key={l.shop_name} className="flex items-center justify-between gap-2 rounded-lg px-2 py-1.5" style={{ backgroundColor: '#fafaf9' }}>
                          <div className="min-w-0">
                            <div className="text-sm font-semibold truncate">{l.shop_name}{l.ccc_shop_id ? <span className="text-[11px] font-normal" style={{ color: '#999' }}> · CCC {l.ccc_shop_id}</span> : null}</div>
                            <div className="flex gap-1 flex-wrap mt-0.5">{(l.free || l.price != null) && <ChargePill a={a} link={l} />}<FilterPill f={l.filters} /></div>
                          </div>
                          <div className="flex items-center gap-1.5">
                            <span className="text-xs font-bold" style={{ color: '#555' }}>{s?.scrubs || 0} · {money(s?.total)}</span>
                            <button className="text-[11px] font-bold rounded-full px-2 py-1" style={{ border: '1px solid #e0dbd6' }} onClick={() => setEdit({ kind: 'filters', target: { kind: 'link', shop_name: l.shop_name, filters: l.filters, label: l.shop_name } })}>🎚</button>
                            <button className="text-[11px] font-bold rounded-full px-2 py-1" style={{ border: '1px solid #e0dbd6' }} onClick={() => setEdit({ kind: 'link', init: l })}>✏️</button>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                  <div className="flex gap-2 mt-3">
                    <button className="text-xs font-bold rounded-xl px-3 py-1.5" style={{ backgroundColor: PURPLE, color: 'white' }} onClick={() => setEdit({ kind: 'filters', target: { kind: 'account', id: a.id, filters: a.filters, label: a.name } })}>🎚 Filters</button>
                    {a.type !== 'house' && <button className="text-xs font-bold rounded-xl px-3 py-1.5" style={{ border: '1px solid #e0dbd6' }} onClick={() => setEdit({ kind: 'account', acct: a })}>✏️ Edit</button>}
                    <button className="text-xs font-bold rounded-xl px-3 py-1.5" style={{ border: '1px solid #e0dbd6' }} onClick={() => setEdit({ kind: 'link', init: { account_id: a.id } })}>🔗 Add body shop</button>
                    {a.type !== 'house' && <button className="text-xs font-bold rounded-xl px-3 py-1.5" style={{ border: '1px solid #e0dbd6' }} onClick={() => setEdit({ kind: 'invite', acct: a })}>✉️ Login{(cfg.users || []).some(x => x.account_id === a.id) ? ` (${(cfg.users || []).filter(x => x.account_id === a.id).length})` : ''}</button>}
                  </div>
                </div>
              )
            })}
          </div>
        )}

        {sum?.unlinked?.length > 0 && (
          <div style={box}>
            <div className="font-extrabold" style={{ color: INK }}>🧩 Body shops not linked to anyone ({sum.unlinked.length})</div>
            <div className="text-xs mb-2" style={{ color: '#888' }}>These counted as Absolute ADAS this month (no charge). When a cal shop signs up, link its body shops here.</div>
            <div className="flex gap-1.5 flex-wrap">
              {sum.unlinked.map(s => <button key={s} className="text-xs font-semibold rounded-full px-2.5 py-1" style={{ border: '1px solid #e0dbd6', backgroundColor: '#fff' }} onClick={() => setEdit({ kind: 'link', init: { shop_name: s } })}>🔗 {s}</button>)}
            </div>
          </div>
        )}

        {sum && (
          <div style={box}>
            <div className="font-extrabold mb-2" style={{ color: INK }}>🧾 Latest scrubs this month</div>
            {!sum.recent?.length && <div className="text-sm" style={{ color: '#aaa' }}>Nothing counted yet. The next CCC estimate will show up here.</div>}
            <div className="grid gap-1">
              {(sum.recent || []).map(r => (
                <div key={r.key} className="flex items-center justify-between gap-2 text-sm border-b py-1.5" style={{ borderColor: '#f0ece8' }}>
                  <div className="min-w-0">
                    <div className="font-semibold truncate">{r.shop || 'Unknown shop'} <span className="font-normal" style={{ color: '#888' }}>· {r.vin || 'no VIN'} · RO {r.ro || '?'} · {r.version}</span></div>
                    <div className="text-[11px]" style={{ color: String(r.reason).startsWith('filtered') ? PURPLE : '#888' }}>{r.account_name} · {r.reason}</div>
                  </div>
                  <div className="font-extrabold" style={{ color: r.billable ? ORANGE : '#aaa' }}>{r.billable ? money(r.price) : '$0'}</div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
      {edit?.kind === 'filters' && <FilterEditor target={edit.target} onClose={() => setEdit(null)} onSaved={saved} />}
      {edit?.kind === 'account' && <AccountEditor acct={edit.acct} onClose={() => setEdit(null)} onSaved={saved} />}
      {edit?.kind === 'invite' && <InviteEditor acct={edit.acct} onClose={() => { setEdit(null); load() }} />}
      {edit?.kind === 'link' && <LinkEditor init={edit.init} accounts={accounts} onClose={() => setEdit(null)} onSaved={saved} />}
    </div>
  )
}
