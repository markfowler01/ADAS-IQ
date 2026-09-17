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
const STEPS_W2 = [['about', '1 · About you'], ['photo', '2 · Photo'], ['docs', '3 · ID & documents'], ['deposit', '4 · Direct deposit'], ['sign', '5 · Sign'], ['training', '6 · Training'], ['ask', '7 · Ask']]
const STEPS_CONTRACTOR = [['about', '1 · About you'], ['photo', '2 · Photo'], ['docs', '3 · ID & documents'], ['deposit', '4 · Payout (Wise)'], ['sign', '5 · Sign'], ['training', '6 · Training'], ['ask', '7 · Ask']]
const inp = { border: '1px solid #e0dbd6', outline: 'none', backgroundColor: 'white' }
const Btn = ({ children, onClick, disabled, tone = 'green', full = true }) => <button type="button" onClick={onClick} disabled={disabled} className={`${full ? 'w-full' : ''} rounded-2xl py-3.5 px-4 text-base font-extrabold text-white`} style={{ backgroundColor: tone === 'orange' ? ORANGE : tone === 'blue' ? BLUE : GREEN, opacity: disabled ? .5 : 1 }}>{children}</button>
const ytEmbed = u => { const m = String(u || '').match(/(?:youtu\.be\/|youtube\.com\/(?:watch\?v=|embed\/|shorts\/))([\w-]{6,})/); return m ? `https://www.youtube.com/embed/${m[1]}` : null }

export default function OnboardingScreen() {
  const [d, setD] = useState(null)
  const [err, setErr] = useState('')
  const [step, setStep] = useState('about')
  const [msg, setMsg] = useState('')
  const load = () => call('').then(x => { setD(x); if (!x.member.photo_url && x.member.emergency_contact?.name) setStep(s => s) }).catch(e => setErr(e.message))
  useEffect(() => { if (!ID || !T) setErr('This link is missing its key. Ask Mark to resend it.'); else load() }, [])
  if (err) return <Shell><div className="rounded-2xl p-5 bg-white text-sm" style={{ color: RED, border: `1.5px solid #fecaca` }}>{err}</div></Shell>
  if (!d) return <Shell><div className="text-sm py-10 text-center" style={{ color: '#888' }}>Loading your onboarding…</div></Shell>
  const m = d.member
  const has = kind => d.documents.some(x => x.kind === kind)
  const contractor = m.employment === 'contractor'
  const done = { about: !!(m.emergency_contact?.name && m.personal_phone), photo: !!m.photo_url, docs: contractor ? (has('passport') || has('dl_front')) : (has('dl_front') && has('ssn')), deposit: !!(d.direct_deposit || d.payout), sign: !!d.signed?.handbook, training: d.course.modules.length > 0 && d.course.modules.every(x => x.progress?.passed), ask: true }
  const pct = Math.round((['about', 'photo', 'docs', 'deposit', 'sign', 'training'].filter(k => done[k]).length / 6) * 100)
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
        {(contractor ? STEPS_CONTRACTOR : STEPS_W2).map(([k, label]) => <button key={k} onClick={() => setStep(k)} className="text-xs font-bold rounded-full px-3 py-1.5 flex-shrink-0" style={step === k ? { backgroundColor: '#1a1a1a', color: 'white' } : { backgroundColor: 'white', color: done[k] && k !== 'ask' ? GREEN : '#555', border: `1px solid ${done[k] && k !== 'ask' ? '#86efac' : '#e0dbd6'}` }}>{done[k] && k !== 'ask' ? '✓ ' : ''}{label}</button>)}
      </div>
      {msg && <div className="text-sm font-semibold mb-2 px-3 py-2 rounded-lg" style={{ backgroundColor: msg.startsWith('✓') ? '#dcfce7' : '#fef2f2', color: msg.startsWith('✓') ? GREEN : RED }}>{msg}</div>}
      {step === 'about' && <About m={m} onSaved={() => { load(); flash('✓ Saved'); setStep('photo') }} />}
      {step === 'photo' && <Photo m={m} onDone={() => { load(); flash('✓ Photo saved to your folder'); setStep('docs') }} />}
      {step === 'docs' && <Docs d={d} has={has} contractor={contractor} onDone={() => { load(); flash('✓ Uploaded to your folder') }} onNext={() => setStep('deposit')} />}
      {step === 'deposit' && (contractor ? <Payout d={d} m={m} onDone={() => { load(); flash('✓ Payout details on file'); setStep('sign') }} /> : <Deposit d={d} m={m} onDone={() => { load(); flash('✓ Direct deposit on file'); setStep('sign') }} />)}
      {step === 'sign' && <Sign d={d} m={m} onDone={() => { load(); flash('✓ Signed and filed'); setStep('training') }} />}
      {step === 'training' && <Training d={d} onDone={load} />}
      {step === 'ask' && <Ask m={m} />}
      <div className="text-[11px] mt-6 text-center" style={{ color: '#999' }}>Your files go to a private folder only Mark and Kat can open. The app keeps none of your bank or Social Security numbers.</div>
    </Shell>
  )
}
function Shell({ children }) { return <div className="min-h-screen" style={{ backgroundColor: '#f5f3f0' }}><div className="max-w-md mx-auto px-4 py-5"><div className="text-[11px] uppercase tracking-widest mb-2" style={{ color: '#888', fontFamily: 'IBM Plex Mono, monospace' }}>Absolute ADAS · Onboarding</div>{children}</div></div> }
function Card({ title, sub, children }) { return <div className="rounded-2xl p-4 mb-3 bg-white" style={{ border: '1.5px solid #e8e4e0' }}><div className="font-extrabold text-base" style={{ color: '#1a1a1a' }}>{title}</div>{sub && <div className="text-xs mb-3" style={{ color: '#666' }}>{sub}</div>}{children}</div> }
const L = ({ label, children }) => <label className="block text-[11px] font-bold mb-2" style={{ color: '#888' }}>{label}<div className="mt-0.5 font-normal">{children}</div></label>
const I = ({ v, set, ...p }) => <input value={v || ''} onChange={e => set(e.target.value)} className="w-full text-sm rounded-lg px-3 py-2.5" style={inp} {...p} />

