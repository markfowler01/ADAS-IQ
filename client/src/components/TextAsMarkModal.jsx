// 💬 Text as Mark (2026-09-14) — queue a text that goes out from Mark's
// PERSONAL cell number. The app only records the request; the bridge on
// Mark's Mac delivers it through the Messages app within a minute (quiet
// hours 7am–8pm PT, daily cap). Owner only.
import { useEffect, useState } from 'react'
import { API_BASE, apiFetch } from '../utils/api.js'

const GREEN = '#15803d'
const ORANGE = '#CD4419'

export default function TextAsMarkModal({ to = '', toName = '', shopId = '', purpose = 'manual', onClose, onQueued }) {
  const [phone, setPhone] = useState(to)
  const [body, setBody] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [done, setDone] = useState(null)
  const [force, setForce] = useState(false)
  const [recent, setRecent] = useState(null)

  useEffect(() => {
    apiFetch(`${API_BASE}/api/personal-texts/recent`).then(r => r.json()).then(d => d.ok && setRecent(d)).catch(() => {})
  }, [])

  async function send() {
    setBusy(true); setErr('')
    try {
      const r = await apiFetch(`${API_BASE}/api/personal-texts`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ to: phone, to_name: toName, body, purpose, shop_id: shopId, force }) })
      const d = await r.json().catch(() => ({}))
      if (!r.ok) { setErr(d.error || `HTTP ${r.status}`); if (d.unknown) setForce(false); return }
      setDone(d); onQueued && onQueued(d)
    } catch (e) { setErr(e.message) } finally { setBusy(false) }
  }

  const mine = (recent?.texts || []).filter(t => t.to === phone).slice(0, 5)

  return (
    <div className="fixed inset-0 z-[80] flex items-end sm:items-center justify-center" style={{ backgroundColor: 'rgba(0,0,0,0.55)' }} onMouseDown={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="bg-white w-full sm:max-w-md rounded-t-2xl sm:rounded-2xl flex flex-col" style={{ maxHeight: '92vh' }}>
        <div className="flex items-center justify-between px-5 py-3" style={{ borderBottom: '1px solid #ebebeb' }}>
          <div>
            <div className="text-[10px] uppercase tracking-wider font-semibold" style={{ color: '#888', fontFamily: 'IBM Plex Mono, monospace' }}>💬 Text as Mark · from your cell</div>
            <div className="font-bold text-base" style={{ color: '#1a1a1a' }}>{toName || phone || 'New text'}</div>
          </div>
          <button onClick={onClose} className="text-2xl leading-none" style={{ color: '#888' }}>×</button>
        </div>
        <div className="px-5 py-4 space-y-3 overflow-y-auto">
          {done ? (
            <div className="rounded-xl p-4" style={{ backgroundColor: '#f0fdf4', border: '1.5px solid #86efac' }}>
              <div className="font-bold" style={{ color: GREEN }}>✅ Queued — sends {done.sends}.</div>
              <div className="text-xs mt-1" style={{ color: '#555' }}>{done.today} of {done.cap} personal texts today. It will show up in your own Messages thread with {toName || phone}.</div>
              <button onClick={onClose} className="mt-3 text-sm font-bold rounded-xl px-4 py-2 text-white" style={{ backgroundColor: GREEN }}>Done</button>
            </div>
          ) : (<>
            {err && <div className="text-sm px-3 py-2 rounded-lg" style={{ backgroundColor: '#fef2f2', color: '#b91c1c' }}>{err}{/known contact/.test(err) && <label className="flex items-center gap-2 mt-2 text-xs"><input type="checkbox" checked={force} onChange={e => setForce(e.target.checked)} /> Send anyway (I know this number)</label>}</div>}
            <div>
              <label className="block text-[11px] font-semibold uppercase tracking-wider mb-1" style={{ color: '#888' }}>To</label>
              <input value={phone} onChange={e => setPhone(e.target.value)} inputMode="tel" placeholder="+1 425 555 0100" className="w-full rounded-lg px-3 py-2 text-base" style={{ border: '1px solid #e0dbd6', outline: 'none', fontFamily: 'IBM Plex Mono, monospace' }} />
            </div>
            <div>
              <label className="block text-[11px] font-semibold uppercase tracking-wider mb-1" style={{ color: '#888' }}>Message</label>
              <textarea value={body} onChange={e => setBody(e.target.value)} rows={5} autoFocus placeholder="Write it the way you'd text it." className="w-full rounded-xl p-3 text-base" style={{ border: '1px solid #e0dbd6', outline: 'none', resize: 'vertical' }} />
              <div className="text-[11px] mt-1" style={{ color: '#888' }}>{body.length} chars · goes out from your number via the Mac, 7am–8pm PT{recent ? ` · ${recent.today}/${recent.cap} today` : ''}</div>
            </div>
            {mine.length > 0 && (
              <div className="rounded-xl overflow-hidden" style={{ border: '1px solid #ebe7e3' }}>
                <div className="px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wider" style={{ backgroundColor: '#f5f3f0', color: '#888' }}>Recent with this number</div>
                {mine.map(t => (
                  <div key={t.id} className="px-3 py-2 text-xs" style={{ borderTop: '1px solid #f1ede9' }}>
                    <span className="font-bold" style={{ color: t.direction === 'in' ? '#1d4ed8' : t.status === 'sent' ? GREEN : t.status === 'failed' ? '#b91c1c' : '#92400e' }}>{t.direction === 'in' ? '⬅ reply' : t.status}</span> · {String(t.created_at).slice(0, 16).replace('T', ' ')}<div style={{ color: '#1a1a1a' }}>{t.body}</div>{t.error && <div style={{ color: '#b91c1c' }}>{t.error}</div>}
                  </div>
                ))}
              </div>
            )}
          </>)}
        </div>
        {!done && (
          <div className="px-5 py-3 flex gap-2" style={{ borderTop: '1px solid #ebebeb' }}>
            <button onClick={onClose} className="flex-1 rounded-xl py-3 text-sm font-semibold" style={{ backgroundColor: '#f5f3f0', color: '#555' }}>Cancel</button>
            <button onClick={send} disabled={busy || !body.trim() || !phone.trim()} className="flex-[2] rounded-xl py-3 text-base font-bold text-white" style={{ backgroundColor: ORANGE, opacity: busy || !body.trim() || !phone.trim() ? .45 : 1 }}>{busy ? 'Queuing…' : '💬 Send from my number'}</button>
          </div>
        )}
      </div>
    </div>
  )
}
