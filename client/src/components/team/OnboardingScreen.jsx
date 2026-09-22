// New-hire onboarding portal (public, signed link: /app/?onboard=<id>&t=…).
// Phone-first. Steps: About you · Photo · ID & documents · Direct deposit ·
// Sign · Training · Ask. Everything saves as you go; files go to the
// person's own WorkDrive folder with clear names.
import { useEffect, useRef, useState } from 'react'

const ORANGE = '#CD4419', GREEN = '#15803d', BLUE = '#1d4ed8', RED = '#b91c1c'
const API = '/server/adasiq-api/api/public/onboard'
const params = new URLSearchParams(window.location.search)
const ID = params.get('onboard') || '', T = params.get('t') || ''
const call = async (path, opts = {}) => { const sep = path.includes('?') ? '&' : '?'; const r = await fetch(`${API}/${ID}${path}${sep}t=${encodeURIComponent(T)}`, opts); const d = await r.json().catch(() => ({})); if (!r.ok) throw new Error(d.error || `HTTP ${r.status}`); return d }
async function shrink(file, max = 1800) {
  try {
    if (!/^image\//.test(file.type) || file.size < 600 * 1024) return file
    let bmp; try { bmp = await createImageBitmap(file, { imageOrientation: 'from-image' }) } catch { bmp = await createImageBitmap(file) }
    const s = Math.min(1, max / Math.max(bmp.width, bmp.height)); const c = document.createElement('canvas'); c.width = Math.round(bmp.width * s); c.height = Math.round(bmp.height * s)
    c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height); bmp.close?.()
    const blob = await new Promise(r => c.toBlob(r, 'image/jpeg', 0.88)); if (!blob || blob.size >= file.size) return file
    return new File([blob], file.name.replace(/\.\w+$/, '') + '.jpg', { type: 'image/jpeg' })
  } catch { return file }
}
const STEPS_W2 = [['welcome', '👋 Welcome'], ['about', '1 · About you'], ['photo', '2 · Photo'], ['docs', '3 · ID & documents'], ['w4', '4 · W-4'], ['deposit', '5 · Direct deposit'], ['sign', '6 · Sign'], ['training', '7 · Training'], ['van', '8 · Your van'], ['ask', '9 · Ask']]
const STEPS_CONTRACTOR = [['welcome', '👋 Welcome'], ['about', '1 · About you'], ['photo', '2 · Photo'], ['docs', '3 · ID & documents'], ['deposit', '4 · Payout (Wise)'], ['sign', '5 · Sign'], ['training', '6 · Training'], ['van', '7 · Your van'], ['ask', '8 · Ask']]
// Existing staff catching up (Mark 2026-09-21): just the bits their file is missing.
const STEPS_CATCHUP = [['welcome', '👋 Welcome'], ['about', '1 · About you'], ['photo', '2 · Photo'], ['sign', '3 · Sign'], ['ask', '4 · Ask']]
const inp = { border: '1px solid #e0dbd6', outline: 'none', backgroundColor: 'white' }
const Btn = ({ children, onClick, disabled, tone = 'green', full = true }) => <button type="button" onClick={onClick} disabled={disabled} className={`${full ? 'w-full' : ''} rounded-2xl py-3.5 px-4 text-base font-extrabold text-white`} style={{ backgroundColor: tone === 'orange' ? ORANGE : tone === 'blue' ? BLUE : GREEN, opacity: disabled ? .5 : 1 }}>{children}</button>
const ytEmbed = u => { const m = String(u || '').match(/(?:youtu\.be\/|youtube\.com\/(?:watch\?v=|embed\/|shorts\/))([\w-]{6,})/); return m ? `https://www.youtube.com/embed/${m[1]}` : null }

