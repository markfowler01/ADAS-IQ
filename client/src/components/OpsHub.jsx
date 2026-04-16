import { useState, useEffect, useRef } from 'react'
import Navbar from './Navbar'

const BRAND = '#CD4419'

// ── SEED DATA ─────────────────────────────────────────────────────────────────

const SEED_LOCATIONS = [
  { id: 'van-1', name: 'Van 1', type: 'van', tech: 'mark', vin: '', plate: '', gps: '', year: '', make: '', model: '', color: '', insurance: '', reg_exp: '', oil_change: '', notes: "Mark's primary van" },
  { id: 'van-2', name: 'Van 2', type: 'van', tech: 'jayden', vin: '', plate: '', gps: '', year: '', make: '', model: '', color: '', insurance: '', reg_exp: '', oil_change: '', notes: "Jayden's van" },
]

const SEED_TECHS = [
  { id: 'mark',   name: 'Mark Fowler' },
  { id: 'jayden', name: 'Jayden Goshorn' },
]

const SEED_LAPTOPS = [
  { id: 'lap-1', name: 'OEM Laptop 1', build: 'Build 2', tech: 'mark',   passcode: '', login: '', teamviewer: '', fca_sn: '', license: '', notes: 'Mark — Ford/GM/Honda/Nissan/Toyota/Tesla',
    oem_creds: [
      { oem: 'Ford FDRS', username: '', password: '' },
      { oem: 'GM Techline', username: '', password: '' },
      { oem: 'Toyota GTS+', username: '', password: '' },
      { oem: 'Honda HDS', username: '', password: '' },
      { oem: 'Nissan Consult', username: '', password: '' },
      { oem: 'Tesla Toolbox', username: '', password: '' },
    ],
    sw_versions: [
      { oem: 'FDRS', version: '' },
      { oem: 'Techline', version: '' },
      { oem: 'GTS+', version: '' },
      { oem: 'HDS', version: 'online' },
      { oem: 'Tesla', version: 'current' },
      { oem: 'Nissan', version: '' },
    ],
  },
  { id: 'lap-2', name: 'OEM Laptop 2', build: 'Build 1', tech: 'mark',   passcode: '', login: '', teamviewer: '', fca_sn: '', license: '', notes: 'Mark — BMW/VIDA/FCA',
    oem_creds: [
      { oem: 'BMW ISTA', username: '', password: '' },
      { oem: 'Volvo VIDA', username: '', password: '' },
      { oem: 'FCA wiTECH', username: '', password: '' },
      { oem: 'Mercedes XENTRY', username: '', password: '' },
      { oem: 'VW ODIS', username: '', password: '' },
    ],
    sw_versions: [
      { oem: 'BMW ISTA', version: '' },
      { oem: 'ODIS', version: '' },
      { oem: 'VIDA', version: '' },
      { oem: 'wiTECH', version: '' },
      { oem: 'XENTRY', version: '' },
    ],
  },
  { id: 'lap-3', name: 'OEM Laptop 3', build: 'Build 2', tech: 'jayden', passcode: '', login: '', teamviewer: '', fca_sn: '', license: '', notes: 'Jayden — Ford/GM/Honda/Nissan/Toyota/Tesla',
    oem_creds: [
      { oem: 'Ford FDRS', username: '', password: '' },
      { oem: 'GM Techline', username: '', password: '' },
      { oem: 'Toyota GTS+', username: '', password: '' },
      { oem: 'Honda HDS', username: '', password: '' },
      { oem: 'Nissan Consult', username: '', password: '' },
    ],
    sw_versions: [
      { oem: 'FDRS', version: '' },
      { oem: 'Techline', version: '' },
      { oem: 'GTS+', version: '' },
      { oem: 'HDS', version: 'online' },
      { oem: 'Nissan', version: '' },
    ],
  },
]

const SEED_OEM = [
  { id: 'o1',  name: 'Ford IDS / FDRS',         build: 'Build 2', tech: 'mark',   renewal: '2026-09-01', cost: 1200, username: '', portal: 'https://www.fordtechservice.dealerconnection.com', twofa: '',                                              notes: 'J2534 required' },
  { id: 'o2',  name: 'GM Techline Connect',      build: 'Build 2', tech: 'mark',   renewal: '2026-07-15', cost: 1800, username: '', portal: 'https://www.gmtechinfo.com',                       twofa: '',                                              notes: 'SPS module programming' },
  { id: 'o3',  name: 'Toyota Techstream / GTS+', build: 'Build 2', tech: 'mark',   renewal: '2026-11-01', cost: 660,  username: '', portal: 'https://techinfo.toyota.com',                      twofa: '',                                              notes: 'Includes Lexus' },
  { id: 'o4',  name: 'Honda HDS',                build: 'Build 2', tech: 'jayden', renewal: '2026-08-20', cost: 480,  username: '', portal: 'https://ecomdl.honda.com',                          twofa: '',                                              notes: 'Includes Acura' },
  { id: 'o5',  name: 'Nissan Consult III+',      build: 'Build 2', tech: 'jayden', renewal: '2026-08-01', cost: 480,  username: '', portal: 'https://techinfo.nissan.com',                       twofa: '',                                              notes: 'Includes Infiniti. Serial# needed.' },
  { id: 'o6',  name: 'Tesla Toolbox',            build: 'Build 2', tech: 'mark',   renewal: '2026-10-01', cost: 0,    username: '', portal: 'https://toolbox.tesla.com',                         twofa: '',                                              notes: 'Online / current' },
  { id: 'o7',  name: 'BMW ISTA',                 build: 'Build 1', tech: 'mark',   renewal: '2026-10-15', cost: 1560, username: '', portal: 'https://www.bmwtechinfo.com',                       twofa: '',                                              notes: 'Includes Mini. ENET/ICOM required.' },
  { id: 'o8',  name: 'Volvo VIDA',               build: 'Build 1', tech: 'mark',   renewal: '2026-07-01', cost: 720,  username: '', portal: 'https://vida.volvocars.com',                        twofa: 'https://volvocars.service-now.com/sp?id=index', notes: 'Includes Polestar' },
  { id: 'o9',  name: 'FCA / Stellantis wiTECH',  build: 'Build 1', tech: 'mark',   renewal: '2026-09-01', cost: 960,  username: '', portal: 'https://www.fcawitech.com',                         twofa: '1-844-948-3242',                                notes: '2FA — call 1-844-948-3242' },
  { id: 'o10', name: 'Mercedes XENTRY',          build: 'Build 1', tech: 'mark',   renewal: '2026-12-01', cost: 2400, username: '', portal: 'https://xentry.mercedes-benz.com',                  twofa: 'https://login.mercedes-benz.com/password/mfa-reset', notes: 'System# + HW ID required' },
  { id: 'o11', name: 'VW ODIS / GRP',            build: 'Build 1', tech: 'jayden', renewal: '2026-09-30', cost: 960,  username: '', portal: 'https://erwin.volkswagen.de',                       twofa: 'odiscerts@vw.com',                              notes: '2FA — odiscerts@vw.com' },
  { id: 'o12', name: 'Audi ODIS',                build: 'Build 1', tech: 'jayden', renewal: '2026-09-30', cost: 960,  username: '', portal: 'https://erwin.volkswagen.de',                       twofa: 'odiscerts@vw.com',                              notes: 'Same portal as VW' },
  { id: 'o13', name: 'Subaru SSM4',              build: 'Build 2', tech: 'mark',   renewal: '2026-06-01', cost: 360,  username: '', portal: 'https://www.subarutech.com',                        twofa: '',                                              notes: '' },
  { id: 'o14', name: 'Mazda MDARS',              build: 'Build 2', tech: 'mark',   renewal: '2026-08-01', cost: 480,  username: '', portal: 'https://mazdatechinfo.com',                         twofa: '',                                              notes: 'C3 R2R / C4 R2R compatible' },
  { id: 'o15', name: 'Rivian',                   build: 'Build 1', tech: 'mark',   renewal: '',           cost: 0,    username: '', portal: '',                                                   twofa: '',                                              notes: 'Build pending' },
  { id: 'o16', name: 'Autoauth',                 build: 'Both',    tech: 'mark',   renewal: '2026-12-01', cost: 720,  username: '', portal: 'https://autoauth.com',                              twofa: '',                                              notes: 'Covers multiple OEMs via portal' },
  { id: 'o17', name: 'I-CAR',                    build: 'Both',    tech: 'mark',   renewal: '2026-12-01', cost: 0,    username: '', portal: 'https://www.i-car.com',                             twofa: '',                                              notes: 'Training certifications' },
  { id: 'o18', name: 'Mitsubishi MUT-III',       build: 'Build 2', tech: 'mark',   renewal: '',           cost: 0,    username: '', portal: '',                                                   twofa: '800-846-7575',                                  notes: '2FA support line' },
]

