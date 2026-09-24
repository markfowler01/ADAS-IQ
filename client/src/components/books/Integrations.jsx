// 🔗 Shop integrations (Mark 2026-09-23): Kinetic via CCC Secure Share and
// ADAS Maps, as two toggles on the CRM Billing tab. The on-site step is a
// phone walk-through anyone can follow at the shop's computer; the rest
// (email to Kinetic, invite to the shop, follow-ups, verification) is
// automatic. Pills on job cards say which links are live.
import { useEffect, useState } from 'react'
import { API_BASE, apiFetch } from '../../utils/api.js'
import { useBig3Map, invalidateBig3Map } from './Big3Rules.jsx'

const ORANGE = '#CD4419', GREEN = '#15803d', TEAL = '#0f766e'
const shopKeyOf = s => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '')
const STATE = {
  off:       { label: 'off',        bg: '#f5f3f0', fg: '#888',    dot: '○' },
  started:   { label: 'setting up', bg: '#fffbeb', fg: '#92400e', dot: '⏳' },
  pending:   { label: 'pending',    bg: '#fef3c7', fg: '#92400e', dot: '⏳' },
  connected: { label: 'connected',  bg: '#dcfce7', fg: GREEN,     dot: '🔗' },
}
const fmtDay = iso => iso ? new Date(iso).toLocaleDateString('en-US', { month: 'numeric', day: 'numeric' }) : ''

// "🔗 Kinetic · 🔗 ADAS Maps" on a job card — only what's connected.
export function IntegrationPills({ shopName, size = 'xs' }) {
  const map = useBig3Map()
  const ints = map[shopKeyOf(shopName)]?.integrations
  if (!ints) return null
  const cls = size === 'xs' ? 'text-[10px] px-1.5 py-0.5' : 'text-[11px] px-2 py-0.5'
  const on = [['kinetic', 'Kinetic'], ['adasmaps', 'ADAS Maps']].filter(([k]) => ints[k] === 'connected')
  if (!on.length) return null
  return <>{on.map(([k, l]) => <span key={k} className={`${cls} font-bold rounded inline-block`} style={{ backgroundColor: '#ccfbf1', color: TEAL }} title={`${l} connected — ${k === 'kinetic' ? 'their estimates flow to Kinetic; reports come back' : 'we get told when a car is ready'}`}>🔗 {l}</span>)}</>
}

function Walkthrough({ which, steps, images, onClose, onDone, doneLabel }) {
  const [i, setI] = useState(0)
  const [copied, setCopied] = useState('')
  const st = steps[i]; const last = i === steps.length - 1
  return (
    <div className="fixed inset-0 z-[70] flex items-end sm:items-center justify-center" style={{ backgroundColor: 'rgba(0,0,0,.55)' }} onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="bg-white w-full sm:max-w-md rounded-t-2xl sm:rounded-2xl overflow-hidden flex flex-col" style={{ maxHeight: '92vh' }}>
        <div className="px-4 py-3 flex items-center justify-between" style={{ borderBottom: '1px solid #f0ece8' }}>
          <div><div className="text-[10px] font-bold uppercase tracking-wider" style={{ color: ORANGE }}>{which === 'kinetic' ? 'Kinetic · CCC Secure Share' : 'ADAS Maps'} · step {i + 1} of {steps.length}</div><div className="font-extrabold text-base" style={{ color: '#1a1a1a' }}>{st.title}</div></div>
          <button onClick={onClose} className="text-2xl leading-none" style={{ color: '#888' }}>×</button>
        </div>
        <div className="p-4 overflow-y-auto space-y-3">
          {st.image && (images?.[st.image]
            ? <img src={images[st.image]} alt="" className="w-full rounded-xl" style={{ border: '1px solid #e8e4e0' }} />
            : <div className="rounded-xl flex items-center justify-center text-xs" style={{ height: 120, backgroundColor: '#faf9f7', border: '1.5px dashed #e0dbd6', color: '#aaa' }}>📷 screenshot coming — Mark shoots it at the next setup</div>)}
          <div className="text-base leading-snug" style={{ color: '#1a1a1a' }}>{st.text}</div>
          {/* A real anchor, not window.open — the iOS PWA rule (2026-06). */}
          {st.link && <a href={st.link.url} target="_blank" rel="noreferrer" className="block text-center rounded-xl py-2.5 text-sm font-bold text-white" style={{ backgroundColor: '#1d4ed8' }}>{st.link.label || 'Open'} ↗</a>}
          {Array.isArray(st.fields) && st.fields.length > 0 && (
            <div className="rounded-xl overflow-hidden" style={{ border: '1px solid #e8e4e0' }}>
              <div className="px-3 py-1.5 text-[11px] font-bold" style={{ backgroundColor: '#faf9f7', color: '#888' }}>Paste these into the form — tap a line to copy</div>
              {st.fields.map(([k, v], n) => (
                <button key={n} onClick={() => { try { navigator.clipboard?.writeText(String(v)); setCopied(k) } catch { /* no clipboard */ } }}
                  className="w-full flex items-center justify-between gap-2 px-3 py-2 text-left" style={{ borderTop: n ? '1px solid #f4f2f0' : 'none' }}>
                  <span className="text-[11px] shrink-0" style={{ color: '#888' }}>{k}</span>
                  <span className="text-sm font-semibold truncate" style={{ color: '#1a1a1a' }}>{v}</span>
                  <span className="text-[10px] font-bold shrink-0" style={{ color: copied === k ? GREEN : '#bbb' }}>{copied === k ? '✓ copied' : 'copy'}</span>
                </button>
              ))}
            </div>
          )}
          {st.whatIf && <div className="rounded-lg px-3 py-2 text-sm" style={{ backgroundColor: '#fffbeb', border: '1px solid #fde68a', color: '#92400e' }}><b>What if?</b> {st.whatIf}</div>}
        </div>
        <div className="p-3 flex gap-2" style={{ borderTop: '1px solid #f0ece8' }}>
          <button onClick={() => setI(x => Math.max(0, x - 1))} disabled={i === 0} className="rounded-xl px-4 py-3 text-sm font-bold" style={{ backgroundColor: '#f5f3f0', color: '#555', opacity: i === 0 ? .4 : 1 }}>‹ Back</button>
          {!last && <button onClick={() => setI(x => x + 1)} className="flex-1 rounded-xl py-3 text-base font-bold text-white" style={{ backgroundColor: ORANGE }}>Next ›</button>}
          {last && <button onClick={onDone} className="flex-1 rounded-xl py-3 text-base font-bold text-white" style={{ backgroundColor: GREEN }}>{doneLabel}</button>}
        </div>
      </div>
    </div>
  )
}

