// 🧑‍🔧 ADAS IQ shop portal (Mark 2026-11-04, phase 2). /app/?iq=portal
// Calibration shops and body shops that pay for CCC scrubs: sign up (or accept
// an invite), accept the terms, put a card on file, see this month's scrubs,
// list their body shops and set 🎚 scrub filters. ADAS IQ brand only: no
// Absolute ADAS name, people, region or phone on this screen.
import { useEffect, useState } from 'react'
import { API_BASE } from '../utils/api.js'

const C = { bg: '#0d0d0d', card: '#141414', card2: '#1c1c1c', line: '#2a2a2a', text: '#f0f0f0', muted: '#888', orange: '#CD4419', green: '#22c55e', purple: '#a78bfa' }
const TOKEN = 'iq_portal_token'
const money = n => `$${(Number(n) || 0).toFixed(2).replace(/\.00$/, '')}`
const getTok = () => { try { return localStorage.getItem(TOKEN) || '' } catch { return '' } }
const setTok = t => { try { t ? localStorage.setItem(TOKEN, t) : localStorage.removeItem(TOKEN) } catch { /* private mode */ } }
async function api(path, method = 'GET', body) {
  const r = await fetch(`${API_BASE}/api/scrub-portal${path}`, { method, headers: { 'Content-Type': 'application/json', 'X-IQ-Token': getTok() }, body: body ? JSON.stringify(body) : undefined })
  const d = await r.json().catch(() => ({}))
  if (!r.ok) { const e = new Error(d.error || `Something went wrong (${r.status})`); e.status = r.status; throw e }
  return d
}
const qs = () => new URLSearchParams(window.location.search)

const inp = { width: '100%', backgroundColor: C.card2, border: `1px solid ${C.line}`, color: C.text, borderRadius: 10, padding: '10px 12px', fontSize: 14 }
const btn = (bg = C.orange) => ({ backgroundColor: bg, color: 'white', borderRadius: 12, padding: '10px 16px', fontWeight: 800, fontSize: 14, border: 'none', cursor: 'pointer' })
const ghost = { backgroundColor: 'transparent', color: C.text, border: `1px solid ${C.line}`, borderRadius: 12, padding: '8px 14px', fontWeight: 700, fontSize: 13, cursor: 'pointer' }
const card = { backgroundColor: C.card, border: `1px solid ${C.line}`, borderRadius: 16, padding: 18 }

function Brand() {
  return <div style={{ fontWeight: 900, fontSize: 22, letterSpacing: -0.5 }}>ADAS <span style={{ color: C.orange }}>IQ</span></div>
}
function Shell({ children, right }) {
  return (
    <div style={{ minHeight: '100vh', backgroundColor: C.bg, color: C.text, fontFamily: "'Inter', -apple-system, Helvetica, Arial, sans-serif" }}>
      <div style={{ borderBottom: `1px solid ${C.line}`, padding: '14px 16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}><Brand />{right}</div>
      <div style={{ maxWidth: 880, margin: '0 auto', padding: 16, display: 'grid', gap: 14 }}>{children}</div>
    </div>
  )
}
const Err = ({ m }) => m ? <div style={{ backgroundColor: '#3b0d0d', color: '#fca5a5', borderRadius: 10, padding: '8px 12px', fontSize: 13 }}>{m}</div> : null

function Terms({ terms, accepted, onAccept }) {
  return (
    <div style={{ ...card, backgroundColor: C.card2 }}>
      <div style={{ fontWeight: 800, marginBottom: 6 }}>Service terms {terms?.draft ? <span style={{ color: '#fbbf24', fontSize: 12 }}>· DRAFT</span> : null}</div>
      <div style={{ maxHeight: 220, overflowY: 'auto', fontSize: 13, color: '#ccc', display: 'grid', gap: 8, paddingRight: 6 }}>
        {(terms?.sections || []).map(([h, t]) => <div key={h}><b style={{ color: C.text }}>{h}.</b> {t}</div>)}
      </div>
      <label style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 10, fontSize: 14 }}>
        <input type="checkbox" checked={accepted} onChange={e => onAccept(e.target.checked)} /> I’ve read these terms and accept them for my company
      </label>
    </div>
  )
}