const SEED_ASSETS = [
  // Van 1 — Mark
  { id: 't1',  name: 'Autel MA600 ADAS Frame',              cat: 'Cal Frame',  location: 'van-1', sn: 'MA600',           sub_exp: '',           nickname: '', notes: 'Primary ADAS cal frame' },
  { id: 't2',  name: 'Autel MS909 Scanner',                  cat: 'Scanner',    location: 'van-1', sn: '',                sub_exp: '2026-02-12', nickname: 'Obi-Wan', notes: "Mark's scanner" },
  { id: 't3',  name: 'Autel IM608 Key Programmer',           cat: 'Full Kit',   location: 'van-1', sn: '',                sub_exp: '',           nickname: '', notes: '' },
  { id: 't4',  name: 'Radar Cal Plate — black stationary',   cat: 'Cal Target', location: 'van-1', sn: 'CSC0602/02',      sub_exp: '',           nickname: '', notes: 'ACC/Radar' },
  { id: 't5',  name: 'Radar Cal Plate — white Z',            cat: 'Cal Target', location: 'van-1', sn: 'CSC0802/03',      sub_exp: '',           nickname: '', notes: 'Nissan/Infiniti type II ACC' },
  { id: 't6',  name: 'Reflector Mirror',                     cat: 'Cal Target', location: 'van-1', sn: 'CSC0602/01',      sub_exp: '',           nickname: '', notes: 'VW/Audi/Nissan/Infiniti' },
  { id: 't7',  name: 'Lidar Reflector',                      cat: 'Cal Target', location: 'van-1', sn: 'CSC0802/04',      sub_exp: '',           nickname: '', notes: 'LIDAR ACC' },
  { id: 't8',  name: 'Radar Plate — VW Group/Bentley',       cat: 'Cal Target', location: 'van-1', sn: 'CSC0602/08',      sub_exp: '',           nickname: '', notes: '' },
  { id: 't9',  name: 'Doppler Radar Cal Box',                cat: 'Cal Target', location: 'van-1', sn: 'CSC0605/01',      sub_exp: '',           nickname: '', notes: 'Audi/VW/Mazda' },
  { id: 't10', name: 'NV Calibrator',                        cat: 'Cal Target', location: 'van-1', sn: 'CSC0603/01',      sub_exp: '',           nickname: '', notes: 'Night vision hot plate' },
  { id: 't11', name: 'Domino Pattern Target',                cat: 'Cal Target', location: 'van-1', sn: 'CSC0805/02',      sub_exp: '',           nickname: '', notes: 'Honda Lane Watch RH mirror' },
  { id: 't12', name: 'Triangle Target',                      cat: 'Cal Target', location: 'van-1', sn: 'CSC0800',         sub_exp: '',           nickname: '', notes: '' },
  { id: 't13', name: 'AVM Pattern Set — Nissan/Infiniti X7', cat: 'Cal Mat',    location: 'van-1', sn: 'CSC1004/11',      sub_exp: '',           nickname: '', notes: 'AVM/BUC' },
  { id: 't14', name: 'AVM Bulk Patterns — Large Box',        cat: 'Cal Mat',    location: 'van-1', sn: 'CSC1004/10A-D',   sub_exp: '',           nickname: '', notes: 'Toyota AVM — 10A x6, 10B x2, 10C x4, D1-D7 x2 each' },
  { id: 't15', name: 'AVM Bulk Patterns — Small Box',        cat: 'Cal Mat',    location: 'van-1', sn: 'CSC1004/04',      sub_exp: '',           nickname: '', notes: '04-1 x4, 04-2 x2, 04-3 x2' },
  { id: 't16', name: 'Mercedes AVM Patterns (3pc)',          cat: 'Cal Mat',    location: 'van-1', sn: 'CSC1006/02/01-03', sub_exp: '',           nickname: '', notes: '' },
  { id: 't17', name: 'BUC Target Board Set x2',              cat: 'Cal Stand',  location: 'van-1', sn: 'CSC0804/01',      sub_exp: '',           nickname: '', notes: 'VW/Audi BUC' },
  { id: 't18', name: 'BUC Stand Set x2',                     cat: 'Cal Stand',  location: 'van-1', sn: 'CSC0804/02',      sub_exp: '',           nickname: '', notes: '' },
  { id: 't19', name: 'Calibrator Stand',                     cat: 'Cal Stand',  location: 'van-1', sn: 'CSC0803/01',      sub_exp: '',           nickname: '', notes: 'Lidar' },
  { id: 't20', name: 'Honda Lane Watch Stand',               cat: 'Cal Stand',  location: 'van-1', sn: 'CSC0802',         sub_exp: '',           nickname: '', notes: '' },
  { id: 't21', name: 'J2534 CarDAQ-M Interface',             cat: 'Small Tool', location: 'van-1', sn: '',                sub_exp: '',           nickname: '', notes: 'OEM pass-thru' },
  // Van 2 — Jayden
  { id: 't22', name: 'Autel MA600 ADAS Frame',              cat: 'Cal Frame',  location: 'van-2', sn: 'MA600',           sub_exp: '',           nickname: '', notes: "Jayden's cal frame" },
  { id: 't23', name: 'Autel MS909 Scanner',                  cat: 'Scanner',    location: 'van-2', sn: '',                sub_exp: '2026-05-20', nickname: 'Chewbacca', notes: "Jayden's scanner" },
  { id: 't24', name: 'Radar Cal Plate — black stationary',   cat: 'Cal Target', location: 'van-2', sn: 'CSC0602/02',      sub_exp: '',           nickname: '', notes: 'ACC/Radar' },
  { id: 't25', name: 'Radar Cal Plate — white Z',            cat: 'Cal Target', location: 'van-2', sn: 'CSC0802/03',      sub_exp: '',           nickname: '', notes: 'Nissan/Infiniti type II ACC' },
  { id: 't26', name: 'J2534 Interface',                      cat: 'Small Tool', location: 'van-2', sn: '',                sub_exp: '',           nickname: '', notes: '' },
]

const MAINT_TYPES = ['Oil Change', 'Tires', 'Tire Rotation', 'Brakes', 'Inspection', 'Registration', 'Repair', 'Wrap', 'Tint', 'Electrical', 'Transmission', 'Coolant', 'Battery', 'Other']
const MAINT_INTERVALS = {
  'Oil Change':    { miles: 5000,  months: 6 },
  'Tire Rotation': { miles: 7500,  months: 6 },
  'Tires':         { miles: 50000, months: 48 },
  'Brakes':        { miles: 40000, months: 36 },
  'Inspection':    { miles: null,  months: 12 },
  'Transmission':  { miles: 60000, months: 48 },
  'Coolant':       { miles: 30000, months: 24 },
}

const ASSET_CATS = ['Cal Frame', 'Scanner', 'Full Kit', 'Cal Target', 'Cal Mat', 'Cal Stand', 'Small Tool', 'Tablet', 'Specialty', 'Other']
const LOC_TYPES  = ['van', 'center', 'office', 'storage']
const BUILD_TYPES = ['Build 1', 'Build 2', 'Both', 'Other']

// ── STORAGE ───────────────────────────────────────────────────────────────────

function lsGet(key, fallback) {
  try { const r = localStorage.getItem(key); return r ? JSON.parse(r) : fallback } catch { return fallback }
}
function lsSet(key, val) {
  try { localStorage.setItem(key, JSON.stringify(val)) } catch {}
}

// ── HELPERS ───────────────────────────────────────────────────────────────────

const days = d => d ? Math.ceil((new Date(d) - new Date()) / 86400000) : null

const statusOf = (d, base = 'active') => {
  if (base === 'inactive') return 'inactive'
  const n = days(d)
  if (n === null) return base
  if (n < 0) return 'expired'
  if (n <= 60) return 'expiring'
  return 'active'
}

const STATUS = {
  active:   { bg: '#e6f4ea', fg: '#1a7336', label: 'Active' },
  expiring: { bg: '#fff3cd', fg: '#7d5a00', label: 'Expiring' },
  expired:  { bg: '#fde8e8', fg: '#9b1c1c', label: 'Expired' },
  inactive: { bg: '#f1efea', fg: '#5f5e5a', label: 'Inactive' },
}

function Chip({ status }) {
  const s = STATUS[status] || STATUS.active
  return <span style={{ background: s.bg, color: s.fg, fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 4, letterSpacing: '0.04em', textTransform: 'uppercase' }}>{s.label}</span>
}

const uid = () => 'x' + Math.random().toString(36).slice(2, 9)

// ── PRIMITIVES ────────────────────────────────────────────────────────────────

function Btn({ onClick, primary, small, danger, children }) {
  return (
    <button onClick={onClick} style={{
      background: primary ? BRAND : danger ? '#fde8e8' : 'transparent',
      color: primary ? '#fff' : danger ? '#9b1c1c' : '#333',
      border: primary ? 'none' : danger ? '0.5px solid #fca5a5' : '0.5px solid #ddd',
      borderRadius: 7, padding: small ? '4px 11px' : '8px 16px',
      fontSize: small ? 11 : 13, fontWeight: 500, cursor: 'pointer',
    }}>
      {children}
    </button>
  )
}

function In({ value, onChange, type = 'text', placeholder }) {
  return <input type={type} value={value ?? ''} onChange={e => onChange(e.target.value)} placeholder={placeholder} style={{ width: '100%', padding: '7px 10px', borderRadius: 7, border: '1px solid #e0ddd8', fontSize: 13, background: 'white', color: '#1a1a1a', boxSizing: 'border-box' }} />
}

function Sel({ value, onChange, options }) {
  return (
    <select value={value ?? ''} onChange={e => onChange(e.target.value)} style={{ width: '100%', padding: '7px 10px', borderRadius: 7, border: '1px solid #e0ddd8', fontSize: 13, background: 'white', color: '#1a1a1a' }}>
      {options.map(o => <option key={o.v ?? o} value={o.v ?? o}>{o.l ?? o}</option>)}
    </select>
  )
}

function F({ label, children, span2 }) {
  return (
    <div style={{ gridColumn: span2 ? 'span 2' : 'span 1' }}>
      <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.07em', textTransform: 'uppercase', color: '#888', marginBottom: 4 }}>{label}</div>
      {children}
    </div>
  )
}

function Grid2({ children }) {
  return <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px 14px' }}>{children}</div>
}

