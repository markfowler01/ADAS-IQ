// 🚐 Van map (Mark 2026-10-03: "the outline of a van and all the items that are
// in the van are clickable"). One map per van, drawn from the shared Ops data:
// the cab holds the tech, the shelf holds the laptops and the tablet, the cargo
// area holds whatever gear that van actually carries (every van is different).
// Red / amber dots = something on that item is expired / due inside 60 days.
// Tap anything → details on the right, with a way into the tab that edits it.
import { useMemo, useState } from 'react'
import { MAINT_TYPES, maintStatus, maintSev, vanOdometer } from './maint.js'

const BRAND = '#CD4419', INK = '#1a1a1a', MUTED = '#8a847e', LINE = '#888780'
const RED = '#c62828', AMBER = '#f9a825', GREEN = '#1a7336'
const days = d => d ? Math.ceil((new Date(d) - new Date()) / 86400000) : null
const addMonths = (d, m) => { if (!d) return ''; const x = new Date(d + 'T12:00:00'); x.setMonth(x.getMonth() + Number(m || 12)); return x.toISOString().slice(0, 10) }
const renewalOf = s => s.purchased ? addMonths(s.purchased, s.term_months || 12) : (s.renewal || '')
const sev = d => { const n = days(d); return n === null ? 0 : n < 0 ? 3 : n <= 60 ? 2 : 1 }   // 0 no date · 1 fine · 2 due · 3 expired
const dotColor = s => (s === 3 ? RED : s === 2 ? AMBER : null)
const EURO = /bmw|ista|mercedes|xentry|vw|odis|audi|volvo|vida|porsche|piwis|jaguar|land rover|jlr|mini/i
const TABLET = /ms9\d\d|mk9\d\d|im6\d\d|maxisys|tablet/i
const GEAR_ORDER = ['Cal Frame', 'Cal Target', 'Cal Mat', 'Cal Stand', 'Full Kit', 'Scanner', 'Specialty', 'Small Tool', 'Other']
const when = d => { const n = days(d); if (n === null) return 'no date'; if (n < 0) return `expired ${Math.abs(n)}d ago`; if (n === 0) return 'today'; return `in ${n}d` }

function kitOf(van, { assets, laptops, oem, techs, locations }) {
  const tech = techs.find(t => t.id === van.tech) || null
  const vanOfTech = tid => locations.find(l => l.type === 'van' && l.tech === tid)?.id
  const mine = laptops.filter(l => (l.location || vanOfTech(l.tech)) === van.id)
  const roleOf = l => l.role || (/euro/i.test(l.name || '') ? 'euro' : 'shop')
  // A subscription belongs to a van (Mark: "the OE subscriptions go with each van"): by its
  // van field first, else by the tech who drives it. Euro-make software sits on the Euro laptop.
  // Shared subscriptions (one per OEM, everyone uses it) show on every van; per-van ones
  // only on theirs; day passes are listed separately and never light a tile.
  const kindOf = s => s.kind || (s.location ? 'van' : 'shared')
  const onVan = s => s.status !== 'inactive' && kindOf(s) !== 'pass' && (kindOf(s) === 'van' ? s.location === van.id : true)
  const subsFor = l => oem.filter(s => s.device ? s.device === l.id : (onVan(s) && (roleOf(l) === 'euro') === EURO.test(s.name || '')))
  const passes = oem.filter(s => s.status !== 'inactive' && kindOf(s) === 'pass')
  const shop = mine.find(l => roleOf(l) === 'shop') || null, euro = mine.find(l => roleOf(l) === 'euro') || null
  const extra = mine.filter(l => l !== shop && l !== euro)
  const here = assets.filter(a => a.location === van.id)
  const tablet = here.find(a => a.cat === 'Tablet') || here.find(a => a.cat === 'Scanner' && TABLET.test(a.name || '')) || null
  const gear = here.filter(a => a !== tablet)
  const groups = GEAR_ORDER.map(cat => ({ cat, items: gear.filter(a => a.cat === cat) })).filter(g => g.items.length)
  const lapSev = l => l ? Math.max(0, ...subsFor(l).map(s => sev(renewalOf(s)))) : 0
  const vanSev = Math.max(sev(van.reg_exp), sev(van.insurance_exp), sev(van.oil_change), maintSev(van))
  const slots = [
    { k: 'lap-shop', kind: 'laptop', label: 'Shop laptop', item: shop, sub: shop ? shop.name : '+ assign', s: lapSev(shop), subs: shop ? subsFor(shop) : [] },
    { k: 'lap-euro', kind: 'laptop', label: 'Euro laptop', item: euro, sub: euro ? euro.name : '+ assign', s: lapSev(euro), subs: euro ? subsFor(euro) : [] },
    ...extra.map((l, i) => ({ k: `lap-x${i}`, kind: 'laptop', label: 'Laptop', item: l, sub: l.name, s: lapSev(l), subs: subsFor(l) })),
  ]
  const tab = { k: 'tablet', kind: 'tablet', label: 'Tablet', item: tablet, sub: tablet ? tablet.name : '+ assign', s: tablet ? sev(tablet.sub_exp) : 0 }
  const gearBoxes = groups.map(g => ({ k: `gear-${g.cat}`, kind: 'gear', label: g.cat, items: g.items, sub: g.items.length === 1 ? (g.items[0].nickname || g.items[0].name) : `${g.items.length} items`, s: Math.max(0, ...g.items.map(a => sev(a.sub_exp))) }))
  const issues = [...slots, tab, ...gearBoxes].filter(b => b.s >= 2).length + (vanSev >= 2 ? 1 : 0)
  return { tech, slots, tab, gearBoxes, vanSev, issues, passes }
}

