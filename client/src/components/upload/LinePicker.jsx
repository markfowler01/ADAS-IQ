// The four tabs that add a line — Programming (by make, per module),
// Diagnostic, Calibration (price list), Zoho Books (anything). Shared by
// Build job (no report) and the Kinetic review (Mark 2026-09-22: "make the
// w/ Kinetic report like this"). onAdd(item, extra) gets a Books item.
import { useEffect, useMemo, useState } from 'react'
import { API_BASE, apiFetch } from '../../utils/api.js'

const ORANGE = '#CD4419', GREEN = '#15803d'
const fmt = n => `$${Number(n || 0).toFixed(2)}`
const KEY_STUFF = /\bkeys?\b|fob|transponder|remote|blade|prox|smart key|key ?less|immobil/i
const CAL_WORDS = /calibrat|scan|radar|camera|sensor|blind|adas|lidar|aim|static|dynamic|inspection|snapshot|steering|seat weight|park|occupant|\bsas\b|\bsws\b|headlamp|night vision|mirror|windshield|360|surround|lane|cruise|collision|alignment/i
const inp = { border: '1.5px solid #e0dbd6', outline: 'none', backgroundColor: 'white' }

let _catalog = null, _p = null
export function useBooksCatalog() {
  const [items, setItems] = useState(_catalog || [])
  useEffect(() => {
    if (_catalog) { setItems(_catalog); return }
    if (!_p) _p = apiFetch(`${API_BASE}/api/jobs/catalog`).then(r => r.json()).then(d => { _catalog = d.items || []; _p = null; return _catalog }).catch(() => { _p = null; return [] })
    _p.then(setItems)
  }, [])
  return items
}