function Modal({ title, onClose, children }) {
  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
      <div style={{ background: 'white', borderRadius: 12, width: '100%', maxWidth: 520, maxHeight: '88vh', overflowY: 'auto' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 18px', borderBottom: '1px solid #ebebeb', position: 'sticky', top: 0, background: 'white', zIndex: 1 }}>
          <span style={{ fontWeight: 500, fontSize: 14 }}>{title}</span>
          <button onClick={onClose} style={{ background: 'none', border: 'none', fontSize: 22, cursor: 'pointer', color: '#888', lineHeight: 1 }}>×</button>
        </div>
        <div style={{ padding: '16px 18px' }}>{children}</div>
      </div>
    </div>
  )
}

function StatCard({ label, value, sub }) {
  return (
    <div style={{ background: '#f5f3f0', borderRadius: 8, padding: '10px 14px' }}>
      <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.07em', textTransform: 'uppercase', color: '#888', marginBottom: 3 }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 500, color: '#1a1a1a' }}>{value}</div>
      {sub && <div style={{ fontSize: 11, color: '#888', marginTop: 2 }}>{sub}</div>}
    </div>
  )
}

function Row({ children, gap = 8, style }) {
  return <div style={{ display: 'flex', alignItems: 'center', gap, flexWrap: 'wrap', ...style }}>{children}</div>
}

function FilterPill({ active, onClick, children }) {
  return (
    <button onClick={onClick} style={{ background: active ? BRAND : 'transparent', color: active ? '#fff' : '#666', border: '0.5px solid ' + (active ? BRAND : '#ddd'), borderRadius: 999, padding: '4px 13px', fontSize: 12, cursor: 'pointer' }}>
      {children}
    </button>
  )
}

function Card({ children }) {
  return (
    <div style={{ border: '1px solid #ebebeb', borderRadius: 10, padding: '13px 15px', background: 'white' }}>
      {children}
    </div>
  )
}

function Meta({ label, value, warn }) {
  if (!value && value !== 0) return null
  return (
    <span style={{ fontSize: 12, color: warn ? '#7d5a00' : '#666' }}>
      {label}: <strong style={{ color: warn ? '#7d5a00' : '#1a1a1a', fontWeight: 500 }}>{value}</strong>
    </span>
  )
}

// ── VAN AVATAR ───────────────────────────────────────────────────────────────

const VEHICLE_COLORS = {
  ford: '#1351d8', chevrolet: '#d4a017', chevy: '#d4a017', gmc: '#cc0000',
  toyota: '#eb0a1e', honda: '#cc0000', mercedes: '#333', sprinter: '#333',
  ram: '#000', nissan: '#c3002f', default: BRAND,
}

function VanAvatar({ location, size = 60, onClick }) {
  const photo = location.photo
  if (photo) {
    return (
      <div onClick={onClick} style={{ width: size, height: size, borderRadius: 10, overflow: 'hidden', cursor: onClick ? 'pointer' : undefined, flexShrink: 0, position: 'relative' }}>
        <img src={photo} alt={location.name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
        {onClick && <div style={{ position: 'absolute', bottom: 2, right: 2, background: 'rgba(0,0,0,0.5)', borderRadius: 4, padding: '1px 4px', fontSize: 9, color: 'white' }}>Edit</div>}
      </div>
    )
  }
  const make = (location.make || '').toLowerCase()
  const bg = VEHICLE_COLORS[make] || VEHICLE_COLORS.default
  const initials = location.make && location.model
    ? (location.make[0] + location.model[0]).toUpperCase()
    : location.name?.replace(/[^A-Z0-9]/gi, '').slice(0, 2).toUpperCase() || '?'
  const sub = [location.year, location.make].filter(Boolean).join(' ')
  return (
    <div onClick={onClick} style={{
      width: size, height: size, borderRadius: 10, background: bg,
      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
      flexShrink: 0, cursor: onClick ? 'pointer' : undefined,
    }}>
      <span style={{ color: 'white', fontSize: size * 0.35, fontWeight: 700, lineHeight: 1 }}>{initials}</span>
      {sub && <span style={{ color: 'rgba(255,255,255,0.7)', fontSize: size * 0.14, marginTop: 2, maxWidth: size - 8, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', textAlign: 'center' }}>{sub}</span>}
    </div>
  )
}

function usePhotoUpload(locId, setLocations) {
  const inputRef = useRef(null)
  function trigger() { inputRef.current?.click() }
  function handleFile(e) {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = () => {
      // Resize to max 200x200 to keep localStorage small
      const img = new Image()
      img.onload = () => {
        const max = 200
        let w = img.width, h = img.height
        if (w > max || h > max) {
          const scale = max / Math.max(w, h)
          w = Math.round(w * scale); h = Math.round(h * scale)
        }
        const canvas = document.createElement('canvas')
        canvas.width = w; canvas.height = h
        canvas.getContext('2d').drawImage(img, 0, 0, w, h)
        const dataUrl = canvas.toDataURL('image/jpeg', 0.7)
        setLocations(prev => prev.map(l => l.id === locId ? { ...l, photo: dataUrl } : l))
      }
      img.src = reader.result
    }
    reader.readAsDataURL(file)
    e.target.value = ''
  }
  const input = <input ref={inputRef} type="file" accept="image/*" onChange={handleFile} style={{ display: 'none' }} />
  return { trigger, input }
}

// ── ALERTS ────────────────────────────────────────────────────────────────────

function Alerts({ oem }) {
  const alerts = []
  oem.forEach(s => {
    const n = days(s.renewal)
    if (n === null) return
    if (n < 0)      alerts.push({ name: s.name, msg: 'EXPIRED',          err: true })
    else if (n <= 60) alerts.push({ name: s.name, msg: `Renews in ${n} days`, err: n <= 14 })
  })
  if (!alerts.length) return (
    <div style={{ background: '#e6f4ea', borderRadius: 8, padding: '9px 14px', fontSize: 12, color: '#1a7336', marginBottom: 16 }}>All subscriptions current.</div>
  )
  return (
    <div style={{ marginBottom: 16, display: 'flex', flexDirection: 'column', gap: 5 }}>
      {alerts.map((a, i) => (
        <div key={i} style={{ background: a.err ? '#fde8e8' : '#fff8e1', borderLeft: `3px solid ${a.err ? '#c62828' : '#f9a825'}`, borderRadius: '0 7px 7px 0', padding: '7px 12px', fontSize: 12, color: a.err ? '#b71c1c' : '#5a3e00' }}>
          <strong>{a.name}</strong> — {a.msg}
        </div>
      ))}
    </div>
  )
}

// ── AUDIT MODAL ──────────────────────────────────────────────────────────────

function AuditModal({ location, assets, onClose }) {
  const items = assets.filter(a => a.location === location.id)
  const [checked, setChecked] = useState({})
  const toggle = id => setChecked(p => ({ ...p, [id]: !p[id] }))
  const total = items.length
  const done  = Object.values(checked).filter(Boolean).length

  return (
    <Modal title={`Audit — ${location.name}`} onClose={onClose}>
      <div style={{ marginBottom: 12, fontSize: 12, color: '#666' }}>
        Check off each item as you verify it is present. {done}/{total} confirmed.
      </div>
      <div style={{ background: done === total && total > 0 ? '#e6f4ea' : '#f5f3f0', borderRadius: 8, padding: '6px 12px', marginBottom: 14, fontSize: 12, fontWeight: 600, color: done === total && total > 0 ? '#1a7336' : '#888' }}>
        {done === total && total > 0 ? 'All items accounted for' : `${total - done} item${total - done !== 1 ? 's' : ''} remaining`}
      </div>
      {items.length === 0 && <div style={{ textAlign: 'center', color: '#888', fontSize: 13, padding: '1rem' }}>No assets assigned to this location.</div>}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        {items.map(a => (
          <div key={a.id} onClick={() => toggle(a.id)} style={{
            display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px', borderRadius: 8, cursor: 'pointer',
            background: checked[a.id] ? '#f0fdf4' : 'white', border: '1px solid ' + (checked[a.id] ? '#bbf7d0' : '#ebebeb'),
          }}>
            <div style={{
              width: 20, height: 20, borderRadius: 5, border: '2px solid ' + (checked[a.id] ? '#16a34a' : '#ccc'),
              background: checked[a.id] ? '#16a34a' : 'white', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
            }}>
              {checked[a.id] && <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>}
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 13, fontWeight: 500, color: checked[a.id] ? '#16a34a' : '#1a1a1a', textDecoration: checked[a.id] ? 'line-through' : 'none' }}>{a.name}</div>
              <Row gap={10}>
                {a.sn && <span style={{ fontSize: 11, color: '#888' }}>S/N: {a.sn}</span>}
                <span style={{ fontSize: 10, fontWeight: 600, background: '#f5f3f0', color: '#888', padding: '1px 6px', borderRadius: 3, textTransform: 'uppercase' }}>{a.cat}</span>
                {a.nickname && <span style={{ fontSize: 11, color: '#666', fontStyle: 'italic' }}>"{a.nickname}"</span>}
              </Row>
            </div>
          </div>
        ))}
      </div>
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 16 }}>
        <Btn primary onClick={onClose}>Done</Btn>
      </div>
    </Modal>
  )
}

// ── VAN DETAIL ───────────────────────────────────────────────────────────────

function VanDetail({ location, setLocations, techs, assets, onBack }) {
  const [modal, setModal]   = useState(false)
  const [form, setForm]     = useState({})
  const [editId, setEditId] = useState(null)
  const [auditLoc, setAuditLoc] = useState(null)
  const [editVan, setEditVan]   = useState(false)
  const [vanForm, setVanForm]   = useState({})
  const detailPhotoUpload = usePhotoUpload(location.id, setLocations)

  // Zoho Books expense sync
  const [expAccounts, setExpAccounts] = useState(null)
  const [syncModal, setSyncModal]     = useState(null)
  const [syncAcct, setSyncAcct]       = useState('')
  const [syncing, setSyncing]         = useState(false)

  // Mileage from Zoho Expense
  const [mileageTrips, setMileageTrips] = useState(null)
  const [mileageLoading, setMileageLoading] = useState(false)
  const [mileageError, setMileageError] = useState(null)
  const [showMileage, setShowMileage] = useState(false)

  async function loadMileage() {
    if (mileageTrips) { setShowMileage(v => !v); return }
    setMileageLoading(true); setMileageError(null)
    try {
      const token = sessionStorage.getItem('adasiq_token')
      const res = await fetch('/server/adasiq-api/api/expenses/mileage', { headers: { 'x-auth-token': token } })
      const data = await res.json()
      if (data.ok) { setMileageTrips(data.trips || []); setShowMileage(true) }
      else setMileageError(data.error || 'Failed to load mileage')
    } catch (e) { setMileageError(e.message) }
    setMileageLoading(false)
  }

  async function loadAccounts() {
    if (expAccounts) return expAccounts
    try {
      const token = sessionStorage.getItem('adasiq_token')
      const res = await fetch('/server/adasiq-api/api/expenses/accounts', { headers: { 'x-auth-token': token } })
      const data = await res.json()
      if (data.accounts) { setExpAccounts(data.accounts); return data.accounts }
    } catch (e) { console.error('Failed to load expense accounts', e) }
    return []
  }

  async function openSync(record) {
    const accts = await loadAccounts()
    setSyncAcct(accts[0]?.account_id || '')
    setSyncModal(record)
  }

  async function doSync() {
    if (!syncModal || !syncAcct) return
    setSyncing(true)
    try {
      const token = sessionStorage.getItem('adasiq_token')
      const res = await fetch('/server/adasiq-api/api/expenses', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-auth-token': token },
        body: JSON.stringify({
          account_id: syncAcct,
          date: syncModal.date,
          amount: syncModal.cost,
          description: `${syncModal.type}${syncModal.vendor ? ' — ' + syncModal.vendor : ''}${syncModal.notes ? ' — ' + syncModal.notes : ''}`,
          reference_number: syncModal.receipt || '',
          vehicle_name: location.name,
        }),
      })
      const data = await res.json()
      if (data.ok) {
        // Mark the record as synced
        setLocations(prev => prev.map(l => {
          if (l.id !== location.id) return l
          return { ...l, maintenance: (l.maintenance || []).map(r => r.id === syncModal.id ? { ...r, books_expense_id: data.expense_id } : r) }
        }))
        setSyncModal(null)
      } else {
        alert('Sync failed: ' + (data.error || 'Unknown error'))
      }
    } catch (e) { alert('Sync failed: ' + e.message) }
    setSyncing(false)
  }

  const tech = techs.find(t => t.id === location.tech)
  const locAssets = assets.filter(a => a.location === location.id)
  const maint = (location.maintenance || []).sort((a, b) => (b.date || '').localeCompare(a.date || ''))

  // Cost stats
  const now = new Date()
  const yearStart = `${now.getFullYear()}-01-01`
  const totalAll = maint.reduce((s, r) => s + (Number(r.cost) || 0), 0)
  const totalYTD = maint.filter(r => r.date >= yearStart).reduce((s, r) => s + (Number(r.cost) || 0), 0)

  // Maintenance alerts
  const alerts = []
  for (const [type, interval] of Object.entries(MAINT_INTERVALS)) {
    const last = maint.find(r => r.type === type)
    if (!last) {
      alerts.push({ type, msg: 'No record on file', level: 'warn' })
      continue
    }
    if (interval.months && last.date) {
      const lastDate = new Date(last.date)
      const dueDate = new Date(lastDate)
      dueDate.setMonth(dueDate.getMonth() + interval.months)
      const daysUntil = Math.ceil((dueDate - now) / 86400000)
      if (daysUntil < 0) alerts.push({ type, msg: `Overdue by ${Math.abs(daysUntil)} days (last: ${last.date})`, level: 'err' })
      else if (daysUntil <= 30) alerts.push({ type, msg: `Due in ${daysUntil} days (last: ${last.date})`, level: 'warn' })
    }
    if (interval.miles && last.mileage) {
      const dueMiles = Number(last.mileage) + interval.miles
      // Show the target mileage so user can compare to current odometer
      alerts.push({ type, msg: `Next due at ${dueMiles.toLocaleString()} mi (last: ${Number(last.mileage).toLocaleString()} mi on ${last.date})`, level: 'info' })
    }
  }

  // Maintenance record form
  const f = v => setForm(p => ({ ...p, ...v }))
  function openAdd() { setForm({ id: uid(), date: new Date().toISOString().slice(0, 10), type: 'Oil Change', vendor: '', cost: '', mileage: '', receipt: '', notes: '' }); setEditId(null); setModal(true) }
  function openEdit(r) { setForm({ ...r }); setEditId(r.id); setModal(true) }
  function save() {
    setLocations(prev => prev.map(l => {
      if (l.id !== location.id) return l
      const records = l.maintenance || []
      if (editId) return { ...l, maintenance: records.map(r => r.id === editId ? form : r) }
      return { ...l, maintenance: [...records, form] }
    }))
    setModal(false)
  }
  function delRecord(id) {
    if (!confirm('Delete this record?')) return
    setLocations(prev => prev.map(l => l.id !== location.id ? l : { ...l, maintenance: (l.maintenance || []).filter(r => r.id !== id) }))
  }

  // Van edit
  const vf = v => setVanForm(p => ({ ...p, ...v }))
  function openEditVan() { setVanForm({ ...location }); setEditVan(true) }
  function saveVan() { setLocations(p => p.map(l => l.id === location.id ? vanForm : l)); setEditVan(false) }
  const techOpts = [{ v: '', l: 'Unassigned' }, ...techs.map(t => ({ v: t.id, l: t.name }))]

  return (
    <div>
      {/* Back + header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
        <button onClick={onBack} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '4px 8px', borderRadius: 6, color: BRAND, fontSize: 14, fontWeight: 600 }}>
          ← Back
        </button>
        <VanAvatar location={location} size={48} onClick={detailPhotoUpload.trigger} />
        {detailPhotoUpload.input}
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 18, fontWeight: 600, color: '#1a1a1a' }}>{location.name}</div>
          <div style={{ fontSize: 12, color: '#888' }}>
            {[location.year, location.make, location.model, location.color].filter(Boolean).join(' ') || 'No vehicle info'}
          </div>
        </div>
        <Btn small onClick={() => setAuditLoc(location)}>Audit</Btn>
        <Btn small onClick={openEditVan}>Edit Van</Btn>
      </div>

      {/* Van info grid */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: 8, marginBottom: 16 }}>
        {tech && <div style={{ background: '#f5f3f0', borderRadius: 8, padding: '8px 12px' }}><div style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', color: '#888', marginBottom: 2 }}>Tech</div><div style={{ fontSize: 13, fontWeight: 500 }}>{tech.name}</div></div>}
        {location.vin && <div style={{ background: '#f5f3f0', borderRadius: 8, padding: '8px 12px' }}><div style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', color: '#888', marginBottom: 2 }}>VIN</div><div style={{ fontSize: 12, fontWeight: 500, wordBreak: 'break-all' }}>{location.vin}</div></div>}
        {location.plate && <div style={{ background: '#f5f3f0', borderRadius: 8, padding: '8px 12px' }}><div style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', color: '#888', marginBottom: 2 }}>Plate</div><div style={{ fontSize: 13, fontWeight: 500 }}>{location.plate}</div></div>}
        {location.reg_exp && <div style={{ background: '#f5f3f0', borderRadius: 8, padding: '8px 12px' }}><div style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', color: '#888', marginBottom: 2 }}>Reg Exp</div><div style={{ fontSize: 13, fontWeight: 500, color: days(location.reg_exp) !== null && days(location.reg_exp) <= 60 ? '#7d5a00' : '#1a1a1a' }}>{location.reg_exp}</div></div>}
        {location.gps && <div style={{ background: '#f5f3f0', borderRadius: 8, padding: '8px 12px' }}><div style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', color: '#888', marginBottom: 2 }}>GPS S/N</div><div style={{ fontSize: 13, fontWeight: 500 }}>{location.gps}</div></div>}
        {location.insurance && <div style={{ background: '#f5f3f0', borderRadius: 8, padding: '8px 12px' }}><div style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', color: '#888', marginBottom: 2 }}>Insurance</div><div style={{ fontSize: 13, fontWeight: 500 }}>{location.insurance}</div></div>}
        <div style={{ background: '#f5f3f0', borderRadius: 8, padding: '8px 12px' }}><div style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', color: '#888', marginBottom: 2 }}>Assets</div><div style={{ fontSize: 13, fontWeight: 500 }}>{locAssets.length} items</div></div>
      </div>

      {/* Maintenance alerts */}
      {alerts.length > 0 && (
        <div style={{ marginBottom: 16 }}>
          <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.07em', textTransform: 'uppercase', color: '#888', marginBottom: 8 }}>Maintenance Alerts</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {alerts.filter(a => a.level !== 'info').map((a, i) => (
              <div key={i} style={{
                background: a.level === 'err' ? '#fde8e8' : '#fff8e1',
                borderLeft: `3px solid ${a.level === 'err' ? '#c62828' : '#f9a825'}`,
                borderRadius: '0 7px 7px 0', padding: '7px 12px', fontSize: 12,
                color: a.level === 'err' ? '#b71c1c' : '#5a3e00',
              }}>
                <strong>{a.type}</strong> — {a.msg}
              </div>
            ))}
            {alerts.filter(a => a.level === 'info').map((a, i) => (
              <div key={'i' + i} style={{
                background: '#eef2ff', borderLeft: '3px solid #818cf8',
                borderRadius: '0 7px 7px 0', padding: '7px 12px', fontSize: 12, color: '#3730a3',
              }}>
                <strong>{a.type}</strong> — {a.msg}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Cost summary */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0,1fr))', gap: 8, marginBottom: 16 }}>
        <StatCard label="Total spent" value={'$' + totalAll.toLocaleString()} />
        <StatCard label="YTD spend" value={'$' + totalYTD.toLocaleString()} />
        <StatCard label="Records" value={maint.length} />
      </div>

      {/* Mileage from Zoho Expense */}
      <div style={{ marginBottom: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: showMileage ? 10 : 0 }}>
          <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.07em', textTransform: 'uppercase', color: '#888' }}>Mileage Log</div>
          <Btn small onClick={loadMileage}>
            {mileageLoading ? 'Loading...' : showMileage ? 'Hide Mileage' : 'Load from Zoho Expense'}
          </Btn>
        </div>
        {mileageError && (
          <div style={{ background: '#fde8e8', borderLeft: '3px solid #c62828', borderRadius: '0 7px 7px 0', padding: '7px 12px', fontSize: 12, color: '#b71c1c', marginTop: 8 }}>
            {mileageError}
          </div>
        )}
        {showMileage && mileageTrips && (
          <div>
            {mileageTrips.length > 0 && (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0,1fr))', gap: 8, marginBottom: 10 }}>
                <StatCard label="Total trips" value={mileageTrips.length} />
                <StatCard label="Total miles" value={mileageTrips.reduce((s, t) => s + (Number(t.distance) || 0), 0).toLocaleString()} />
                <StatCard label="Total reimbursement" value={'$' + mileageTrips.reduce((s, t) => s + (Number(t.amount) || 0), 0).toLocaleString()} />
              </div>
            )}
            {mileageTrips.length === 0 && <div style={{ textAlign: 'center', padding: '1rem', color: '#888', fontSize: 13 }}>No mileage trips found in Zoho Expense.</div>}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 5, maxHeight: 300, overflowY: 'auto' }}>
              {mileageTrips.map((t, i) => (
                <div key={t.trip_id || i} style={{ border: '1px solid #ebebeb', borderRadius: 8, padding: '10px 12px', background: 'white' }}>
                  <Row gap={8} style={{ marginBottom: 3 }}>
                    <span style={{ fontWeight: 500, fontSize: 12 }}>{t.destination || t.description || 'Trip'}</span>
                    <span style={{ fontSize: 10, fontWeight: 600, background: '#f5f3f0', color: '#888', padding: '1px 6px', borderRadius: 4, textTransform: 'uppercase' }}>{t.start_date}</span>
                    {t.distance > 0 && <span style={{ fontSize: 12, fontWeight: 600, color: '#4338ca' }}>{Number(t.distance).toLocaleString()} {t.unit}</span>}
                    {t.amount > 0 && <span style={{ fontSize: 12, fontWeight: 600, color: '#1a7336' }}>${Number(t.amount).toLocaleString()}</span>}
                    {t.status && <Chip status={t.status === 'APPROVED' || t.status === 'approved' ? 'active' : t.status === 'REJECTED' ? 'expired' : 'expiring'} />}
                  </Row>
                  {t.source && t.destination && <div style={{ fontSize: 11, color: '#888' }}>{t.source} → {t.destination}</div>}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Maintenance log */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
        <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.07em', textTransform: 'uppercase', color: '#888' }}>Maintenance Log</div>
        <Btn primary onClick={openAdd}>+ Add Record</Btn>
      </div>

      {maint.length === 0 && <div style={{ textAlign: 'center', padding: '2rem', color: '#888', fontSize: 13 }}>No maintenance records yet. Add one to start tracking.</div>}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {maint.map(r => (
          <Card key={r.id}>
            <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8 }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <Row gap={8} style={{ marginBottom: 4 }}>
                  <span style={{ fontWeight: 500, fontSize: 13 }}>{r.type}</span>
                  <span style={{ fontSize: 10, fontWeight: 600, background: '#f5f3f0', color: '#888', padding: '1px 7px', borderRadius: 4, textTransform: 'uppercase' }}>{r.date || 'No date'}</span>
                  {r.cost > 0 && <span style={{ fontSize: 12, fontWeight: 600, color: '#1a7336' }}>${Number(r.cost).toLocaleString()}</span>}
                </Row>
                <Row gap={12}>
                  {r.vendor  && <Meta label="Vendor"  value={r.vendor} />}
                  {r.mileage && <Meta label="Mileage" value={Number(r.mileage).toLocaleString() + ' mi'} />}
                  {r.receipt && <Meta label="Receipt" value={r.receipt} />}
                </Row>
                {r.notes && <div style={{ fontSize: 11, color: '#888', marginTop: 4 }}>{r.notes}</div>}
                {r.books_expense_id && <span style={{ fontSize: 10, background: '#e6f4ea', color: '#1a7336', padding: '1px 6px', borderRadius: 4, fontWeight: 600, marginTop: 4, display: 'inline-block' }}>Synced to Books</span>}
              </div>
              <Row gap={5} style={{ flexShrink: 0 }}>
                {r.cost > 0 && !r.books_expense_id && <Btn small onClick={() => openSync(r)}>Sync</Btn>}
                <Btn small onClick={() => openEdit(r)}>Edit</Btn>
                <Btn small danger onClick={() => delRecord(r.id)}>×</Btn>
              </Row>
            </div>
          </Card>
        ))}
      </div>

      {/* Add/edit maintenance record modal */}
      {modal && (
        <Modal title={editId ? 'Edit Record' : 'Add Maintenance Record'} onClose={() => setModal(false)}>
          <Grid2>
            <F label="Date"><In type="date" value={form.date} onChange={v => f({ date: v })} /></F>
            <F label="Type"><Sel value={form.type} onChange={v => f({ type: v })} options={MAINT_TYPES} /></F>
            <F label="Vendor"><In value={form.vendor} onChange={v => f({ vendor: v })} placeholder="Shop / dealer name" /></F>
            <F label="Cost ($)"><In type="number" value={form.cost} onChange={v => f({ cost: v })} placeholder="0" /></F>
            <F label="Mileage"><In type="number" value={form.mileage} onChange={v => f({ mileage: v })} placeholder="Odometer reading" /></F>
            <F label="Receipt #"><In value={form.receipt} onChange={v => f({ receipt: v })} placeholder="Receipt or invoice #" /></F>
            <F label="Notes" span2><In value={form.notes} onChange={v => f({ notes: v })} /></F>
          </Grid2>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 14 }}>
            <Btn onClick={() => setModal(false)}>Cancel</Btn>
            <Btn primary onClick={save}>Save</Btn>
          </div>
        </Modal>
      )}

      {/* Edit van modal */}
      {editVan && (
        <Modal title="Edit Van" onClose={() => setEditVan(false)}>
          <Grid2>
            <F label="Name"><In value={vanForm.name} onChange={v => vf({ name: v })} /></F>
            <F label="Type"><Sel value={vanForm.type} onChange={v => vf({ type: v })} options={LOC_TYPES} /></F>
            <F label="Primary tech"><Sel value={vanForm.tech} onChange={v => vf({ tech: v })} options={techOpts} /></F>
            <F label="Year"><In value={vanForm.year} onChange={v => vf({ year: v })} placeholder="2022" /></F>
            <F label="Make"><In value={vanForm.make} onChange={v => vf({ make: v })} placeholder="Ford" /></F>
            <F label="Model"><In value={vanForm.model} onChange={v => vf({ model: v })} placeholder="Transit" /></F>
            <F label="Color"><In value={vanForm.color} onChange={v => vf({ color: v })} /></F>
            <F label="VIN" span2><In value={vanForm.vin} onChange={v => vf({ vin: v })} /></F>
            <F label="License plate"><In value={vanForm.plate} onChange={v => vf({ plate: v })} /></F>
            <F label="Registration exp"><In type="date" value={vanForm.reg_exp} onChange={v => vf({ reg_exp: v })} /></F>
            <F label="GPS serial / IMEI"><In value={vanForm.gps} onChange={v => vf({ gps: v })} /></F>
            <F label="Insurance"><In value={vanForm.insurance} onChange={v => vf({ insurance: v })} placeholder="Carrier / policy #" /></F>
            <F label="Notes" span2><In value={vanForm.notes} onChange={v => vf({ notes: v })} /></F>
          </Grid2>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 14 }}>
            <Btn onClick={() => setEditVan(false)}>Cancel</Btn>
            <Btn primary onClick={saveVan}>Save</Btn>
          </div>
        </Modal>
      )}

      {auditLoc && <AuditModal location={auditLoc} assets={assets} onClose={() => setAuditLoc(null)} />}

      {/* Sync to Zoho Books modal */}
      {syncModal && (
        <Modal title="Sync to Zoho Books" onClose={() => setSyncModal(null)}>
          <div style={{ marginBottom: 12 }}>
            <div style={{ fontSize: 13, marginBottom: 8 }}>
              <strong>{syncModal.type}</strong> — ${Number(syncModal.cost).toLocaleString()} on {syncModal.date}
            </div>
            <F label="Expense account">
              {expAccounts ? (
                <Sel value={syncAcct} onChange={v => setSyncAcct(v)} options={expAccounts.map(a => ({ v: a.account_id, l: a.account_name }))} />
              ) : (
                <div style={{ fontSize: 12, color: '#888' }}>Loading accounts...</div>
              )}
            </F>
          </div>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
            <Btn onClick={() => setSyncModal(null)}>Cancel</Btn>
            <Btn primary onClick={doSync}>{syncing ? 'Syncing...' : 'Create Expense'}</Btn>
          </div>
        </Modal>
      )}
    </div>
  )
}

// ── VAN CARD ─────────────────────────────────────────────────────────────────

function VanCard({ loc, techs, assets, setLocations, onSelect, onAudit, onEdit, onDel }) {
  const tech  = techs.find(t => t.id === loc.tech)
  const count = assets.filter(a => a.location === loc.id).length
  const { trigger, input } = usePhotoUpload(loc.id, setLocations)

  return (
    <div onClick={onSelect} style={{ border: '1px solid #ebebeb', borderRadius: 10, padding: '13px 15px', background: 'white', cursor: 'pointer' }}>
      <div style={{ display: 'flex', gap: 12, marginBottom: 8 }}>
        <VanAvatar location={loc} size={56} onClick={(e) => { e.stopPropagation(); trigger() }} />
        {input}
        <div style={{ flex: 1, minWidth: 0 }}>
          <Row gap={8} style={{ marginBottom: 4 }}>
            <span style={{ fontWeight: 500, fontSize: 15 }}>{loc.name}</span>
            <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.05em', textTransform: 'uppercase', background: '#f5f3f0', color: '#888', padding: '2px 7px', borderRadius: 4 }}>{loc.type}</span>
          </Row>
          {(loc.year || loc.make || loc.model) && <div style={{ fontSize: 12, color: '#666', marginBottom: 2 }}>{[loc.year, loc.make, loc.model].filter(Boolean).join(' ')}</div>}
          {tech && <div style={{ fontSize: 11, color: '#888' }}>Tech: {tech.name}</div>}
        </div>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 3, marginBottom: 10 }}>
        {loc.color && <Meta label="Color" value={loc.color} />}
        {loc.vin   && <Meta label="VIN"     value={loc.vin} />}
        {loc.plate && <Meta label="Plate"   value={loc.plate} />}
        {loc.reg_exp && <Meta label="Reg exp" value={loc.reg_exp} warn={days(loc.reg_exp) !== null && days(loc.reg_exp) <= 60} />}
        {loc.gps   && <Meta label="GPS S/N" value={loc.gps} />}
        {loc.insurance && <Meta label="Insurance" value={loc.insurance} />}
        <Meta label="Assets" value={count} />
        {loc.notes && <span style={{ fontSize: 11, color: '#888', marginTop: 2 }}>{loc.notes}</span>}
      </div>
      <Row gap={6}>
        <Btn small onClick={(e) => { e.stopPropagation(); onAudit() }}>Audit</Btn>
        <Btn small onClick={(e) => { e.stopPropagation(); onEdit() }}>Edit</Btn>
        <Btn small danger onClick={(e) => { e.stopPropagation(); onDel() }}>Remove</Btn>
      </Row>
    </div>
  )
}

