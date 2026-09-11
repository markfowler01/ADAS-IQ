// 💸 Bill it (Mark 2026-09-10) — the in-app review of BOTH documents
// before anything is emailed: the insurance invoice (the estimate, at
// list) and the cost invoice (per-line partnership discount). Staff only;
// the server refuses technicians and refuses to double-bill.
//
// The LEFT side is editable (Mark: "whatever happened on the left side,
// I want it to happen on the right side also"): change a price or qty,
// remove a line, add an item from the Books catalog. The right side
// mirrors it live, and on send the Books estimate is updated to match
// before either document is emailed — so both always agree.
import { useEffect, useState } from 'react'
import { API_BASE, apiFetch } from '../utils/api.js'
import { Big3Picker, describeRules, normalizeMode } from './books/Big3Rules.jsx'

const ORANGE = '#CD4419'
const GREEN = '#15803d'
const fmt = n => `$${Number(n || 0).toFixed(2)}`
const r2 = n => Math.round((Number(n) || 0) * 100) / 100
// Same words the server uses to tell a real part from a service typed "goods" in Books.
const LOOKS_LIKE_SERVICE = /scan|calibrat|inspection|labor|set-?up|program|diagnos|report|snapshot|aim|alignment|ride|remove|install|r&i|r & i/i
const NO_DISCOUNT = /calibration identification report|^sfp?\s*[-\s].*post[- ]?scan/i
// Which Big 4 slot a line is (mirrors the server's big3KeyFor).
const big3KeyFor = name => {
  const n = String(name || '').toLowerCase()
  if (/calibration identification report/.test(n)) return 'cal_id'
  if (/post collision safety inspection|\bpcsi\b/.test(n)) return 'pcsi'
  if (/calibration snapshot/.test(n)) return 'snapshot'
  if (/post[- ]?(calibration )?scan/.test(n)) return 'post_scan'
  return null
}
const BIG3_ORDER = ['cal_id', 'pcsi', 'post_scan', 'snapshot']
// Rebuild the Big 4 lines from a rule: Charge → paid item, Included → "(included)" $0 item,
// Off → none; Snapshot charge ⇒ no Post-Scan line at all (Mark: "no post scan with snapshot").
function applyBig3(lines, rules, items) {
  const others = lines.filter(l => !l.big3_key)
  const firstIdx = lines.findIndex(l => l.big3_key)
  const fresh = []
  for (const key of BIG3_ORDER) {
    const it = items?.[key]; if (!it) continue
    let mode = normalizeMode(rules[key]) || 'off'
    if (key === 'post_scan' && normalizeMode(rules.snapshot) === 'charge') mode = 'off'
    if (key === 'snapshot' && mode !== 'charge') continue
    const pick = mode === 'charge' ? it.paid : mode === 'included' ? it.base : null
    if (!pick) continue
    const prev = lines.find(l => l.big3_key === key && (l.name === pick.name))
    fresh.push(prev ? { ...prev, rate: pick.rate, quantity: prev.quantity || 1 } : { item_id: pick.item_id, name: pick.name, description: '', rate: pick.rate, quantity: 1, product_type: pick.product_type || 'service', is_part: false, never_discount: NO_DISCOUNT.test(pick.name), big3_key: key, _edited: true })
  }
  const at = firstIdx < 0 ? 0 : Math.min(firstIdx, others.length)
  return [...others.slice(0, at), ...fresh, ...others.slice(at)]
}

