// 🚐 Van map (Mark 2026-10-03: "the outline of a van and all the items that are
// in the van are clickable"). One map per van, drawn from the shared Ops data:
// the cab holds the tech, the shelf holds the laptops and the tablet, the cargo
// area holds whatever gear that van actually carries (every van is different).
// Red / amber dots = something on that item is expired / due inside 60 days.
// Tap anything → details on the right, with a way into the tab that edits it.
import { useMemo, useState } from 'react'

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
  const onVan = s => s.status !== 'inactive' && (s.location ? s.location === van.id : s.tech === van.tech)
  const subsFor = l => oem.filter(s => s.device ? s.device === l.id : (onVan(s) && (roleOf(l) === 'euro') === EURO.test(s.name || '')))
  const shop = mine.find(l => roleOf(l) === 'shop') || null, euro = mine.find(l => roleOf(l) === 'euro') || null
  const extra = mine.filter(l => l !== shop && l !== euro)
  const here = assets.filter(a => a.location === van.id)
  const tablet = here.find(a => a.cat === 'Tablet') || here.find(a => a.cat === 'Scanner' && TABLET.test(a.name || '')) || null
  const gear = here.filter(a => a !== tablet)
  const groups = GEAR_ORDER.map(cat => ({ cat, items: gear.filter(a => a.cat === cat) })).filter(g => g.items.length)
  const lapSev = l => l ? Math.max(0, ...subsFor(l).map(s => sev(renewalOf(s)))) : 0
  const vanSev = Math.max(sev(van.reg_exp), sev(van.insurance), sev(van.oil_change))
  const slots = [
    { k: 'lap-shop', kind: 'laptop', label: 'Shop laptop', item: shop, sub: shop ? shop.name : '+ assign', s: lapSev(shop), subs: shop ? subsFor(shop) : [] },
    { k: 'lap-euro', kind: 'laptop', label: 'Euro laptop', item: euro, sub: euro ? euro.name : '+ assign', s: lapSev(euro), subs: euro ? subsFor(euro) : [] },
    ...extra.map((l, i) => ({ k: `lap-x${i}`, kind: 'laptop', label: 'Laptop', item: l, sub: l.name, s: lapSev(l), subs: subsFor(l) })),
  ]
  const tab = { k: 'tablet', kind: 'tablet', label: 'Tablet', item: tablet, sub: tablet ? tablet.name : '+ assign', s: tablet ? sev(tablet.sub_exp) : 0 }
  const gearBoxes = groups.map(g => ({ k: `gear-${g.cat}`, kind: 'gear', label: g.cat, items: g.items, sub: g.items.length === 1 ? (g.items[0].nickname || g.items[0].name) : `${g.items.length} items`, s: Math.max(0, ...g.items.map(a => sev(a.sub_exp))) }))
  const issues = [...slots, tab, ...gearBoxes].filter(b => b.s >= 2).length + (vanSev >= 2 ? 1 : 0)
  return { tech, slots, tab, gearBoxes, vanSev, issues }
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
  const boxes = []
  let y = 150
  const row = (list, h) => { const n = list.length, gap = 10, w = (216 - gap * (n - 1)) / n; list.forEach((b, i) => boxes.push({ ...b, x: 72 + i * (w + gap), y, w, h })); y += h + 12 }
  const lapRows = []; for (let i = 0; i < kit.slots.length; i += 2) lapRows.push(kit.slots.slice(i, i + 2))
  lapRows.forEach(r => row(r, 66))
  boxes.push({ ...kit.tab, x: 126, y, w: 108, h: 56 }); y += 70
  const small = kit.gearBoxes.filter(g => g.label === 'Small Tool' || g.label === 'Scanner' || g.label === 'Other')
  const big = kit.gearBoxes.filter(g => !small.includes(g))
  if (big.length) { row([big[0]], 56); for (let i = 1; i < big.length; i += 2) row(big.slice(i, i + 2), 66) }
  if (small.length) row([{ k: 'gear-small', kind: 'tools', label: small.length === 1 ? small[0].label : 'Small tools and scanner', items: small.flatMap(g => g.items), sub: `${small.reduce((t, g) => t + g.items.length, 0)} items`, s: Math.max(0, ...small.map(g => g.s)) }], 50)
  if (!kit.gearBoxes.length) row([{ k: 'gear-none', kind: 'none', label: 'No gear listed yet', sub: 'add it on Tools & Equipment', s: 0 }], 48)
  row([{ k: 'van', kind: 'van', label: `${van.name} · plate, reg, oil`, sub: '', s: kit.vanSev }], 44)
  const H = y + 40
  const bodyBottom = H - 22
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" style={{ display: 'block', maxWidth: 440, margin: '0 auto' }} role="img" aria-label={`${van.name} kit map`}>
      <rect x="0" y="0" width={W} height={H} rx="18" fill="#0f1115" />
      {/* body */}
      <path d={`M58 44 Q58 12 92 12 H268 Q302 12 302 44 V${bodyBottom - 18} Q302 ${bodyBottom} 284 ${bodyBottom} H76 Q58 ${bodyBottom} 58 ${bodyBottom - 18} Z`} fill="#e9eaee" stroke="#f8f9fb" strokeWidth="2" />
      {/* windshield + cab */}
      <path d="M78 42 Q80 22 100 22 H260 Q280 22 282 42 L276 60 H84 Z" fill="#1b2430" />
      <rect x="66" y="64" width="228" height="62" rx="8" fill="#1f2630" />
      <rect x="92" y="78" width="54" height="40" rx="8" fill="#2a3340" /><rect x="214" y="78" width="54" height="40" rx="8" fill="#2a3340" />
      <circle cx="119" cy="98" r="11" fill="none" stroke="#3b4653" strokeWidth="3" />
      {/* mirrors + wheels */}
      <rect x="40" y="52" width="18" height="12" rx="3" fill="#1f2630" /><rect x="302" y="52" width="18" height="12" rx="3" fill="#1f2630" />
      {[[52, 110], [296, 110], [52, bodyBottom - 90], [296, bodyBottom - 90]].map(([x, yy], i) => <rect key={i} x={x} y={yy} width="12" height="44" rx="5" fill="#111418" />)}
      {/* cargo floor */}
      <rect x="64" y="136" width="232" height={bodyBottom - 148} rx="10" fill="#15181d" />
      {/* tail lights */}
      <rect x="66" y={bodyBottom - 8} width="40" height="5" rx="2" fill="#dc2626" /><rect x="254" y={bodyBottom - 8} width="40" height="5" rx="2" fill="#dc2626" />
      {/* cab: the tech */}
      <g onClick={() => onPick('tech')} style={{ cursor: 'pointer' }}>
        <rect x="118" y="100" width="124" height="34" rx="8" fill={sel === 'tech' ? '#3b2a8a' : '#2b2f6b'} stroke={sel === 'tech' ? '#CD4419' : '#6f6ae0'} strokeWidth="1.5" />
        <circle cx="136" cy="117" r="10" fill="none" stroke="#bfc3ff" strokeWidth="2" />
        <text x="136" y="121" textAnchor="middle" fontSize="9" fontWeight="700" fill="#e3e5ff">{kit.tech ? kit.tech.name.split(' ').map(p => p[0]).join('').slice(0, 2).toUpperCase() : '+'}</text>
        <text x="154" y="114" fontSize="11" fontWeight="700" fill="#ffffff">{kit.tech ? kit.tech.name.split(' ')[0] : 'No tech'}</text>
        <text x="154" y="127" fontSize="9" fill="#bfc3ff">CAB</text>
        <circle cx="232" cy="110" r="4" fill={kit.tech ? '#22c55e' : '#6b7280'} />
      </g>
      {boxes.map(b => { const t = TILE[b.kind] || TILE.gear; const icon = b.kind === 'gear' ? (GEAR_ICON[b.label] || t.icon) : t.icon; const on = sel === b.k; const wide = b.w > 150; return (
        <g key={b.k} onClick={() => b.kind !== 'none' && onPick(b.k)} style={{ cursor: b.kind === 'none' ? 'default' : 'pointer' }}>
          <rect x={b.x} y={b.y} width={b.w} height={b.h} rx="9" fill={t.fill} stroke={on ? '#CD4419' : t.edge} strokeWidth={on ? 2.5 : 1.2} />
          {wide
            ? <><text x={b.x + 18} y={b.y + b.h / 2 + 6} fontSize="18">{icon}</text><text x={b.x + 46} y={b.y + (b.sub ? b.h / 2 - 1 : b.h / 2 + 4)} fontSize="12" fontWeight="700" fill={t.text}>{b.label}</text>{b.sub && <text x={b.x + 46} y={b.y + b.h / 2 + 14} fontSize="10.5" fill={t.sub}>{String(b.sub).slice(0, 34)}</text>}</>
            : <><text x={b.x + b.w / 2} y={b.y + 24} textAnchor="middle" fontSize="18">{icon}</text><text x={b.x + b.w / 2} y={b.y + b.h - (b.sub ? 20 : 10)} textAnchor="middle" fontSize="11.5" fontWeight="700" fill={t.text}>{b.label}</text>{b.sub && <text x={b.x + b.w / 2} y={b.y + b.h - 8} textAnchor="middle" fontSize="9.5" fill={t.sub}>{String(b.sub).slice(0, 22)}</text>}</>}
          {b.kind !== 'none' && <circle cx={b.x + b.w - 9} cy={b.y + 9} r="4" fill={light(b.s)} />}
        </g>
      ) })}
    </svg>
  )
}

