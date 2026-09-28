// Ops → Laptop Setup. The standing rule, the per-laptop asset list, and both
// setup runbooks in full (Mark 2026-09-27).
//
// The runbooks live as markdown next to the code and are imported raw, so the
// numbered steps, checklists, tables, the power script and the troubleshooting
// tables stay exactly as Mark wrote them and can be edited without touching
// JSX. Nothing here holds a password: where a runbook needs one it names the
// Zoho Vault entry instead.
import { useState } from 'react'
import Markdown from '../Markdown.jsx'
import shopRunbook from '../../content/tech-laptop-shop-runbook.md?raw'
import euroRunbook from '../../content/tech-laptop-euro-runbook.md?raw'

const ORANGE = '#CD4419'
const lsGet = (k, d) => { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d } catch { return d } }
const lsSet = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)) } catch { /* private mode */ } }

// The Handover columns from the Shop runbook, in that order.
export const ASSET_COLS = [
  { k: 'pc_name',   label: 'PC name',        w: 150, ph: 'TECH-LAPTOP-1' },
  { k: 'tag',       label: 'Service tag',    w: 110, ph: '' },
  { k: 'model',     label: 'Model',          w: 160, ph: '' },
  { k: 'assigned',  label: 'Assigned to',    w: 120, ph: '' },
  { k: 'purchased', label: 'Purchased',      w: 110, ph: 'YYYY-MM-DD' },
  { k: 'cost',      label: 'Cost',           w: 90,  ph: '$' },
  { k: 'vault',     label: 'Vault entry',    w: 150, ph: 'name only' },
  { k: 'bitlocker', label: 'BitLocker confirmed', w: 150, ph: 'yes + date' },
  { k: 'subs',      label: 'OEM subs + expiry', w: 220, ph: 'Ford FDRS 2027-03-01' },
  { k: 'interface', label: 'Interface serial', w: 150, ph: '' },
]

const blankAsset = name => ({ id: `la_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 5)}`, pc_name: name || '', tag: '', model: '', assigned: '', purchased: '', cost: '', vault: '', bitlocker: '', subs: '', interface: '' })