export default function BillItModal({ job, user, onClose, onBilled }) {
  const [p, setP] = useState(null)
  const [lines, setLines] = useState([])
  const [err, setErr] = useState('')
  const [emails, setEmails] = useState('')
  const [pct, setPct] = useState(null)
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState(null)
  const [dry, setDry] = useState(false)
  const [catalog, setCatalog] = useState([])
  const [q, setQ] = useState('')
  const [rules, setRules] = useState(null)
  const [rulesTouched, setRulesTouched] = useState(false)
  const [remember, setRemember] = useState(true)
  const isOwner = String(user?.email || '').toLowerCase().startsWith('mark@') || user?.role === 'owner'

  useEffect(() => {
    let dead = false
    apiFetch(`${API_BASE}/api/jobs/${job.id}/bill/preview`, { method: 'POST' }).then(async r => {
      const d = await r.json().catch(() => ({}))
      if (dead) return
      if (!r.ok) { setErr(d.error || `HTTP ${r.status}`); return }
      const ls = (d.lines || []).map(l => ({ ...l, big3_key: l.big3_key || big3KeyFor(l.name) }))
      setP(d); setLines(ls); setEmails((d.emails || []).join(', ')); setPct(d.discount_pct)
      // Picker starts from what is actually ON the estimate (a paid line = Charge,
      // a $0 line = Included, missing = Off), falling back to the shop rule —
      // so a click changes only the slot Kat clicked.
      if (d.big3?.rules) {
        const eff = { ...d.big3.rules }
        for (const key of BIG3_ORDER) {
          const hit = ls.filter(l => l.big3_key === key)
          if (hit.length) eff[key] = hit.some(l => Number(l.rate) > 0) ? 'charge' : 'included'
          else if (key === 'post_scan' || key === 'snapshot') eff[key] = 'off'
        }
        if (eff.snapshot === 'charge') eff.post_scan = d.big3.rules.post_scan
        setRules(eff)
      }
    }).catch(e => !dead && setErr(e.message))
    apiFetch(`${API_BASE}/api/jobs/catalog`).then(r => r.json()).then(d => { if (!dead && d.ok) setCatalog(d.items || []) }).catch(() => {})
    return () => { dead = true }
  }, [job.id])

  function changeRules(next) { setRules(next); setRulesTouched(true); setLines(ls => applyBig3(ls, next, p?.big3?.items)) }
  function setLine(i, patch) { setLines(ls => ls.map((l, j) => j === i ? { ...l, ...patch, _edited: true } : l)) }
  function removeLine(i) { setLines(ls => ls.filter((_, j) => j !== i)) }
  function addItem(it) {
    setLines(ls => [...ls, { item_id: it.item_id, name: it.name, description: '', rate: r2(it.rate), quantity: 1, product_type: it.type || 'service', is_part: it.type === 'goods' && !LOOKS_LIKE_SERVICE.test(it.name), never_discount: NO_DISCOUNT.test(it.name), big3_key: big3KeyFor(it.name), _added: true, _edited: true }])
    setQ('')
  }
  const hits = q.trim().length >= 2 ? catalog.filter(i => i.name.toLowerCase().includes(q.trim().toLowerCase())).slice(0, 8) : []

  // Both columns derive from the same edited line set.
  const rows = lines.map(l => {
    const amount = r2((Number(l.rate) || 0) * (Number(l.quantity) || 0))
    const eligible = amount > 0 && !l.is_part && !l.never_discount
    const d = eligible && pct > 0 ? pct : 0
    const why = amount > 0 && !eligible ? (l.is_part ? 'part — no discount' : 'never discounted') : ''
    return { ...l, amount, d, why, cost: r2(amount * (1 - d / 100)) }
  })
  const insTotal = r2(rows.reduce((s, l) => s + l.amount, 0))
  const costTotal = r2(rows.reduce((s, l) => s + l.cost, 0))
  const edited = rows.some(l => l._edited) || (p && rows.length !== (p.lines || []).length)

  async function send() {
    if (!p) return
    const list = emails.split(/[,\s]+/).map(s => s.trim()).filter(Boolean)
    if (!list.length) { setErr('Add at least one email.'); return }
    if (!rows.length) { setErr('Nothing left to bill.'); return }
    if (!dry && !window.confirm(`Send BOTH to ${list.join(', ')}?\n\nInsurance invoice ${p.estimate_number}: ${fmt(insTotal)}\nCost invoice at ${pct}%: ${fmt(costTotal)}${edited ? '\n\nThe Books estimate will be updated to match your edits first.' : ''}`)) return
    setBusy(true); setErr('')
    try {
      const learnNew = !!(rules && p.big3 && !p.big3.has_rule)   // first invoice for this shop → remember what we did
      const body = { emails: list, discount_pct: pct, big3_rules: (rulesTouched || learnNew) ? rules : undefined, big3_save: (rulesTouched && remember) || learnNew, lines: rows.map(l => ({ line_item_id: l.line_item_id || null, item_id: l.item_id || null, name: l.name, description: l.description || '', rate: r2(l.rate), quantity: Number(l.quantity) || 1, product_type: l.product_type, _extra: !!l._extra })) }
      const r = await apiFetch(`${API_BASE}/api/jobs/${job.id}/bill${dry ? '?dry=1' : ''}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      const d = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(d.error || `HTTP ${r.status}`)
      setDone(d); if (!dry) onBilled && onBilled(d)
    } catch (e) { setErr(e.message) } finally { setBusy(false) }
  }

  const cell = { border: '1px solid #cbd5e1', borderRadius: 6, padding: '4px 6px', fontSize: 16, textAlign: 'right', backgroundColor: 'white' }

  return (
    <div className="fixed inset-0 z-[70] flex items-end sm:items-center justify-center" style={{ backgroundColor: 'rgba(0,0,0,0.55)' }} onMouseDown={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="bg-white w-full rounded-t-2xl sm:rounded-2xl flex flex-col" style={{ maxHeight: '96vh', maxWidth: 'min(1400px, 98vw)' }}>
        <div className="flex items-center justify-between px-5 py-3" style={{ borderBottom: '1px solid #ebebeb' }}>
          <div>
            <div className="text-[10px] uppercase tracking-wider font-semibold" style={{ color: '#888', fontFamily: 'IBM Plex Mono, monospace' }}>💸 Bill it · review before anything is sent</div>
            <div className="font-bold text-xl" style={{ color: '#1a1a1a' }}>{p?.shop_name || job.shop_name}{p?.estimate_number ? ` · ${p.estimate_number}` : ''}</div>
          </div>
          <button onClick={onClose} className="text-2xl leading-none" style={{ color: '#888' }}>×</button>
        </div>

        <div className="px-5 py-4 overflow-y-auto space-y-3">
          {err && <div className="text-base px-3 py-2 rounded-lg" style={{ backgroundColor: '#fef2f2', color: '#b91c1c' }}>{err}</div>}
          {!p && !err && <div className="text-sm py-6 text-center" style={{ color: '#888' }}>Reading the estimate from Books…</div>}
          {done && (
            <div className="rounded-xl p-4" style={{ backgroundColor: done.dry ? '#fffbeb' : '#f0fdf4', border: `1.5px solid ${done.dry ? '#fde68a' : '#86efac'}` }}>
              <div className="font-bold text-base" style={{ color: done.dry ? '#92400e' : GREEN }}>{done.dry ? '🧪 Dry run — nothing sent. Here is what it would have done:' : '✅ Both sent.'}</div>
              <div className="text-sm mt-1" style={{ color: '#555' }}>
                Insurance invoice {p.estimate_number} → {done.emails.join(', ')}<br />
                Cost invoice {done.invoice?.number || p.estimate_number} at {pct}% → {fmt(costTotal)}{done.invoice ? ` (Books total ${fmt(done.invoice.total)})` : ''}
                {done.estimate_updated ? <><br />Estimate updated in Books to match your edits.</> : null}
              </div>
              <button onClick={onClose} className="mt-3 text-base font-bold rounded-xl px-5 py-2.5 text-white" style={{ backgroundColor: GREEN }}>Done</button>
            </div>
          )}
          {p && !done && (<>
            {p.warnings.length > 0 && (
              <div className="rounded-xl p-3 text-sm space-y-1" style={{ backgroundColor: '#fffbeb', border: '1.5px solid #fde68a', color: '#92400e' }}>
                {p.warnings.map((w, i) => <div key={i}>⚠️ {w}</div>)}
              </div>
            )}
            {rules && p.big3 && (
              <div className="rounded-xl p-3" style={{ backgroundColor: p.big3.has_rule ? '#f0fdf4' : '#fffbeb', border: `1.5px solid ${p.big3.has_rule ? '#bbf7d0' : '#fde68a'}` }}>
                <div className="flex items-center justify-between mb-2 gap-2">
                  <span className="text-sm font-bold" style={{ color: '#1a1a1a' }}>🧾 Big 4 for {p.shop_name}</span>
                  <span className="text-xs" style={{ color: '#888' }}>{p.big3.has_rule ? `shop rule · ${p.big3.set_by || 'saved'}` : 'no shop rule yet — default shown'}</span>
                </div>
                <Big3Picker rules={rules} onChange={changeRules} />
                {(() => {
                  // Nudge (Mark 2026-09-11): "if we normally do not charge for post scans and all of a sudden we do, I want to be notified".
                  if (!p.big3?.has_rule) return <div className="text-xs mt-2" style={{ color: '#92400e' }}>🧠 First invoice for {p.shop_name} — whatever you send will be remembered as this shop's rule.</div>
                  const saved = p.big3.rules || {}
                  const labels = { cal_id: 'Cal ID report', pcsi: 'PCSI', post_scan: 'Post-Scan', snapshot: 'Calibration Snapshot' }
                  const word = m => normalizeMode(m) === 'charge' ? 'charge for' : normalizeMode(m) === 'included' ? 'include (no charge)' : 'leave off'
                  const diffs = Object.keys(labels).filter(k => normalizeMode(rules[k]) !== normalizeMode(saved[k]))
                  if (!diffs.length) return null
                  return (
                    <div className="rounded-lg px-3 py-2 mt-2 text-xs space-y-0.5" style={{ backgroundColor: '#fef2f2', border: '1px solid #fecaca', color: '#991b1b' }}>
                      {diffs.map(k => <div key={k}>⚠️ You normally <b>{word(saved[k])}</b> {labels[k]} at {p.shop_name}, this invoice will <b>{word(rules[k])}</b> it.{rulesTouched && remember ? ' Saving as the new rule.' : ''}</div>)}
                    </div>
                  )
                })()}
                <div className="flex items-center justify-between mt-2 gap-2 flex-wrap">
                  <label className="flex items-center gap-2 text-xs" style={{ color: rulesTouched ? '#555' : '#aaa' }}>
                    <input type="checkbox" checked={remember} disabled={!rulesTouched} onChange={e => setRemember(e.target.checked)} /> {rulesTouched ? `Remember for ${p.shop_name} (every invoice from now on)` : 'Change a switch to update this shop\'s rule'}
                  </label>
                  <span className="text-xs" style={{ color: '#888' }}>{describeRules(rules)}</span>
                </div>
              </div>
            )}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* LEFT — editable estimate */}
              <div className="rounded-xl overflow-hidden flex flex-col" style={{ border: '1.5px solid #bfdbfe' }}>
                <div className="px-4 py-3 text-base font-bold flex items-center justify-between gap-2" style={{ backgroundColor: '#eff6ff', color: '#1d4ed8' }}>
                  <span>🏦 Insurance invoice · estimate {p.estimate_number}</span>
                  <span className="text-xs font-semibold text-right" style={{ color: edited ? ORANGE : '#3b82f6' }}>{edited ? '✏️ edited — Books estimate will be updated' : 'tap a price or qty to edit'}</span>
                </div>
                {rows.map((l, i) => (
                  <div key={i} className="flex items-center gap-2 px-3 py-2 text-base" style={{ borderTop: '1px solid #f1f5f9', backgroundColor: l._added ? '#f0fdf4' : 'white' }}>
                    <span className="flex-1 min-w-0" style={{ color: '#1a1a1a' }}>{l.big3_key ? '🧾 ' : ''}{l.name}{l._extra ? ' ➕' : ''}{l._added ? <span className="text-xs font-bold" style={{ color: GREEN }}> · added</span> : null}</span>
                    <input type="number" step="1" min="1" value={l.quantity} onChange={e => setLine(i, { quantity: Math.max(1, Number(e.target.value) || 1) })} style={{ ...cell, width: 54 }} title="Qty" />
                    <span style={{ color: '#94a3b8' }}>×</span>
                    <input type="number" step="0.01" min="0" value={l.rate} onChange={e => setLine(i, { rate: e.target.value })} onBlur={e => setLine(i, { rate: r2(e.target.value) })} style={{ ...cell, width: 96 }} title="Price" />
                    <span className="tabular-nums font-semibold flex-shrink-0" style={{ color: '#1a1a1a', minWidth: 84, textAlign: 'right' }}>{fmt(l.amount)}</span>
                    <button type="button" onClick={() => removeLine(i)} className="w-7 h-7 rounded-full font-bold flex-shrink-0" style={{ backgroundColor: '#fef2f2', color: '#b91c1c' }} title="Remove line">×</button>
                  </div>
                ))}
                <div className="px-3 py-2" style={{ borderTop: '1px solid #f1f5f9', backgroundColor: '#f8fafc' }}>
                  <input value={q} onChange={e => setQ(e.target.value)} placeholder="＋ Add an item from Books… (type 2+ letters)" className="w-full rounded-lg px-3 py-2 text-base" style={{ border: '1px dashed #93c5fd', outline: 'none', backgroundColor: 'white' }} />
                  {hits.length > 0 && (
                    <div className="rounded-lg overflow-hidden mt-1" style={{ border: '1px solid #bfdbfe' }}>
                      {hits.map(it => (
                        <button key={it.item_id} type="button" onClick={() => addItem(it)} className="w-full text-left px-3 py-2 flex justify-between text-base" style={{ borderTop: '1px solid #eff6ff', backgroundColor: 'white' }}>
                          <span className="truncate" style={{ color: '#1a1a1a' }}>{it.name}{it.type === 'goods' ? <span className="text-xs" style={{ color: '#888' }}> · part</span> : null}</span><span className="tabular-nums" style={{ color: '#555' }}>{fmt(it.rate)}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
                <div className="flex justify-between px-4 py-3 text-xl font-extrabold" style={{ borderTop: '2px solid #e2e8f0', color: '#1a1a1a', marginTop: 'auto' }}><span>Total</span><span className="tabular-nums">{fmt(insTotal)}</span></div>
              </div>

              {/* RIGHT — cost invoice, mirrors the left */}
              <div className="rounded-xl overflow-hidden flex flex-col" style={{ border: '1.5px solid #bbf7d0' }}>
                <div className="px-4 py-3 text-base font-bold flex items-center justify-between" style={{ backgroundColor: '#f0fdf4', color: GREEN }}>
                  <span>💸 Cost invoice · {p.customer_type ? p.customer_type.replace(/_/g, ' ') : 'shop'} discount</span>
                  <span className="flex items-center gap-1">
                    <input type="number" min="0" max="50" value={pct ?? 0} onChange={e => setPct(Number(e.target.value))} className="w-20 text-lg font-bold rounded-md px-2 py-1 text-right" style={{ border: '2px solid #86efac' }} />%
                  </span>
                </div>
                {rows.map((l, i) => (
                  <div key={i} className="flex justify-between gap-3 px-4 text-base" style={{ borderTop: '1px solid #f1f5f9', minHeight: 45, alignItems: 'center', backgroundColor: l._added ? '#f0fdf4' : 'white' }}>
                    <span style={{ color: '#1a1a1a' }}>{l.name}{l.quantity > 1 ? ` ×${l.quantity}` : ''}{l.d ? <span className="font-bold" style={{ color: GREEN }}> −{l.d}%</span> : l.why ? <span style={{ color: '#888' }}> · {l.why}</span> : null}</span>
                    <span className="flex-shrink-0 tabular-nums font-semibold" style={{ color: l.d ? GREEN : '#555' }}>{fmt(l.cost)}</span>
                  </div>
                ))}
                <div className="flex justify-between px-4 py-3 text-xl font-extrabold" style={{ borderTop: '2px solid #dcfce7', color: GREEN, marginTop: 'auto' }}><span>Total · Due on Receipt</span><span className="tabular-nums">{fmt(costTotal)}</span></div>
              </div>
            </div>
            <div>
              <label className="block text-[11px] font-semibold uppercase tracking-wider mb-1" style={{ color: '#888' }}>Send both to</label>
              <input value={emails} onChange={e => setEmails(e.target.value)} placeholder="shop@email.com, second@email.com" className="w-full rounded-lg px-3 py-2.5 text-base" style={{ border: '1px solid #e0dbd6', outline: 'none' }} />
              <div className="text-sm mt-1" style={{ color: '#888' }}>From the Books contact. Saves the shop {fmt(insTotal - costTotal)}. Rule on file: {p.rule}.</div>
              {p.templates && (
                <div className="text-sm mt-1" style={{ color: '#888' }}>PDF templates: insurance → <b>{p.templates.estimate?.name || 'missing'}</b> · cost → <b>{p.templates.invoice?.name || 'missing'}</b>. Header carries RO#, Year/Make/Model, VIN and the scan-report link, same as Kat's.</div>
              )}
            </div>
            {isOwner && (
              <label className="flex items-center gap-2 text-sm" style={{ color: '#92400e' }}>
                <input type="checkbox" checked={dry} onChange={e => setDry(e.target.checked)} /> Dry run — build it, post to #dispatch, send nothing, change nothing in Books (Mark only)
              </label>
            )}
          </>)}
        </div>

        {p && !done && (
          <div className="px-5 py-3 flex gap-2" style={{ borderTop: '1px solid #ebebeb' }}>
            <button onClick={onClose} className="flex-1 rounded-xl py-3.5 text-base font-semibold" style={{ backgroundColor: '#f5f3f0', color: '#555' }}>Cancel</button>
            <button onClick={send} disabled={busy || (!dry && !p.can_bill)} className="flex-[2] rounded-xl py-3.5 text-lg font-bold text-white" style={{ backgroundColor: dry ? '#92400e' : GREEN, opacity: busy || (!dry && !p.can_bill) ? .45 : 1 }}>
              {busy ? 'Sending…' : dry ? '🧪 Dry run' : `💸 Send both — ${fmt(insTotal)} insurance · ${fmt(costTotal)} cost`}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