// ── VANS TAB ──────────────────────────────────────────────────────────────────

function VansTab({ locations, setLocations, techs, assets }) {
  const [modal, setModal] = useState(false)
  const [form, setForm]   = useState({})
  const [editId, setEditId] = useState(null)
  const [auditLoc, setAuditLoc] = useState(null)
  const [selectedLoc, setSelectedLoc] = useState(null)
  const f = v => setForm(p => ({ ...p, ...v }))

  const techOpts = [{ v: '', l: 'Unassigned' }, ...techs.map(t => ({ v: t.id, l: t.name }))]

  function openAdd() { setForm({ id: uid(), name: '', type: 'van', tech: '', vin: '', plate: '', gps: '', year: '', make: '', model: '', color: '', insurance: '', reg_exp: '', oil_change: '', notes: '' }); setEditId(null); setModal(true) }
  function openEdit(l) { setForm({ ...l }); setEditId(l.id); setModal(true) }
  function save() {
    if (editId) setLocations(p => p.map(l => l.id === editId ? form : l))
    else setLocations(p => [...p, form])
    setModal(false)
  }
  function del(id) { if (confirm('Remove this location?')) setLocations(p => p.filter(l => l.id !== id)) }

  // Detail view for a selected van — get live data from locations state
  const selectedLocData = selectedLoc ? locations.find(l => l.id === selectedLoc) : null
  if (selectedLocData) {
    return <VanDetail location={selectedLocData} setLocations={setLocations} techs={techs} assets={assets} onBack={() => setSelectedLoc(null)} />
  }

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 14 }}>
        <Btn primary onClick={openAdd}>+ Add location</Btn>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 10 }}>
        {locations.map(loc => <VanCard key={loc.id} loc={loc} techs={techs} assets={assets} setLocations={setLocations} onSelect={() => setSelectedLoc(loc.id)} onAudit={() => setAuditLoc(loc)} onEdit={() => openEdit(loc)} onDel={() => del(loc.id)} />)}
      </div>
      {modal && (
        <Modal title={editId ? 'Edit location' : 'Add location'} onClose={() => setModal(false)}>
          <Grid2>
            <F label="Name"><In value={form.name} onChange={v => f({ name: v })} placeholder="Van 3 / ADAS Center 1" /></F>
            <F label="Type"><Sel value={form.type} onChange={v => f({ type: v })} options={LOC_TYPES} /></F>
            <F label="Primary tech"><Sel value={form.tech} onChange={v => f({ tech: v })} options={techOpts} /></F>
            <F label="Year"><In value={form.year} onChange={v => f({ year: v })} placeholder="2022" /></F>
            <F label="Make"><In value={form.make} onChange={v => f({ make: v })} placeholder="Ford" /></F>
            <F label="Model"><In value={form.model} onChange={v => f({ model: v })} placeholder="Transit" /></F>
            <F label="Color"><In value={form.color} onChange={v => f({ color: v })} placeholder="White" /></F>
            <F label="VIN" span2><In value={form.vin} onChange={v => f({ vin: v })} /></F>
            <F label="License plate"><In value={form.plate} onChange={v => f({ plate: v })} /></F>
            <F label="Registration exp"><In type="date" value={form.reg_exp} onChange={v => f({ reg_exp: v })} /></F>
            <F label="GPS serial / IMEI"><In value={form.gps} onChange={v => f({ gps: v })} /></F>
            <F label="Insurance"><In value={form.insurance} onChange={v => f({ insurance: v })} placeholder="Carrier / policy #" /></F>
            <F label="Last oil change"><In type="date" value={form.oil_change} onChange={v => f({ oil_change: v })} /></F>
            <F label="Notes" span2><In value={form.notes} onChange={v => f({ notes: v })} /></F>
          </Grid2>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 14 }}>
            <Btn onClick={() => setModal(false)}>Cancel</Btn>
            <Btn primary onClick={save}>Save</Btn>
          </div>
        </Modal>
      )}
      {auditLoc && <AuditModal location={auditLoc} assets={assets} onClose={() => setAuditLoc(null)} />}
    </div>
  )
}

