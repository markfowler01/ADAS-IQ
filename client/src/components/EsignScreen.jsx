// ✍️ Public signing page: /app/?esign=<id>&t=<token> (no login).
// Read the exact PDF, type your name, agree, sign with a finger. Phone-first.
import { useEffect, useRef, useState } from 'react'

const ORANGE = '#CD4419', GREEN = '#15803d', RED = '#b91c1c'
const API = '/server/adasiq-api/api/public/esign'
const params = new URLSearchParams(window.location.search)
const ID = params.get('esign') || '', T = params.get('t') || ''
const call = async (path, opts = {}) => { const r = await fetch(`${API}/${ID}${path}${path.includes('?') ? '&' : '?'}t=${encodeURIComponent(T)}`, opts); const d = await r.json().catch(() => ({})); if (!r.ok) throw new Error(d.error || `HTTP ${r.status}`); return d }
const pdfUrl = () => `${API}/${ID}/pdf?t=${encodeURIComponent(T)}`

function Pad({ onChange }) {
  const ref = useRef(null), drawing = useRef(false), last = useRef(null), inked = useRef(0)
  useEffect(() => {
    const c = ref.current, r = c.getBoundingClientRect(), dpr = window.devicePixelRatio || 1
    c.width = r.width * dpr; c.height = r.height * dpr
    const ctx = c.getContext('2d'); ctx.scale(dpr, dpr); ctx.lineWidth = 2.6; ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.strokeStyle = '#0b2a6f'
  }, [])
  const pos = e => { const r = ref.current.getBoundingClientRect(), p = e.touches ? e.touches[0] : e; return { x: p.clientX - r.left, y: p.clientY - r.top } }
  const down = e => { e.preventDefault(); drawing.current = true; last.current = pos(e) }
  const move = e => {
    if (!drawing.current) return; e.preventDefault()
    const p = pos(e), ctx = ref.current.getContext('2d')
    ctx.beginPath(); ctx.moveTo(last.current.x, last.current.y); ctx.lineTo(p.x, p.y); ctx.stroke()
    inked.current += Math.hypot(p.x - last.current.x, p.y - last.current.y); last.current = p
  }
  const up = () => { if (!drawing.current) return; drawing.current = false; onChange(inked.current > 40 ? ref.current.toDataURL('image/png') : '') }
  const clear = () => { const c = ref.current; c.getContext('2d').clearRect(0, 0, c.width, c.height); inked.current = 0; onChange('') }
  return (
    <div>
      <canvas ref={ref} onMouseDown={down} onMouseMove={move} onMouseUp={up} onMouseLeave={up} onTouchStart={down} onTouchMove={move} onTouchEnd={up}
        className="w-full rounded-xl bg-white" style={{ height: 160, border: '2px dashed #c9c2bb', touchAction: 'none' }} />
      <div className="flex justify-between text-[11px] mt-1" style={{ color: '#888' }}><span>Sign with your finger</span><button type="button" onClick={clear} className="font-bold" style={{ color: ORANGE }}>Clear</button></div>
    </div>
  )
}