function Line({ l, v, warn }) { return <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, fontSize: 13, padding: '5px 0', borderBottom: '1px solid #f1ede9' }}><span style={{ color: MUTED }}>{l}</span><span style={{ color: warn ? RED : INK, fontWeight: 600, textAlign: 'right' }}>{v || '—'}</span></div> }

function Panel({ van, kit, sel, onGo }) {
  if (!sel) return <div style={{ fontSize: 13, color: MUTED }}>Tap anything in the van.</div>
  const smallKinds = ['Small Tool', 'Scanner', 'Other']
  const smallItems = kit.gearBoxes.filter(g => smallKinds.includes(g.label)).flatMap(g => g.items)
  const b = sel === 'gear-small' ? { k: 'gear-small', kind: 'tools', label: 'Small tools and scanner', items: smallItems } : [...kit.slots, kit.tab, ...kit.gearBoxes].find(x => x.k === sel)
  const H = ({ t, s }) => <div style={{ marginBottom: 10 }}><div style={{ fontSize: 16, fontWeight: 700, color: INK }}>{t}</div>{s && <div style={{ fontSize: 12, color: MUTED }}>{s}</div>}</div>
  const Go = ({ tab, label }) => <button onClick={() => onGo(tab)} style={{ marginTop: 12, fontSize: 12, fontWeight: 700, color: 'white', background: BRAND, border: 0, borderRadius: 7, padding: '7px 12px', cursor: 'pointer' }}>{label} →</button>
  if (sel === 'tech') return <div><H t={kit.tech ? kit.tech.name : 'No tech assigned'} s={`${van.name} · driver`} /><Line l="Van" v={van.name} /><Go tab="vans" label="Open Vans & Locations" /></div>
  if (sel === 'van') return <div><H t={van.name} s={[van.year, van.make, van.model].filter(Boolean).join(' ') || 'van'} /><Line l="Plate" v={van.plate} /><Line l="VIN" v={van.vin} /><Line l="Registration" v={van.reg_exp ? `${van.reg_exp} · ${when(van.reg_exp)}` : ''} warn={sev(van.reg_exp) >= 2} /><Line l="Insurance" v={van.insurance ? `${van.insurance} · ${when(van.insurance)}` : ''} warn={sev(van.insurance) >= 2} /><Line l="Oil change" v={van.oil_change ? `${van.oil_change} · ${when(van.oil_change)}` : ''} warn={sev(van.oil_change) >= 2} /><Go tab="vans" label="Open Vans & Locations" /></div>
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
      {van && <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1.25fr) minmax(260px, 1fr)', gap: 14, alignItems: 'start' }}>
        <div style={{ background: '#f9f8f7', borderRadius: 14, padding: 12 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 4, flexWrap: 'wrap', gap: 6 }}>
            <span style={{ fontSize: 15, fontWeight: 700, color: INK }}>{van.name}{kit.tech ? ` · ${kit.tech.name}` : ''}</span>
            <span style={{ fontSize: 12, color: kit.issues ? '#7d5a00' : GREEN, fontWeight: 600 }}>{kit.issues ? `${kit.issues} thing${kit.issues === 1 ? '' : 's'} need attention` : 'All current'}</span>
          </div>
          <VanSvg van={van} kit={kit} sel={sel} onPick={setSel} />
          <div style={{ fontSize: 11, color: MUTED, marginTop: 6 }}>Green light = current · amber = due within 60 days · red = expired · gray = no date entered yet</div>
        </div>
        <div style={{ background: 'white', border: '1px solid #ebe7e2', borderRadius: 12, padding: 16, minHeight: 180, position: 'sticky', top: 12 }}>
          <Panel van={van} kit={kit} sel={sel} onGo={onGo} />
        </div>
      </div>}
    </div>
  )
}