function SignIn({ onIn, terms }) {
  const invite = qs().get('invite')
  const [mode, setMode] = useState(invite ? 'invite' : 'login')
  const [f, setF] = useState({ email: '', password: '', name: '', company: '', phone: '', type: 'cal_shop', body_shops: '' })
  const [ok, setOk] = useState(false), [busy, setBusy] = useState(false), [err, setErr] = useState('')
  const set = (k, v) => setF(x => ({ ...x, [k]: v }))
  const go = async () => {
    setBusy(true); setErr('')
    try {
      const d = mode === 'login' ? await api('/login', 'POST', { email: f.email, password: f.password })
        : mode === 'invite' ? await api('/accept-invite', 'POST', { token: invite, password: f.password, name: f.name, accept_terms: ok, terms_version: terms?.version })
        : await api('/signup', 'POST', { ...f, accept_terms: ok, terms_version: terms?.version })
      setTok(d.token)
      if (invite) window.history.replaceState({}, '', `${window.location.pathname}?iq=portal`)
      onIn()
    } catch (e) { setErr(e.message) } finally { setBusy(false) }
  }
  const field = (k, ph, type = 'text') => <input style={inp} type={type} placeholder={ph} value={f[k]} onChange={e => set(k, e.target.value)} autoComplete={type === 'password' ? (mode === 'login' ? 'current-password' : 'new-password') : 'on'} />
  return (
    <Shell>
      <div style={{ ...card, maxWidth: 520, width: '100%', margin: '24px auto', display: 'grid', gap: 10 }}>
        <div style={{ fontSize: 22, fontWeight: 900 }}>{mode === 'login' ? 'Sign in' : mode === 'invite' ? 'Set up your login' : 'Start scrubbing'}</div>
        <div style={{ color: C.muted, fontSize: 14 }}>Calibration requirements for every CCC estimate your shops send. {money(terms?.price ?? 3)} per VIN, first {terms?.trial ?? 25} free.</div>
        {mode === 'signup' && <>
          {field('company', 'Company name')}
          <div style={{ display: 'flex', gap: 6 }}>
            {[['cal_shop', '🔧 Calibration shop'], ['body_shop', '🚗 Body shop']].map(([k, l]) => <button key={k} onClick={() => set('type', k)} style={f.type === k ? { ...btn(C.text), color: C.bg, padding: '8px 12px', fontSize: 13 } : ghost}>{l}</button>)}
          </div>
          {f.type === 'cal_shop' && <textarea style={{ ...inp, minHeight: 80 }} placeholder={'Body shops you work with, one per line\n(we check each one before it goes live)'} value={f.body_shops} onChange={e => set('body_shops', e.target.value)} />}
          {field('phone', 'Phone')}
        </>}
        {mode !== 'login' && field('name', 'Your name')}
        {mode !== 'invite' && field('email', 'Email', 'email')}
        {field('password', mode === 'login' ? 'Password' : 'Pick a password (8+ characters)', 'password')}
        {mode !== 'login' && <Terms terms={terms} accepted={ok} onAccept={setOk} />}
        <Err m={err} />
        <button style={{ ...btn(), opacity: busy ? 0.6 : 1 }} disabled={busy || (mode !== 'login' && !ok)} onClick={go}>{busy ? 'One sec…' : mode === 'login' ? 'Sign in' : 'Accept terms and continue'}</button>
        {mode === 'login' && terms?.signup_open && <button style={ghost} onClick={() => setMode('signup')}>New here? Create an account</button>}
        {mode === 'signup' && <button style={ghost} onClick={() => setMode('login')}>I already have a login</button>}
        {mode === 'login' && !terms?.signup_open && <div style={{ color: C.muted, fontSize: 12 }}>New accounts are by invite right now.</div>}
      </div>
    </Shell>
  )
}