export default function OnboardingScreen() {
  const [d, setD] = useState(null)
  const [err, setErr] = useState('')
  const [step, setStep] = useState('welcome')
  const [msg, setMsg] = useState('')
  const load = () => call('').then(x => { setD(x); if (!x.member.photo_url && x.member.emergency_contact?.name) setStep(s => s) }).catch(e => setErr(e.message))
  useEffect(() => { if (!ID || !T) setErr('This link is missing its key. Ask Mark to resend it.'); else load() }, [])
  if (err) return <Shell><div className="rounded-2xl p-5 bg-white text-sm" style={{ color: RED, border: `1.5px solid #fecaca` }}>{err}</div></Shell>
  if (!d) return <Shell><div className="text-sm py-10 text-center" style={{ color: '#888' }}>Loading your onboarding…</div></Shell>
  const m = d.member
  const has = kind => d.documents.some(x => x.kind === kind)
  const contractor = m.employment === 'contractor'
  const catchup = d.mode === 'catchup'
  const isTech = (m.track || 'tech') !== 'ops'
  const done = { about: !!(m.emergency_contact?.name && m.personal_phone), photo: !!m.photo_url, docs: contractor ? (has('passport') || has('dl_front')) : (has('dl_front') && has('ssn')), w4: has('w4'), deposit: !!(d.direct_deposit || d.payout), sign: !!d.signed?.handbook, training: d.course.modules.length > 0 && d.course.modules.every(x => x.progress?.passed), ask: true }
  const hasVan = isTech && !!m.van
  done.van = !!m.van_handover?.at
  const steps = (catchup ? STEPS_CATCHUP : contractor ? STEPS_CONTRACTOR : STEPS_W2).filter(([k]) => k !== 'van' || hasVan)
  const counted = steps.map(([k]) => k).filter(k => k !== 'ask' && k !== 'welcome')
  const pct = Math.round((counted.filter(k => done[k]).length / counted.length) * 100)
  const flash = t => { setMsg(t); setTimeout(() => setMsg(''), 3500) }
  return (
    <Shell>
      <div className="rounded-2xl p-4 mb-3 bg-white" style={{ border: '1.5px solid #e8e4e0' }}>
        <div className="flex items-center gap-3">
          {m.photo_url ? <img src={m.photo_url} alt="" className="w-14 h-14 rounded-full object-cover" /> : <div className="w-14 h-14 rounded-full flex items-center justify-center text-white font-bold" style={{ backgroundColor: ORANGE }}>{m.name.split(' ').map(s => s[0]).join('').slice(0, 2)}</div>}
          <div className="flex-1"><div className="font-extrabold text-lg leading-tight" style={{ color: '#1a1a1a' }}>Welcome, {m.preferred_name || m.name.split(' ')[0]}!</div><div className="text-xs" style={{ color: '#666' }}>{m.title}{m.hire_date ? ` · starts ${m.hire_date}` : ''}{m.boss ? ` · reports to ${m.boss.name}` : ''}</div></div>
          <div className="text-right"><div className="text-2xl font-extrabold" style={{ color: pct === 100 ? GREEN : ORANGE }}>{pct}%</div><div className="text-[10px]" style={{ color: '#888' }}>done</div></div>
        </div>
        <div className="h-2 rounded-full mt-3" style={{ backgroundColor: '#f1ede9' }}><div className="h-2 rounded-full" style={{ width: `${pct}%`, backgroundColor: pct === 100 ? GREEN : ORANGE, transition: 'width .3s' }} /></div>
      </div>
      <div className="flex gap-1.5 overflow-x-auto pb-2 mb-3" style={{ scrollbarWidth: 'none' }}>
        {steps.map(([k, label]) => <button key={k} onClick={() => setStep(k)} className="text-xs font-bold rounded-full px-3 py-1.5 flex-shrink-0" style={step === k ? { backgroundColor: '#1a1a1a', color: 'white' } : { backgroundColor: 'white', color: done[k] && k !== 'ask' ? GREEN : '#555', border: `1px solid ${done[k] && k !== 'ask' ? '#86efac' : '#e0dbd6'}` }}>{done[k] && k !== 'ask' ? '✓ ' : ''}{label}</button>)}
      </div>
      {msg && <div className="text-sm font-semibold mb-2 px-3 py-2 rounded-lg" style={{ backgroundColor: msg.startsWith('✓') ? '#dcfce7' : '#fef2f2', color: msg.startsWith('✓') ? GREEN : RED }}>{msg}</div>}
      {step === 'welcome' && <Welcome d={d} m={m} onNext={() => setStep('about')} />}
      {step === 'about' && <About m={m} isTech={isTech && !catchup} onSaved={() => { load(); flash('✓ Saved'); setStep('photo') }} />}
      {step === 'photo' && <Photo m={m} onDone={() => { load(); flash('✓ Photo saved to your folder'); setStep(catchup ? 'sign' : 'docs') }} />}
      {step === 'docs' && <Docs d={d} has={has} contractor={contractor} isTech={isTech} onDone={() => { load(); flash('✓ Uploaded to your folder') }} onNext={() => setStep(contractor ? 'deposit' : 'w4')} />}
      {step === 'w4' && <W4 has={has} onDone={() => { load(); flash('✓ W-4 filed in your folder') }} onNext={() => setStep('deposit')} />}
      {step === 'deposit' && (contractor ? <Payout d={d} m={m} onDone={() => { load(); flash('✓ Payout details on file'); setStep('sign') }} /> : <Deposit d={d} m={m} onDone={() => { load(); flash('✓ Direct deposit on file'); setStep('sign') }} />)}
      {step === 'sign' && <Sign d={d} m={m} onDone={() => { load(); flash('✓ Signed and filed'); setStep('training') }} />}
      {step === 'training' && <Training d={d} onDone={load} />}
      {step === 'van' && <Van d={d} m={m} onDone={() => { load(); flash('✓ Van handover signed and filed') }} />}
      {step === 'ask' && <Ask m={m} />}
      <div className="text-[11px] mt-6 text-center" style={{ color: '#999' }}>Your files go to a private folder only Mark and Kat can open. The app keeps none of your bank or Social Security numbers.</div>
    </Shell>
  )
}
function Shell({ children }) { return <div className="min-h-screen" style={{ backgroundColor: '#f5f3f0' }}><div className="max-w-md mx-auto px-4 py-5"><div className="text-[11px] uppercase tracking-widest mb-2" style={{ color: '#888', fontFamily: 'IBM Plex Mono, monospace' }}>Absolute ADAS · Onboarding</div>{children}</div></div> }
function Card({ title, sub, children }) { return <div className="rounded-2xl p-4 mb-3 bg-white" style={{ border: '1.5px solid #e8e4e0' }}><div className="font-extrabold text-base" style={{ color: '#1a1a1a' }}>{title}</div>{sub && <div className="text-xs mb-3" style={{ color: '#666' }}>{sub}</div>}{children}</div> }
const L = ({ label, children }) => <label className="block text-[11px] font-bold mb-2" style={{ color: '#888' }}>{label}<div className="mt-0.5 font-normal">{children}</div></label>
const I = ({ v, set, ...p }) => <input value={v || ''} onChange={e => set(e.target.value)} className="w-full text-sm rounded-lg px-3 py-2.5" style={inp} {...p} />