export default function EsignScreen() {
  const [d, setD] = useState(null)
  const [err, setErr] = useState('')
  const [name, setName] = useState('')
  const [agree, setAgree] = useState(false)
  const [png, setPng] = useState('')
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState(false)
  useEffect(() => { if (!ID || !T) setErr('This link is missing its key. Ask Mark to resend it.'); else call('').then(x => { setD(x); setName(x.signer || '') }).catch(e => setErr(e.message)) }, [])
  async function sign() {
    setBusy(true); setErr('')
    try {
      await call('/sign', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, consent: agree, png }) })
      setDone(true)
      call('/finish', { method: 'POST' }).catch(() => {})   // copies + next steps; hourly retry if this drops
    } catch (e) { setErr(e.message) } finally { setBusy(false) }
  }
  const shell = children => <div className="min-h-screen" style={{ backgroundColor: '#f5f3f0' }}><div className="max-w-md mx-auto px-4 py-5"><div className="text-[11px] uppercase tracking-widest mb-2" style={{ color: '#888', fontFamily: 'IBM Plex Mono, monospace' }}>Absolute ADAS · Sign</div>{children}</div></div>
  const card = (children, border = '#e8e4e0') => <div className="rounded-2xl p-4 mb-3 bg-white" style={{ border: `1.5px solid ${border}` }}>{children}</div>
  if (err && !d) return shell(card(<div className="text-sm" style={{ color: RED }}>{err}</div>, '#fecaca'))
  if (!d) return shell(<div className="text-sm py-10 text-center" style={{ color: '#888' }}>Loading…</div>)
  const first = (d.signer || '').split(' ')[0]
  if (done || d.status === 'completed') return shell(card(<>
    <div className="text-2xl mb-1">✅</div>
    <div className="font-extrabold text-lg" style={{ color: '#1a1a1a' }}>Signed. Thank you{first ? `, ${first}` : ''}!</div>
    <div className="text-sm mt-1" style={{ color: '#555' }}>A signed copy is on its way to your email.{d.kind === 'recruit_offer' ? ' Your onboarding link comes next.' : ''}</div>
    <a href={pdfUrl()} target="_blank" rel="noreferrer" className="inline-block mt-3 text-sm font-bold rounded-xl px-4 py-2 text-white" style={{ backgroundColor: GREEN }}>📄 View the signed copy</a>
  </>, '#86efac'))
  if (d.status !== 'sent') return shell(card(<div className="text-sm" style={{ color: RED }}>This document was withdrawn. Ask Mark for a new one.</div>, '#fecaca'))
  const ready = name.trim().length >= 3 && agree && png
  return shell(<>
    {card(<>
      <div className="font-extrabold text-lg leading-tight" style={{ color: '#1a1a1a' }}>{d.subject.replace(/ — Absolute ADAS$/, '')}</div>
      <div className="text-sm mt-1" style={{ color: '#555' }}>Hi {first}. Read the letter, then sign below.</div>
      <a href={pdfUrl()} target="_blank" rel="noreferrer" className="block text-center mt-3 text-base font-extrabold rounded-2xl py-3 text-white" style={{ backgroundColor: ORANGE }}>📄 Read the letter</a>
      <iframe title="Letter" src={pdfUrl()} className="w-full mt-3 rounded-lg hidden sm:block" style={{ height: 520, border: '1px solid #e8e4e0' }} />
    </>)}
    {card(<>
      <label className="block text-[11px] font-bold mb-1" style={{ color: '#888' }}>Your full name</label>
      <input value={name} onChange={e => setName(e.target.value)} autoComplete="name" className="w-full text-base rounded-lg px-3 py-2.5 mb-3" style={{ border: '1px solid #e0dbd6' }} />
      <Pad onChange={setPng} />
      <label className="flex gap-2 items-start text-sm mt-3" style={{ color: '#333' }}>
        <input type="checkbox" checked={agree} onChange={e => setAgree(e.target.checked)} className="mt-1" style={{ width: 18, height: 18 }} />
        <span>I agree to sign this document electronically, and that my electronic signature is the legal equivalent of my handwritten signature.</span>
      </label>
      {err && <div className="text-sm mt-2" style={{ color: RED }}>{err}</div>}
      <button type="button" disabled={!ready || busy} onClick={sign} className="w-full rounded-2xl py-3.5 mt-3 text-base font-extrabold text-white" style={{ backgroundColor: GREEN, opacity: ready && !busy ? 1 : 0.45 }}>{busy ? 'Signing…' : '✍️ Sign'}</button>
      <div className="text-[11px] mt-2" style={{ color: '#888' }}>We record the time, your device and IP address with your signature. You'll get a copy by email.</div>
    </>)}
  </>)
}