export default function IntegrationsPanel({ shop }) {
  const [d, setD] = useState(null)
  const [busy, setBusy] = useState('')
  const [walk, setWalk] = useState(null)   // 'kinetic' | 'adasmaps'
  const [msg, setMsg] = useState('')
  const load = () => shop?.id && apiFetch(`${API_BASE}/api/shops/${shop.id}/integrations`).then(r => r.json()).then(x => { if (x.ok) setD(x) }).catch(() => {})
  useEffect(() => { load() }, [shop?.id])
  async function act(which, action) {
    setBusy(`${which}:${action}`); setMsg('')
    try {
      const r = await apiFetch(`${API_BASE}/api/shops/${shop.id}/integrations/${which}/${action}`, { method: 'POST' })
      const x = await r.json(); if (!r.ok) throw new Error(x.error || `HTTP ${r.status}`)
      setD(p => ({ ...(p || {}), integrations: x.integrations }))
      invalidateBig3Map()
      if (action === 'step-done' || action === 'reemail') setMsg(x.emailed ? `✓ Turned on. Parisa emailed at ${x.to}. Connected when the first report lands.` : `⚠ Turned on, but the email to Kinetic failed: ${x.error}`)
      if (action === 'account-done') setMsg(`✓ Kinetic account made${x.account_email ? ` for ${x.account_email}` : ''} — they set their own password from Kinetic's email. Next: CCC Secure Share at their computer.`)
      if (action === 'invite') setMsg(`✓ Steps sent${x.texted ? ' by text' : ''}${x.emailed ? ' by email' : ''}${x.errors?.length ? ' · ⚠ ' + x.errors.join('; ') : ''}${!x.texted && !x.emailed ? ' — nothing went out: add the owner\'s phone or email to the card' : ''}`)
    } catch (e) { setMsg(`✗ ${e.message}`) } finally { setBusy('') }
  }
  if (!shop?.id) return null
  const ints = d?.integrations || { kinetic: { state: 'off' }, adasmaps: { state: 'off' } }
  const Row = ({ which, label, sub }) => {
    const it = ints[which] || { state: 'off' }; const S = STATE[it.state] || STATE.off
    const last = (it.history || []).slice(-1)[0]
    return (
      <div className="px-3 py-2.5" style={{ borderTop: '1px solid #f1f5f9' }}>
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <div className="min-w-0">
            <div className="flex items-center gap-2"><span className="text-sm font-semibold" style={{ color: '#1a1a1a' }}>{label}</span><span className="text-[11px] font-bold rounded-full px-2 py-0.5" style={{ backgroundColor: S.bg, color: S.fg }}>{S.dot} {S.label}{it.state === 'connected' && it.connected_at ? ` · ${fmtDay(it.connected_at)}` : it.state === 'pending' && (it.emailed_at || it.invited_at) ? ` · since ${fmtDay(it.emailed_at || it.invited_at)}` : ''}</span>{which === 'kinetic' && it.account_created_at && <span className="text-[11px] font-bold rounded-full px-2 py-0.5" style={{ backgroundColor: '#eff6ff', color: '#1d4ed8' }} title={it.account_email ? `Kinetic ID: ${it.account_email}` : ''}>🆕 account {fmtDay(it.account_created_at)}</span>}</div>
            <div className="text-[11px]" style={{ color: '#888' }}>{sub}{last ? ` · last: ${last.note} (${last.by || 'app'}, ${fmtDay(last.at)})` : ''}</div>
          </div>
          <div className="flex gap-1 flex-wrap">
            {which === 'kinetic' && it.state !== 'connected' && <button disabled={!!busy} onClick={() => setWalk('kinetic')} className="text-xs font-bold rounded-lg px-3 py-1.5 text-white" style={{ backgroundColor: ORANGE }}>📱 Walk-through</button>}
            {/* 🆕 Their own Kinetic ID account (Mark 2026-09-24): made first, they set the password from Kinetic's email. */}
            {which === 'kinetic' && it.state !== 'connected' && !it.account_created_at && <button disabled={!!busy} onClick={() => act('kinetic', 'account-done')} className="text-xs font-bold rounded-lg px-3 py-1.5" style={{ backgroundColor: 'white', color: '#1d4ed8', border: '1px solid #bfdbfe' }}>🆕 Account made</button>}
            {which === 'kinetic' && it.state === 'pending' && <button disabled={!!busy} onClick={() => act('kinetic', 'reemail')} className="text-xs font-bold rounded-lg px-3 py-1.5" style={{ backgroundColor: 'white', color: ORANGE, border: `1px solid ${ORANGE}` }}>✉️ Re-email Parisa</button>}
            {which === 'adasmaps' && it.state !== 'connected' && <button disabled={!!busy} onClick={() => setWalk('adasmaps')} className="text-xs font-bold rounded-lg px-3 py-1.5 text-white" style={{ backgroundColor: ORANGE }}>📱 Walk-through</button>}
            {which === 'adasmaps' && it.state !== 'connected' && <button disabled={!!busy} onClick={() => act('adasmaps', 'invite')} className="text-xs font-bold rounded-lg px-3 py-1.5" style={{ backgroundColor: 'white', color: ORANGE, border: `1px solid ${ORANGE}` }}>{it.state === 'pending' ? '↻ Resend the steps' : '📨 Send the shop the steps'}</button>}
            {it.state !== 'connected' && <button disabled={!!busy} onClick={() => act(which, 'connected')} className="text-xs font-bold rounded-lg px-3 py-1.5" style={{ backgroundColor: 'white', color: GREEN, border: '1px solid #86efac' }}>Mark connected</button>}
            {it.state !== 'off' && <button disabled={!!busy} onClick={() => { if (window.confirm(`Turn ${label} off for ${shop.shop_name}?`)) act(which, 'off') }} className="text-xs font-bold rounded-lg px-3 py-1.5" style={{ backgroundColor: 'white', color: '#888', border: '1px solid #e0dbd6' }}>Off</button>}
          </div>
        </div>
      </div>
    )
  }
  return (
    <div className="rounded-xl overflow-hidden mb-3" style={{ border: '1.5px solid #99f6e4', backgroundColor: 'white' }}>
      <div className="px-3 py-2 flex items-center justify-between" style={{ backgroundColor: '#f0fdfa' }}><span className="text-sm font-bold" style={{ color: TEAL }}>🔗 Integrations</span><span className="text-[11px]" style={{ color: '#0f766e' }}>estimates in, reports + "car is ready" out</span></div>
      <Row which="kinetic" label="Kinetic · CCC Secure Share" sub="Their CCC estimates flow to Kinetic; calibration reports come back to us. On-site: Configuration → Secure Share → Marketplace → Kinetic ON, then the app emails Kinetic." />
      <Row which="adasmaps" label="ADAS Maps" sub="Allstate + State Farm's platform. The shop adds Absolute ADAS under Vendors; we're told when a car is ready." />
      {msg && <div className="px-3 py-2 text-xs" style={{ borderTop: '1px solid #f1f5f9', color: msg.startsWith('✓') ? GREEN : '#92400e' }}>{msg}</div>}
      {walk && d?.steps && (
        <Walkthrough which={walk} steps={d.steps[walk]} images={d.images} onClose={() => setWalk(null)}
          doneLabel={walk === 'kinetic' ? '✅ Turned on at the shop' : '📨 Send the shop the steps'}
          onDone={async () => { setWalk(null); await act(walk, walk === 'kinetic' ? 'step-done' : 'invite') }} />
      )}
    </div>
  )
}
