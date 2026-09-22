// The Hired moment (Mark 2026-09-22: "anytime I click that Hired button I
// want two flows to pop up — one for us on the backside so we don't forget
// anything, and the front side where the new employee puts in all his
// information"). Left: our runway, owned + dated. Right: their portal,
// live. Opens from Recruiting → Hired and from Directory → Onboarding.
import { useEffect, useState } from 'react'
import { API_BASE, apiFetch, ORANGE } from '../books/shared'
import { Avatar } from './Directory.jsx'

const GREEN = '#15803d', RED = '#b91c1c', BLUE = '#1d4ed8', PURPLE = '#7e22ce'
const j = async (url, opts) => { const r = await apiFetch(`${API_BASE}${url}`, opts); const d = await r.json().catch(() => ({})); if (!r.ok) throw new Error(d.error || `HTTP ${r.status}`); return d }
const OWNER = { mark: ['Mark', '#b45309', '#fff7ed'], kat: ['Kat', PURPLE, '#faf5ff'], auto: ['auto', '#0e7490', '#f0fdfa'] }
const fmt = d => d ? new Date(d + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : ''
const inp = { border: '1px solid #e0dbd6', outline: 'none', backgroundColor: 'white' }

export default function OnboardingLaunch({ memberId, onClose, onOpenProfile }) {
  const [d, setD] = useState(null)
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState('')
  const [issue, setIssue] = useState(null)   // { index, serial }
  const [linkResult, setLinkResult] = useState('')
  const load = () => j(`/api/people/onboarding/${memberId}/launch`).then(setD).catch(e => setErr(e.message))
  useEffect(() => { load() }, [memberId]) // eslint-disable-line react-hooks/exhaustive-deps
  async function toggle(key) { setBusy(key); try { await j(`/api/people/checklist/${memberId}/toggle`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ key }) }); await load() } catch (e) { alert(e.message) } finally { setBusy('') } }
  async function sendLink(mode) { setBusy('link'); setLinkResult(''); try { const r = await j(`/api/people/onboarding/${memberId}/invite`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mode }) }); setLinkResult(`Text ${r.sms ? (r.sms.ok ? '✓' : '✗ ' + r.sms.error) : '— no phone'} · Email ${r.email ? (r.email.ok ? '✓' : '✗ ' + r.email.error) : '— no email'}`); await load() } catch (e) { alert(e.message) } finally { setBusy('') } }
  async function issueLine(index, issued, serial) { setBusy(`eq${index}`); try { await j(`/api/people/onboarding/${memberId}/equipment`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ index, issued, serial }) }); setIssue(null); await load() } catch (e) { alert(e.message) } finally { setBusy('') } }
  if (err) return <Shell onClose={onClose}><div className="text-sm" style={{ color: RED }}>{err}</div></Shell>
  if (!d) return <Shell onClose={onClose}><div className="text-sm py-10 text-center" style={{ color: '#888' }}>Loading…</div></Shell>
  const m = d.member, first = m.preferred_name || m.name.split(' ')[0]
  const ours = d.ours, oursDone = ours.filter(i => i.done).length
  const theirsDone = d.theirs.filter(t => t.done).length
  const daysTo = m.hire_date ? Math.round((new Date(m.hire_date + 'T12:00:00') - new Date(d.today + 'T12:00:00')) / 86400000) : null
  const grouped = ['auto', 'kat', 'mark'].map(o => [o, ours.filter(i => (i.owner || 'mark') === o)]).filter(([, l]) => l.length)
  const Item = ({ it }) => {
    const late = !it.done && it.due_date && it.due_date < d.today, today = !it.done && it.due_date === d.today
    const [oname, ocol, obg] = OWNER[it.owner || 'mark'] || OWNER.mark
    return (
      <label className="flex items-start gap-2.5 py-2" style={{ borderTop: '1px solid #f3f3f3', cursor: it.owner === 'auto' ? 'default' : 'pointer' }}>
        <input type="checkbox" checked={!!it.done} disabled={it.owner === 'auto' || busy === it.key} onChange={() => toggle(it.key)} className="mt-1" />
        <span className="flex-1 min-w-0">
          <span className="block text-sm" style={{ color: it.done ? '#999' : '#1a1a1a', textDecoration: it.done ? 'line-through' : 'none', fontWeight: it.done ? 400 : 600 }}>{it.label.split(' — ')[0]}</span>
          <span className="flex gap-1.5 flex-wrap mt-0.5 text-[11px]">
            <span className="rounded-full px-2 py-0.5 font-bold" style={{ backgroundColor: obg, color: ocol }}>{oname}</span>
            {it.due_date && <span className="rounded-full px-2 py-0.5 font-bold" style={late ? { backgroundColor: '#fef2f2', color: RED } : today ? { backgroundColor: '#fffbeb', color: '#b45309' } : { backgroundColor: '#f5f3f0', color: '#888' }}>{late ? `⚠ was due ${fmt(it.due_date)}` : today ? 'due today' : `by ${fmt(it.due_date)}`}</span>}
            {it.done && it.at && <span style={{ color: '#aaa' }}>✓ {String(it.at).slice(0, 10)}{it.by && it.by !== 'auto' ? ` · ${it.by}` : ''}</span>}
          </span>
        </span>
      </label>
    )
  }
  return (
    <Shell onClose={onClose}>
      <div className="flex items-center gap-3 mb-4">
        <Avatar m={m} size={56} />
        <div className="flex-1 min-w-0">
          <div className="text-[10px] uppercase tracking-wider font-semibold" style={{ color: ORANGE, fontFamily: 'IBM Plex Mono, monospace' }}>🚀 Onboarding launch</div>
          <div className="font-extrabold text-xl leading-tight" style={{ color: '#1a1a1a' }}>{m.name}</div>
          <div className="text-xs" style={{ color: '#666' }}>{m.title} · {m.employment === 'contractor' ? 'contractor' : 'W-2'} · {m.track}{m.hire_date ? ` · starts ${fmt(m.hire_date)}` : ' · no start date yet'}{daysTo != null ? (daysTo > 0 ? ` · in ${daysTo} day${daysTo === 1 ? '' : 's'}` : daysTo === 0 ? ' · TODAY' : ` · day ${-daysTo + 1}`) : ''}</div>
        </div>
        {onOpenProfile && <button onClick={() => onOpenProfile(m.id)} className="text-xs font-bold rounded-lg px-3 py-2" style={{ backgroundColor: '#f5f3f0', color: '#555' }}>Full profile</button>}
      </div>
      {!m.hire_date && <div className="text-xs mb-3 px-3 py-2 rounded-lg font-semibold" style={{ backgroundColor: '#fffbeb', color: '#92400e' }}>Set a start date on the profile — every due date on our side hangs off it.</div>}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* ── Our side ── */}
        <div className="rounded-2xl p-4" style={{ backgroundColor: '#fff7ed', border: '1.5px solid #fdba74' }}>
          <div className="flex items-center justify-between mb-1">
            <div className="text-xs font-bold uppercase tracking-wider" style={{ color: '#b45309', fontFamily: 'IBM Plex Mono, monospace' }}>Our runway</div>
            <div className="text-sm font-extrabold" style={{ color: '#b45309' }}>{oursDone}/{ours.length}</div>
          </div>
          <div className="h-1.5 rounded-full mb-2" style={{ backgroundColor: '#fed7aa' }}><div className="h-1.5 rounded-full" style={{ width: `${ours.length ? (oursDone / ours.length) * 100 : 0}%`, backgroundColor: '#b45309' }} /></div>
          {grouped.map(([o, list]) => (
            <div key={o} className="mb-2">
              <div className="text-[10px] uppercase tracking-wider font-bold mt-2" style={{ color: OWNER[o][1] }}>{o === 'auto' ? 'Ticks itself from their portal' : `${OWNER[o][0]} owns`}</div>
              {list.map(it => <Item key={it.key} it={it} />)}
            </div>
          ))}
          {d.equipment.length > 0 && (
            <div className="mt-3 rounded-xl p-3 bg-white" style={{ border: '1px solid #fed7aa' }}>
              <div className="text-[10px] uppercase tracking-wider font-bold mb-1" style={{ color: '#b45309' }}>🧰 Kit — tap to issue</div>
              {d.equipment.map((e, i) => (
                <div key={i} className="py-1.5" style={{ borderTop: '1px solid #f3f3f3' }}>
                  <div className="flex items-center gap-2">
                    <button onClick={() => e.issued ? issueLine(i, '', e.serial) : setIssue({ index: i, serial: e.serial || '' })} disabled={busy === `eq${i}`} className="text-xs font-bold rounded-full px-2.5 py-1 flex-shrink-0" style={e.issued ? { backgroundColor: '#dcfce7', color: GREEN } : { backgroundColor: 'white', color: ORANGE, border: `1px solid ${ORANGE}` }}>{e.issued ? `✓ ${fmt(e.issued)}` : 'Issue'}</button>
                    <span className="text-sm flex-1" style={{ color: '#1a1a1a' }}>{e.name}{e.serial ? <span className="text-xs" style={{ color: '#888' }}> · {e.serial}</span> : ''}</span>
                  </div>
                  {issue?.index === i && <div className="flex gap-2 mt-1.5"><input autoFocus value={issue.serial} onChange={ev => setIssue(x => ({ ...x, serial: ev.target.value }))} placeholder="Serial / plate (optional)" className="text-sm rounded-lg px-2 py-1.5 flex-1" style={inp} onKeyDown={ev => { if (ev.key === 'Enter') issueLine(i, d.today, issue.serial); if (ev.key === 'Escape') setIssue(null) }} /><button onClick={() => issueLine(i, d.today, issue.serial)} className="text-xs font-bold rounded-lg px-3 py-1.5 text-white" style={{ backgroundColor: GREEN }}>Issued today</button><button onClick={() => setIssue(null)} className="text-xs px-2" style={{ color: '#888' }}>×</button></div>}
                </div>
              ))}
            </div>
          )}
        </div>
        {/* ── Their side ── */}
        <div className="rounded-2xl p-4" style={{ backgroundColor: '#f0fdf4', border: '1.5px solid #86efac' }}>
          <div className="flex items-center justify-between mb-1">
            <div className="text-xs font-bold uppercase tracking-wider" style={{ color: GREEN, fontFamily: 'IBM Plex Mono, monospace' }}>{first}'s portal</div>
            <div className="text-sm font-extrabold" style={{ color: GREEN }}>{d.portal_pct}%</div>
          </div>
          <div className="h-1.5 rounded-full mb-2" style={{ backgroundColor: '#bbf7d0' }}><div className="h-1.5 rounded-full" style={{ width: `${d.portal_pct}%`, backgroundColor: GREEN }} /></div>
          {d.theirs.map(t => (
            <div key={t.key} className="flex items-center gap-2.5 py-2 text-sm" style={{ borderTop: '1px solid #dcfce7' }}>
              <span className="w-5 text-center font-bold" style={{ color: t.done ? GREEN : '#ccc' }}>{t.done ? '✓' : '○'}</span>
              <span style={{ color: t.done ? '#999' : '#1a1a1a', fontWeight: t.done ? 400 : 600 }}>{t.label}</span>
            </div>
          ))}
          <div className="mt-3 rounded-xl p-3 bg-white" style={{ border: '1px solid #bbf7d0' }}>
            <div className="text-[10px] uppercase tracking-wider font-bold mb-1" style={{ color: GREEN }}>Their link</div>
            <div className="text-xs mb-2" style={{ color: '#555' }}>{d.link.completed_at ? `✅ Finished ${String(d.link.completed_at).slice(0, 10)} — welcome text sent.` : d.link.invited_at ? `Sent ${String(d.link.invited_at).slice(0, 10)}. Nudges go to them on day 2 and 5.` : 'Not sent yet.'}{d.link.revoked_at ? ` Old links revoked ${String(d.link.revoked_at).slice(0, 10)}.` : ''}</div>
            <div className="text-xs mb-2" style={{ color: '#888' }}>📱 {m.phone || 'no phone'} · ✉️ {m.email || 'no email'}</div>
            <div className="flex gap-2 flex-wrap">
              <button onClick={() => sendLink('full')} disabled={busy === 'link'} className="text-xs font-bold rounded-lg px-3 py-2 text-white" style={{ backgroundColor: GREEN }}>{busy === 'link' ? 'Sending…' : d.link.invited_at ? '📨 Resend link' : '📨 Send their link'}</button>
            </div>
            {linkResult && <div className="text-[11px] mt-1.5" style={{ color: '#555' }}>{linkResult}</div>}
          </div>
          <div className="text-[11px] mt-2" style={{ color: '#166534' }}>Their login turns on by itself once training, the handbook and the paperwork are in. Crew gets a "say hi" in #dispatch when they hit 100%.</div>
        </div>
      </div>
    </Shell>
  )
}
function Shell({ children, onClose }) {
  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center" style={{ backgroundColor: 'rgba(0,0,0,.55)' }} onClick={onClose}>
      <div className="bg-white w-full sm:max-w-4xl rounded-t-2xl sm:rounded-2xl p-4 sm:p-5 max-h-[94vh] overflow-y-auto relative" onClick={e => e.stopPropagation()}>
        <button onClick={onClose} className="absolute top-3 right-4 text-2xl leading-none" style={{ color: '#888' }}>×</button>
        {children}
      </div>
    </div>
  )
}
