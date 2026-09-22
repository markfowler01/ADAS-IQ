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
  const [setup, setSetup] = useState(null)      // editable copy of the plan facts
  const [kinTo, setKinTo] = useState('')
  async function saveSetup() { setBusy('setup'); try { await j(`/api/people/onboarding/${memberId}/setup`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(setup) }); setSetup(null); await load() } catch (e) { alert(e.message) } finally { setBusy('') } }
  async function kinetic() { setBusy('kinetic'); try { const r = await j(`/api/people/onboarding/${memberId}/kinetic-email`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ to: kinTo || undefined }) }); setLinkResult(`Kinetic request sent to ${r.to}`); await load() } catch (e) { alert(e.message) } finally { setBusy('') } }
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
          {it.key === 'kinetic' && !it.done && (
            <span className="flex gap-1.5 items-center mt-1.5 flex-wrap">
              {!d.kinetic_email && <input value={kinTo} onChange={e => setKinTo(e.target.value)} placeholder="Kinetic support email" className="text-xs rounded-lg px-2 py-1 w-52" style={inp} />}
              <button onClick={e => { e.preventDefault(); kinetic() }} disabled={busy === 'kinetic' || (!d.kinetic_email && !kinTo)} className="text-[11px] font-bold rounded-full px-2.5 py-1 text-white" style={{ backgroundColor: BLUE, opacity: busy === 'kinetic' ? .6 : 1 }}>{busy === 'kinetic' ? 'Sending…' : `📧 Email Kinetic${d.kinetic_email ? ` (${d.kinetic_email})` : ''}`}</button>
            </span>
          )}
          {it.key === 'zoho_account' && !it.done && <span className="block text-[11px] mt-1" style={{ color: '#666' }}>Zoho Admin → Users → Add: <b>{m.work_email}</b>. Then their Cliq + WorkDrive follow.</span>}
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
      {/* Setup — the facts that change the plan (Mark 2026-09-22) */}
      <div className="rounded-2xl p-3 mb-4" style={{ backgroundColor: '#f5f3f0', border: '1px solid #e0dbd6' }}>
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <div className="text-[10px] uppercase tracking-wider font-bold" style={{ color: '#555', fontFamily: 'IBM Plex Mono, monospace' }}>⚙️ Setup</div>
          {!setup && <button onClick={() => setSetup({ experience_level: m.experience_level, van: m.van, scan_tool: m.scan_tool, route_zone: m.route_zone, route_notes: m.route_notes, hire_date: m.hire_date, email: m.work_email })} className="text-xs font-bold rounded-full px-3 py-1" style={{ backgroundColor: 'white', color: ORANGE, border: `1px solid ${ORANGE}` }}>Edit</button>}
        </div>
        {!setup ? (
          <div className="flex gap-x-4 gap-y-1 flex-wrap text-xs mt-1" style={{ color: '#374151' }}>
            <span>🎓 <b>{m.experience_level === 'certified' ? 'Certified tech · ~1 week ride-along' : 'New to calibration · ~3 weeks ride-along'}</b></span>
            <span>✉️ {m.work_email}</span>
            {m.track !== 'ops' && <span>🚐 {m.van ? `Van ${m.van}` : <i style={{ color: RED }}>no van assigned</i>}{m.scan_tool ? ` · ${m.scan_tool}` : ''}</span>}
            {m.track !== 'ops' && <span>🗺 {m.route_zone ? `${m.region} zone` : <i style={{ color: RED }}>no territory</i>}{d.route?.service ? ` · ${d.route.service.length} service shop${d.route.service.length === 1 ? '' : 's'} · ${d.route.grow.length} to grow` : ''}{m.route_notes ? ` · ${m.route_notes.slice(0, 50)}${m.route_notes.length > 50 ? '…' : ''}` : ''}</span>}
            <span>👕 {m.shirt_size || <i style={{ color: '#999' }}>shirt ?</i>} · 👖 {m.pants_waist || m.pants_inseam ? `W${m.pants_waist || '?'}×L${m.pants_inseam || '?'}` : <i style={{ color: '#999' }}>pants ?</i>}</span>
          </div>
        ) : (
          <div className="mt-2">
            <div className="flex gap-2 flex-wrap mb-2">
              {[['green', '🌱 New to calibration — 3 weeks with Mark'], ['certified', '🎓 Certified tech — about a week']].map(([v, l]) => <button key={v} onClick={() => setSetup(x => ({ ...x, experience_level: v }))} className="text-xs font-bold rounded-full px-3 py-1.5" style={setup.experience_level === v ? { backgroundColor: '#1a1a1a', color: 'white' } : { backgroundColor: 'white', color: '#555', border: '1px solid #e0dbd6' }}>{l}</button>)}
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 mb-2">
              <label className="text-[11px] font-bold" style={{ color: '#888' }}>Start date<input type="date" value={setup.hire_date || ''} onChange={e => setSetup(x => ({ ...x, hire_date: e.target.value }))} className="w-full text-sm rounded-lg px-2 py-1.5 mt-0.5 font-normal" style={inp} /></label>
              <label className="text-[11px] font-bold sm:col-span-2" style={{ color: '#888' }}>Work email (Zoho user to create)<input value={setup.email || ''} onChange={e => setSetup(x => ({ ...x, email: e.target.value }))} className="w-full text-sm rounded-lg px-2 py-1.5 mt-0.5 font-normal" style={inp} /></label>
              {m.track !== 'ops' && <><label className="text-[11px] font-bold" style={{ color: '#888' }}>Van #<input value={setup.van || ''} onChange={e => setSetup(x => ({ ...x, van: e.target.value }))} placeholder="Van 2" className="w-full text-sm rounded-lg px-2 py-1.5 mt-0.5 font-normal" style={inp} /></label>
              <label className="text-[11px] font-bold" style={{ color: '#888' }}>Scan tool<input value={setup.scan_tool || ''} onChange={e => setSetup(x => ({ ...x, scan_tool: e.target.value }))} placeholder="Autel MA600 #…" className="w-full text-sm rounded-lg px-2 py-1.5 mt-0.5 font-normal" style={inp} /></label>
              <label className="text-[11px] font-bold" style={{ color: '#888' }}>Territory (CRM zone)<select value={setup.route_zone || ''} onChange={e => setSetup(x => ({ ...x, route_zone: e.target.value }))} className="w-full text-sm rounded-lg px-2 py-1.5 mt-0.5 font-normal" style={inp}><option value="">— pick —</option>{(d.zones || []).map(z => <option key={z.id} value={z.id}>{z.label} · {z.day}</option>)}</select></label></>}
            </div>
            {m.track !== 'ops' && <label className="block text-[11px] font-bold mb-2" style={{ color: '#888' }}>Route notes — anything beyond the zone's shops<textarea value={setup.route_notes || ''} onChange={e => setSetup(x => ({ ...x, route_notes: e.target.value }))} rows={2} placeholder="Service: Avon, B&H, L-M. Grow: Carstar Bellevue, Express Auto Body…" className="w-full text-sm rounded-lg px-2 py-1.5 mt-0.5 font-normal" style={inp} /></label>}
            <div className="flex gap-2"><button onClick={saveSetup} disabled={busy === 'setup'} className="text-xs font-bold rounded-lg px-3 py-2 text-white" style={{ backgroundColor: GREEN }}>{busy === 'setup' ? 'Saving…' : 'Save — re-dates the runway'}</button><button onClick={() => setSetup(null)} className="text-xs px-2" style={{ color: '#888' }}>cancel</button></div>
          </div>
        )}
        {d.route?.service && !setup && (
          <div className="text-[11px] mt-2" style={{ color: '#555' }}>
            <b>Service:</b> {d.route.service.join(', ') || 'none yet'}{d.route.grow.length ? <> · <b>Grow:</b> {d.route.grow.slice(0, 8).join(', ')}{d.route.grow.length > 8 ? ` +${d.route.grow.length - 8}` : ''}</> : null}
          </div>
        )}
      </div>
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
          {m.van_handover?.at && <div className="mt-3 rounded-xl p-3 bg-white text-xs" style={{ border: '1px solid #bbf7d0', color: '#374151' }}><div className="text-[10px] uppercase tracking-wider font-bold mb-1" style={{ color: GREEN }}>🚐 Van handover · {String(m.van_handover.at).slice(0, 10)}</div>{Number(m.van_handover.mileage).toLocaleString()} mi · tread {m.van_handover.tread?.lf}/{m.van_handover.tread?.rf}/{m.van_handover.tread?.lr}/{m.van_handover.tread?.rr} · {m.van_handover.photos} photos{m.van_handover.videos ? ` · ${m.van_handover.videos} video` : ''}{m.van_handover.damage ? <div className="mt-1">Damage: {m.van_handover.damage}</div> : null}{(m.van_handover.tools || []).some(t => !t.present) && <div className="mt-1 font-bold" style={{ color: RED }}>Missing: {m.van_handover.tools.filter(t => !t.present).map(t => t.name).join(', ')}</div>}</div>}
          <div className="mt-3 rounded-xl p-3 bg-white" style={{ border: '1px solid #bbf7d0' }}>
            <div className="text-[10px] uppercase tracking-wider font-bold mb-1" style={{ color: GREEN }}>Their link</div>
            <div className="text-xs mb-2" style={{ color: '#555' }}>{d.link.completed_at ? `✅ Finished ${String(d.link.completed_at).slice(0, 10)} — welcome text sent.` : d.link.invited_at ? `Sent ${String(d.link.invited_at).slice(0, 10)}. Nudges go to them on day 2 and 5.` : 'Not sent yet.'}{d.link.revoked_at ? ` Old links revoked ${String(d.link.revoked_at).slice(0, 10)}.` : ''}</div>
            <div className="text-xs mb-2" style={{ color: '#888' }}>📱 {m.phone || 'no phone'} · ✉️ {m.email || 'no email'}</div>
            <div className="flex gap-2 flex-wrap">
              <button onClick={() => sendLink('full')} disabled={busy === 'link'} className="text-xs font-bold rounded-lg px-3 py-2 text-white" style={{ backgroundColor: GREEN }}>{busy === 'link' ? 'Sending…' : d.link.invited_at ? '📨 Resend link' : '📨 Send their link'}</button>
            </div>
            {linkResult && <div className="text-[11px] mt-1.5" style={{ color: '#555' }}>{linkResult}</div>}
          </div>
          <div className="text-[11px] mt-2" style={{ color: '#166534' }}>Their app account is on from Hired — it works the moment Kat creates their Zoho user. Crew gets a "say hi" in #dispatch when they hit 100%.</div>
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