// ── ASSETS TAB ────────────────────────────────────────────────────────────────

function AssetsTab({ assets, setAssets, locations }) {
  const [modal, setModal]     = useState(false)
  const [form, setForm]       = useState({})
  const [editId, setEditId]   = useState(null)
  const [filterLoc, setFilterLoc] = useState('all')
  const [filterCat, setFilterCat] = useState('all')
  const f = v => setForm(p => ({ ...p, ...v }))

  const locOpts = [{ v: '', l: 'Unassigned' }, ...locations.map(l => ({ v: l.id, l: l.name }))]

  function openAdd() { setForm({ id: uid(), name: '', cat: 'Cal Target', location: '', sn: '', sub_exp: '', nickname: '', notes: '', status: 'active' }); setEditId(null); setModal(true) }
  function openEdit(a) { setForm({ ...a }); setEditId(a.id); setModal(true) }
  function save() {
    if (editId) setAssets(p => p.map(a => a.id === editId ? form : a))
    else setAssets(p => [...p, form])
    setModal(false)
  }
  function del(id) { if (confirm('Remove this asset?')) setAssets(p => p.filter(a => a.id !== id)) }

  const filtered = assets.filter(a =>
    (filterLoc === 'all' || a.location === filterLoc) &&
    (filterCat === 'all' || a.cat === filterCat)
  )

  const byLoc = {}
  filtered.forEach(a => {
    const key = a.location || 'unassigned'
    if (!byLoc[key]) byLoc[key] = []
    byLoc[key].push(a)
  })

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10, flexWrap: 'wrap', gap: 8 }}>
        <Row gap={5}>
          <FilterPill active={filterLoc === 'all'} onClick={() => setFilterLoc('all')}>All locations</FilterPill>
          {locations.map(l => (
            <FilterPill key={l.id} active={filterLoc === l.id} onClick={() => setFilterLoc(l.id)}>{l.name}</FilterPill>
          ))}
        </Row>
        <Btn primary onClick={openAdd}>+ Add asset</Btn>
      </div>
      <Row gap={5} style={{ marginBottom: 14 }}>
        <FilterPill active={filterCat === 'all'} onClick={() => setFilterCat('all')}>All types</FilterPill>
        {ASSET_CATS.filter(c => assets.some(a => a.cat === c)).map(c => (
          <FilterPill key={c} active={filterCat === c} onClick={() => setFilterCat(c)}>{c}</FilterPill>
        ))}
      </Row>

      {Object.entries(byLoc).map(([locId, items]) => {
        const loc = locations.find(l => l.id === locId)
        return (
          <div key={locId} style={{ marginBottom: 20 }}>
            <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.07em', textTransform: 'uppercase', color: '#888', marginBottom: 8, paddingBottom: 4, borderBottom: '1px solid #ebebeb' }}>
              {loc ? loc.name : 'Unassigned'} — {items.length} item{items.length !== 1 ? 's' : ''}
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {items.map(a => {
                const st = statusOf(a.sub_exp, a.status)
                const n  = days(a.sub_exp)
                return (
                  <Card key={a.id}>
                    <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8 }}>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <Row gap={7} style={{ marginBottom: 4 }}>
                          <span style={{ fontWeight: 500, fontSize: 13 }}>{a.name}</span>
                          <span style={{ fontSize: 10, fontWeight: 600, background: '#f5f3f0', color: '#888', padding: '1px 7px', borderRadius: 4, letterSpacing: '0.04em', textTransform: 'uppercase' }}>{a.cat}</span>
                          {a.sub_exp && <Chip status={st} />}
                        </Row>
                        <Row gap={12}>
                          {a.sn       && <Meta label="S/N"      value={a.sn} />}
                          {a.nickname && <Meta label="Nickname" value={a.nickname} />}
                          {a.sub_exp  && <Meta label="Sub exp"  value={`${a.sub_exp}${n !== null && n >= 0 && n <= 90 ? ` (${n}d)` : n !== null && n < 0 ? ' — EXPIRED' : ''}`} warn={n !== null && n <= 60} />}
                        </Row>
                        {a.notes && <div style={{ fontSize: 11, color: '#888', marginTop: 4 }}>{a.notes}</div>}
                      </div>
                      <Row gap={5} style={{ flexShrink: 0 }}>
                        <Btn small onClick={() => openEdit(a)}>Edit</Btn>
                        <Btn small danger onClick={() => del(a.id)}>×</Btn>
                      </Row>
                    </div>
                  </Card>
                )
              })}
            </div>
          </div>
        )
      })}
      {filtered.length === 0 && <div style={{ textAlign: 'center', padding: '2rem', color: '#888', fontSize: 13 }}>No assets match this filter.</div>}

      {modal && (
        <Modal title={editId ? 'Edit asset' : 'Add asset'} onClose={() => setModal(false)}>
          <Grid2>
            <F label="Name" span2><In value={form.name} onChange={v => f({ name: v })} placeholder="e.g. Radar Cal Plate — white Z" /></F>
            <F label="Category"><Sel value={form.cat} onChange={v => f({ cat: v })} options={ASSET_CATS} /></F>
            <F label="Assigned to"><Sel value={form.location} onChange={v => f({ location: v })} options={locOpts} /></F>
            <F label="Serial / part number"><In value={form.sn} onChange={v => f({ sn: v })} placeholder="e.g. CSC0802/03" /></F>
            <F label="Nickname"><In value={form.nickname} onChange={v => f({ nickname: v })} /></F>
            <F label="Subscription expiry"><In type="date" value={form.sub_exp} onChange={v => f({ sub_exp: v })} /></F>
            <F label="Status"><Sel value={form.status} onChange={v => f({ status: v })} options={['active', 'inactive']} /></F>
            <F label="Notes" span2><In value={form.notes} onChange={v => f({ notes: v })} /></F>
          </Grid2>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 14 }}>
            <Btn onClick={() => setModal(false)}>Cancel</Btn>
            <Btn primary onClick={save}>Save</Btn>
          </div>
        </Modal>
      )}
    </div>
  )
}

