// 📸 Scrub from photos (Mark 2026-10-24): on site, the shop hands the tech a
// printed CCC estimate (usually 2–3+ pages). Snap every page → the pages become
// one PDF on the server → the same scrubber as an uploaded PDF → the tech sees
// what's required → Request job / Request quote → Kat gets all of it directly.
import { useRef, useState } from 'react'
import { API_BASE, apiFetch } from '../utils/api.js'
import { normScrub, requestJobFor } from '../pages/ScrubLibraryScreen.jsx'

const ORANGE = '#CD4419', BLUE = '#1d4ed8', GREEN = '#15803d', INK = '#1a1a1a'

// Phone photos are 3–6 MB. Shrink to ~2000px JPEG (still sharp enough to read
// every line) so a 3-page estimate uploads in seconds on a shop's wifi.
async function shrink(file) {
  try {
    const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' })
    const scale = Math.min(1, 2000 / Math.max(bmp.width, bmp.height))
    const c = document.createElement('canvas'); c.width = Math.round(bmp.width * scale); c.height = Math.round(bmp.height * scale)
    c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height)
    return await new Promise(res => c.toBlob(b => res(b || file), 'image/jpeg', 0.85))
  } catch { return file }
}

export default function PhotoScrub({ user, onClose }) {
  const [pages, setPages] = useState([])          // [{ url, blob }]
  const [step, setStep] = useState('capture')     // capture | scrubbing | result | sent
  const [msg, setMsg] = useState('')
  const [err, setErr] = useState('')
  const [scrub, setScrub] = useState(null)
  const [shop, setShop] = useState('')
  const [busy, setBusy] = useState('')
  const [sentKind, setSentKind] = useState('')
  const camRef = useRef(null), libRef = useRef(null)

  async function addFiles(list) {
    const files = Array.from(list || []).filter(f => /^image\//.test(f.type) || /\.(jpe?g|png|heic)$/i.test(f.name))
    for (const f of files) {
      const blob = await shrink(f)
      setPages(p => [...p, { url: URL.createObjectURL(blob), blob }])
    }
  }
  const removePage = i => setPages(p => p.filter((_, j) => j !== i))
  const move = (i, d) => setPages(p => { const n = [...p]; const j = i + d; if (j < 0 || j >= n.length) return p; [n[i], n[j]] = [n[j], n[i]]; return n })

  async function runScrub() {
    if (!pages.length) return
    if (pages.length === 1 && !window.confirm('Estimates are usually 2–3 pages or more. Is this the only page?')) return
    setStep('scrubbing'); setErr(''); setMsg(`Reading ${pages.length} page${pages.length === 1 ? '' : 's'} — about a minute…`)
    const name = `Photo estimate ${new Date().toISOString().slice(0, 19).replace(/[T:]/g, '-')} (${pages.length}p).pdf`
    const fd = new FormData(); pages.forEach((p, i) => fd.append('pages', p.blob, `page-${i + 1}.jpg`)); fd.append('name', name)
    let id = ''
    try {
      const r = await apiFetch(`${API_BASE}/api/scrubs/upload-photos`, { method: 'POST', body: fd })
      const d = await r.json().catch(() => ({}))
      if (r.status === 400) { setErr(d.error || 'Those photos did not come through.'); setStep('capture'); return }
      id = String(d.scrubId || '')
    } catch { /* the gateway cut the wait — the scrub keeps going; poll for it */ }
    const t0 = Date.now()
    while (Date.now() - t0 < 240000) {
      try {
        const r = await apiFetch(`${API_BASE}/api/scrubs?limit=30`)
        const d = await r.json().catch(() => ({}))
        const hit = (d.scrubs || []).find(x => (id && String(x.id) === id) || x.fileName === name || String(x.fileName || '').endsWith(name))
        if (hit) { const s = normScrub(hit); setScrub(s); setShop(s.shop || ''); setStep('result'); setMsg(''); return }
      } catch { /* keep polling */ }
      await new Promise(res => setTimeout(res, 5000))
    }
    setErr('That one is taking longer than usual. It will show up in the Scrub Library in a minute.'); setStep('capture')
  }

  async function request(kind) {
    if (!shop.trim() && !window.confirm('No shop name — send it anyway? Kat will have to fill it in.')) return
    setBusy(kind); setErr('')
    try {
      await requestJobFor({ ...scrub, shop: shop.trim() || scrub.shop || '', source: 'photos' }, user, kind)
      setSentKind(kind); setStep('sent')
    } catch (e) { setErr(e.message || 'Could not send it.') } finally { setBusy('') }
  }

  const req = (scrub?.sensors || []).filter(x => x.r), notReq = (scrub?.sensors || []).filter(x => !x.r)
  const Btn = ({ children, onClick, bg = ORANGE, fg = 'white', border, disabled }) => (
    <button type="button" disabled={disabled} onClick={onClick} className="w-full rounded-2xl font-extrabold text-base py-3.5"
      style={{ backgroundColor: bg, color: fg, border: border || 'none', opacity: disabled ? 0.5 : 1 }}>{children}</button>
  )

  return (
    <div className="fixed inset-0 z-[80] flex flex-col" style={{ backgroundColor: '#f5f3f0' }}>
      <div className="flex items-center justify-between px-4 py-3 bg-white" style={{ borderBottom: '1px solid #e8e4e0' }}>
        <div className="font-extrabold text-lg" style={{ color: INK }}>📸 Scrub estimate photos</div>
        <button onClick={onClose} className="text-2xl leading-none px-2" style={{ color: '#888' }} aria-label="Close">✕</button>
      </div>
      <div className="flex-1 overflow-y-auto px-4 py-4">
        {err && <div className="rounded-xl px-3 py-2 mb-3 text-sm font-semibold" style={{ backgroundColor: '#fee2e2', color: '#b91c1c' }}>{err}</div>}

        {step === 'capture' && (<>
          <div className="text-sm mb-3" style={{ color: '#555' }}>Lay each page flat, fill the screen, no glare. <b>Get every page</b> — the repair lines usually run onto page 2 and 3.</div>
          <div className="grid grid-cols-3 gap-2 mb-3">
            {pages.map((p, i) => (
              <div key={p.url} className="relative rounded-xl overflow-hidden bg-white" style={{ border: '1px solid #e0dbd6' }}>
                <img src={p.url} alt={`Page ${i + 1}`} className="w-full object-cover" style={{ aspectRatio: '3 / 4' }} />
                <div className="absolute top-1 left-1 text-xs font-extrabold px-1.5 py-0.5 rounded" style={{ backgroundColor: 'rgba(0,0,0,0.65)', color: 'white' }}>{i + 1}</div>
                <button onClick={() => removePage(i)} className="absolute top-1 right-1 w-7 h-7 rounded-full font-bold" style={{ backgroundColor: 'rgba(0,0,0,0.65)', color: 'white' }} aria-label="Remove page">✕</button>
                <div className="absolute bottom-1 left-1 right-1 flex justify-between">
                  {i > 0 ? <button onClick={() => move(i, -1)} className="w-7 h-7 rounded-full text-sm" style={{ backgroundColor: 'rgba(255,255,255,0.9)' }} aria-label="Move earlier">◀</button> : <span />}
                  {i < pages.length - 1 ? <button onClick={() => move(i, 1)} className="w-7 h-7 rounded-full text-sm" style={{ backgroundColor: 'rgba(255,255,255,0.9)' }} aria-label="Move later">▶</button> : <span />}
                </div>
              </div>
            ))}
          </div>
          <input ref={camRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={e => { addFiles(e.target.files); e.target.value = '' }} />
          <input ref={libRef} type="file" accept="image/*" multiple className="hidden" onChange={e => { addFiles(e.target.files); e.target.value = '' }} />
          <div className="space-y-2">
            <Btn onClick={() => camRef.current?.click()} bg={pages.length ? 'white' : ORANGE} fg={pages.length ? ORANGE : 'white'} border={pages.length ? `2px solid ${ORANGE}` : ''}>
              📷 {pages.length ? `Add page ${pages.length + 1}` : 'Take a picture of page 1'}
            </Btn>
            <button onClick={() => libRef.current?.click()} className="w-full text-sm font-bold py-2" style={{ color: '#555' }}>🖼 Pick from my photos instead</button>
            {pages.length > 0 && <Btn onClick={runScrub} bg={GREEN}>🔬 Scrub {pages.length} page{pages.length === 1 ? '' : 's'}</Btn>}
          </div>
        </>)}

        {step === 'scrubbing' && (
          <div className="text-center py-16">
            <div className="text-5xl mb-3">🔬</div>
            <div className="font-extrabold text-lg" style={{ color: INK }}>{msg}</div>
            <div className="text-sm mt-1" style={{ color: '#777' }}>Same scrubber as a PDF. Keep the app open.</div>
          </div>
        )}

        {step === 'result' && scrub && (<>
          <div className="rounded-2xl bg-white p-4 mb-3" style={{ border: '1.5px solid #e8e4e0' }}>
            <div className="font-extrabold text-lg" style={{ color: INK }}>{[scrub.year, scrub.make, scrub.model].filter(Boolean).join(' ') || scrub.vehicle || 'Vehicle not read'}</div>
            <div className="text-xs mt-0.5" style={{ color: '#666' }}>{[scrub.ro && `RO ${scrub.ro}`, scrub.vin && `VIN …${String(scrub.vin).slice(-8)}`, scrub.insurer].filter(Boolean).join(' · ') || 'No RO / VIN read — check the photos'}</div>
            <label className="block text-[11px] font-bold mt-3 mb-1" style={{ color: '#888' }}>SHOP</label>
            <input value={shop} onChange={e => setShop(e.target.value)} placeholder="Shop name" className="w-full text-base rounded-lg px-3 py-2" style={{ border: '1px solid #e0dbd6' }} />
          </div>
          <div className="rounded-2xl p-4 mb-3" style={{ backgroundColor: req.length ? '#fff7ed' : '#f0fdf4', border: `1.5px solid ${req.length ? '#fdba74' : '#86efac'}` }}>
            <div className="font-extrabold mb-1" style={{ color: req.length ? '#9a3412' : GREEN }}>{req.length ? `✅ ${req.length} calibration${req.length === 1 ? '' : 's'} required` : '➖ Nothing required on this estimate'}</div>
            {req.map(x => <div key={x.n} className="text-sm py-1" style={{ color: INK, borderTop: '1px solid #fde4cf' }}><b>{x.n}</b>{x.l ? <span style={{ color: '#888' }}> · line {x.l}</span> : null}{x.g ? <div className="text-xs" style={{ color: '#666' }}>{x.g}</div> : null}</div>)}
            {notReq.length > 0 && <div className="text-xs mt-2" style={{ color: '#888' }}>Not required: {notReq.map(x => x.n).join(', ')}</div>}
          </div>
          <div className="space-y-2">
            <Btn onClick={() => request('job')} disabled={!!busy}>{busy === 'job' ? 'Sending…' : '🧾 Request job → Kat'}</Btn>
            <Btn onClick={() => request('quote')} bg="white" fg={BLUE} border={`2px solid ${BLUE}`} disabled={!!busy}>{busy === 'quote' ? 'Sending…' : '📝 Request quote → Kat'}</Btn>
            <button onClick={onClose} className="w-full text-sm font-bold py-2" style={{ color: '#555' }}>Nothing needed — close</button>
          </div>
        </>)}

        {step === 'sent' && (
          <div className="text-center py-14">
            <div className="text-5xl mb-3">✅</div>
            <div className="font-extrabold text-lg" style={{ color: INK }}>{sentKind === 'quote' ? 'Quote requested' : 'Job requested'} — Kat has it</div>
            <div className="text-sm mt-1 mb-6" style={{ color: '#666' }}>She got the car, the RO, what's required and the estimate in a direct message. It's on the board in {sentKind === 'quote' ? 'Quotes Requested' : 'Job Requested'}.</div>
            <div className="space-y-2 max-w-xs mx-auto">
              <Btn onClick={() => { setPages([]); setScrub(null); setShop(''); setStep('capture') }}>📸 Scrub another</Btn>
              <button onClick={onClose} className="w-full text-sm font-bold py-2" style={{ color: '#555' }}>Done</button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