const W = 360
// Tile colors (the look Mark sent 2026-10-03: dark van, glowing colored tiles).
const TILE = {
  laptop: { fill: '#1e4fb3', edge: '#4f8cf0', text: '#ffffff', sub: '#bcd3ff', icon: '💻' },
  tablet: { fill: '#1e4fb3', edge: '#4f8cf0', text: '#ffffff', sub: '#bcd3ff', icon: '📱' },
  gear:   { fill: '#157347', edge: '#3ec37f', text: '#ffffff', sub: '#bdf0d2', icon: '🧰' },
  tools:  { fill: '#4b5563', edge: '#9aa3b2', text: '#ffffff', sub: '#d6dbe3', icon: '🔧' },
  van:    { fill: '#b45309', edge: '#f59e0b', text: '#ffffff', sub: '#fde6c0', icon: '🚐' },
  none:   { fill: '#1f232b', edge: '#3a404b', text: '#9aa3b2', sub: '#6b7280', icon: '＋' },
}
const GEAR_ICON = { 'Cal Frame': '🎯', 'Cal Target': '🎯', 'Cal Mat': '🧹', 'Cal Stand': '🧹', 'Full Kit': '🧰', 'Scanner': '🔧', 'Specialty': '🧰', 'Small Tool': '🔧', 'Other': '🧰' }
const light = s => (s === 3 ? '#ef4444' : s === 2 ? '#f59e0b' : s === 1 ? '#22c55e' : '#6b7280')