// ── LAPTOPS TAB ───────────────────────────────────────────────────────────────

function LaptopsTab({ laptops, setLaptops, techs }) {
  const [modal, setModal]   = useState(false)
  const [form, setForm]     = useState({})
  const [editId, setEditId] = useState(null)
  const f = v => setForm(p => ({ ...p, ...v }))
  const techOpts = [{ v: '', l: 'Unassigned' }, ...techs.map(t => ({ v: t.id, l: t.name }))]

  function openAdd() { setForm({ id: uid(), name: '', build: 'Build 2', tech: '', passcode: '', login: '', teamviewer: '', fca_sn: '', license: '', notes: '', oem_creds: [], sw_versions: [] }); setEditId(null); setModal(true) }
  function openEdit(l) { setForm({ ...l, oem_creds: l.oem_creds || [], sw_versions: l.sw_versions || [] }); setEditId(l.id); setModal(true) }
  function save() {
    if (editId) setLaptops(p => p.map(l => l.id === editId ? form : l))
    else setLaptops(p => [...p, form])
    setModal(false)
  }
  function del(id) { if (confirm('Remove this laptop?')) setLaptops(p => p.filter(l => l.id !== id)) }

  // OEM cred helpers
  function addCred() { f({ oem_creds: [...(form.oem_creds || []), { oem: '', username: '', password: '' }] }) }
  function updateCred(i, key, val) { const c = [...(form.oem_creds || [])]; c[i] = { ...c[i], [key]: val }; f({ oem_creds: c }) }
  function removeCred(i) { f({ oem_creds: (form.oem_creds || []).filter((_, j) => j !== i) }) }

  // SW version helpers
  function addVer() { f({ sw_versions: [...(form.sw_versions || []), { oem: '', version: '' }] }) }
  function updateVer(i, key, val) { const v = [...(form.sw_versions || [])]; v[i] = { ...v[i], [key]: val }; f({ sw_versions: v }) }
  function removeVer(i) { f({ sw_versions: (form.sw_versions || []).filter((_, j) => j !== i) }) }

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 14 }}>
        <Btn primary onClick={openAdd}>+ Add laptop</Btn>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {laptops.map(lap => {
          const tech = techs.find(t => t.id === lap.tech)
          const creds = lap.oem_creds || []
          const vers  = lap.sw_versions || []
          return (
            <Card key={lap.id}>
              <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8 }}>
                <div style={{ flex: 1 }}>
                  <Row gap={8} style={{ marginBottom: 6 }}>
                    <span style={{ fontWeight: 500, fontSize: 14 }}>{lap.name}</span>
                    <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.05em', textTransform: 'uppercase', background: '#f5f3f0', color: '#888', padding: '2px 8px', borderRadius: 4 }}>{lap.build}</span>
                  </Row>
                  <Row gap={12}>
                    {tech              && <Meta label="Assigned to"   value={tech.name} />}
                    {lap.login         && <Meta label="Login"         value={lap.login} />}
                    {lap.teamviewer    && <Meta label="TeamViewer"    value={lap.teamviewer} />}
                    {lap.fca_sn        && <Meta label="FCA Device S/N" value={lap.fca_sn} />}
                    {lap.license       && <Meta label="License"       value={lap.license} />}
                    {creds.length > 0  && <Meta label="OEM Logins"   value={creds.length} />}
                  </Row>
                  {/* SW version pills */}
                  {vers.length > 0 && (
                    <Row gap={4} style={{ marginTop: 5 }}>
                      {vers.filter(v => v.version).map((v, i) => (
                        <span key={i} style={{ fontSize: 10, background: '#eef2ff', color: '#4338ca', padding: '2px 7px', borderRadius: 4, fontWeight: 600 }}>
                          {v.oem} {v.version}
                        </span>
                      ))}
                    </Row>
                  )}
                  {lap.notes && <div style={{ fontSize: 11, color: '#888', marginTop: 5 }}>{lap.notes}</div>}
                </div>
                <Row gap={5} style={{ flexShrink: 0 }}>
                  <Btn small onClick={() => openEdit(lap)}>Edit</Btn>
                  <Btn small danger onClick={() => del(lap.id)}>×</Btn>
                </Row>
              </div>
            </Card>
          )
        })}
      </div>
      {modal && (
        <Modal title={editId ? 'Edit laptop' : 'Add laptop'} onClose={() => setModal(false)}>
          <Grid2>
            <F label="Name"><In value={form.name} onChange={v => f({ name: v })} placeholder="OEM Laptop 1" /></F>
            <F label="Build type"><Sel value={form.build} onChange={v => f({ build: v })} options={BUILD_TYPES} /></F>
            <F label="Assigned tech"><Sel value={form.tech} onChange={v => f({ tech: v })} options={techOpts} /></F>
            <F label="Login / account"><In value={form.login} onChange={v => f({ login: v })} placeholder="Local / email" /></F>
            <F label="Passcode"><In value={form.passcode} onChange={v => f({ passcode: v })} /></F>
            <F label="TeamViewer ID"><In value={form.teamviewer} onChange={v => f({ teamviewer: v })} /></F>
            <F label="FCA device S/N"><In value={form.fca_sn} onChange={v => f({ fca_sn: v })} /></F>
            <F label="License / cert #"><In value={form.license} onChange={v => f({ license: v })} /></F>
            <F label="Notes" span2><In value={form.notes} onChange={v => f({ notes: v })} /></F>
          </Grid2>

          {/* OEM Credentials section */}
          <div style={{ marginTop: 16, borderTop: '1px solid #ebebeb', paddingTop: 14 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
              <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.07em', textTransform: 'uppercase', color: '#888' }}>OEM Credentials</div>
              <Btn small onClick={addCred}>+ Add</Btn>
            </div>
            {(form.oem_creds || []).map((c, i) => (
              <div key={i} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr auto', gap: 6, marginBottom: 6, alignItems: 'end' }}>
                <In value={c.oem} onChange={v => updateCred(i, 'oem', v)} placeholder="OEM name" />
                <In value={c.username} onChange={v => updateCred(i, 'username', v)} placeholder="Username" />
                <In value={c.password} onChange={v => updateCred(i, 'password', v)} placeholder="Password" />
                <button onClick={() => removeCred(i)} style={{ background: 'none', border: 'none', color: '#9b1c1c', cursor: 'pointer', fontSize: 16, padding: '4px 6px' }}>×</button>
              </div>
            ))}
          </div>

          {/* Software Versions section */}
          <div style={{ marginTop: 14, borderTop: '1px solid #ebebeb', paddingTop: 14 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
              <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.07em', textTransform: 'uppercase', color: '#888' }}>Software Versions</div>
              <Btn small onClick={addVer}>+ Add</Btn>
            </div>
            {(form.sw_versions || []).map((v, i) => (
              <div key={i} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr auto', gap: 6, marginBottom: 6, alignItems: 'end' }}>
                <In value={v.oem} onChange={val => updateVer(i, 'oem', val)} placeholder="OEM / software" />
                <In value={v.version} onChange={val => updateVer(i, 'version', val)} placeholder="Version" />
                <button onClick={() => removeVer(i)} style={{ background: 'none', border: 'none', color: '#9b1c1c', cursor: 'pointer', fontSize: 16, padding: '4px 6px' }}>×</button>
              </div>
            ))}
          </div>

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 14 }}>
            <Btn onClick={() => setModal(false)}>Cancel</Btn>
            <Btn primary onClick={save}>Save</Btn>
          </div>
        </Modal>
      )}
    </div>
  )
}