const FILTER_FIELDS = [['min_year', 'Oldest model year', 'e.g. 2013'], ['max_year', 'Newest model year', 'blank = any'], ['makes_only', 'Only these makes', 'blank = all'], ['makes_skip', 'Skip these makes', 'e.g. Tesla'], ['insurers_only', 'Only these insurers', 'blank = all'], ['insurers_skip', 'Skip these insurers', 'e.g. GEICO']]
function Filters({ title, note, filters, onSave }) {
  const init = () => Object.fromEntries([...FILTER_FIELDS.map(([k]) => [k, Array.isArray(filters?.[k]) ? filters[k].join(', ') : (filters?.[k] || '')]), ['locked_only', !!filters?.locked_only], ['skip_supplements', !!filters?.skip_supplements]])
  const [f, setF] = useState(init), [busy, setBusy] = useState(false), [err, setErr] = useState(''), [open, setOpen] = useState(false)
  useEffect(() => { setF(init()) }, [JSON.stringify(filters)])   // eslint-disable-line react-hooks/exhaustive-deps
  const save = async clear => { setBusy(true); setErr(''); try { await onSave(clear ? {} : f); setOpen(false) } catch (e) { setErr(e.message) } finally { setBusy(false) } }
  if (!open) return <button style={{ ...ghost, borderColor: C.purple, color: C.purple }} onClick={() => setOpen(true)}>🎚 {title}</button>
  return (
    <div style={{ ...card, backgroundColor: C.card2, display: 'grid', gap: 8, width: '100%' }}>
      <div style={{ fontWeight: 800 }}>🎚 {title}</div>
      <div style={{ color: C.muted, fontSize: 12 }}>{note}</div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 8 }}>
        {FILTER_FIELDS.map(([k, l, ph]) => <label key={k} style={{ fontSize: 12, color: C.muted, display: 'grid', gap: 4 }}>{l}<input style={inp} placeholder={ph} value={f[k]} onChange={e => setF(x => ({ ...x, [k]: e.target.value }))} /></label>)}
      </div>
      <label style={{ fontSize: 13, display: 'flex', gap: 8 }}><input type="checkbox" checked={f.locked_only} onChange={e => setF(x => ({ ...x, locked_only: e.target.checked }))} /> Locked estimates only (not every save)</label>
      <label style={{ fontSize: 13, display: 'flex', gap: 8 }}><input type="checkbox" checked={f.skip_supplements} onChange={e => setF(x => ({ ...x, skip_supplements: e.target.checked }))} /> Skip supplements</label>
      <Err m={err} />
      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
        <button style={ghost} disabled={busy} onClick={() => save(true)}>Clear</button>
        <button style={ghost} onClick={() => setOpen(false)}>Cancel</button>
        <button style={btn('#7c3aed')} disabled={busy} onClick={() => save(false)}>{busy ? 'Saving…' : 'Save filters'}</button>
      </div>
    </div>
  )
}
const Reads = ({ r }) => r?.length ? <span style={{ fontSize: 12, color: C.purple, fontWeight: 700 }}>🎚 {r.join(' · ')}</span> : <span style={{ fontSize: 12, color: '#555' }}>🎚 no filters: every estimate is scrubbed</span>