export default function LaptopSetupTab() {
  const [assets, setAssets] = useState(() => lsGet('ops2_laptop_assets', []))
  const [openBook, setOpenBook] = useState(null)
  const save = next => { setAssets(next); lsSet('ops2_laptop_assets', next) }
  const set = (id, k, v) => save(assets.map(a => a.id === id ? { ...a, [k]: v } : a))
  const add = name => save([...assets, blankAsset(name)])
  const del = id => { if (window.confirm('Remove this laptop from the asset list?')) save(assets.filter(a => a.id !== id)) }

  const inp = { border: '1px solid #e0dbd6', borderRadius: 7, padding: '6px 8px', fontSize: 13, width: '100%', outline: 'none', backgroundColor: 'white' }

  return (
    <div>
      {/* The rule, before anything else. */}
      <div className="rounded-2xl p-4 mb-4" style={{ backgroundColor: '#fff5f0', border: `2px solid ${ORANGE}` }}>
        <div className="text-base font-extrabold mb-1" style={{ color: ORANGE }}>Every technician gets two laptops</div>
        <p className="text-sm leading-snug" style={{ color: '#7c2d12' }}>
          One <b>Ford and GM machine</b> and one <b>Euro machine</b> (BMW, Mercedes, VW/Audi, Volvo, JLR).
          They are <b>never combined on one laptop</b>. The OEM software stacks fight each other, and a
          rebuild on a combined machine takes a tech off the road for a day instead of an hour.
        </p>
        <div className="mt-3 pt-3 flex flex-wrap gap-x-6 gap-y-1 text-[13px]" style={{ borderTop: '1px solid #fcd5c5', color: '#7c2d12' }}>
          <span><b>Naming:</b></span>
          <span>Ford/GM &rarr; <code style={{ fontFamily: 'IBM Plex Mono, monospace' }}>TECH-LAPTOP-1</code>, <code style={{ fontFamily: 'IBM Plex Mono, monospace' }}>TECH-LAPTOP-2</code>&hellip;</span>
          <span>Euro &rarr; <code style={{ fontFamily: 'IBM Plex Mono, monospace' }}>TECH-LAPTOP-EURO-1</code>, <code style={{ fontFamily: 'IBM Plex Mono, monospace' }}>TECH-LAPTOP-EURO-2</code>&hellip;</span>
        </div>
      </div>

      {/* Asset list — the Handover columns. */}
      <div className="flex items-center justify-between mb-2 flex-wrap gap-2">
        <div>
          <div className="text-sm font-extrabold" style={{ color: '#1a1a1a' }}>Laptop asset list</div>
          <div className="text-[12px]" style={{ color: '#888' }}>One row per machine. Vault entry is the <b>name</b> of the Zoho Vault entry, never the password.</div>
        </div>
        <div className="flex gap-1.5">
          <button onClick={() => add(`TECH-LAPTOP-${assets.filter(a => /^TECH-LAPTOP-\d/.test(a.pc_name)).length + 1}`)}
            className="text-xs font-bold rounded-lg px-3 py-2 text-white" style={{ backgroundColor: ORANGE }}>+ Ford/GM</button>
          <button onClick={() => add(`TECH-LAPTOP-EURO-${assets.filter(a => /^TECH-LAPTOP-EURO-\d/.test(a.pc_name)).length + 1}`)}
            className="text-xs font-bold rounded-lg px-3 py-2" style={{ backgroundColor: 'white', color: ORANGE, border: `1px solid ${ORANGE}` }}>+ Euro</button>
        </div>
      </div>

      <div className="overflow-x-auto rounded-xl mb-5" style={{ border: '1px solid #e0dbd6', backgroundColor: 'white' }}>
        <table style={{ borderCollapse: 'collapse', fontSize: 13, minWidth: 1330 }}>
          <thead><tr>
            {ASSET_COLS.map(c => <th key={c.k} style={{ textAlign: 'left', padding: '9px 10px', backgroundColor: '#faf9f7', color: '#57534e', fontWeight: 800, borderBottom: '1px solid #e0dbd6', whiteSpace: 'nowrap', minWidth: c.w }}>{c.label}</th>)}
            <th style={{ width: 40, borderBottom: '1px solid #e0dbd6', backgroundColor: '#faf9f7' }} />
          </tr></thead>
          <tbody>
            {assets.map(a => (
              <tr key={a.id}>
                {ASSET_COLS.map(c => (
                  <td key={c.k} style={{ padding: '5px 7px', borderTop: '1px solid #f1ede9' }}>
                    <input value={a[c.k] || ''} placeholder={c.ph} onChange={e => set(a.id, c.k, e.target.value)} style={inp} />
                  </td>
                ))}
                <td style={{ padding: '5px 7px', borderTop: '1px solid #f1ede9', textAlign: 'center' }}>
                  <button onClick={() => del(a.id)} title="Remove" style={{ color: '#b91c1c', fontWeight: 800, fontSize: 16, lineHeight: 1 }}>&times;</button>
                </td>
              </tr>
            ))}
            {!assets.length && (
              <tr><td colSpan={ASSET_COLS.length + 1} style={{ padding: '16px 12px', color: '#999', fontSize: 13.5 }}>
                No machines listed yet. Add one per technician per stack — a Ford/GM and a Euro.
              </td></tr>
            )}
          </tbody>
        </table>
      </div>

      {/* The runbooks, in full. */}
      <div className="text-sm font-extrabold mb-2" style={{ color: '#1a1a1a' }}>Setup runbooks</div>
      {[
        { id: 'shop', title: 'Shop Laptop Setup Runbook', sub: 'Ford and GM machine · TECH-LAPTOP-1, TECH-LAPTOP-2…', md: shopRunbook },
        { id: 'euro', title: 'Tech Laptop Euro Setup Runbook', sub: 'BMW, Mercedes, VW/Audi, Volvo, JLR · TECH-LAPTOP-EURO-1…', md: euroRunbook },
      ].map(b => {
        const open = openBook === b.id
        return (
          <div key={b.id} className="rounded-xl overflow-hidden mb-2" style={{ backgroundColor: 'white', border: '1px solid #e0dbd6' }}>
            <button onClick={() => setOpenBook(open ? null : b.id)} className="w-full text-left px-4 py-3 flex items-center gap-3">
              <span style={{ fontSize: 20 }}>💻</span>
              <span className="flex-1 min-w-0">
                <span className="block text-sm font-bold" style={{ color: '#1a1a1a' }}>{b.title}</span>
                <span className="block text-[12px]" style={{ color: '#888' }}>{b.sub}</span>
              </span>
              <span className="text-xs font-bold" style={{ color: ORANGE }}>{open ? 'Hide' : 'Open'}</span>
            </button>
            {open && <div className="px-4 pb-5" style={{ borderTop: '1px solid #f1ede9' }}><Markdown text={b.md} /></div>}
          </div>
        )
      })}

      <p className="text-[12px] mt-4" style={{ color: '#999' }}>
        Passwords are not kept in this app. Every credential a runbook needs lives in Zoho Vault; the asset list records the Vault entry name so you can find it.
      </p>
    </div>
  )
}