// ── OEM SOFTWARE TAB ──────────────────────────────────────────────────────────

function OEMTab({ oem, setOem, techs }) {
  const [modal, setModal]   = useState(false)
  const [form, setForm]     = useState({})
  const [editId, setEditId] = useState(null)
  const [filter, setFilter] = useState('all')
  const f = v => setForm(p => ({ ...p, ...v }))
  const techOpts = [{ v: '', l: 'Unassigned' }, ...techs.map(t => ({ v: t.id, l: t.name }))]

  function openAdd() { setForm({ id: uid(), name: '', build: 'Build 2', tech: '', renewal: '', cost: 0, username: '', portal: '', twofa: '', notes: '', status: 'active' }); setEditId(null); setModal(true) }
  function openEdit(s) { setForm({ ...s }); setEditId(s.id); setModal(true) }
  function save() {
    if (editId) setOem(p => p.map(s => s.id === editId ? form : s))
    else setOem(p => [...p, form])
    setModal(false)
  }
  function del(id) { if (confirm('Remove this subscription?')) setOem(p => p.filter(s => s.id !== id)) }

  const totalCost = oem.reduce((s, x) => s + (Number(x.cost) || 0), 0)
  const filtered  = filter === 'all' ? oem : oem.filter(s => statusOf(s.renewal, s.status) === filter)

  return (
    <div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0,1fr))', gap: 8, marginBottom: 14 }}>
        <StatCard label="Subscriptions" value={oem.length} />
        <StatCard label="Annual cost"   value={'$' + totalCost.toLocaleString()} />
        <StatCard label="Expiring ≤60d" value={oem.filter(s => { const n = days(s.renewal); return n !== null && n >= 0 && n <= 60 }).length} />
      </div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12, flexWrap: 'wrap', gap: 8 }}>
        <Row gap={5}>
          {['all', 'active', 'expiring', 'expired'].map(s => (
            <FilterPill key={s} active={filter === s} onClick={() => setFilter(s)}>
              {s === 'all' ? 'All' : s.charAt(0).toUpperCase() + s.slice(1)}
            </FilterPill>
          ))}
        </Row>
        <Btn primary onClick={openAdd}>+ Add subscription</Btn>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
        {filtered.map(s => {
          const st   = statusOf(s.renewal, s.status)
          const n    = days(s.renewal)
          const tech = techs.find(t => t.id === s.tech)
          return (
            <Card key={s.id}>
              <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8 }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <Row gap={7} style={{ marginBottom: 5 }}>
                    <span style={{ fontWeight: 500, fontSize: 14 }}>{s.name}</span>
                    <Chip status={st} />
                    <span style={{ fontSize: 10, fontWeight: 600, background: '#f5f3f0', color: '#888', padding: '1px 7px', borderRadius: 4, letterSpacing: '0.04em', textTransform: 'uppercase' }}>{s.build}</span>
                  </Row>
                  <Row gap={14}>
                    {tech      && <Meta label="Tech"   value={tech.name} />}
                    {s.cost > 0 && <Meta label="Cost"  value={'$' + Number(s.cost).toLocaleString() + '/yr'} />}
                    {s.renewal && <Meta label="Renews" value={`${s.renewal}${n !== null && n >= 0 ? ` (${n}d)` : ' — EXPIRED'}`} warn={n !== null && n <= 60} />}
                    {s.username && <Meta label="User"  value={s.username} />}
                    {s.portal  && <a href={s.portal} target="_blank" rel="noreferrer" style={{ fontSize: 12, color: BRAND }}>Portal ↗</a>}
                    {s.twofa   && <span style={{ fontSize: 11, background: '#fef3c7', color: '#92400e', padding: '1px 7px', borderRadius: 4, fontWeight: 600 }}>2FA: {s.twofa}</span>}
                  </Row>
                  {s.notes && <div style={{ fontSize: 11, color: '#888', marginTop: 4 }}>{s.notes}</div>}
                </div>
                <Row gap={5} style={{ flexShrink: 0 }}>
                  <Btn small onClick={() => openEdit(s)}>Edit</Btn>
                  <Btn small danger onClick={() => del(s.id)}>×</Btn>
                </Row>
              </div>
            </Card>
          )
        })}
      </div>
      {modal && (
        <Modal title={editId ? 'Edit subscription' : 'Add OEM subscription'} onClose={() => setModal(false)}>
          <Grid2>
            <F label="Software name" span2><In value={form.name} onChange={v => f({ name: v })} placeholder="Ford IDS / FDRS" /></F>
            <F label="Build"><Sel value={form.build} onChange={v => f({ build: v })} options={BUILD_TYPES} /></F>
            <F label="Assigned tech"><Sel value={form.tech} onChange={v => f({ tech: v })} options={techOpts} /></F>
            <F label="Renewal date"><In type="date" value={form.renewal} onChange={v => f({ renewal: v })} /></F>
            <F label="Annual cost ($)"><In type="number" value={form.cost} onChange={v => f({ cost: v })} /></F>
            <F label="Username / login" span2><In value={form.username} onChange={v => f({ username: v })} /></F>
            <F label="Portal URL" span2><In value={form.portal} onChange={v => f({ portal: v })} placeholder="https://" /></F>
            <F label="2FA contact" span2><In value={form.twofa} onChange={v => f({ twofa: v })} placeholder="Phone, email, or URL for 2FA support" /></F>
            <F label="Notes" span2><In value={form.notes} onChange={v => f({ notes: v })} /></F>
          </Grid2>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 14 }}>
            <Btn onClick={() => setModal(false)}>Cancel</Btn>
            <Btn primary onClick={save}>Save</Btn>
          </div>
        </Modal>
      )}
    </div>
  )
}