function Invoices({ onPaid }) {
  const [list, setList] = useState(null), [busy, setBusy] = useState(false), [msg, setMsg] = useState('')
  const load = () => api('/invoices').then(d => setList(d.invoices)).catch(() => setList([]))
  useEffect(() => { load() }, [])
  const failed = (list || []).filter(i => i.status === 'failed')
  const payNow = async () => { setBusy(true); setMsg(''); try { const d = await api('/invoices/pay-open', 'POST'); const bad = d.results.filter(r => !r.ok); setMsg(bad.length ? `Still didn’t go through: ${bad.map(b => b.why).join(', ')}` : 'Paid. Thanks! Scrubbing is on.'); load(); onPaid() } catch (e) { setMsg(e.message) } finally { setBusy(false) } }
  const pill = s => ({ paid: [C.green, '✅ Paid'], failed: ['#ef4444', '❌ Card failed'], processing: ['#3b82f6', '⏳ Processing'], draft: ['#6b7280', '🧾 Card charged soon'] })[s] || ['#6b7280', s]
  return (
    <div style={{ ...card, display: 'grid', gap: 6 }}>
      <div style={{ fontWeight: 800 }}>🧾 Invoices</div>
      {failed.length > 0 && <div style={{ backgroundColor: '#3b0d0d', borderRadius: 10, padding: 10, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <div style={{ fontSize: 13, color: '#fca5a5' }}>A card payment didn’t go through. Update the card above, then pay here.</div>
        <button style={btn()} disabled={busy} onClick={payNow}>{busy ? 'Paying…' : `Pay ${money(failed.reduce((t, i) => t + i.total, 0))} now`}</button>
      </div>}
      {msg && <div style={{ fontSize: 13, color: C.muted }}>{msg}</div>}
      {list && !list.length && <div style={{ color: C.muted, fontSize: 13 }}>No invoices yet. You’re billed on the 1st for the month before.</div>}
      {(list || []).map(i => { const [c, l] = pill(i.status); return (
        <details key={i.number} style={{ borderTop: `1px solid ${C.line}`, padding: '8px 0' }}>
          <summary style={{ cursor: 'pointer', display: 'flex', justifyContent: 'space-between', gap: 8, fontSize: 14 }}>
            <span><b>{i.month}</b> <span style={{ color: C.muted, fontSize: 12 }}>· {i.number} · {i.vins} VINs</span> <span style={{ color: c, fontSize: 12, fontWeight: 800 }}>{l}</span></span>
            <b>{money(i.total)}</b>
          </summary>
          <div style={{ display: 'grid', gap: 3, marginTop: 6, fontSize: 12, color: '#ccc' }}>{i.lines.map(x => <div key={x.text} style={{ display: 'flex', justifyContent: 'space-between' }}><span>{x.text}</span><b>{money(x.amount)}</b></div>)}</div>
        </details>
      ) })}
    </div>
  )
}

function Dashboard({ me, reload, onOut }) {
  const [shop, setShop] = useState(''), [msg, setMsg] = useState(''), [err, setErr] = useState(''), [busy, setBusy] = useState('')
  const a = me.account, u = me.usage
  const isAdmin = me.user.role === 'admin'
  const saveFilters = (shop_name, filters) => api('/filters', 'PUT', { shop_name, filters }).then(reload)
  const addShop = async () => { setErr(''); try { await api('/link-request', 'POST', { shop_name: shop }); setShop(''); setMsg('Sent. We check it and switch it on, usually the same day.'); reload() } catch (e) { setErr(e.message) } }
  const card_ = async () => { setBusy('card'); setErr(''); try { const d = await api('/card', 'POST'); window.location.href = d.url } catch (e) { setErr(e.message); setBusy('') } }
  const freeLeft = a.free_left || 0
  return (
    <Shell right={<div style={{ display: 'flex', gap: 10, alignItems: 'center', fontSize: 13, color: C.muted }}>{me.user.name || me.user.email}<button style={ghost} onClick={onOut}>Sign out</button></div>}>
      <div>
        <div style={{ fontSize: 26, fontWeight: 900 }}>{a.name}</div>
        <div style={{ color: C.muted, fontSize: 14 }}>{a.type === 'cal_shop' ? 'Calibration shop' : 'Body shop'} · {a.free ? 'no charge' : `${money(a.price)} per VIN`}{me.contract ? ` · terms accepted ${me.contract.at.slice(0, 10)}` : ''}</div>
      </div>
      {a.status === 'pending_review' && <div style={{ backgroundColor: '#2a2006', color: '#fcd34d', borderRadius: 12, padding: 12, fontSize: 14, fontWeight: 700 }}>🕓 Thanks for signing up. We’re checking your account and body shops, usually the same business day. You can add your card and filters now.</div>}
      {me.signup && !me.signup.complete && a.status !== 'pending_review' && (
        <div style={{ ...card, display: 'grid', gap: 6 }}>
          <div style={{ fontWeight: 800 }}>Getting set up · {me.signup.done} of {me.signup.total}</div>
          {me.signup.steps.map(x => <div key={x.key} style={{ fontSize: 13, color: x.done ? C.green : C.muted }}>{x.done ? '✓' : '○'} {x.label}{!x.done && x.key === 'ccc' ? ': have each body shop turn on the ADAS IQ app in CCC Secure Share' : ''}{!x.done && x.key === 'card' ? ': add it above' : ''}</div>)}
        </div>
      )}
      {a.status === 'past_due' && <div style={{ backgroundColor: '#3b0d0d', color: '#fca5a5', borderRadius: 12, padding: 12, fontSize: 14, fontWeight: 700 }}>⛔ Scrubbing is paused: an invoice is past due. Update your card and pay below. Your estimates are kept.</div>}
      <Err m={err} />
      {msg && <div style={{ backgroundColor: '#052e16', color: '#86efac', borderRadius: 10, padding: '8px 12px', fontSize: 13 }}>{msg}</div>}

      {/* Card on file */}
      {!a.free && (a.card
        ? <div style={{ ...card, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}><div>💳 <b style={{ textTransform: 'capitalize' }}>{a.card.brand}</b> ending {a.card.last4} · exp {a.card.exp}</div>{isAdmin && <button style={ghost} disabled={busy === 'card'} onClick={card_}>Change card</button>}</div>
        : <div style={{ ...card, borderColor: C.orange, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <div><div style={{ fontWeight: 800 }}>💳 Add a card to keep scrubbing past your free ones</div><div style={{ color: C.muted, fontSize: 13 }}>Billed monthly for the month before. The card is stored by Stripe, never by us.</div></div>
            {isAdmin && (me.card_ready ? <button style={btn()} disabled={busy === 'card'} onClick={card_}>{busy === 'card' ? 'Opening…' : 'Add card'}</button> : <span style={{ color: C.muted, fontSize: 13 }}>Card setup opens soon. We’ll email you.</span>)}
          </div>)}

      {/* This month */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 10 }}>
        {[['Scrubs this month', u.scrubs, C.text], ['Billable', u.billable, C.orange], ['🎚 Filtered (free)', u.filtered || 0, C.purple], ['So far', money(u.total), C.green]].map(([l, v, c]) => (
          <div key={l} style={card}><div style={{ fontSize: 12, color: C.muted }}>{l}</div><div style={{ fontSize: 26, fontWeight: 900, color: c }}>{v}</div></div>
        ))}
      </div>
      {!a.free && freeLeft > 0 && <div style={{ color: C.muted, fontSize: 13 }}>🎁 Free scrubs left: {freeLeft}</div>}

      {/* Account-wide filters */}
      <div style={{ ...card, display: 'grid', gap: 8 }}>
        <div style={{ fontWeight: 800 }}>🎚 Scrub filters{a.type === 'cal_shop' ? ' for every body shop' : ''}</div>
        <Reads r={a.reads} />
        <div style={{ color: C.muted, fontSize: 12 }}>A car that doesn’t pass isn’t scrubbed and isn’t charged. A car with no year on the estimate is still scrubbed.</div>
        {isAdmin && <div><Filters title="Edit filters" note={a.type === 'cal_shop' ? 'Applies to every body shop on your account. Each body shop can add its own on top; the stricter one wins.' : 'Applies to every estimate you send.'} filters={a.filters} onSave={f => saveFilters('', f)} /></div>}
      </div>

      {/* Body shops */}
      {a.type === 'cal_shop' && (
        <div style={{ ...card, display: 'grid', gap: 10 }}>
          <div style={{ fontWeight: 800 }}>🚗 Your body shops</div>
          {me.links.length === 0 && <div style={{ color: C.muted, fontSize: 13 }}>None live yet.</div>}
          {me.links.map(l => {
            const s = u.shops?.find(x => x.shop.toLowerCase() === l.shop_name.toLowerCase())
            return (
              <div key={l.shop_name} style={{ borderTop: `1px solid ${C.line}`, paddingTop: 10, display: 'grid', gap: 6 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}><b>{l.shop_name}</b><span style={{ fontSize: 13, color: C.muted }}>{s?.scrubs || 0} scrubs · {money(s?.total)}</span></div>
                <Reads r={l.reads} />
                {isAdmin && <div><Filters title={`Filters for ${l.shop_name}`} note="Just this body shop. Your account filters still apply; the stricter one wins." filters={l.filters} onSave={f => saveFilters(l.shop_name, f)} /></div>}
              </div>
            )
          })}
          {me.requests.length > 0 && <div style={{ fontSize: 13, color: C.muted }}>⏳ Waiting for a check: {me.requests.map(r => `${r.shop_name}${r.status === 'denied' ? ' (not approved)' : ''}`).join(', ')}</div>}
          {isAdmin && <div style={{ display: 'flex', gap: 8 }}><input style={inp} placeholder="Add a body shop (name as on the estimate)" value={shop} onChange={e => setShop(e.target.value)} /><button style={btn()} disabled={!shop.trim()} onClick={addShop}>Add</button></div>}
        </div>
      )}

      <Invoices onPaid={reload} />

      {/* Latest */}
      <div style={{ ...card, display: 'grid', gap: 4 }}>
        <div style={{ fontWeight: 800, marginBottom: 4 }}>🧾 Latest this month</div>
        {!me.recent?.length && <div style={{ color: C.muted, fontSize: 13 }}>Nothing yet. Estimates show up here as your shops send them through CCC.</div>}
        {(me.recent || []).map(r => (
          <div key={r.key} style={{ display: 'flex', justifyContent: 'space-between', gap: 8, borderTop: `1px solid ${C.line}`, padding: '6px 0', fontSize: 13 }}>
            <div style={{ minWidth: 0 }}><div style={{ fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.shop} · RO {r.ro || '?'} · {r.vin}</div><div style={{ color: String(r.reason).startsWith('filtered') ? C.purple : C.muted, fontSize: 12 }}>{r.reason}</div></div>
            <div style={{ fontWeight: 800, color: r.billable ? C.orange : '#555' }}>{r.billable ? money(r.price) : '$0'}</div>
          </div>
        ))}
      </div>
    </Shell>
  )
}

export default function IqPortal() {
  const [terms, setTerms] = useState(null)
  const [me, setMe] = useState(null)
  const [state, setState] = useState('loading')   // loading | out | in
  const load = async () => {
    if (!getTok()) { setState('out'); return }
    try { setMe(await api('/me')); setState('in') } catch (e) { if (e.status === 401) setTok(''); setState('out') }
  }
  useEffect(() => {
    document.title = 'ADAS IQ'
    api('/terms').then(setTerms).catch(() => {})
    const sid = qs().get('sid')
    const done = () => { window.history.replaceState({}, '', `${window.location.pathname}?iq=portal`); load() }
    if (qs().get('card') === 'done' && sid && getTok()) api(`/card/confirm?sid=${encodeURIComponent(sid)}`).catch(() => {}).finally(done)
    else load()
  }, [])
  if (state === 'loading') return <Shell><div style={{ color: C.muted }}>Loading…</div></Shell>
  if (state === 'out' || !me) return <SignIn terms={terms} onIn={load} />
  return <Dashboard me={me} reload={load} onOut={() => { setTok(''); setMe(null); setState('out') }} />
}
