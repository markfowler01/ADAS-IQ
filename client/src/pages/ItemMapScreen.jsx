// Item Mapping — Kinetic sensor name → Zoho Books item (Mark 2026-08-11:
// "most calibrations are getting removed on the swap"). The invoice
// builders consult this table FIRST, so what's here is exactly what gets
// billed. Seed proposes pairings with AI; every row is editable.

import { useEffect, useState, useCallback } from 'react'
import { API_BASE, apiFetch } from '../utils/api.js'
import Navbar from '../components/Navbar.jsx'

const ORANGE = '#CD4419'

function normKey(name) {
  return String(name || '').toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim()
}

export default function ItemMapScreen({ user, onLogout, currentScreen, onNavigate }) {
  const [data, setData] = useState({ map: {}, books_items: [], vocab: [] })
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState('')        // normKey currently saving
  const [seeding, setSeeding] = useState(false)
  const [newName, setNewName] = useState('')
  const [toast, setToast] = useState('')

  function showToast(m) { setToast(m); setTimeout(() => setToast(''), 3500) }

  const load = useCallback(async () => {
    try {
      const r = await apiFetch(`${API_BASE}/api/item-map`)
      const j = await r.json()
      if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`)
      setData({ map: j.map || {}, books_items: j.books_items || [], vocab: j.vocab || [] })
      setErr('')
    } catch (e) { setErr(e.message) }
    finally { setLoading(false) }
  }, [])
  useEffect(() => { load() }, [load])

  async function save(kineticName, itemId) {
    const item = data.books_items.find(i => String(i.item_id) === String(itemId))
    if (!item) return
    setBusy(normKey(kineticName))
    try {
      const r = await apiFetch(`${API_BASE}/api/item-map`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kinetic_name: kineticName, item_name: item.name, item_id: item.item_id }),
      })
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      setData(prev => ({ ...prev, map: { ...prev.map, [normKey(kineticName)]: {
        kinetic_name: kineticName, item_name: item.name, item_id: item.item_id, source: 'manual',
      } } }))
      showToast(`✓ ${kineticName} → ${item.name}`)
    } catch (e) { showToast(`Save failed: ${e.message}`) }
    finally { setBusy('') }
  }

  async function remove(kineticName) {
    setBusy(normKey(kineticName))
    try {
      const r = await apiFetch(`${API_BASE}/api/item-map/delete`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kinetic_name: kineticName }),
      })
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      setData(prev => {
        const map = { ...prev.map }
        delete map[normKey(kineticName)]
        return { ...prev, map }
      })
    } catch (e) { showToast(`Delete failed: ${e.message}`) }
    finally { setBusy('') }
  }

  async function seed() {
    setSeeding(true)
    try {
      const r = await apiFetch(`${API_BASE}/api/item-map/seed`, { method: 'POST' })
      const j = await r.json()
      if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`)
      showToast(`✨ Mapped ${j.seeded} item${j.seeded === 1 ? '' : 's'}${j.skipped?.length ? ` · ${j.skipped.length} had no good match` : ''}`)
      await load()
    } catch (e) { showToast(`Seed failed: ${e.message}`) }
    finally { setSeeding(false) }
  }

  function addRow() {
    const name = newName.trim()
    if (!name) return
    setNewName('')
    // Row appears in the unmapped list until a Books item is picked.
    setData(prev => prev.vocab.some(v => normKey(v) === normKey(name))
      ? prev
      : { ...prev, vocab: [...prev.vocab, name] })
  }

  // Rows = every vocab entry + every mapped key not in vocab (custom adds)
  const vocabKeys = new Set(data.vocab.map(normKey))
  const rows = [
    ...data.vocab.map(v => ({ name: v, entry: data.map[normKey(v)] || null })),
    ...Object.entries(data.map)
      .filter(([k]) => !vocabKeys.has(k))
      .map(([, e]) => ({ name: e.kinetic_name, entry: e })),
  ]
  const mappedCount = rows.filter(r => r.entry).length

  return (
    <div className="min-h-screen flex flex-col" style={{ backgroundColor: '#f5f3f0' }}>
      <Navbar user={user} onLogout={onLogout} currentScreen={currentScreen} onNavigate={onNavigate} />
      <div className="max-w-3xl w-full mx-auto px-4 py-5 flex-1">
        <div className="flex items-end justify-between gap-3 flex-wrap mb-1">
          <div>
            <div className="text-[11px] uppercase tracking-widest" style={{ color: '#888', fontFamily: 'IBM Plex Mono, monospace' }}>Books</div>
            <h1 className="text-xl font-bold" style={{ color: '#1a1a1a' }}>Item Mapping</h1>
          </div>
          <button onClick={seed} disabled={seeding}
            className="text-xs font-bold rounded-lg px-4 py-2 text-white"
            style={{ backgroundColor: seeding ? '#e5e7eb' : ORANGE }}
          >{seeding ? 'Mapping…' : '✨ Auto-map unmapped'}</button>
        </div>
        <p className="text-xs mb-4" style={{ color: '#888', lineHeight: 1.5 }}>
          What each Kinetic report sensor bills as. Invoices use this table first — no more guessing.
          {' '}{mappedCount}/{rows.length} mapped.
        </p>

        {loading ? (
          <div className="text-sm p-6" style={{ color: '#888' }}>Loading…</div>
        ) : err ? (
          <div className="text-sm p-4 rounded-xl" style={{ color: '#991b1b', backgroundColor: '#fee2e2' }}>{err}</div>
        ) : (
          <div className="rounded-2xl bg-white" style={{ border: '1px solid #ebebeb' }}>
            {rows.map(({ name, entry }, i) => (
              <div key={normKey(name)}
                className="flex items-center gap-3 px-4 py-3 flex-wrap"
                style={{ borderTop: i === 0 ? 'none' : '1px solid #f0ece8' }}>
                <div className="flex-1 min-w-[160px]">
                  <div className="text-sm font-semibold" style={{ color: '#1a1a1a' }}>{name}</div>
                  {entry && (
                    <div className="text-[10px]" style={{ color: '#aaa' }}>
                      {entry.source === 'seed' ? '✨ AI-mapped' : 'set by hand'}
                    </div>
                  )}
                </div>
                <span style={{ color: '#ccc' }}>→</span>
                <select
                  value={entry?.item_id || ''}
                  disabled={busy === normKey(name)}
                  onChange={e => e.target.value && save(name, e.target.value)}
                  className="text-sm rounded-lg px-2 py-2"
                  style={{
                    border: entry ? '1.5px solid #d1fae5' : `1.5px dashed ${ORANGE}`,
                    backgroundColor: entry ? '#f0fdf4' : '#fff5f0',
                    maxWidth: 280, minWidth: 200,
                  }}
                >
                  <option value="">{entry ? entry.item_name : '— pick a Books item —'}</option>
                  {data.books_items.map(it => (
                    <option key={it.item_id} value={it.item_id}>{it.name} (${it.rate || 0})</option>
                  ))}
                </select>
                {entry && (
                  <button onClick={() => remove(name)} disabled={busy === normKey(name)}
                    className="text-xs px-2 py-1" style={{ color: '#bbb' }} title="Remove mapping">✕</button>
                )}
              </div>
            ))}

            {/* Add custom sensor name */}
            <div className="flex items-center gap-2 px-4 py-3" style={{ borderTop: '1px solid #f0ece8', backgroundColor: '#fafaf9' }}>
              <input value={newName} onChange={e => setNewName(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && addRow()}
                placeholder="Add a sensor name Kinetic uses…"
                className="flex-1 text-sm px-3 py-2 rounded-lg"
                style={{ border: '1px solid #e0dbd6', backgroundColor: 'white' }} />
              <button onClick={addRow} className="text-xs font-bold rounded-lg px-3 py-2 text-white" style={{ backgroundColor: ORANGE }}>+ Add</button>
            </div>
          </div>
        )}
      </div>

      {toast && (
        <div className="fixed bottom-5 left-1/2 -translate-x-1/2 text-white text-xs font-semibold rounded-full px-4 py-2 z-50" style={{ backgroundColor: '#1a1a1a' }}>
          {toast}
        </div>
      )}
    </div>
  )
}
