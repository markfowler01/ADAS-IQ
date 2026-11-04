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
      {edit?.kind === 'link' && <LinkEditor init={edit.init} accounts={accounts} onClose={() => setEdit(null)} onSaved={saved} />}
    </div>
  )
}
