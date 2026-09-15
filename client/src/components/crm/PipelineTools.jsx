// Territory + cadence pieces for the CRM board (Mark 2026-09-15).
import { useEffect, useState } from 'react'
import { API_BASE, apiFetch } from '../../utils/api.js'
import { Eyebrow, Notice, Pill, PrimaryButton, SecondaryButton, Chip, ORANGE, GREEN, BLUE } from '../ui/ReviewKit.jsx'
import { ZONES, STAGES, STAGE_QUIET, IN_PLAY_STAGES, IN_PLAY_CAP, TEAM_MEMBERS } from '../crmConstants'

const inp = { border: '1px solid #e0dbd6', outline: 'none', backgroundColor: 'white', borderRadius: 8 }
const j = async (url, opts) => { const r = await apiFetch(`${API_BASE}${url}`, opts); const d = await r.json().catch(() => ({})); if (!r.ok) throw new Error(d.error || `HTTP ${r.status}`); return d }
export const zoneOf = s => (ZONES.find(z => z.id === s.region) ? s.region : '')
export const ownerOf = s => TEAM_MEMBERS.includes(s.assigned_to) ? s.assigned_to : (ZONES.find(z => z.id === zoneOf(s))?.owner || '')
export function lastTouch(s) {
  const d = []
  for (const a of Array.isArray(s.activities) ? s.activities : []) { const x = String(a?.date || a?.at || '').slice(0, 10); if (x) d.push(x) }
  for (const x of [s.last_contact, s.stage_changed_at, s.created_at]) { const y = String(x || '').slice(0, 10); if (y) d.push(y) }
  return d.sort().pop() || ''
}
/** Days past the stage's quiet time; > 0 means gone quiet. */
export function staleDays(s) {
  // Card-level clock only for shops being worked (Qualified→Proposal) and Dormant; Active shops are judged by invoices on the server.
  if (!IN_PLAY_STAGES.includes(s.pipeline_stage) && s.pipeline_stage !== 'dormant') return null
  const q = STAGE_QUIET[s.pipeline_stage]; if (q == null) return null
  const t = lastTouch(s); if (!t) return null
  return Math.floor((new Date(new Date().toDateString()) - new Date(t + 'T00:00:00')) / 86400000) - q
}
export const inPlayCount = (shops, owner) => shops.filter(s => ownerOf(s) === owner && IN_PLAY_STAGES.includes(s.pipeline_stage)).length

/** Owners' in-play counters + territory grid toggle + Monday list button. */
export function InPlayBar({ shops, isOwner, gridOpen, onToggleGrid, onMonday }) {
  return (
    <div className="flex items-center gap-2 flex-wrap mb-3">
      {TEAM_MEMBERS.map(o => { const n = inPlayCount(shops, o); return <span key={o} className="text-xs font-bold px-2.5 py-1 rounded-full" style={{ backgroundColor: n > IN_PLAY_CAP ? '#fee2e2' : '#f0fdf4', color: n > IN_PLAY_CAP ? '#b91c1c' : '#166534', border: `1px solid ${n > IN_PLAY_CAP ? '#fecaca' : '#bbf7d0'}` }}>{o} · {n}/{IN_PLAY_CAP} in play</span> })}
      <button onClick={onToggleGrid} className="text-xs font-bold px-2.5 py-1 rounded-full" style={{ backgroundColor: gridOpen ? '#1a1a1a' : 'white', color: gridOpen ? 'white' : '#555', border: '1px solid #e0dbd6' }}>🗺 Territory grid</button>
      {isOwner && <button onClick={onMonday} className="text-xs font-bold px-2.5 py-1 rounded-full" style={{ backgroundColor: 'white', color: BLUE, border: '1px solid #bfdbfe' }}>📋 Monday list</button>}
    </div>
  )
}

/** Zones down, stages across. Click a cell to filter the board. */
export function TerritoryGrid({ shops, onPick }) {
  const cols = STAGES.filter(s => !['lost', 'denied'].includes(s.id))
  const rows = [...ZONES, { id: '', label: 'No zone', owner: '', day: '' }]
  const live = shops.filter(s => !['lost', 'denied'].includes(s.pipeline_stage))
  return (
    <div className="rounded-xl overflow-x-auto mb-4" style={{ border: '1.5px solid #e8e4e0', backgroundColor: 'white' }}>
      <table className="text-xs" style={{ minWidth: 760, width: '100%' }}>
        <thead><tr style={{ backgroundColor: '#f8f6f4' }}><th className="text-left px-3 py-2">Zone</th>{cols.map(c => <th key={c.id} className="px-2 py-2 text-center" style={{ color: c.color }}>{c.emoji} {c.label}</th>)}<th className="px-2 py-2 text-center">Stale</th></tr></thead>
        <tbody>{rows.map(z => { const mine = live.filter(s => zoneOf(s) === z.id); const stale = mine.filter(s => (staleDays(s) || 0) > 0 && s.pipeline_stage !== 'target').length; return (
          <tr key={z.id || 'none'} style={{ borderTop: '1px solid #f1f5f9' }}>
            <td className="px-3 py-2"><b>{z.label}</b>{z.owner ? <span style={{ color: '#888' }}> · {z.owner} · {z.day}</span> : null}<span style={{ color: '#bbb' }}> · {mine.length}</span></td>
            {cols.map(c => { const n = mine.filter(s => s.pipeline_stage === c.id).length; return <td key={c.id} className="text-center px-2 py-1">{n ? <button onClick={() => onPick(z.id, c.id)} className="font-bold rounded-lg px-2 py-0.5" style={{ backgroundColor: c.bg, color: c.color }}>{n}</button> : <span style={{ color: '#ddd' }}>·</span>}</td> })}
            <td className="text-center px-2 py-1">{stale ? <span className="font-bold" style={{ color: '#b45309' }}>⏰ {stale}</span> : <span style={{ color: '#ddd' }}>·</span>}</td>
          </tr>) })}</tbody>
      </table>
    </div>
  )
}