// ── ROOT ──────────────────────────────────────────────────────────────────────

const TABS = [
  { id: 'vans',    label: 'Vans & Locations' },
  { id: 'assets',  label: 'Tools & Equipment' },
  { id: 'laptops', label: 'Laptops' },
  { id: 'oem',     label: 'OEM Software' },
]

export default function OpsHub({ user, onLogout, currentScreen, onNavigate }) {
  const [tab, setTab] = useState('vans')

  const [locations, setLocations] = useState(() => lsGet('ops2_loc',     SEED_LOCATIONS))
  const [assets,    setAssets]    = useState(() => lsGet('ops2_assets',  SEED_ASSETS))
  const [laptops,   setLaptops]   = useState(() => lsGet('ops2_laptops', SEED_LAPTOPS))
  const [oem,       setOem]       = useState(() => lsGet('ops2_oem',     SEED_OEM))
  const techs = SEED_TECHS

  useEffect(() => lsSet('ops2_loc',     locations), [locations])
  useEffect(() => lsSet('ops2_assets',  assets),    [assets])
  useEffect(() => lsSet('ops2_laptops', laptops),   [laptops])
  useEffect(() => lsSet('ops2_oem',     oem),       [oem])

  const counts = { vans: locations.length, assets: assets.length, laptops: laptops.length, oem: oem.length }

  return (
    <div style={{ background: 'white', minHeight: '100vh' }}>
      <Navbar user={user} onLogout={onLogout} currentScreen={currentScreen} onNavigate={onNavigate} />
      {/* Section header */}
      <div style={{ background: '#1a1a1a', padding: '13px 20px', display: 'flex', alignItems: 'center', gap: 10 }}>
        <div style={{ width: 30, height: 30, background: BRAND, borderRadius: 6, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
          <svg width="17" height="17" viewBox="0 0 17 17" fill="none">
            <rect x="1" y="9" width="5.5" height="6.5" rx="1" fill="white" opacity="0.9"/>
            <rect x="8.5" y="4.5" width="7" height="11" rx="1" fill="white" opacity="0.65"/>
            <path d="M0.5 9L8.5 2.5L16.5 9" stroke="white" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" fill="none"/>
          </svg>
        </div>
        <div>
          <div style={{ color: '#fff', fontWeight: 500, fontSize: 15 }}>Operations Hub</div>
          <div style={{ color: '#777', fontSize: 11 }}>Absolute ADAS · Asset &amp; Subscription Management</div>
        </div>
      </div>

      <div style={{ padding: '16px 20px' }}>
        <Alerts oem={oem} />

        {/* Tab bar */}
        <div style={{ display: 'flex', borderBottom: '1px solid #ebebeb', marginBottom: 18, gap: 0, overflowX: 'auto' }}>
          {TABS.map(t => (
            <button key={t.id} onClick={() => setTab(t.id)} style={{
              background: 'none', border: 'none',
              borderBottom: tab === t.id ? `2px solid ${BRAND}` : '2px solid transparent',
              color: tab === t.id ? BRAND : '#666',
              fontWeight: tab === t.id ? 500 : 400,
              fontSize: 13, padding: '9px 16px', cursor: 'pointer', whiteSpace: 'nowrap',
            }}>
              {t.label}
              <span style={{ marginLeft: 6, background: '#f5f3f0', borderRadius: 999, padding: '1px 7px', fontSize: 11, color: '#888' }}>{counts[t.id]}</span>
            </button>
          ))}
        </div>

        {tab === 'vans'    && <VansTab    locations={locations} setLocations={setLocations} techs={techs} assets={assets} />}
        {tab === 'assets'  && <AssetsTab  assets={assets}       setAssets={setAssets}       locations={locations} />}
        {tab === 'laptops' && <LaptopsTab laptops={laptops}     setLaptops={setLaptops}     techs={techs} />}
        {tab === 'oem'     && <OEMTab     oem={oem}            setOem={setOem}             techs={techs} />}
      </div>
    </div>
  )
}
