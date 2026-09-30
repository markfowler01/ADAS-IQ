// 📥 CCC Secure Share settings (Mark 2026-09-30). Owner only. Where the webhook
// secret goes (Catalyst's env-var limit was full), plus the webhook address to
// paste into CCC and the last CCC estimates that came in. The secret is never
// shown again once saved — the screen only says "set" or "not set".
import { useEffect, useState } from 'react'
import { API_BASE, apiFetch } from '../utils/api.js'
import Navbar from '../components/Navbar'

const INK = '#1a1a1a', ORANGE = '#CD4419', GREEN = '#15803d'

export default function CccSettingsScreen({ user, onLogout, currentScreen, onNavigate }) {
  const [st, setSt] = useState(null)
  const [err, setErr] = useState('')
  const [val, setVal] = useState({ sandbox: '', production: '' })
  const [busy, setBusy] = useState('')
  const [msg, setMsg] = useState('')
  const [copied, setCopied] = useState(false)
  const load = () => apiFetch(`${API_BASE}/api/ccc-admin/status`).then(r => r.json()).then(d => d.error ? setErr(d.error) : setSt(d)).catch(e => setErr(e.message))
  useEffect(() => { load() }, [])
  const save = async env => {
    setBusy(env); setMsg('')
    try {
      const r = await apiFetch(`${API_BASE}/api/ccc-admin/secret`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ env, secret: val[env] }) })
      const d = await r.json(); if (!r.ok) throw new Error(d.error || `HTTP ${r.status}`)
      setVal(v => ({ ...v, [env]: '' })); setMsg(`✓ ${env === 'production' ? 'Production' : 'Sandbox'} secret saved.`); load()
    } catch (e) { setMsg(e.message) } finally { setBusy('') }
  }
  const copy = () => { try { navigator.clipboard?.writeText(st?.webhook || '') } catch {} setCopied(true); setTimeout(() => setCopied(false), 1500) }
  const box = { border: '1.5px solid #e8e4e0', borderRadius: 14, padding: 16, backgroundColor: '#fff' }
  return (
    <div className="min-h-screen" style={{ backgroundColor: '#fafaf9' }}>
      <Navbar user={user} onLogout={onLogout} currentScreen={currentScreen} onNavigate={onNavigate} />
      <div className="p-4 max-w-2xl mx-auto grid gap-3">
        <div>
          <h1 className="text-2xl font-bold" style={{ color: INK }}>📥 CCC Secure Share</h1>
          <p className="text-sm" style={{ color: '#777' }}>App {st?.appId || '1800'} · Absolute ADAS · Vehicle Diagnostics Reporting · Push</p>
        </div>
        {err && <div className="rounded-lg px-3 py-2 text-sm" style={{ backgroundColor: '#fef2f2', color: '#b91c1c' }}>{err}</div>}
        {st && (<>
          <div style={box}>
            <div className="text-sm font-bold mb-1" style={{ color: INK }}>1 · Webhook URL (paste into CCC → Environments)</div>
            <div className="flex gap-2 items-center">
              <code className="flex-1 text-xs rounded-lg px-2.5 py-2 break-all" style={{ backgroundColor: '#f5f3f0', color: INK }}>{st.webhook}</code>
              <button onClick={copy} className="rounded-lg px-3 py-2 text-sm font-bold text-white whitespace-nowrap" style={{ backgroundColor: copied ? GREEN : ORANGE }}>{copied ? '✓ Copied' : 'Copy'}</button>
            </div>
            <div className="text-xs mt-1.5" style={{ color: '#888' }}>Version v9. CCC adds /estimate itself.</div>
          </div>
          <div style={box}>
            <div className="text-sm font-bold mb-2" style={{ color: INK }}>2 · Secret keys (the same one you set in CCC with "Set secret key")</div>
            {['sandbox', 'production'].map(env => (
              <div key={env} className="mb-3">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-sm font-semibold" style={{ color: INK }}>{env === 'production' ? 'Production' : 'Sandbox'}</span>
                  <span className="text-xs font-bold px-2 py-0.5 rounded-full" style={st[env] ? { backgroundColor: '#dcfce7', color: GREEN } : { backgroundColor: '#fef3c7', color: '#92400e' }}>{st[env] ? '✓ set' : 'not set'}</span>
                </div>
                <div className="flex gap-2">
                  <input type="password" autoComplete="new-password" value={val[env]} onChange={e => setVal(v => ({ ...v, [env]: e.target.value }))} placeholder={st[env] ? 'Paste a new one to replace it' : 'Paste the secret key'}
                    className="flex-1 text-sm rounded-lg px-2.5 py-2" style={{ border: '1.5px solid #ddd', outline: 'none' }} />
                  <button onClick={() => save(env)} disabled={busy === env || val[env].trim().length < 16} className="rounded-lg px-3 py-2 text-sm font-bold text-white" style={{ backgroundColor: INK, opacity: val[env].trim().length < 16 ? .4 : 1 }}>{busy === env ? 'Saving…' : 'Save'}</button>
                </div>
              </div>
            ))}
            <div className="text-xs" style={{ color: '#888' }}>Saved on our server only. It's never shown again, here or anywhere. Use a different secret for production.</div>
            {msg && <div className="text-sm mt-2 font-semibold" style={{ color: msg.startsWith('✓') ? GREEN : '#b91c1c' }}>{msg}</div>}
          </div>
          <div style={box}>
            <div className="flex items-center justify-between mb-2"><span className="text-sm font-bold" style={{ color: INK }}>3 · Latest estimates from CCC</span><button onClick={load} className="text-xs font-bold" style={{ color: ORANGE }}>Refresh</button></div>
            {!st.recent?.length ? <div className="text-sm" style={{ color: '#888' }}>Nothing yet. Press "Test connection" in CCC, or send an estimate from CCC ONE.</div>
              : st.recent.map((r, i) => (
                <div key={i} className="flex items-center justify-between gap-2 py-1.5 text-xs" style={{ borderTop: i ? '1px solid #f0f0f0' : 'none' }}>
                  <span className="truncate" style={{ color: INK }}>{r.sj_name}</span>
                  <span className="whitespace-nowrap font-bold" style={{ color: r.sj_status === 'done' ? GREEN : r.sj_status === 'dead' ? '#b91c1c' : '#92400e' }}>{r.sj_status}{r.sj_ms ? ` · ${Math.round(r.sj_ms / 1000)}s` : ''}</span>
                </div>
              ))}
          </div>
        </>)}
      </div>
    </div>
  )
}