/** First-time territory setup: preview → Mark confirms → zones + owners written. */
export function SetupBanner({ shops, isOwner, onApplied }) {
  const [preview, setPreview] = useState(null); const [busy, setBusy] = useState(false); const [err, setErr] = useState('')
  const unzoned = shops.filter(s => !zoneOf(s)).length
  if (!unzoned) return null
  async function load() { setBusy(true); setErr(''); try { setPreview(await j('/api/pipeline/setup/preview')) } catch (e) { setErr(e.message) } finally { setBusy(false) } }
  async function apply() { if (!confirm(`Write zones and owners on ${preview.changes} shops? Only the zone and owner fields change.`)) return; setBusy(true); try { const r = await j('/api/pipeline/setup/apply', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }); setPreview(null); onApplied(r.updated) } catch (e) { setErr(e.message) } finally { setBusy(false) } }
  return (
    <div className="rounded-xl p-3 mb-4" style={{ backgroundColor: '#eff6ff', border: '1.5px solid #bfdbfe' }}>
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div><div className="text-sm font-bold" style={{ color: BLUE }}>🗺 {unzoned} shop{unzoned === 1 ? '' : 's'} without a zone</div><div className="text-xs" style={{ color: '#555' }}>Zones come from the address (Bellingham → Olympia, six zones along I-5); each zone has an owner and a route day.</div></div>
        {!preview && <button onClick={load} disabled={busy} className="text-xs font-bold rounded-lg px-3 py-1.5 text-white" style={{ backgroundColor: BLUE }}>{busy ? '…' : 'Preview setup'}</button>}
      </div>
      {err && <Notice tone="red" className="mt-2">{err}</Notice>}
      {preview && (
        <div className="mt-2 text-xs space-y-1" style={{ color: '#333' }}>
          <div>{preview.changes} shops would get a zone or owner: {Object.entries(preview.counts).map(([k, v]) => `${ZONES.find(z => z.id === k)?.label || 'no zone'} ${v}`).join(' · ')}</div>
          {preview.unzoned.length > 0 && <div style={{ color: '#92400e' }}>Can't place from the address ({preview.unzoned.length}): {preview.unzoned.slice(0, 8).map(u => u.shop).join(', ')}{preview.unzoned.length > 8 ? '…' : ''} — set their zone on the shop card.</div>}
          <div className="flex gap-2 pt-1">{isOwner ? <button onClick={apply} disabled={busy} className="text-xs font-bold rounded-lg px-3 py-1.5 text-white" style={{ backgroundColor: GREEN }}>{busy ? 'Writing…' : `✅ Confirm · write ${preview.changes}`}</button> : <span style={{ color: '#92400e' }}>Only Mark can confirm.</span>}<button onClick={() => setPreview(null)} className="text-xs" style={{ color: '#888' }}>cancel</button></div>
        </div>
      )}
    </div>
  )
}