function VanSvg({ van, kit, sel, onPick }) {
  // Mark's van graphic (2026-10-03) is the backdrop: 512 × 768, cargo floor x 112–398,
  // y 222–690, the cab's dash card at y 130–197. Tiles are laid out inside the floor and
  // shrink to fit when a van carries a lot of gear.
  const X0 = 112, X1 = 398, Y0 = 222, Y1 = 690, GAP = 10
  const rows = []
  const push = (list, h) => rows.push({ list, h })
  for (let i = 0; i < kit.slots.length; i += 2) push(kit.slots.slice(i, i + 2), 66)
  push([kit.tab], 56)
  const small = kit.gearBoxes.filter(g => ['Small Tool', 'Scanner', 'Other'].includes(g.label))
  const big = kit.gearBoxes.filter(g => !small.includes(g))
  if (big.length) { push([big[0]], 56); for (let i = 1; i < big.length; i += 2) push(big.slice(i, i + 2), 66) }
  if (small.length) push([{ k: 'gear-small', kind: 'tools', label: small.length === 1 ? small[0].label : 'Small tools and scanner', items: small.flatMap(g => g.items), sub: `${small.reduce((t, g) => t + g.items.length, 0)} items`, s: Math.max(0, ...small.map(g => g.s)) }], 50)
  if (!kit.gearBoxes.length) push([{ k: 'gear-none', kind: 'none', label: 'No gear listed yet', sub: 'add it on Tools & Equipment', s: 0 }], 48)
  push([{ k: 'van', kind: 'van', label: `${van.name} · plate, reg, oil`, sub: '', s: kit.vanSev }], 44)
  const need = rows.reduce((t, r) => t + r.h, 0) + GAP * (rows.length - 1)
  const k = Math.min(1, (Y1 - Y0) / need)
  const boxes = []
  let y = Y0
  for (const r of rows) {
    const h = r.h * k, n = r.list.length, w = r.list[0]?.kind === 'tablet' ? 120 : (X1 - X0 - GAP * (n - 1)) / n
    const x0 = r.list[0]?.kind === 'tablet' ? (X0 + X1) / 2 - 60 : X0
    r.list.forEach((b, i) => boxes.push({ ...b, x: x0 + i * (w + GAP), y, w, h }))
    y += h + GAP * k
  }
  const fs = k < 0.85 ? 0.85 : 1
  return (
    <svg viewBox="0 0 512 768" width="100%" style={{ display: 'block', maxWidth: 470, margin: '0 auto', borderRadius: 14 }} role="img" aria-label={`${van.name} kit map`}>
      <image href={import.meta.env.BASE_URL + 'van-map.png'} x="0" y="0" width="512" height="768" />
      <g onClick={() => onPick('tech')} style={{ cursor: 'pointer' }}>
        <rect x="162" y="132" width="188" height="62" rx="12" fill={sel === 'tech' ? '#3b2a8a' : '#1e3f8f'} stroke={sel === 'tech' ? '#CD4419' : '#4f8cf0'} strokeWidth="2" />
        <circle cx="194" cy="163" r="18" fill="#1d4ed8" stroke="#8fb5ff" strokeWidth="2" />
        <text x="194" y="168" textAnchor="middle" fontSize="13" fontWeight="700" fill="#ffffff">{kit.tech ? kit.tech.name.split(' ').map(p => p[0]).join('').slice(0, 2).toUpperCase() : '+'}</text>
        <text x="224" y="159" fontSize="15" fontWeight="700" fill="#ffffff">{kit.tech ? `${kit.tech.name.split(' ')[0]} tech` : 'No tech'}</text>
        <text x="224" y="177" fontSize="11" fill="#bcd3ff">CAB</text>
        <text x="334" y="169" textAnchor="middle" fontSize="16" fill="#8fb5ff">›</text>
        <circle cx="338" cy="142" r="4" fill={kit.tech ? '#22c55e' : '#6b7280'} />
      </g>
      {boxes.map(b => { const t = TILE[b.kind] || TILE.gear; const icon = b.kind === 'gear' ? (GEAR_ICON[b.label] || t.icon) : t.icon; const on = sel === b.k; const wide = b.w > 170; const cx = b.x + b.w / 2; return (
        <g key={b.k} onClick={() => b.kind !== 'none' && onPick(b.k)} style={{ cursor: b.kind === 'none' ? 'default' : 'pointer' }}>
          <rect x={b.x} y={b.y} width={b.w} height={b.h} rx="12" fill={t.fill} stroke={on ? '#CD4419' : t.edge} strokeWidth={on ? 3 : 1.5} />
          <text x={b.x + (wide ? 22 : 14)} y={b.y + b.h / 2 + (wide ? 8 : 7)} fontSize={(wide ? 22 : 17) * fs}>{icon}</text>
          <text x={b.x + (wide ? 62 : 42)} y={b.y + (b.sub ? b.h / 2 - 1 : b.h / 2 + 5)} fontSize={(wide ? 15 : 12.5) * fs} fontWeight="700" fill={t.text}>{wide ? b.label : String(b.label).slice(0, 16)}</text>
          {b.sub && <text x={b.x + (wide ? 62 : 42)} y={b.y + b.h / 2 + (wide ? 17 : 14)} fontSize={(wide ? 12 : 10.5) * fs} fill={t.sub}>{String(b.sub).slice(0, wide ? 36 : 17)}</text>}
          {b.kind !== 'none' && <><text x={b.x + b.w - 16} y={b.y + b.h / 2 + 6} textAnchor="middle" fontSize="16" fill={t.sub}>›</text><circle cx={b.x + b.w - 11} cy={b.y + 11} r="4.5" fill={light(b.s)} /></>}
        </g>
      ) })}
    </svg>
  )
}

function Line({ l, v, warn }) { return <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, fontSize: 13, padding: '5px 0', borderBottom: '1px solid #f1ede9' }}><span style={{ color: MUTED }}>{l}</span><span style={{ color: warn ? RED : INK, fontWeight: 600, textAlign: 'right' }}>{v || '—'}</span></div> }