export default function LinePicker({ onAdd, jobMake = '', existingNames = [], usual = false, initialTab = 'programming', compact = false }) {
  const catalog = useBooksCatalog()
  const [tab, setTab] = useState(initialTab)
  const [q, setQ] = useState('')
  const have = useMemo(() => new Set(existingNames.map(n => String(n || '').toLowerCase())), [existingNames])
  const byName = useMemo(() => new Map(catalog.map(i => [i.name.toLowerCase(), i])), [catalog])
  const modItems = useMemo(() => catalog.filter(i => /^module programming and reflash - /i.test(i.name)).map(i => ({ ...i, make: i.name.replace(/^module programming and reflash - /i, '') })).sort((a, b) => a.make.localeCompare(b.make)), [catalog])
  const fees = useMemo(() => ['Security Access and Authorization Fee', 'Gateway Access Fee'].map(n => byName.get(n.toLowerCase())).filter(Boolean), [byName])
  const mk = String(jobMake || '').toLowerCase()
  const suggested = modItems.find(i => mk && (i.make.toLowerCase() === mk || mk.includes(i.make.toLowerCase())))
  const diag = byName.get('diagnostic 1') || catalog.find(i => /^diagnostic/i.test(i.name))
  const needle = q.trim().toLowerCase()
  const booksHits = needle.length >= 2 ? catalog.filter(i => i.name.toLowerCase().includes(needle)).slice(0, 14) : []
  const calHits = needle.length >= 2 ? catalog.filter(i => !KEY_STUFF.test(i.name) && CAL_WORDS.test(i.name) && i.name.toLowerCase().includes(needle) && !have.has(i.name.toLowerCase())).slice(0, 10) : []
  const add = (it, extra = {}) => { onAdd(it, extra); setQ('') }
  const TABS = [['programming', '🔌 Programming'], ['diagnostic', '🔍 Diagnostic'], ['calibration', '🎯 Calibration'], ['books', '📚 Zoho Books — any item']]
  return (
    <div>
      {usual && (suggested || diag) && (
        <button type="button" onClick={() => { if (suggested) add(suggested); if (diag) add(diag, { description: '' }) }} className="w-full text-left rounded-xl px-3 py-2.5 mb-2" style={{ backgroundColor: '#fff5f0', border: `1.5px solid ${ORANGE}` }}>
          <div className="text-sm font-bold" style={{ color: ORANGE }}>⚡ The usual for a repair shop{suggested ? ` — ${suggested.make} programming` : ''}{diag ? ' + diagnostic' : ''}</div>
          <div className="text-[11px]" style={{ color: '#666' }}>Programming, diagnostic, then a calibration if it needs one.</div>
        </button>
      )}
      <div className="flex gap-1 mb-2 flex-wrap">
        {TABS.map(([k, l]) => <button key={k} type="button" onClick={() => { setTab(k); setQ('') }} className="text-xs font-bold rounded-full px-3 py-1.5" style={tab === k ? { backgroundColor: '#1a1a1a', color: 'white' } : { backgroundColor: 'white', color: '#555', border: '1px solid #e0dbd6' }}>{l}</button>)}
      </div>
      <div className="rounded-xl p-3" style={{ backgroundColor: '#faf9f7', border: '1px solid #e8e4e0' }}>
        {tab === 'programming' && (<>
          <div className="text-[11px] mb-1.5" style={{ color: '#666' }}>Priced <b>per module</b> — tap the make once per module flashed.</div>
          {suggested && <button type="button" onClick={() => add(suggested)} className="text-sm font-bold rounded-xl px-3 py-2 mb-2 text-white" style={{ backgroundColor: ORANGE }}>＋ {suggested.make} module · {fmt(suggested.rate)}</button>}
          <div className="flex gap-1.5 flex-wrap mb-2">{modItems.map(i => <button key={i.item_id} type="button" onClick={() => add(i)} className="text-xs font-semibold rounded-full px-2.5 py-1" style={{ backgroundColor: 'white', color: '#1a1a1a', border: '1px solid #e0dbd6' }}>{i.make} <span style={{ color: '#888' }}>{fmt(i.rate)}</span></button>)}</div>
          <div className="flex gap-1.5 flex-wrap">{fees.map(f => <button key={f.item_id} type="button" onClick={() => add(f)} className="text-xs font-semibold rounded-full px-2.5 py-1" style={{ backgroundColor: '#fff7ed', color: '#b45309', border: '1px solid #fdba74' }}>＋ {f.name} {fmt(f.rate)}</button>)}</div>
          {!catalog.length && <div className="text-xs" style={{ color: '#aaa' }}>Loading Books…</div>}
        </>)}
        {tab === 'diagnostic' && (<>
          {diag ? <button type="button" onClick={() => add(diag, { description: '' })} className="text-sm font-bold rounded-xl px-3 py-2 text-white" style={{ backgroundColor: ORANGE }}>＋ {diag.name} · {fmt(diag.rate)}</button> : <div className="text-xs" style={{ color: '#888' }}>No "Diagnostic 1" item in Books.</div>}
          <div className="text-[11px] mt-1.5" style={{ color: '#666' }}>Write what was diagnosed on the line after adding it.</div>
        </>)}
        {tab === 'calibration' && (<>
          <input autoFocus value={q} onChange={e => setQ(e.target.value)} placeholder="Search the price list… blind spot, front radar, windshield" className="w-full text-sm rounded-lg px-3 py-2 mb-2" style={inp} onKeyDown={e => { if (e.key === 'Enter' && calHits[0]) add(calHits[0]) }} />
          {calHits.map(it => <button key={it.item_id} type="button" onClick={() => add(it)} className="w-full text-left flex justify-between px-3 py-2 text-sm rounded-lg" style={{ backgroundColor: 'white', border: '1px solid #eee', marginBottom: 4 }}><span>{it.name}</span><span className="font-bold" style={{ color: GREEN }}>{fmt(it.rate)}</span></button>)}
          {needle.length >= 2 && !calHits.length && <div className="text-xs" style={{ color: '#888' }}>Nothing on the list matches.</div>}
        </>)}
        {tab === 'books' && (<>
          <div className="text-[11px] mb-1.5" style={{ color: '#666' }}>The whole Zoho Books menu — tap to add a line; tap again for another.</div>
          <input autoFocus value={q} onChange={e => setQ(e.target.value)} placeholder="Search every Books item…" className="w-full text-sm rounded-lg px-3 py-2 mb-2" style={inp} onKeyDown={e => { if (e.key === 'Enter' && booksHits[0]) add(booksHits[0]) }} />
          {booksHits.map(it => <button key={it.item_id} type="button" onClick={() => add(it)} className="w-full text-left flex justify-between px-3 py-2 text-sm rounded-lg" style={{ backgroundColor: 'white', border: '1px solid #eee', marginBottom: 4 }}><span>{it.name}{it.type === 'goods' ? <span className="text-xs" style={{ color: '#888' }}> · part</span> : null}</span><span className="font-bold" style={{ color: GREEN }}>{fmt(it.rate)}</span></button>)}
          {needle.length >= 2 && !booksHits.length && <div className="text-xs" style={{ color: '#888' }}>Nothing in Books matches "{q.trim()}".</div>}
          {needle.length < 2 && <div className="text-xs" style={{ color: '#aaa' }}>{catalog.length ? `${catalog.length} items in Books.` : 'Loading Books…'}</div>}
        </>)}
      </div>
    </div>
  )
}