/** Moving into an in-play stage needs a next follow-up + what it is. */
export function NextActionModal({ shop, stage, onConfirm, onCancel }) {
  const d = new Date(); d.setDate(d.getDate() + (STAGE_QUIET[stage] ? Math.min(7, STAGE_QUIET[stage]) : 7))
  const [date, setDate] = useState(d.toISOString().slice(0, 10)); const [action, setAction] = useState(shop.next_action || '')
  const st = STAGES.find(s => s.id === stage)
  return (
    <div className="fixed inset-0 z-[90] flex items-end sm:items-center justify-center" style={{ backgroundColor: 'rgba(0,0,0,.55)' }} onMouseDown={e => { if (e.target === e.currentTarget) onCancel() }}>
      <div className="bg-white w-full sm:max-w-sm rounded-t-2xl sm:rounded-2xl p-5 space-y-3">
        <Eyebrow>{st?.emoji} {shop.shop_name} → {st?.label}</Eyebrow>
        <div className="text-sm" style={{ color: '#555' }}>Nothing sits above Target without a next move. When, and what?</div>
        <div><Eyebrow>Next follow-up</Eyebrow><input type="date" value={date} onChange={e => setDate(e.target.value)} className="w-full px-3 py-2 text-sm" style={inp} /></div>
        <div><Eyebrow>What you'll do</Eyebrow><input autoFocus value={action} onChange={e => setAction(e.target.value)} placeholder="e.g. Stop by with the discount sheet · call Dave about the Subaru" className="w-full px-3 py-2 text-sm" style={inp} onKeyDown={e => e.key === 'Enter' && date && onConfirm({ next_followup: date, next_action: action.trim() })} /></div>
        <div className="flex gap-2"><SecondaryButton onClick={onCancel}>Cancel</SecondaryButton><PrimaryButton tone="orange" onClick={() => onConfirm({ next_followup: date, next_action: action.trim() })} disabled={!date}>Move it</PrimaryButton></div>
      </div>
    </div>
  )
}

/** Monday list for an owner, with a send-to-Cliq button. */
export function MondayModal({ isOwner, onClose, onOpenShop }) {
  const [owner, setOwner] = useState('Mark'); const [d, setD] = useState(null); const [err, setErr] = useState(''); const [busy, setBusy] = useState(false)
  useEffect(() => { setD(null); j(`/api/pipeline/monday?owner=${owner}`).then(setD).catch(e => setErr(e.message)) }, [owner])
  const l = d?.list
  const Sec = ({ title, items, tone }) => items?.length ? <div><Eyebrow>{title} · {items.length}</Eyebrow>{items.slice(0, 12).map(i => <button key={i.id} onClick={() => onOpenShop(i.id)} className="block w-full text-left text-sm py-1" style={{ borderTop: '1px solid #f1f5f9' }}><b>{i.shop}</b> <span className="text-xs" style={{ color: '#888' }}>{i.stage_label} · {i.zone_label}{i.next_followup ? ` · ${i.next_followup}` : ''}{i.stale > 0 ? ` · ${i.stale}d past the clock` : ''}{i.fit != null && title.startsWith('Best') ? ` · fit ${i.fit}/10` : ''}</span>{i.next_action && <div className="text-xs" style={{ color: tone || '#555' }}>→ {i.next_action}</div>}</button>)}</div> : null
  return (
    <div className="fixed inset-0 z-[80] flex items-end sm:items-center justify-center" style={{ backgroundColor: 'rgba(0,0,0,.55)' }} onMouseDown={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="bg-white w-full sm:max-w-lg rounded-t-2xl sm:rounded-2xl overflow-hidden flex flex-col" style={{ maxHeight: '90vh' }}>
        <div className="px-5 py-3 flex items-center justify-between" style={{ borderBottom: '1px solid #ebebeb' }}><div><Eyebrow>📋 Monday list</Eyebrow><div className="flex gap-1 mt-1">{TEAM_MEMBERS.map(o => <Pill key={o} size="sm" on={owner === o} onClick={() => setOwner(o)}>{o}</Pill>)}</div></div><button onClick={onClose} className="text-2xl" style={{ color: '#888' }}>×</button></div>
        <div className="px-5 py-3 space-y-3 overflow-y-auto">
          {err && <Notice tone="red">{err}</Notice>}
          {!l && !err && <div className="text-sm" style={{ color: '#888' }}>Building…</div>}
          {l && <>
            <div className="text-xs" style={{ color: '#555' }}>In play <b style={{ color: l.in_play.length > l.in_play_cap ? '#b91c1c' : GREEN }}>{l.in_play.length}/{l.in_play_cap}</b> · route days: {l.zones.map(z => `${z.label} ${z.day} (${z.count})`).join(' · ')}</div>
            <Sec title="Overdue follow-ups" items={l.overdue} tone="#b91c1c" /><Sec title="Gone quiet" items={l.stale} tone="#b45309" /><Sec title="Due this week" items={l.due_this_week} /><Sec title="Best targets to qualify" items={l.targets_to_qualify} /><Sec title="Dormant, time for a call" items={l.dormant_due} />
            {!l.overdue.length && !l.stale.length && !l.due_this_week.length && <Notice tone="green">Clean week. Work the targets.</Notice>}
          </>}
        </div>
        {isOwner && <div className="px-5 py-3 flex gap-2" style={{ borderTop: '1px solid #ebebeb' }}><SecondaryButton onClick={onClose}>Close</SecondaryButton><PrimaryButton tone="blue" disabled={busy} onClick={async () => { setBusy(true); try { await j('/api/pipeline/monday/send', { method: 'POST' }); alert('Sent: Mark → your alerts chat, Jayden → Cliq DM') } catch (e) { setErr(e.message) } finally { setBusy(false) } }}>{busy ? 'Sending…' : '📨 Send both lists to Cliq'}</PrimaryButton></div>}
      </div>
    </div>
  )
}
