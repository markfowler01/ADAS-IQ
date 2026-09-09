// 🚐 Sales stop (Mark 2026-09-09) — the tech side. Under a minute:
//   1. Which shop?  nearest first (phone location), or search / new shop
//   2. What happened? three big buttons; "Got a card" opens the camera and
//      the business-card reader fills the person in
//   3. One line (phone dictation works), Save → confetti + scoreboard
// Also exports SalesStopScoreboard for Live Day.
import { useEffect, useRef, useState } from 'react'
import { API_BASE, apiFetch } from '../utils/api.js'

const ORANGE = '#CD4419'
const GREEN = '#15803d'
const STAGE = { target: '🎯 Target', contacted: '📞 Contacted', interested: '🤝 Interested', proposal: '📋 Proposal', active: '✅ Customer', second_active: '✅ Customer', lost: '❌ Lost', denied: '❌ Denied' }

const OUTCOMES = [
  { id: 'talked', emoji: '🤝', label: 'Talked to someone', hint: 'Estimator, manager, owner, anyone' },
  { id: 'cards',  emoji: '📇', label: 'Left cards', hint: 'Nobody free — still counts' },
  { id: 'card',   emoji: '📸', label: 'Got a business card', hint: 'Snap it — I fill in the rest' },
]

function useLocation() {
  const [loc, setLoc] = useState(null)
  const [state, setState] = useState('asking')   // asking | ok | denied | none | slow
  function ask() {
    if (!navigator.geolocation) { setState('none'); return }
    setState('asking')
    const slow = setTimeout(() => setState(st => (st === 'asking' ? 'slow' : st)), 5000)
    navigator.geolocation.getCurrentPosition(
      p => { clearTimeout(slow); setLoc({ lat: p.coords.latitude, lng: p.coords.longitude }); setState('ok') },
      () => { clearTimeout(slow); setState('denied') },
      { enableHighAccuracy: true, timeout: 12000, maximumAge: 60000 },
    )
  }
  useEffect(() => { ask() }, [])
  return { loc, state, ask }
}
const LAST_KEY = 'aa_last_sales_stop_shop'
function readLastShop() { try { return JSON.parse(localStorage.getItem(LAST_KEY) || 'null') } catch { return null } }
function writeLastShop(s) { try { localStorage.setItem(LAST_KEY, JSON.stringify({ shop_name: s.shop_name, id: s.id || '', at: new Date().toISOString() })) } catch {} }

function Confetti() {
  const bits = Array.from({ length: 28 }, (_, i) => i)
  return (
    <div className="pointer-events-none fixed inset-0 z-[60] overflow-hidden">
      {bits.map(i => (
        <span key={i} className="absolute text-2xl" style={{
          left: `${(i * 37) % 100}%`, top: '-5%',
          animation: `aa-fall ${1.4 + (i % 5) * 0.2}s ease-in ${(i % 7) * 0.08}s forwards`,
        }}>{['🎉', '🚐', '💰', '✨', '📇'][i % 5]}</span>
      ))}
      <style>{`@keyframes aa-fall { to { transform: translateY(110vh) rotate(${'360deg'}); opacity: .9 } }`}</style>
    </div>
  )
}