// First thing they see (Mark 2026-09-22: "make the new employee feel wanted
// and pumped"): Mark on video, a note, the crew's faces, and day one — before
// a single form.
function Welcome({ d, m, onNext }) {
  const w = d.welcome || {}, crew = d.crew || [], first = m.preferred_name || m.name.split(' ')[0]
  const days = m.hire_date ? Math.round((new Date(m.hire_date + 'T12:00:00') - new Date(new Date().toDateString())) / 86400000) : null
  const yt = ytEmbed(w.video_url)
  const boss = crew.find(c => c.is_boss)
  return (
    <div>
      <div className="rounded-2xl p-5 mb-3 text-white" style={{ background: 'linear-gradient(135deg, #CD4419, #b45309)' }}>
        <div className="text-[11px] font-bold uppercase tracking-widest" style={{ opacity: .85 }}>Absolute ADAS</div>
        <div className="text-2xl font-extrabold leading-tight mt-1">Welcome to the crew, {first}.</div>
        {days != null && <div className="text-sm mt-2" style={{ opacity: .95 }}>{days > 0 ? `${days} day${days === 1 ? '' : 's'} until your first day — ${new Date(m.hire_date + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}.` : days === 0 ? "Today's the day." : 'You\'re in.'}</div>}
      </div>
      {yt ? <div className="rounded-2xl overflow-hidden mb-3" style={{ aspectRatio: '16/9', backgroundColor: '#000' }}><iframe src={yt} title="Welcome from Mark" className="w-full h-full" allow="accelerometer; autoplay; encrypted-media; gyroscope; picture-in-picture" allowFullScreen /></div>
        : w.video_url ? <a href={w.video_url} target="_blank" rel="noreferrer" className="block rounded-2xl p-4 mb-3 text-center font-bold" style={{ backgroundColor: '#1a1a1a', color: 'white' }}>▶ A word from Mark</a> : null}
      {w.note && <Card title="From Mark"><div className="text-sm whitespace-pre-wrap" style={{ color: '#374151' }}>{w.note}</div></Card>}
      <Card title="Your first day" sub={m.hire_date ? new Date(m.hire_date + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' }) : 'Mark will confirm the date'}>
        <div className="text-sm space-y-1.5" style={{ color: '#374151' }}>
          {w.first_day?.time && <div>🕗 <b>{w.first_day.time}</b></div>}
          {w.first_day?.where && <div>📍 {w.first_day.where}</div>}
          {boss && <div>👤 You're with <b>{boss.name}</b>{boss.phone ? <> — <a href={`tel:${boss.phone.replace(/[^\d+]/g, '')}`} className="font-bold" style={{ color: BLUE }}>{boss.phone}</a></> : null}</div>}
          {w.first_day?.bring && <div>🎒 Bring: {w.first_day.bring}</div>}
          <div className="text-xs pt-1" style={{ color: '#888' }}>You'll get a text the morning of with the same details.</div>
        </div>
      </Card>
      {crew.length > 0 && (
        <Card title="Meet the crew" sub="The people you'll be working with. Tap a number to call.">
          <div className="grid grid-cols-2 gap-2">
            {crew.map((c, i) => (
              <div key={i} className="rounded-xl p-2.5 flex items-center gap-2" style={{ backgroundColor: '#faf9f7', border: `1px solid ${c.is_boss ? ORANGE : '#eee'}` }}>
                {c.photo_url ? <img src={c.photo_url} alt="" className="w-10 h-10 rounded-full object-cover flex-shrink-0" /> : <div className="w-10 h-10 rounded-full flex items-center justify-center text-white text-sm font-bold flex-shrink-0" style={{ backgroundColor: c.color }}>{c.name.split(' ').map(x => x[0]).slice(0, 2).join('')}</div>}
                <div className="min-w-0"><div className="text-sm font-bold truncate" style={{ color: '#1a1a1a' }}>{c.name.split(' ')[0]}{c.is_boss ? ' ★' : ''}</div><div className="text-[11px] truncate" style={{ color: '#666' }}>{c.title}</div>{c.phone && <a href={`tel:${c.phone.replace(/[^\d+]/g, '')}`} className="text-[11px] font-bold" style={{ color: BLUE }}>📞 call</a>}</div>
              </div>
            ))}
          </div>
        </Card>
      )}
      {d.company?.who_to_call?.length > 0 && <Card title="Who to call for what"><div className="text-sm space-y-1" style={{ color: '#374151' }}>{d.company.who_to_call.slice(0, 6).map((x, i) => <div key={i}><b>{x.need}:</b> {x.person}{x.note ? <span style={{ color: '#888' }}> · {x.note}</span> : ''}</div>)}</div></Card>}
      <Btn onClick={onNext}>Let's get you set up → (about 20 minutes)</Btn>
    </div>
  )
}
// Van handover (Mark 2026-09-22): "inventory their tools in their van 100%
// with photos and video and have them sign off on it… note the mileage…
// tire tread depth, maintenance, exterior damage."
function Van({ d, m, onDone }) {
  const done = m.van_handover
  const docs = d.documents || []
  const photos = docs.filter(x => x.kind === 'van_photo').length, videos = docs.filter(x => x.kind === 'van_video').length
  const [f, setF] = useState({ mileage: '', fuel: '', tread: { lf: '', rf: '', lr: '', rr: '' }, damage: '', maintenance: '', tools: (m.equipment || []).map(e => ({ name: e.name, present: true, note: '' })), signature: '' })
  const [busy, setBusy] = useState(false)
  async function sign() { setBusy(true); try { await call('/van-handover', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(f) }); onDone() } catch (e) { alert(e.message) } finally { setBusy(false) } }
  if (done) return (
    <Card title={`✅ ${m.van} is yours`} sub={`Signed ${String(done.at).slice(0, 10)} · ${Number(done.mileage).toLocaleString()} mi · tread ${done.tread?.lf}/${done.tread?.rf}/${done.tread?.lr}/${done.tread?.rr} · ${done.photos} photos${done.videos ? ` · ${done.videos} video` : ''}`}>
      <div className="text-sm" style={{ color: '#374151' }}>The signed handover is in your folder. Find damage or a missing tool later? Tell Mark that day.</div>
    </Card>
  )
  const T = ({ k, label }) => <label className="text-[11px] font-bold" style={{ color: '#888' }}>{label}<input value={f.tread[k]} onChange={e => setF(x => ({ ...x, tread: { ...x.tread, [k]: e.target.value } }))} inputMode="decimal" placeholder="/32" className="w-full text-sm rounded-lg px-2 py-2 mt-0.5 font-normal text-center" style={inp} /></label>
  return (
    <div>
      <Card title={`Your van: ${m.van}`} sub={`${m.scan_tool ? `Scan tool: ${m.scan_tool}. ` : ''}Walk it once, honestly. What you sign for is what you're responsible for — and what you note now can't be pinned on you later.`}>
        <div className="text-xs font-bold mb-1" style={{ color: '#1a1a1a' }}>1 · Photos & video</div>
        <div className="text-[11px] mb-2" style={{ color: '#666' }}>Four corners of the van, the dash with the odometer, the cargo area, then the tools laid out. A short walk-around clip (under a minute) is worth a lot.</div>
        <Upload kind="van_photo" label={`Van photo${photos ? ` (${photos} so far)` : ''}`} hint="Add as many as it takes — 4 minimum." has={photos > 0} onDone={onDone} capture="environment" />
        <Upload kind="van_video" label={`Walk-around video${videos ? ` (${videos})` : ''}`} hint="Under a minute. Talk through what you see." has={videos > 0} onDone={onDone} accept="video/*" capture="environment" tone="blue" />
        <div className="text-xs font-bold mt-4 mb-1" style={{ color: '#1a1a1a' }}>2 · Numbers</div>
        <div className="grid grid-cols-2 gap-2 mb-2">
          <L label="Odometer (miles)"><I v={f.mileage} set={v => setF(x => ({ ...x, mileage: v }))} inputMode="numeric" placeholder="e.g. 48210" /></L>
          <L label="Fuel"><I v={f.fuel} set={v => setF(x => ({ ...x, fuel: v }))} placeholder="3/4, full…" /></L>
        </div>
        <div className="text-[11px] font-bold mb-1" style={{ color: '#888' }}>Tread depth in 32nds — use the gauge in the van (new is ~10–12, replace at 4)</div>
        <div className="grid grid-cols-4 gap-2 mb-3"><T k="lf" label="LF" /><T k="rf" label="RF" /><T k="lr" label="LR" /><T k="rr" label="RR" /></div>
        <div className="text-xs font-bold mb-1" style={{ color: '#1a1a1a' }}>3 · Condition</div>
        <L label="Exterior / interior damage — dents, scuffs, cracked glass, stains. Say where."><textarea value={f.damage} onChange={e => setF(x => ({ ...x, damage: e.target.value }))} rows={3} placeholder="None, or: scuff on rear bumper driver side, small chip in windshield lower right…" className="w-full text-sm rounded-lg px-3 py-2.5" style={inp} /></L>
        <L label="Maintenance — warning lights, next oil change sticker, brakes, wipers, anything due"><textarea value={f.maintenance} onChange={e => setF(x => ({ ...x, maintenance: e.target.value }))} rows={2} placeholder="Oil sticker says 51,000. No lights on." className="w-full text-sm rounded-lg px-3 py-2.5" style={inp} /></L>
        {f.tools.length > 0 && <>
          <div className="text-xs font-bold mt-2 mb-1" style={{ color: '#1a1a1a' }}>4 · Tools & equipment — uncheck anything that isn't there</div>
          {f.tools.map((t, i) => (
            <div key={i} className="flex items-center gap-2 py-1.5" style={{ borderBottom: '1px solid #f3f3f3' }}>
              <input type="checkbox" checked={t.present} onChange={e => setF(x => ({ ...x, tools: x.tools.map((y, n) => n === i ? { ...y, present: e.target.checked } : y) }))} />
              <span className="text-sm flex-1" style={{ color: t.present ? '#1a1a1a' : RED }}>{t.name}</span>
              <input value={t.note} onChange={e => setF(x => ({ ...x, tools: x.tools.map((y, n) => n === i ? { ...y, note: e.target.value } : y) }))} placeholder="serial / note" className="text-xs rounded-lg px-2 py-1 w-28" style={inp} />
            </div>
          ))}
        </>}
        <div className="text-xs font-bold mt-4 mb-1" style={{ color: '#1a1a1a' }}>5 · Sign for it</div>
        <div className="text-[11px] mb-2" style={{ color: '#666' }}>"I've inspected this van and its equipment, the inventory is complete and accurate, and I'm responsible for it while it's in my care."</div>
        <I v={f.signature} set={v => setF(x => ({ ...x, signature: v }))} placeholder={`Type your full name: ${m.name}`} />
        <div className="mt-3"><Btn onClick={sign} disabled={busy || photos < 4 || !f.mileage || !f.signature}>{busy ? 'Filing…' : photos < 4 ? `Add ${4 - photos} more photo${4 - photos === 1 ? '' : 's'} first` : 'Sign the handover →'}</Btn></div>
      </Card>
    </div>
  )
}
function About({ m, onSaved, isTech = false }) {
  const [f, setF] = useState({ preferred_name: m.preferred_name, personal_phone: m.personal_phone, personal_email: m.personal_email, address: m.address, birthday: m.birthday, shirt_size: m.shirt_size, license_expiry: m.license_expiry || '', license_number: '', ec: { ...m.emergency_contact } })
  const [busy, setBusy] = useState(false)
  async function save() { setBusy(true); try { await call('/profile', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...f, emergency_contact: f.ec }) }); onSaved() } catch (e) { alert(e.message) } finally { setBusy(false) } }
  return (
    <Card title="About you" sub="Takes a minute. Only Mark and Kat see this.">
      <L label="What you go by"><I v={f.preferred_name} set={v => setF(x => ({ ...x, preferred_name: v }))} placeholder="e.g. Jay" /></L>
      <L label="Your cell (for the schedule and texts)"><I v={f.personal_phone} set={v => setF(x => ({ ...x, personal_phone: v }))} type="tel" placeholder="(425) 555-0123" /></L>
      <L label="Personal email"><I v={f.personal_email} set={v => setF(x => ({ ...x, personal_email: v }))} type="email" /></L>
      <L label="Home address"><I v={f.address} set={v => setF(x => ({ ...x, address: v }))} placeholder="Street, City, WA ZIP" /></L>
      <div className="grid grid-cols-2 gap-2"><L label="Birthday (MM-DD)"><I v={f.birthday} set={v => setF(x => ({ ...x, birthday: v }))} placeholder="07-04" /></L><L label="Shirt size"><I v={f.shirt_size} set={v => setF(x => ({ ...x, shirt_size: v }))} placeholder="L" /></L></div>
      {isTech && <>
        <div className="text-xs font-bold mt-2 mb-1" style={{ color: '#1a1a1a' }}>Driver's license</div>
        <div className="text-[11px] mb-1" style={{ color: '#888' }}>You'll drive customers' cars on test drives, so we track the expiry. We keep only the last 4 of the number.</div>
        <div className="grid grid-cols-2 gap-2"><L label="Expires"><I v={f.license_expiry} set={v => setF(x => ({ ...x, license_expiry: v }))} type="date" /></L><L label="License number"><I v={f.license_number} set={v => setF(x => ({ ...x, license_number: v }))} placeholder="as printed" /></L></div>
      </>}
      <div className="text-xs font-bold mt-2 mb-1" style={{ color: '#1a1a1a' }}>Emergency contact</div>
      <L label="Name"><I v={f.ec.name} set={v => setF(x => ({ ...x, ec: { ...x.ec, name: v } }))} /></L>
      <div className="grid grid-cols-2 gap-2"><L label="Phone"><I v={f.ec.phone} set={v => setF(x => ({ ...x, ec: { ...x.ec, phone: v } }))} type="tel" /></L><L label="Relationship"><I v={f.ec.relationship} set={v => setF(x => ({ ...x, ec: { ...x.ec, relationship: v } }))} placeholder="spouse, parent…" /></L></div>
      <Btn onClick={save} disabled={busy || !f.personal_phone || !f.ec.name || !f.ec.phone}>{busy ? 'Saving…' : 'Save and continue →'}</Btn>
    </Card>
  )
}
function Upload({ kind, label, hint, has, onDone, accept = 'image/*', capture, tone = 'orange' }) {
  const ref = useRef(null); const [busy, setBusy] = useState(false)
  // Certs and "other" need a name first — a small inline form, not a
  // browser prompt (those look broken on iPhone).
  const [pending, setPending] = useState(null)   // the picked file waiting on details
  const [meta, setMeta] = useState({ label: '', issuer: '', expires: '' })
  async function send(f0, m = {}) {
    setBusy(true)
    try { const f = kind === 'van_video' ? f0 : await shrink(f0, kind === 'photo' ? 1000 : 2000); const fd = new FormData(); fd.append('file', f, f.name); fd.append('kind', kind); if (m.label) fd.append('label', m.label); if (m.issuer) fd.append('issuer', m.issuer); if (/^\d{4}-\d{2}-\d{2}$/.test(m.expires || '')) fd.append('expires', m.expires); await call('/upload', { method: 'POST', body: fd }); setPending(null); setMeta({ label: '', issuer: '', expires: '' }); onDone() } catch (err) { alert(err.message) } finally { setBusy(false) }
  }
  function onFile(e) {
    const f0 = e.target.files?.[0]; e.target.value = ''; if (!f0) return
    if (kind === 'cert' || kind === 'other') setPending(f0); else send(f0, kind === 'van_photo' ? { label: `#${(Date.now() % 100000)}` } : {})
  }
  return (
    <div className="py-2" style={{ borderBottom: '1px solid #f3f3f3' }}>
      <div className="flex items-center gap-3">
        <div className="flex-1"><div className="text-sm font-bold" style={{ color: '#1a1a1a' }}>{has ? '✅ ' : ''}{label}</div>{hint && <div className="text-[11px]" style={{ color: '#888' }}>{hint}</div>}</div>
        <input ref={ref} type="file" accept={accept} capture={capture} hidden onChange={onFile} />
        <button type="button" onClick={() => ref.current?.click()} disabled={busy} className="text-xs font-bold rounded-xl px-3 py-2 text-white flex-shrink-0" style={{ backgroundColor: has ? '#555' : tone === 'orange' ? ORANGE : BLUE, opacity: busy ? .6 : 1 }}>{busy ? '⏫ …' : has ? (kind === 'cert' || kind === 'other' ? '＋ Add' : 'Redo') : '📷 Snap'}</button>
      </div>
      {pending && (
        <div className="rounded-xl p-3 mt-2" style={{ backgroundColor: '#fff5f0', border: `1px solid ${ORANGE}` }}>
          <div className="text-xs font-bold mb-2" style={{ color: '#1a1a1a' }}>{kind === 'cert' ? 'What certification is this?' : 'What is this?'} <span className="font-normal" style={{ color: '#888' }}>· {pending.name}</span></div>
          <I v={meta.label} set={v => setMeta(x => ({ ...x, label: v }))} placeholder={kind === 'cert' ? 'e.g. I-CAR ADAS, Autel ADAS Level 2' : 'e.g. Forklift card, diploma'} />
          {kind === 'cert' && <div className="grid grid-cols-2 gap-2 mt-2"><I v={meta.issuer} set={v => setMeta(x => ({ ...x, issuer: v }))} placeholder="Issued by (optional)" /><I v={meta.expires} set={v => setMeta(x => ({ ...x, expires: v }))} type="date" /></div>}
          <div className="flex gap-2 mt-2">
            <button type="button" onClick={() => send(pending, meta)} disabled={busy || !meta.label.trim()} className="flex-1 rounded-xl py-2.5 text-sm font-bold text-white" style={{ backgroundColor: GREEN, opacity: busy || !meta.label.trim() ? .5 : 1 }}>{busy ? 'Uploading…' : 'Upload'}</button>
            <button type="button" onClick={() => setPending(null)} className="rounded-xl px-4 py-2.5 text-sm font-bold" style={{ backgroundColor: '#f5f3f0', color: '#555' }}>Cancel</button>
          </div>
        </div>
      )}
    </div>
  )
}
// F: W-4 for W-2 hires. The IRS form is filled on the phone (or printed),
// then photographed or saved as PDF into the folder as "11 Form W-4".
function W4({ has, onDone, onNext }) {
  return (
    <Card title="Form W-4" sub="Tells payroll how much federal tax to hold back. About 5 minutes.">
      <ol className="text-sm mb-3 space-y-1.5" style={{ color: '#374151' }}>
        <li>1. Open the IRS form: <a href="https://www.irs.gov/pub/irs-pdf/fw4.pdf" target="_blank" rel="noreferrer" className="font-bold underline" style={{ color: BLUE }}>irs.gov/pub/irs-pdf/fw4.pdf</a>. It fills in on your phone.</li>
        <li>2. Most people only do Step 1 (name, address, Social Security number, filing status) and Step 5 (sign and date). Steps 2–4 are optional.</li>
        <li>3. Save it as a PDF, or print and photograph every page, then add it here.</li>
      </ol>
      <Upload kind="w4" label="Form W-4 (signed)" hint="PDF or photos of each page." has={has('w4')} onDone={onDone} accept="image/*,.pdf" />
      <div className="mt-3"><Btn onClick={onNext} disabled={!has('w4')}>{has('w4') ? 'Continue →' : 'Add the W-4 to continue'}</Btn></div>
    </Card>
  )
}
function Photo({ m, onDone }) {
  return (
    <Card title="Your profile photo" sub="Shows on the team directory and org chart. Face the light, plain background, shoulders up.">
      {m.photo_url && <img src={m.photo_url} alt="" className="w-32 h-32 rounded-full object-cover mx-auto mb-3" />}
      <Upload kind="photo" label="Profile photo" has={!!m.photo_url} onDone={onDone} capture="user" />
    </Card>
  )
}
function Docs({ d, has, contractor, isTech = true, onDone, onNext }) {
  const mvr = isTech ? <Upload kind="mvr" label="Driving record (MVR)" hint="You drive customers' cars. Order yours at dol.wa.gov (about $13) and add the PDF or a photo — or Mark can pull it." has={has('mvr')} onDone={onDone} accept="image/*,.pdf" tone="blue" /> : null
  if (contractor) return (
    <Card title="ID & documents" sub="Photograph each one flat, all four corners in, no glare. They go straight into your personnel folder, clearly labeled.">
      <Upload kind="passport" label="Government ID or passport" hint="Photo page. Needed for the contract." has={has('passport')} onDone={onDone} capture="environment" />
      <Upload kind="dl_front" label="Driver's license (if you have one)" has={has('dl_front')} onDone={onDone} capture="environment" />
      {mvr}
      <Upload kind="cert" label="Certifications / diplomas" hint="Add as many as you have." has={has('cert')} onDone={onDone} accept="image/*,.pdf" tone="blue" />
      <Upload kind="other" label="Anything else Mark asked for" has={false} onDone={onDone} accept="image/*,.pdf" tone="blue" />
      <div className="mt-3"><Btn onClick={onNext} disabled={!(has('passport') || has('dl_front'))}>{has('passport') || has('dl_front') ? 'Continue →' : 'A government ID is needed'}</Btn></div>
    </Card>
  )
  return (
    <Card title="ID & documents" sub="Photograph each one flat, all four corners in, no glare. They go straight into your personnel folder, clearly labeled.">
      <Upload kind="dl_front" label="Driver's license — front" has={has('dl_front')} onDone={onDone} capture="environment" />
      <Upload kind="dl_back" label="Driver's license — back" has={has('dl_back')} onDone={onDone} capture="environment" />
      <Upload kind="ssn" label="Social Security card" hint="Needed for payroll and the I-9. Never stored in the app itself." has={has('ssn')} onDone={onDone} capture="environment" />
      <Upload kind="passport" label="Passport or other ID (optional)" has={has('passport')} onDone={onDone} capture="environment" />
      <Upload kind="voided_check" label="Voided check (optional)" hint="Or do direct deposit on the next step." has={has('voided_check')} onDone={onDone} capture="environment" />
      {mvr}
      <Upload kind="cert" label="Certifications (I-CAR, Autel, OEM…)" hint="Add as many as you have." has={has('cert')} onDone={onDone} accept="image/*,.pdf" tone="blue" />
      <Upload kind="other" label="Anything else Mark asked for" has={false} onDone={onDone} accept="image/*,.pdf" tone="blue" />
      <div className="mt-3"><Btn onClick={onNext} disabled={!(has('dl_front') && has('ssn'))}>{has('dl_front') && has('ssn') ? 'Continue →' : 'License front + Social Security card needed'}</Btn></div>
    </Card>
  )
}
function Deposit({ d, m, onDone }) {
  const [f, setF] = useState({ bank: '', routing: '', account: '', account2: '', type: 'checking', name_on_account: m.name, signature: '' })
  const [busy, setBusy] = useState(false)
  const digits = v => v.replace(/\D/g, '')
  if (d.direct_deposit) return <Card title="Direct deposit — on file ✅" sub={`${d.direct_deposit.bank} · ${d.direct_deposit.type} ending in ${d.direct_deposit.last4} · signed ${String(d.direct_deposit.at).slice(0, 10)}`}><div className="text-xs" style={{ color: '#666' }}>Need to change it? Tell Mark — a new authorization replaces this one.</div></Card>
  async function save() { setBusy(true); try { await call('/direct-deposit', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(f) }); onDone() } catch (e) { alert(e.message) } finally { setBusy(false) } }
  const ok = f.bank && digits(f.routing).length === 9 && digits(f.account).length >= 4 && digits(f.account) === digits(f.account2) && f.signature.trim().toLowerCase() === m.name.toLowerCase()
  return (
    <Card title="Direct deposit" sub="This has to be right — read the numbers off a check or your bank app. We check the routing number and make you type the account number twice.">
      <L label="Bank name"><I v={f.bank} set={v => setF(x => ({ ...x, bank: v }))} placeholder="e.g. BECU, Chase, WSECU" /></L>
      <L label="Routing number (9 digits)"><I v={f.routing} set={v => setF(x => ({ ...x, routing: digits(v).slice(0, 9) }))} inputMode="numeric" placeholder="325081403" /></L>
      <L label="Account number"><I v={f.account} set={v => setF(x => ({ ...x, account: digits(v).slice(0, 17) }))} inputMode="numeric" /></L>
      <L label="Account number again"><I v={f.account2} set={v => setF(x => ({ ...x, account2: digits(v).slice(0, 17) }))} inputMode="numeric" /></L>
      {f.account2 && f.account !== f.account2 && <div className="text-xs font-bold mb-2" style={{ color: RED }}>The two account numbers don't match.</div>}
      <div className="grid grid-cols-2 gap-2"><L label="Type"><select value={f.type} onChange={e => setF(x => ({ ...x, type: e.target.value }))} className="w-full text-sm rounded-lg px-3 py-2.5" style={inp}><option value="checking">Checking</option><option value="savings">Savings</option></select></L><L label="Name on account"><I v={f.name_on_account} set={v => setF(x => ({ ...x, name_on_account: v }))} /></L></div>
      <div className="rounded-lg p-3 mb-3 text-xs" style={{ backgroundColor: '#f8f6f4', color: '#555' }}>I authorize Absolute ADAS to deposit my pay to this account and to reverse a deposit made in error. This stays in effect until I change or cancel it in writing.</div>
      <L label={`Sign by typing your full name: ${m.name}`}><I v={f.signature} set={v => setF(x => ({ ...x, signature: v }))} placeholder={m.name} /></L>
      <Btn onClick={save} disabled={!ok || busy}>{busy ? 'Filing…' : '✍️ Sign and file direct deposit'}</Btn>
    </Card>
  )
}
function Payout({ d, m, onDone }) {
  const [f, setF] = useState({ email: '', email2: '', currency: 'USD', bank: '', account_ref: '', signature: '' })
  const [busy, setBusy] = useState(false)
  if (d.payout) return <Card title="Payout — on file ✅" sub={`Wise · ${d.payout.email} · ${d.payout.currency} · signed ${String(d.payout.at).slice(0, 10)}`}><div className="text-xs" style={{ color: '#666' }}>Need to change it? Tell Mark — a new authorization replaces this one.</div></Card>
  async function save() { setBusy(true); try { await call('/payout', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(f) }); onDone() } catch (e) { alert(e.message) } finally { setBusy(false) } }
  const ok = /@/.test(f.email) && f.email.trim().toLowerCase() === f.email2.trim().toLowerCase() && f.signature.trim().toLowerCase() === m.name.toLowerCase()
  return (
    <Card title="How you get paid (Wise)" sub="Contract payments go out through Wise. Enter the email on your Wise account — twice, so it's right.">
      <L label="Wise account email"><I v={f.email} set={v => setF(x => ({ ...x, email: v }))} type="email" /></L>
      <L label="Wise account email again"><I v={f.email2} set={v => setF(x => ({ ...x, email2: v }))} type="email" /></L>
      {f.email2 && f.email.trim().toLowerCase() !== f.email2.trim().toLowerCase() && <div className="text-xs font-bold mb-2" style={{ color: RED }}>The two emails don't match.</div>}
      <div className="grid grid-cols-2 gap-2"><L label="Currency"><select value={f.currency} onChange={e => setF(x => ({ ...x, currency: e.target.value }))} className="w-full text-sm rounded-lg px-3 py-2.5" style={inp}>{['USD', 'PHP', 'EUR', 'GBP', 'CAD', 'MXN', 'INR'].map(c => <option key={c}>{c}</option>)}</select></L><L label="Local bank (optional)"><I v={f.bank} set={v => setF(x => ({ ...x, bank: v }))} placeholder="e.g. BDO, BPI" /></L></div>
      <L label="Account reference (optional, last digits only)"><I v={f.account_ref} set={v => setF(x => ({ ...x, account_ref: v }))} placeholder="…1234" /></L>
      <div className="rounded-lg p-3 mb-3 text-xs" style={{ backgroundColor: '#f8f6f4', color: '#555' }}>I confirm these payout details are mine and authorize Absolute ADAS to send contract payments to this account.</div>
      <L label={`Sign by typing your full name: ${m.name}`}><I v={f.signature} set={v => setF(x => ({ ...x, signature: v }))} placeholder={m.name} /></L>
      <Btn onClick={save} disabled={!ok || busy}>{busy ? 'Filing…' : '✍️ Sign and file payout details'}</Btn>
    </Card>
  )
}
function Sign({ d, m, onDone }) {
  const [sig, setSig] = useState(''); const [busy, setBusy] = useState(''); const [hb, setHb] = useState(null)
  useEffect(() => { fetch('/server/adasiq-api/api/public/onboard/' + ID + '/handbook?t=' + encodeURIComponent(T)).then(r => r.json()).then(x => setHb(x.sections || null)).catch(() => {}) }, [])
  const hasContract = d.documents.some(x => x.kind === 'contract') || false
  async function sign(doc) { setBusy(doc); try { await call('/sign', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ doc, signature: sig }) }); onDone() } catch (e) { alert(e.message) } finally { setBusy('') } }
  const ok = sig.trim().toLowerCase() === m.name.toLowerCase()
  return (
    <Card title="Read and sign" sub="Two things to read, one signature. A signed PDF goes in your folder.">
      <details className="mb-3" open={!d.signed?.handbook}><summary className="text-sm font-bold cursor-pointer" style={{ color: ORANGE }}>📖 Absolute ADAS HR policies (holidays, sick leave, time off)</summary>
        <div className="mt-2 space-y-3">{(hb || []).map(s => <div key={s.title}><div className="text-sm font-bold" style={{ color: '#1a1a1a' }}>{s.title}</div><div className="text-xs whitespace-pre-wrap" style={{ color: '#444', lineHeight: 1.6 }}>{s.body}</div></div>)}{!hb && <div className="text-xs" style={{ color: '#888' }}>Loading…</div>}</div>
      </details>
      <div className="mb-3">
        <div className="text-sm font-bold" style={{ color: '#1a1a1a' }}>📕 Technician Training Handbook, Volume 1</div>
        <div className="text-xs mb-2" style={{ color: '#666' }}>{m.track === 'ops' ? 'Read it even in billing — it is what the techs work from.' : 'Read it start to finish. It is the how-to for everything you will do on a car.'}</div>
        <a href={d.tech_handbook_url || '/app/technician-handbook-v1.pdf'} target="_blank" rel="noreferrer" className="block text-center rounded-xl py-3 text-sm font-bold text-white" style={{ backgroundColor: BLUE }}>📖 Open the handbook (PDF)</a>
      </div>
      {d.signed?.handbook ? <div className="text-sm font-bold mb-3" style={{ color: GREEN }}>✅ Policies + handbook signed {String(d.signed.handbook.at).slice(0, 10)}</div> : (
        <><L label={`Sign by typing your full name: ${m.name}`}><I v={sig} set={setSig} placeholder={m.name} /></L><Btn onClick={() => sign('handbook')} disabled={!ok || !!busy}>{busy === 'handbook' ? 'Filing…' : '✍️ I have read the policies and the handbook — sign'}</Btn></>)}
      {d.signed?.contract ? <div className="text-sm font-bold mt-3" style={{ color: GREEN }}>✅ Contract / offer signed {String(d.signed.contract.at).slice(0, 10)}</div> : (
        <div className="mt-4 pt-3" style={{ borderTop: '1px solid #f3f3f3' }}><div className="text-sm font-bold" style={{ color: '#1a1a1a' }}>Contract / offer letter</div><div className="text-xs mb-2" style={{ color: '#666' }}>{hasContract ? 'Mark put your contract in your folder. Sign to confirm you received and agree to it.' : 'Mark hasn\'t added a contract to your folder yet — nothing to sign here for now.'}</div>{hasContract && <>{!ok && <L label={`Type your full name: ${m.name}`}><I v={sig} set={setSig} /></L>}<Btn tone="blue" onClick={() => sign('contract')} disabled={!ok || !!busy}>{busy === 'contract' ? 'Filing…' : '✍️ Sign contract acknowledgment'}</Btn></>}</div>)}
    </Card>
  )
}
function Training({ d, onDone }) {
  const [open, setOpen] = useState(null); const [ans, setAns] = useState({}); const [result, setResult] = useState(null); const [busy, setBusy] = useState(false)
  const mods = d.course.modules
  const passedCount = mods.filter(x => x.progress?.passed).length
  async function submit(mod) { setBusy(true); try { const r = await call(`/course/${mod.id}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ answers: ans }) }); setResult(r); onDone() } catch (e) { alert(e.message) } finally { setBusy(false) } }
  return (
    <Card title={`Training · ${passedCount}/${mods.length} passed`} sub={`Watch, read, answer. ${d.course.pass_pct}% to pass — retry as many times as you like.`}>
      {mods.map((mod, i) => {
        const isOpen = open === mod.id, yt = ytEmbed(mod.video_url)
        return (
          <div key={mod.id} className="rounded-xl mb-2 overflow-hidden" style={{ border: `1.5px solid ${mod.progress?.passed ? '#86efac' : '#e8e4e0'}` }}>
            <button onClick={() => { setOpen(isOpen ? null : mod.id); setAns({}); setResult(null) }} className="w-full text-left px-3 py-2.5 flex items-center gap-2" style={{ backgroundColor: mod.progress?.passed ? '#f0fdf4' : 'white' }}>
              <span className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold text-white flex-shrink-0" style={{ backgroundColor: mod.progress?.passed ? GREEN : ORANGE }}>{mod.progress?.passed ? '✓' : i + 1}</span>
              <span className="flex-1"><div className="text-sm font-bold" style={{ color: '#1a1a1a' }}>{mod.title}</div><div className="text-[11px]" style={{ color: '#888' }}>{mod.minutes} min{mod.video_url ? ' · video' : ''}{mod.progress ? ` · best ${mod.progress.best}%` : ''}</div></span>
              <span style={{ color: '#bbb' }}>{isOpen ? '▾' : '▸'}</span>
            </button>
            {isOpen && (
              <div className="px-3 pb-3">
                {yt ? <div className="rounded-lg overflow-hidden mb-2" style={{ aspectRatio: '16/9' }}><iframe src={yt} title={mod.title} className="w-full h-full" allow="accelerometer; autoplay; encrypted-media; gyroscope; picture-in-picture" allowFullScreen /></div>
                  : mod.video_url ? <a href={mod.video_url} target="_blank" rel="noreferrer" className="block text-center rounded-xl py-3 mb-2 text-sm font-bold text-white" style={{ backgroundColor: BLUE }}>▶ Watch the video</a> : null}
                <div className="text-sm whitespace-pre-wrap mb-3" style={{ color: '#333', lineHeight: 1.6 }}>{mod.reading}</div>
                {mod.quiz.map(q => (
                  <div key={q.id} className="mb-3">
                    <div className="text-sm font-bold mb-1" style={{ color: '#1a1a1a' }}>{q.q}</div>
                    {q.options.map((o, k) => { const chosen = ans[q.id] === k; const correct = result?.correct?.find(c => c.id === q.id)?.correct; const show = result != null
                      return <button key={k} type="button" onClick={() => !show && setAns(a => ({ ...a, [q.id]: k }))} className="w-full text-left text-sm rounded-lg px-3 py-2 mb-1" style={{ border: `1.5px solid ${show && correct === k ? '#86efac' : chosen ? ORANGE : '#e8e4e0'}`, backgroundColor: show && correct === k ? '#f0fdf4' : chosen ? '#fff5f0' : 'white', color: show && chosen && correct !== k ? RED : '#1a1a1a' }}>{chosen ? '● ' : '○ '}{o}</button> })}
                  </div>
                ))}
                {result ? <div className="text-sm font-bold mb-2" style={{ color: result.passed ? GREEN : RED }}>{result.passed ? `✅ Passed — ${result.score}%` : `${result.score}% — not yet. Re-read and try again.`}</div> : null}
                {result ? <Btn tone="blue" onClick={() => { setAns({}); setResult(null); if (result.passed) setOpen(mods[i + 1]?.id || null) }}>{result.passed ? (mods[i + 1] ? 'Next module →' : 'Done!') : 'Try again'}</Btn>
                  : <Btn onClick={() => submit(mod)} disabled={busy || mod.quiz.some(q => ans[q.id] == null)}>{busy ? 'Checking…' : 'Check my answers'}</Btn>}
              </div>
            )}
          </div>
        )
      })}
      {passedCount === mods.length && mods.length > 0 && <div className="rounded-xl p-3 text-center font-extrabold" style={{ backgroundColor: '#dcfce7', color: GREEN }}>🎉 Training complete. GET SOME!!!</div>}
      {d.ladder && (
        <div className="mt-4">
          <div className="font-extrabold text-base" style={{ color: '#1a1a1a' }}>Your skills ladder · {d.ladder.pct}%</div>
          <div className="text-xs mb-2" style={{ color: '#666' }}>Each rung is signed off by the tech you rode with. All rungs done = promotion.</div>
          {d.ladder.rungs.map(r => <div key={r.key} className="flex items-center justify-between gap-2 py-1.5 text-sm" style={{ borderBottom: '1px solid #f3f3f3' }}><span style={{ color: r.complete ? GREEN : '#1a1a1a' }}>{r.complete ? '✅ ' : ''}{r.label}</span><b className="tabular-nums" style={{ color: r.complete ? GREEN : ORANGE }}>{Math.min(r.done, r.need)}/{r.need}</b></div>)}
        </div>
      )}
    </Card>
  )
}
function Ask({ m }) {
  const [q, setQ] = useState(''); const [log, setLog] = useState([]); const [busy, setBusy] = useState(false)
  async function ask() { const question = q.trim(); if (!question) return; setQ(''); setLog(l => [...l, { who: 'you', text: question }]); setBusy(true); try { const r = await call('/ask', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ question }) }); setLog(l => [...l, { who: 'buddy', text: r.answer }]) } catch (e) { setLog(l => [...l, { who: 'buddy', text: `Couldn't answer: ${e.message}` }]) } finally { setBusy(false) } }
  return (
    <Card title="Ask anything" sub="Answers come from the handbook and training. If it's not in there, it'll tell you to ask Mark.">
      <div className="space-y-2 mb-3">{log.length === 0 && <div className="text-xs" style={{ color: '#888' }}>Try: "When do I get paid?" · "What if I forget to clock out?" · "Who do I call about the schedule?"</div>}{log.map((e, i) => <div key={i} className="text-sm rounded-xl px-3 py-2" style={e.who === 'you' ? { backgroundColor: '#fff5f0', color: '#1a1a1a', marginLeft: 24 } : { backgroundColor: '#f5f3f0', color: '#1a1a1a', marginRight: 24 }}>{e.who === 'buddy' ? '🤖 ' : ''}{e.text}</div>)}{busy && <div className="text-xs" style={{ color: '#888' }}>thinking…</div>}</div>
      <div className="flex gap-2"><input value={q} onChange={e => setQ(e.target.value)} onKeyDown={e => e.key === 'Enter' && ask()} placeholder="Type a question" className="flex-1 text-sm rounded-xl px-3 py-2.5" style={inp} /><button onClick={ask} disabled={busy} className="rounded-xl px-4 text-sm font-bold text-white" style={{ backgroundColor: ORANGE }}>Ask</button></div>
    </Card>
  )
}