function About({ m, onSaved }) {
  const [f, setF] = useState({ preferred_name: m.preferred_name, personal_phone: m.personal_phone, personal_email: m.personal_email, address: m.address, birthday: m.birthday, shirt_size: m.shirt_size, ec: { ...m.emergency_contact } })
  const [busy, setBusy] = useState(false)
  async function save() { setBusy(true); try { await call('/profile', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...f, emergency_contact: f.ec }) }); onSaved() } catch (e) { alert(e.message) } finally { setBusy(false) } }
  return (
    <Card title="About you" sub="Takes a minute. Only Mark and Kat see this.">
      <L label="What you go by"><I v={f.preferred_name} set={v => setF(x => ({ ...x, preferred_name: v }))} placeholder="e.g. Jay" /></L>
      <L label="Your cell (for the schedule and texts)"><I v={f.personal_phone} set={v => setF(x => ({ ...x, personal_phone: v }))} type="tel" placeholder="(425) 555-0123" /></L>
      <L label="Personal email"><I v={f.personal_email} set={v => setF(x => ({ ...x, personal_email: v }))} type="email" /></L>
      <L label="Home address"><I v={f.address} set={v => setF(x => ({ ...x, address: v }))} placeholder="Street, City, WA ZIP" /></L>
      <div className="grid grid-cols-2 gap-2"><L label="Birthday (MM-DD)"><I v={f.birthday} set={v => setF(x => ({ ...x, birthday: v }))} placeholder="07-04" /></L><L label="Shirt size"><I v={f.shirt_size} set={v => setF(x => ({ ...x, shirt_size: v }))} placeholder="L" /></L></div>
      <div className="text-xs font-bold mt-2 mb-1" style={{ color: '#1a1a1a' }}>Emergency contact</div>
      <L label="Name"><I v={f.ec.name} set={v => setF(x => ({ ...x, ec: { ...x.ec, name: v } }))} /></L>
      <div className="grid grid-cols-2 gap-2"><L label="Phone"><I v={f.ec.phone} set={v => setF(x => ({ ...x, ec: { ...x.ec, phone: v } }))} type="tel" /></L><L label="Relationship"><I v={f.ec.relationship} set={v => setF(x => ({ ...x, ec: { ...x.ec, relationship: v } }))} placeholder="spouse, parent…" /></L></div>
      <Btn onClick={save} disabled={busy || !f.personal_phone || !f.ec.name || !f.ec.phone}>{busy ? 'Saving…' : 'Save and continue →'}</Btn>
    </Card>
  )
}
function Upload({ kind, label, hint, has, onDone, accept = 'image/*', capture, tone = 'orange' }) {
  const ref = useRef(null); const [busy, setBusy] = useState(false)
  async function onFile(e) {
    const f0 = e.target.files?.[0]; e.target.value = ''; if (!f0) return
    setBusy(true)
    try { const f = await shrink(f0, kind === 'photo' ? 1000 : 2000); const fd = new FormData(); fd.append('file', f, f.name); fd.append('kind', kind); const lbl = kind === 'cert' || kind === 'other' ? window.prompt('What is this?', '') : ''; if (lbl === null) return; if (lbl) fd.append('label', lbl); await call('/upload', { method: 'POST', body: fd }); onDone() } catch (err) { alert(err.message) } finally { setBusy(false) }
  }
  return (
    <div className="flex items-center gap-3 py-2" style={{ borderBottom: '1px solid #f3f3f3' }}>
      <div className="flex-1"><div className="text-sm font-bold" style={{ color: '#1a1a1a' }}>{has ? '✅ ' : ''}{label}</div>{hint && <div className="text-[11px]" style={{ color: '#888' }}>{hint}</div>}</div>
      <input ref={ref} type="file" accept={accept} capture={capture} hidden onChange={onFile} />
      <button type="button" onClick={() => ref.current?.click()} disabled={busy} className="text-xs font-bold rounded-xl px-3 py-2 text-white flex-shrink-0" style={{ backgroundColor: has ? '#555' : tone === 'orange' ? ORANGE : BLUE, opacity: busy ? .6 : 1 }}>{busy ? '⏫ …' : has ? 'Redo' : '📷 Snap'}</button>
    </div>
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
function Docs({ d, has, contractor, onDone, onNext }) {
  if (contractor) return (
    <Card title="ID & documents" sub="Photograph each one flat, all four corners in, no glare. They go straight into your personnel folder, clearly labeled.">
      <Upload kind="passport" label="Government ID or passport" hint="Photo page. Needed for the contract." has={has('passport')} onDone={onDone} capture="environment" />
      <Upload kind="dl_front" label="Driver's license (if you have one)" has={has('dl_front')} onDone={onDone} capture="environment" />
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
    <Card title="Read and sign" sub="The handbook is short. Read it, then sign by typing your full name. A signed PDF goes in your folder.">
      <details className="mb-3" open={!d.signed?.handbook}><summary className="text-sm font-bold cursor-pointer" style={{ color: ORANGE }}>📖 Absolute ADAS handbook & policies</summary>
        <div className="mt-2 space-y-3">{(hb || []).map(s => <div key={s.title}><div className="text-sm font-bold" style={{ color: '#1a1a1a' }}>{s.title}</div><div className="text-xs whitespace-pre-wrap" style={{ color: '#444', lineHeight: 1.6 }}>{s.body}</div></div>)}{!hb && <div className="text-xs" style={{ color: '#888' }}>Loading…</div>}</div>
      </details>
      {d.signed?.handbook ? <div className="text-sm font-bold mb-3" style={{ color: GREEN }}>✅ Handbook signed {String(d.signed.handbook.at).slice(0, 10)}</div> : (
        <><L label={`Sign by typing your full name: ${m.name}`}><I v={sig} set={setSig} placeholder={m.name} /></L><Btn onClick={() => sign('handbook')} disabled={!ok || !!busy}>{busy === 'handbook' ? 'Filing…' : '✍️ I have read the handbook — sign'}</Btn></>)}
      <div className="mt-4 pt-3" style={{ borderTop: '1px solid #f3f3f3' }}>
        <div className="text-sm font-bold" style={{ color: '#1a1a1a' }}>📕 Technician Training Handbook, Volume 1</div>
        <div className="text-xs mb-2" style={{ color: '#666' }}>{m.track === 'ops' ? 'Optional for billing & dispatch, but worth the read — it is what the techs work from.' : 'Read it start to finish. It is the how-to for everything you will do on a car.'}</div>
        <a href={d.tech_handbook_url || '/app/technician-handbook-v1.pdf'} target="_blank" rel="noreferrer" className="block text-center rounded-xl py-3 mb-2 text-sm font-bold text-white" style={{ backgroundColor: BLUE }}>📖 Open the handbook (PDF)</a>
        {d.signed?.tech_handbook ? <div className="text-sm font-bold" style={{ color: GREEN }}>✅ Technician handbook signed {String(d.signed.tech_handbook.at).slice(0, 10)}</div> : (
          <>{!ok && <L label={`Type your full name: ${m.name}`}><I v={sig} set={setSig} /></L>}<Btn onClick={() => sign('tech_handbook')} disabled={!ok || !!busy}>{busy === 'tech_handbook' ? 'Filing…' : '✍️ I have read the Technician Handbook — sign'}</Btn></>)}
      </div>
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