export default function SalesStopSheet({ user, onClose, onLogged }) {
  const { loc, state: locState, ask: askLocation } = useLocation()
  const [step, setStep] = useState(1)
  const [tab, setTab] = useState('near')          // near | mine | all
  const [mine, setMine] = useState([])
  const [lastShop] = useState(() => readLastShop())
  const [personOpen, setPersonOpen] = useState(false)
  const [shops, setShops] = useState([])
  const [loading, setLoading] = useState(false)
  const [query, setQuery] = useState('')
  const [shop, setShop] = useState(null)          // { shop_name, id?, isNew }
  const [outcome, setOutcome] = useState(null)
  const [person, setPerson] = useState({ name: '', title: '', email: '', phone: '' })
  const [scanning, setScanning] = useState(false)
  const [scanMsg, setScanMsg] = useState('')
  const [cardPreview, setCardPreview] = useState(null)
  const [note, setNote] = useState('')
  const [saving, setSaving] = useState(false)
  const [done, setDone] = useState(null)
  const [error, setError] = useState('')
  const camRef = useRef(null)

  // Load the list for the active tab (search overrides the tab)
  useEffect(() => {
    let dead = false
    const t = setTimeout(async () => {
      setLoading(true)
      try {
        const p = new URLSearchParams()
        if (loc) { p.set('lat', loc.lat); p.set('lng', loc.lng) }
        if (query.trim()) p.set('q', query.trim())
        else if (tab === 'all') p.set('all', '1')
        const r = await apiFetch(`${API_BASE}/api/sales-stops/nearby?${p}`)
        const d = await r.json()
        if (!dead && r.ok) setShops(d.shops || [])
      } catch { /* list stays */ } finally { if (!dead) setLoading(false) }
    }, query ? 250 : 0)
    return () => { dead = true; clearTimeout(t) }
  }, [loc, query, locState, tab])

  // "Mine" — shops this tech has stopped at, newest first
  useEffect(() => {
    let dead = false
    const tech = String(user?.name || '').split(' ')[0]
    apiFetch(`${API_BASE}/api/sales-stops/recent?tech=${encodeURIComponent(tech)}`).then(r => r.json()).then(d => {
      if (dead || !d.ok) return
      const seen = new Set(); const out = []
      for (const st of d.stops || []) { if (seen.has(st.shop_key)) continue; seen.add(st.shop_key); out.push({ id: st.shop_id, shop_name: st.shop_name, pipeline_stage: 'active', last_stop: { tech: st.tech, date: st.date }, distance_mi: null }) }
      setMine(out)
    }).catch(() => {})
    return () => { dead = true }
  }, [user?.name])

  function pickOutcome(id) {
    setOutcome(id)
    if (id === 'card') setTimeout(() => camRef.current?.click(), 0)
  }
  async function onCard(e) {
    const file = e.target.files?.[0]; e.target.value = ''
    if (!file) return
    setCardPreview(URL.createObjectURL(file)); setScanning(true); setScanMsg('')
    try {
      const fd = new FormData(); fd.append('image', file)
      const r = await apiFetch(`${API_BASE}/api/extract-business-card`, { method: 'POST', body: fd })
      const d = await r.json()
      if (!r.ok) throw new Error(d.error || 'Scan failed')
      setPerson(p => ({
        name: p.name || [d.first_name, d.last_name].filter(Boolean).join(' '),
        title: p.title || d.title || '',
        email: p.email || String(d.email || '').toLowerCase(),
        phone: p.phone || d.phone || '',
      }))
      if (!shop && d.shop_name) setShop({ shop_name: d.shop_name, isNew: true })
      setScanMsg('✓ Read the card — check it and save')
    } catch (err) { setScanMsg(`Couldn't read it: ${err.message}. Type the name in.`) }
    finally { setScanning(false) }
  }

  async function save() {
    if (!shop || !outcome) return
    setSaving(true); setError('')
    try {
      const r = await apiFetch(`${API_BASE}/api/sales-stops`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ shop_name: shop.shop_name, shop_id: shop.id || '', outcome, note, person, lat: loc?.lat ?? null, lng: loc?.lng ?? null, tech: user?.name || '' }),
      })
      const d = await r.json()
      if (!r.ok) throw new Error(d.error || `HTTP ${r.status}`)
      writeLastShop(d.shop || shop)
      setDone(d); onLogged && onLogged(d)
    } catch (e) { setError(e.message) } finally { setSaving(false) }
  }

  const canSave = !!shop && !!outcome && !saving

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center" style={{ backgroundColor: 'rgba(0,0,0,0.55)' }} onClick={onClose}>
      {done && <Confetti />}
      <div className="bg-white w-full sm:max-w-md rounded-t-2xl sm:rounded-2xl p-4 max-h-[92vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <input ref={camRef} type="file" accept="image/*" capture="environment" hidden onChange={onCard} />
        <div className="flex items-start justify-between mb-2">
          <div>
            <div className="text-[10px] uppercase tracking-wider font-semibold" style={{ color: '#888', fontFamily: 'IBM Plex Mono, monospace' }}>🚐 Sales stop</div>
            <div className="font-bold text-lg" style={{ color: '#1a1a1a' }}>{done ? 'Logged. Nice.' : step === 1 ? 'Which shop?' : shop?.shop_name}</div>
          </div>
          <button onClick={onClose} className="text-2xl px-1 leading-none" style={{ color: '#888' }}>×</button>
        </div>

        {done ? (
          <div>
            <div className="rounded-2xl p-4 text-white mb-3" style={{ backgroundColor: GREEN }}>
              <div className="text-3xl font-extrabold">{done.stats?.week ?? 1}<span className="text-base font-bold opacity-80"> / {done.stats?.goal ?? 5} this week</span></div>
              <div className="text-sm mt-1 opacity-90">
                {done.stats?.streak >= 2 ? `🔥 ${done.stats.streak}-day streak · ` : ''}{done.stats?.total ?? 1} stops all time{done.stats?.hit ? ' · GET SOME!!!' : ''}
              </div>
            </div>
            {done.bonus_pending && (
              <div className="rounded-xl p-3 mb-3 text-sm font-bold" style={{ backgroundColor: '#fff5f0', color: ORANGE, border: `1.5px dashed ${ORANGE}` }}>
                🎯 {done.shop?.shop_name} has never been invoiced. Their first job pays you 1% of their first 30 days.
              </div>
            )}
            {done.new_shop && <div className="text-xs mb-3" style={{ color: '#666' }}>➕ Added {done.shop?.shop_name} to the CRM as Contacted.</div>}
            {(done.leaderboard || []).length > 0 && (
              <div className="rounded-xl mb-3" style={{ border: '1px solid #ebe7e3' }}>
                {done.leaderboard.map((t, i) => (
                  <div key={t.tech} className="flex items-center justify-between px-3 py-2 text-sm" style={{ borderTop: i ? '1px solid #f1ede9' : 'none' }}>
                    <span className="font-bold">{i === 0 ? '🥇' : i === 1 ? '🥈' : '🥉'} {t.tech}</span>
                    <span style={{ color: '#666' }}>{t.week} this week · {t.total} total{t.streak >= 2 ? ` · 🔥${t.streak}` : ''}</span>
                  </div>
                ))}
              </div>
            )}
            <button onClick={onClose} className="w-full rounded-xl py-3 text-sm font-bold text-white" style={{ backgroundColor: ORANGE }}>Done</button>
          </div>
        ) : step === 1 ? (
          <div>
            <div className="sticky top-0 bg-white pb-2 z-10">
              <input value={query} onChange={e => setQuery(e.target.value)} placeholder="Search a shop… typos are fine"
                autoFocus inputMode="search" enterKeyHint="search"
                className="w-full rounded-xl px-3 py-3 text-base" style={{ border: '1.5px solid #e0dbd6', outline: 'none' }} />
              {query.trim().length > 1 && (
                <button onClick={() => { setShop({ shop_name: query.trim(), isNew: true }); setStep(2) }}
                  className="w-full rounded-xl py-3 mt-2 text-sm font-bold" style={{ backgroundColor: '#fff5f0', color: ORANGE, border: `1.5px dashed ${ORANGE}` }}>
                  ➕ Not in the list? Add “{query.trim()}”
                </button>
              )}
              {!query.trim() && (
                <div className="grid grid-cols-3 gap-1 mt-2 rounded-xl p-1" style={{ backgroundColor: '#f5f3f0' }}>
                  {[['near', '📍 Near me'], ['mine', '🚐 Mine'], ['all', 'A–Z']].map(([id, label]) => (
                    <button key={id} onClick={() => setTab(id)} className="rounded-lg py-2 text-sm font-bold"
                      style={tab === id ? { backgroundColor: 'white', color: '#1a1a1a', boxShadow: '0 1px 3px rgba(0,0,0,.12)' } : { color: '#777' }}>{label}</button>
                  ))}
                </div>
              )}
            </div>

            {/* Same shop as last time — one tap */}
            {!query.trim() && lastShop?.shop_name && (
              <button onClick={() => { setShop({ shop_name: lastShop.shop_name, id: lastShop.id || '', isNew: false }); setStep(2) }}
                className="w-full text-left rounded-xl px-3 py-3 mb-2 flex items-center gap-2" style={{ backgroundColor: '#f0fdf4', border: '1.5px solid #86efac' }}>
                <span className="text-xl">↩️</span>
                <span className="flex-1 min-w-0"><span className="block font-bold text-sm truncate" style={{ color: GREEN }}>{lastShop.shop_name}</span><span className="block text-[11px]" style={{ color: '#666' }}>your last stop · tap for a repeat</span></span>
              </button>
            )}

            {/* Location state — never silent */}
            {!query.trim() && tab === 'near' && locState !== 'ok' && (
              <button onClick={askLocation} className="w-full rounded-xl px-3 py-2.5 mb-2 text-sm font-bold text-left flex items-center gap-2"
                style={{ backgroundColor: '#fffbeb', color: '#92400e', border: '1px solid #fde68a' }}>
                <span>📍</span>
                <span className="flex-1">{locState === 'asking' ? 'Finding the van…' : locState === 'slow' ? 'Still finding you… tap to retry, or use Mine / A–Z' : locState === 'denied' ? 'Location is off — tap to allow, or use Mine / A–Z' : 'No location on this device — use Mine / A–Z'}</span>
                {(locState === 'asking' || locState === 'slow') && <span className="animate-pulse">⏳</span>}
              </button>
            )}

            <div className="text-[11px] font-semibold mb-1" style={{ color: '#888' }}>
              {query ? 'Matches' : tab === 'mine' ? 'Shops you\'ve stopped at' : tab === 'all' ? 'Every shop, A to Z' : locState === 'ok' ? '📍 Nearest to the van' : 'Longest since a job'}{loading ? ' · loading' : ''}
            </div>
            <div className="rounded-xl overflow-hidden mb-2" style={{ border: '1px solid #ebe7e3' }}>
              {(!query.trim() && tab === 'mine' ? mine : shops).map((s, i) => (
                <button key={s.id || s.shop_name} onClick={() => { setShop({ ...s, isNew: false }); setStep(2) }}
                  className="w-full text-left px-3 flex items-center gap-2 active:bg-orange-50" style={{ borderTop: i ? '1px solid #f1ede9' : 'none', backgroundColor: 'white', minHeight: '56px', paddingTop: '10px', paddingBottom: '10px' }}>
                  <div className="flex-1 min-w-0">
                    <div className="font-bold text-sm truncate" style={{ color: '#1a1a1a' }}>{s.shop_name}</div>
                    <div className="text-[11px]" style={{ color: '#888' }}>
                      {STAGE[s.pipeline_stage] || s.pipeline_stage}
                      {s.days_since_job != null ? ` · last job ${s.days_since_job === 0 ? 'today' : `${s.days_since_job}d ago`}` : ''}
                      {s.last_stop ? ` · stop ${s.last_stop.date}${s.last_stop.tech ? ` (${s.last_stop.tech})` : ''}` : ' · never stopped'}
                    </div>
                  </div>
                  {s.distance_mi != null && <span className="text-xs font-bold rounded-full px-2 py-0.5" style={{ backgroundColor: '#f5f3f0', color: '#555' }}>{s.distance_mi} mi</span>}
                </button>
              ))}
              {!loading && (!query.trim() && tab === 'mine' ? mine : shops).length === 0 && (
                <div className="px-3 py-4 text-sm text-center" style={{ color: '#888' }}>
                  {query ? 'No match — use the Add button above.' : tab === 'mine' ? 'No stops logged yet. Your first one shows up here.' : tab === 'near' && locState !== 'ok' ? 'Waiting on location — or search by name.' : 'Nothing here yet.'}
                </div>
              )}
            </div>
          </div>
        ) : (
          <div>
            <button onClick={() => setStep(1)} className="text-xs font-semibold mb-2" style={{ color: '#888' }}>‹ change shop</button>
            <div className="grid grid-cols-1 gap-2 mb-3">
              {OUTCOMES.map(o => (
                <button key={o.id} onClick={() => pickOutcome(o.id)}
                  className="w-full rounded-2xl px-4 py-3 text-left flex items-center gap-3"
                  style={outcome === o.id ? { backgroundColor: ORANGE, color: 'white' } : { backgroundColor: 'white', color: '#1a1a1a', border: '1.5px solid #e0dbd6' }}>
                  <span className="text-2xl">{o.emoji}</span>
                  <span><span className="block font-bold">{o.label}</span><span className="block text-xs" style={{ opacity: .8 }}>{o.hint}</span></span>
                </button>
              ))}
            </div>
            {outcome && outcome !== 'card' && !personOpen && !cardPreview && !person.name && (
              <button onClick={() => setPersonOpen(true)} className="w-full rounded-xl py-2.5 mb-3 text-sm font-semibold" style={{ backgroundColor: 'white', color: '#555', border: '1px dashed #d6d0ca' }}>
                + add who you met (optional)
              </button>
            )}
            {(outcome === 'card' || personOpen || cardPreview || person.name) && (
              <div className="rounded-xl p-3 mb-3" style={{ border: '1px solid #ebe7e3' }}>
                <div className="flex items-center justify-between mb-2">
                  <div className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: '#888' }}>Who did you meet?</div>
                  <button onClick={() => camRef.current?.click()} className="text-xs font-bold rounded-full px-2.5 py-1" style={{ backgroundColor: '#fff5f0', color: ORANGE, border: `1px solid ${ORANGE}` }}>📸 {cardPreview ? 'Rescan' : 'Scan card'}</button>
                </div>
                {cardPreview && <img src={cardPreview} alt="" className="w-full max-h-28 object-cover rounded-lg mb-2" />}
                {(scanning || scanMsg) && <div className="text-xs mb-2" style={{ color: scanning ? '#888' : GREEN }}>{scanning ? 'Reading the card…' : scanMsg}</div>}
                <div className="grid grid-cols-2 gap-2">
                  <input value={person.name} onChange={e => setPerson(p => ({ ...p, name: e.target.value }))} placeholder="Name" className="rounded-lg px-2 py-2 text-sm col-span-2" style={{ border: '1px solid #e0dbd6' }} />
                  <input value={person.title} onChange={e => setPerson(p => ({ ...p, title: e.target.value }))} placeholder="Title (estimator…)" className="rounded-lg px-2 py-2 text-sm col-span-2" style={{ border: '1px solid #e0dbd6' }} />
                  <input value={person.phone} onChange={e => setPerson(p => ({ ...p, phone: e.target.value }))} placeholder="Phone" inputMode="tel" className="rounded-lg px-2 py-2 text-sm" style={{ border: '1px solid #e0dbd6' }} />
                  <input value={person.email} onChange={e => setPerson(p => ({ ...p, email: e.target.value }))} placeholder="Email" inputMode="email" className="rounded-lg px-2 py-2 text-sm" style={{ border: '1px solid #e0dbd6' }} />
                </div>
              </div>
            )}
            <textarea value={note} onChange={e => setNote(e.target.value)} rows={2} placeholder="One line — tap the mic on your keyboard and say it"
              className="w-full rounded-xl p-3 text-sm mb-3" style={{ border: '1px solid #e0dbd6', outline: 'none', resize: 'none' }} />
            {error && <div className="text-sm mb-2 px-3 py-2 rounded-lg" style={{ backgroundColor: '#fef2f2', color: '#b91c1c' }}>{error}</div>}
            <div className="sticky bottom-0 bg-white pt-2 -mx-4 px-4 pb-1" style={{ boxShadow: '0 -6px 12px rgba(255,255,255,.9)' }}>
              <button onClick={save} disabled={!canSave} className="w-full rounded-xl py-3.5 text-base font-extrabold text-white" style={{ backgroundColor: GREEN, opacity: canSave ? 1 : .45 }}>
                {saving ? 'Saving…' : !shop ? 'Pick a shop' : !outcome ? 'Pick what happened' : '✅ Log the stop'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

// ── Live Day scoreboard ──────────────────────────────────────────────────
export function SalesStopScoreboard({ user, onOpen, refreshKey }) {
  const [stats, setStats] = useState(null)
  useEffect(() => {
    let dead = false
    apiFetch(`${API_BASE}/api/sales-stops/stats`).then(r => r.json()).then(d => { if (!dead && d.ok) setStats(d) }).catch(() => {})
    return () => { dead = true }
  }, [refreshKey])
  const techs = stats?.techs || []
  return (
    <div className="rounded-2xl bg-white p-4 shadow-sm mb-3" style={{ border: '1px solid #ebebeb', borderTop: `4px solid ${ORANGE}` }}>
      <div className="flex items-center justify-between mb-2">
        <div>
          <div className="text-[10px] uppercase tracking-wider font-semibold" style={{ color: '#888', fontFamily: 'IBM Plex Mono, monospace' }}>🚐 Sales stops · this week</div>
          <div className="text-xs" style={{ color: '#888' }}>Goal {stats?.goal ?? 5} per tech · a stop that lands a new customer pays 1% of their first 30 days</div>
        </div>
        <button onClick={onOpen} className="text-sm font-bold rounded-xl px-3 py-2 text-white" style={{ backgroundColor: ORANGE }}>🚐 Sales stop</button>
      </div>
      {techs.length === 0 ? (
        <div className="text-sm py-2" style={{ color: '#888' }}>No stops yet this week. First one's the hardest.</div>
      ) : techs.map(t => {
        const pct = Math.min(100, Math.round((t.week / Math.max(1, t.goal)) * 100))
        return (
          <div key={t.tech} className="mb-2">
            <div className="flex items-center justify-between text-sm">
              <span className="font-bold" style={{ color: '#1a1a1a' }}>{t.tech}</span>
              <span style={{ color: t.hit ? GREEN : '#555' }}>
                {t.week}/{t.goal}{t.hit ? ' · GET SOME!!!' : ''}{t.streak >= 2 ? ` · 🔥 ${t.streak}` : ''}{t.earned > 0 ? ` · 💰 $${t.earned.toFixed(2)}` : ''}
              </span>
            </div>
            <div className="h-2 rounded-full mt-1" style={{ backgroundColor: '#f1ede9' }}>
              <div className="h-2 rounded-full" style={{ width: `${pct}%`, backgroundColor: t.hit ? GREEN : ORANGE }} />
            </div>
            {(t.pending?.length > 0 || t.active?.length > 0) && (
              <div className="text-[11px] mt-1" style={{ color: '#666' }}>
                {t.active?.map(a => `💰 ${a.shop}: $${Number(a.bonus).toFixed(2)} so far (to ${a.window_end})`).join(' · ')}
                {t.active?.length && t.pending?.length ? ' · ' : ''}
                {t.pending?.length ? `🎯 pending: ${t.pending.slice(0, 3).join(', ')}${t.pending.length > 3 ? ` +${t.pending.length - 3}` : ''}` : ''}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