// 🔧 The van itself: dates, odometer, every interval service with when it's due, and a
// one-line form to log a service (writes the same maintenance record the Vans tab keeps).
function VanPanel({ van, onGo, setLocations }) {
  const [logging, setLogging] = useState(false)
  const [rec, setRec] = useState({ type: 'Oil Change', date: new Date().toISOString().slice(0, 10), mileage: vanOdometer(van) || '', cost: '', vendor: '' })
  const ms = maintStatus(van)
  const recent = (van.maintenance || []).slice().sort((a, b) => String(b.date || '').localeCompare(String(a.date || ''))).slice(0, 5)
  const save = () => {
    if (!rec.date || !rec.type) return
    const r = { id: `m-${Date.now().toString(36)}`, type: rec.type, date: rec.date, mileage: rec.mileage ? Number(rec.mileage) : '', cost: rec.cost ? Number(rec.cost) : 0, vendor: rec.vendor, receipt: '', notes: '' }
    setLocations(p => p.map(l => l.id === van.id ? { ...l, maintenance: [...(l.maintenance || []), r], odometer: Math.max(Number(l.odometer) || 0, Number(rec.mileage) || 0) || l.odometer } : l))
    setLogging(false)
  }
  const inp = { fontSize: 12, padding: '5px 8px', borderRadius: 6, border: '1px solid #e0ddd8', width: '100%' }
  const H = ({ t, s }) => <div style={{ marginBottom: 10 }}><div style={{ fontSize: 16, fontWeight: 700, color: INK }}>{t}</div>{s && <div style={{ fontSize: 12, color: MUTED }}>{s}</div>}</div>
  return (
    <div>
      <H t={van.name} s={[van.year, van.make, van.model].filter(Boolean).join(' ') || 'van'} />
      <Line l="Plate" v={van.plate} /><Line l="VIN" v={van.vin} />
      <Line l="Registration" v={van.reg_exp ? `${van.reg_exp} · ${when(van.reg_exp)}` : ''} warn={sev(van.reg_exp) >= 2} />
      <Line l="Insurance" v={[van.insurance, van.insurance_exp ? `${van.insurance_exp} · ${when(van.insurance_exp)}` : ''].filter(Boolean).join(' · ')} warn={sev(van.insurance_exp) >= 2} />
      <Line l="Odometer" v={vanOdometer(van) ? `${vanOdometer(van).toLocaleString()} mi` : ''} />
      <div style={{ fontSize: 11, fontWeight: 700, color: MUTED, textTransform: 'uppercase', letterSpacing: '0.06em', margin: '12px 0 4px' }}>Service schedule</div>
      {ms.map(m => <Line key={m.type} l={m.type} v={m.last ? `${m.text} · last ${m.last.date}` : 'no record yet'} warn={m.sev >= 2} />)}
      {recent.length > 0 && <><div style={{ fontSize: 11, fontWeight: 700, color: MUTED, textTransform: 'uppercase', letterSpacing: '0.06em', margin: '12px 0 4px' }}>Recent</div>
        {recent.map(r => <Line key={r.id} l={`${r.date} · ${r.type}`} v={`${r.mileage ? Number(r.mileage).toLocaleString() + ' mi' : ''}${r.cost ? ` · $${Number(r.cost).toLocaleString()}` : ''}${r.vendor ? ` · ${r.vendor}` : ''}`} />)}</>}
      {setLocations && !logging && <button onClick={() => setLogging(true)} style={{ marginTop: 12, marginRight: 8, fontSize: 12, fontWeight: 700, color: 'white', background: BRAND, border: 0, borderRadius: 7, padding: '7px 12px', cursor: 'pointer' }}>🔧 Log a service</button>}
      {logging && (
        <div style={{ marginTop: 12, background: '#f9f8f7', borderRadius: 10, padding: 10, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
          <select value={rec.type} onChange={e => setRec(r => ({ ...r, type: e.target.value }))} style={inp}>{MAINT_TYPES.map(t => <option key={t}>{t}</option>)}</select>
          <input type="date" value={rec.date} onChange={e => setRec(r => ({ ...r, date: e.target.value }))} style={inp} />
          <input type="number" placeholder="Odometer (mi)" value={rec.mileage} onChange={e => setRec(r => ({ ...r, mileage: e.target.value }))} style={inp} />
          <input type="number" placeholder="Cost ($)" value={rec.cost} onChange={e => setRec(r => ({ ...r, cost: e.target.value }))} style={inp} />
          <input placeholder="Shop / vendor" value={rec.vendor} onChange={e => setRec(r => ({ ...r, vendor: e.target.value }))} style={{ ...inp, gridColumn: 'span 2' }} />
          <div style={{ gridColumn: 'span 2', display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <button onClick={() => setLogging(false)} style={{ fontSize: 12, fontWeight: 700, padding: '6px 10px', borderRadius: 7, border: '1px solid #e0ddd8', background: 'white', cursor: 'pointer' }}>Cancel</button>
            <button onClick={save} style={{ fontSize: 12, fontWeight: 700, padding: '6px 10px', borderRadius: 7, border: 0, background: BRAND, color: 'white', cursor: 'pointer' }}>Save service</button>
          </div>
        </div>
      )}
      <button onClick={() => onGo('vans')} style={{ marginTop: 12, fontSize: 12, fontWeight: 700, color: BRAND, background: 'white', border: `1px solid ${BRAND}`, borderRadius: 7, padding: '7px 12px', cursor: 'pointer' }}>Full history on Vans →</button>
    </div>
  )
}

function Panel({ van, kit, sel, onGo, setLocations }) {
  if (!sel) return <div style={{ fontSize: 13, color: MUTED }}>Tap anything in the van.</div>
  const smallKinds = ['Small Tool', 'Scanner', 'Other']
  const smallItems = kit.gearBoxes.filter(g => smallKinds.includes(g.label)).flatMap(g => g.items)
  const b = sel === 'gear-small' ? { k: 'gear-small', kind: 'tools', label: 'Small tools and scanner', items: smallItems } : [...kit.slots, kit.tab, ...kit.gearBoxes].find(x => x.k === sel)
  const H = ({ t, s }) => <div style={{ marginBottom: 10 }}><div style={{ fontSize: 16, fontWeight: 700, color: INK }}>{t}</div>{s && <div style={{ fontSize: 12, color: MUTED }}>{s}</div>}</div>
  const Go = ({ tab, label }) => <button onClick={() => onGo(tab)} style={{ marginTop: 12, fontSize: 12, fontWeight: 700, color: 'white', background: BRAND, border: 0, borderRadius: 7, padding: '7px 12px', cursor: 'pointer' }}>{label} →</button>
  if (sel === 'tech') return <div><H t={kit.tech ? kit.tech.name : 'No tech assigned'} s={`${van.name} · driver`} /><Line l="Van" v={van.name} /><Go tab="vans" label="Open Vans & Locations" /></div>
  if (sel === 'van') return <VanPanel van={van} onGo={onGo} setLocations={setLocations} />
  if (!b) return null
  if (b.kind === 'laptop') return (
    <div>
      <H t={b.item ? b.item.name : `${b.label} — empty slot`} s={b.item ? `${b.label} · ${b.item.build || ''}` : 'assign a laptop to this van on the Laptops tab'} />
      {b.item && <><Line l="Build" v={b.item.build} />{b.item.teamviewer && <Line l="Remote" v={b.item.teamviewer} />}
        <div style={{ fontSize: 11, fontWeight: 700, color: MUTED, textTransform: 'uppercase', letterSpacing: '0.06em', margin: '12px 0 4px' }}>Subscriptions on it</div>
        {b.subs.length ? b.subs.map(s => { const r = renewalOf(s); return <Line key={s.id} l={s.name} v={r ? `${r} · ${when(r)}` : 'no date yet'} warn={sev(r) >= 2} /> }) : <div style={{ fontSize: 12, color: MUTED }}>None linked yet — set the tech on each subscription on the OEM Software tab.</div>}</>}
      <Go tab={b.item ? 'oem' : 'laptops'} label={b.item ? 'Open OEM Software' : 'Open Laptops'} />
    </div>)
  if (b.kind === 'tablet') return <div><H t={b.item ? b.item.name : 'Tablet — empty slot'} s={b.item ? `${b.item.cat}${b.item.nickname ? ` · "${b.item.nickname}"` : ''}` : 'add the Autel tablet to this van on Tools & Equipment'} />{b.item && <><Line l="Serial" v={b.item.sn} /><Line l="Subscription" v={b.item.sub_exp ? `${b.item.sub_exp} · ${when(b.item.sub_exp)}` : 'no date yet'} warn={sev(b.item.sub_exp) >= 2} />{b.item.notes && <Line l="Notes" v={b.item.notes} />}</>}<Go tab="assets" label="Open Tools & Equipment" /></div>
  if (b.kind === 'gear' || b.kind === 'tools') return <div><H t={b.label} s={`${b.items.length} on ${van.name}`} />{b.items.map(a => <Line key={a.id} l={a.nickname ? `${a.name} "${a.nickname}"` : a.name} v={a.sub_exp ? `sub ${when(a.sub_exp)}` : (a.sn || '')} warn={sev(a.sub_exp) >= 2} />)}<Go tab="assets" label="Open Tools & Equipment" /></div>
  return null
}

const uid = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`
// The standard kit every van starts with (Mark 2026-10-03: "add new vans with the same
// set ups"). Serials and dates get filled in as the gear is bought.
const STANDARD_KIT = [
  { name: 'Autel MS909 Tablet', cat: 'Tablet' },
  { name: 'Autel MA600 ADAS Frame', cat: 'Cal Frame' },
  { name: 'Calibration targets', cat: 'Cal Target' },
  { name: 'Calibration mats', cat: 'Cal Mat' },
  { name: 'Target stands', cat: 'Cal Stand' },
]

function NewVan({ techs, count, onCreate, onClose }) {
  const [name, setName] = useState(`Van ${count + 1}`)
  const [tech, setTech] = useState('')
  const [kit, setKit] = useState(true)
  const inp = { width: '100%', padding: '7px 10px', borderRadius: 7, border: '1px solid #e0ddd8', fontSize: 13, background: 'white' }
  return (
    <div style={{ background: 'white', border: '1px solid #ebe7e2', borderRadius: 12, padding: 14, marginBottom: 12, maxWidth: 520 }}>
      <div style={{ fontSize: 14, fontWeight: 700, color: INK, marginBottom: 8 }}>🚐 New van</div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
        <div><div style={{ fontSize: 11, color: MUTED, marginBottom: 3 }}>Name</div><input value={name} onChange={e => setName(e.target.value)} style={inp} /></div>
        <div><div style={{ fontSize: 11, color: MUTED, marginBottom: 3 }}>Tech</div><select value={tech} onChange={e => setTech(e.target.value)} style={inp}><option value="">Unassigned</option>{techs.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}</select></div>
      </div>
      <label style={{ display: 'flex', gap: 8, alignItems: 'flex-start', fontSize: 12, color: '#444', marginTop: 10 }}>
        <input type="checkbox" checked={kit} onChange={e => setKit(e.target.checked)} style={{ marginTop: 2 }} />
        <span>Set it up with the standard kit: Shop laptop, Euro laptop, Autel tablet, MA600 frame, targets, mats and stands. Serials, dates and subscriptions get filled in as you go.</span>
      </label>
      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 12 }}>
        <button onClick={onClose} style={{ fontSize: 12, fontWeight: 700, padding: '7px 12px', borderRadius: 7, border: '1px solid #e0ddd8', background: 'white', cursor: 'pointer' }}>Cancel</button>
        <button onClick={() => name.trim() && onCreate({ name: name.trim(), tech, kit })} style={{ fontSize: 12, fontWeight: 700, padding: '7px 12px', borderRadius: 7, border: 0, background: BRAND, color: 'white', cursor: 'pointer' }}>Create van</button>
      </div>
    </div>
  )
}

// The van's subscriptions, under the map (Mark 2026-10-03: "van at the top and the
// subscriptions at the bottom"). One row each, grouped by the laptop they run on.
function VanSubs({ van, kit, onGo }) {
  const groups = kit.slots.filter(sl => sl.item || sl.subs.length).map(sl => ({ title: `${sl.label}${sl.item ? ` · ${sl.item.name}` : ''}`, subs: sl.subs }))
  const total = groups.reduce((t, g) => t + g.subs.length, 0)
  const cost = groups.reduce((t, g) => t + g.subs.reduce((x, s) => x + (Number(s.cost) || 0), 0), 0)
  const sevColor = n => (n === 3 ? RED : n === 2 ? '#b45309' : n === 1 ? GREEN : MUTED)
  return (
    <div style={{ background: 'white', border: '1px solid #ebe7e2', borderRadius: 12, padding: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', flexWrap: 'wrap', gap: 6, marginBottom: 8 }}>
        <div style={{ fontSize: 15, fontWeight: 700, color: INK }}>Subscriptions on {van.name}</div>
        <div style={{ fontSize: 12, color: MUTED }}>{total} subscription{total === 1 ? '' : 's'}{cost ? ` · $${cost.toLocaleString()} per term` : ''}</div>
      </div>
      {!total && <div style={{ fontSize: 13, color: MUTED }}>None tied to this van yet. On the Subscriptions tab, set "Van it runs on" for each one.</div>}
      {kit.passes.length > 0 && <div style={{ fontSize: 12, color: MUTED, marginBottom: 8 }}>🎟 Bought as a day pass when a job needs it: {kit.passes.map(p => p.name).join(', ')}</div>}
      {groups.map(g => g.subs.length > 0 && (
        <div key={g.title} style={{ marginBottom: 10 }}>
          <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: MUTED, margin: '6px 0 4px' }}>💻 {g.title}</div>
          {g.subs.sort((a, b) => (days(renewalOf(a)) ?? 9999) - (days(renewalOf(b)) ?? 9999)).map(sub => { const r = renewalOf(sub), n = sev(r); return (
            <div key={sub.id} onClick={() => onGo('oem')} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '7px 10px', borderRadius: 8, border: '1px solid #f1ede9', borderLeft: `4px solid ${sevColor(n)}`, marginBottom: 5, cursor: 'pointer' }}>
              <span style={{ fontSize: 13, fontWeight: 600, color: INK, flex: 1, minWidth: 0 }}>{sub.name}</span>
              {sub.cost > 0 && <span style={{ fontSize: 12, color: MUTED }}>${Number(sub.cost).toLocaleString()}</span>}
              <span style={{ fontSize: 12, fontWeight: 700, color: sevColor(n), whiteSpace: 'nowrap' }}>{r ? `${when(r)} · ${r}` : 'no date yet'}</span>
              <span style={{ color: BRAND, fontWeight: 700 }}>›</span>
            </div>) })}
        </div>
      ))}
    </div>
  )
}

// The van's own facts at the top (Mark 2026-10-03: "add all of this at the top"):
// plate, VIN, registration, insurance, oil change — editable in place, saved to the van.
function VanHeader({ van, kit, setLocations }) {
  const save = (k, v) => setLocations && setLocations(p => p.map(l => l.id === van.id ? { ...l, [k]: v } : l))
  const F = ({ k, label, type = 'text', ph = '' }) => {
    const v = van[k] || ''
    const n = type === 'date' ? days(v) : null
    const color = type === 'date' && v ? (n < 0 ? RED : n <= 60 ? '#b45309' : GREEN) : INK
    return (
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: 10.5, textTransform: 'uppercase', letterSpacing: '0.06em', color: MUTED, marginBottom: 2 }}>{label}{type === 'date' && v ? <span style={{ color, marginLeft: 6, textTransform: 'none', letterSpacing: 0, fontWeight: 700 }}>{when(v)}</span> : null}</div>
        <input type={type} defaultValue={v} placeholder={ph} onBlur={e => e.target.value !== v && save(k, e.target.value)} onKeyDown={e => e.key === 'Enter' && e.target.blur()}
          style={{ width: '100%', fontSize: 13, fontWeight: 600, color, padding: '5px 8px', borderRadius: 7, border: '1px solid #ebe7e2', background: 'white', fontFamily: k === 'vin' || k === 'plate' ? 'IBM Plex Mono, monospace' : 'inherit' }} />
      </div>
    )
  }
  return (
    <div style={{ background: 'white', border: '1px solid #ebe7e2', borderRadius: 12, padding: '12px 16px', marginBottom: 12 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', flexWrap: 'wrap', gap: 6, marginBottom: 10 }}>
        <div style={{ fontSize: 17, fontWeight: 800, color: INK }}>🚐 {van.name}{kit.tech ? <span style={{ fontWeight: 500, color: '#555' }}> · {kit.tech.name}</span> : null}{[van.year, van.make, van.model].filter(Boolean).length ? <span style={{ fontSize: 12, color: MUTED, marginLeft: 8 }}>{[van.year, van.make, van.model].filter(Boolean).join(' ')}</span> : null}</div>
        <div style={{ fontSize: 12, fontWeight: 700, color: kit.issues ? '#b45309' : GREEN }}>{kit.issues ? `${kit.issues} thing${kit.issues === 1 ? '' : 's'} need attention` : 'All current'}</div>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 10 }}>
        <F k="plate" label="Plate" ph="ABC1234" />
        <F k="vin" label="VIN" ph="17 characters" />
        <F k="reg_exp" label="Registration" type="date" />
        <F k="insurance_exp" label="Insurance exp" type="date" />
        <F k="odometer" label="Odometer (mi)" type="number" ph="current reading" />
      </div>
      {(() => { const ms = maintStatus(van).filter(m => m.last).sort((a, b) => b.sev - a.sev || (a.daysUntil ?? 9999) - (b.daysUntil ?? 9999)); const odo = vanOdometer(van); return (
        <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', marginTop: 10, fontSize: 12 }}>
          <span style={{ color: MUTED }}>🔧 Next service:</span>
          {ms.length ? ms.slice(0, 3).map(m => <span key={m.type} style={{ fontWeight: 700, color: m.sev === 3 ? RED : m.sev === 2 ? '#b45309' : GREEN }}>{m.type} {m.text}</span>) : <span style={{ color: MUTED }}>no service logged yet — tap the van tile to log one</span>}
          {odo ? <span style={{ color: MUTED, marginLeft: 'auto' }}>{odo.toLocaleString()} mi</span> : null}
        </div>) })()}
    </div>
  )
}

export default function VanMapTab({ locations, assets, laptops, oem, techs, onGo, setLocations, setLaptops, setAssets }) {
  const [adding, setAdding] = useState(false)
  function createVan({ name, tech, kit }) {
    const id = `van-${uid()}`, n = locations.filter(l => l.type === 'van').length + 1
    setLocations(p => [...p, { id, name, type: 'van', tech, vin: '', plate: '', gps: '', year: '', make: '', model: '', color: '', insurance: '', reg_exp: '', oil_change: '', notes: '' }])
    if (kit) {
      setLaptops(p => [...p,
        { id: `lap-${uid()}`, name: `TECH-LAPTOP-${n}`, build: 'Build 2', tech, role: 'shop', location: id, passcode: '', login: '', teamviewer: '', fca_sn: '', license: '', notes: 'Shop laptop — Ford, GM, Asian makes', oem_creds: [], sw_versions: [] },
        { id: `lap-${uid()}`, name: `TECH-LAPTOP-EURO-${n}`, build: 'Build 1', tech, role: 'euro', location: id, passcode: '', login: '', teamviewer: '', fca_sn: '', license: '', notes: 'Euro laptop — BMW, Mercedes, VW/Audi, Volvo', oem_creds: [], sw_versions: [] }])
      setAssets(p => [...p, ...STANDARD_KIT.map(k => ({ id: `t-${uid()}`, name: k.name, cat: k.cat, location: id, sn: '', sub_exp: '', nickname: '', notes: `${name} standard kit` }))])
    }
    setAdding(false); setVanId(id); setSel('')
  }
  const vans = locations.filter(l => l.type === 'van')
  const [vanId, setVanId] = useState(vans[0]?.id || '')
  const [sel, setSel] = useState('')
  const van = vans.find(v => v.id === vanId) || vans[0]
  const kits = useMemo(() => Object.fromEntries(vans.map(v => [v.id, kitOf(v, { assets, laptops, oem, techs, locations })])), [vans, assets, laptops, oem, techs, locations])
  const kit = van ? kits[van.id] : null
  return (
    <div>
      {adding && <NewVan techs={techs} count={vans.length} onCreate={createVan} onClose={() => setAdding(false)} />}
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 12, alignItems: 'center' }}>
        {vans.map(v => { const k = kits[v.id]; const on = v.id === van.id; return (
          <button key={v.id} onClick={() => { setVanId(v.id); setSel('') }} style={{ fontSize: 12, fontWeight: 700, padding: '6px 12px', borderRadius: 999, border: `1.5px solid ${on ? BRAND : '#e0ddd8'}`, background: on ? BRAND : 'white', color: on ? 'white' : '#555', cursor: 'pointer' }}>
            🚐 {v.name}{k.tech ? ` · ${k.tech.name.split(' ')[0]}` : ''}{k.issues ? <span style={{ marginLeft: 6, background: on ? 'white' : '#fde8e8', color: RED, borderRadius: 999, padding: '0 6px', fontSize: 11 }}>{k.issues}</span> : null}
          </button>) })}
        {setLocations && <button onClick={() => setAdding(true)} style={{ fontSize: 12, fontWeight: 700, padding: '6px 12px', borderRadius: 999, border: '1.5px dashed #c9c3bc', background: 'white', color: '#555', cursor: 'pointer' }}>+ New van</button>}
      </div>
      {!van && <div style={{ fontSize: 13, color: MUTED }}>No vans yet — tap + New van.</div>}
      {van && <VanHeader key={van.id} van={van} kit={kit} setLocations={setLocations} />}
      {van && <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1.15fr) minmax(300px, 1fr)', gap: 14, alignItems: 'start' }}>
        <div style={{ background: '#f9f8f7', borderRadius: 14, padding: 12 }}>
          <VanSvg van={van} kit={kit} sel={sel} onPick={setSel} />
          <div style={{ fontSize: 11, color: MUTED, marginTop: 6 }}>Green light = current · amber = due within 60 days · red = expired · gray = no date entered yet</div>
        </div>
        <div style={{ position: 'sticky', top: 12, display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div style={{ background: 'white', border: '1px solid #ebe7e2', borderRadius: 12, padding: 16, minHeight: 120 }}>
            {sel && <button onClick={() => setSel('')} style={{ float: 'right', fontSize: 11, color: MUTED, background: 'none', border: 0, cursor: 'pointer' }}>✕ close</button>}
            <Panel van={van} kit={kit} sel={sel} onGo={onGo} setLocations={setLocations} />
          </div>
          <VanSubs van={van} kit={kit} onGo={onGo} />
        </div>
      </div>}
    </div>
  )
}
