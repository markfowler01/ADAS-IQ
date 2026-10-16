// 🧭 How I work — profile views. SelfWorkStyle: the person's own short,
// strengths-only summary. MarkWorkStyle: Mark-only deep report (scores,
// how to lead, watch-fors, check-in talking points, optional AI brief).
import { useEffect, useState } from 'react'
import { API_BASE, apiFetch, ORANGE } from '../books/shared'

const GREEN = '#15803d', RED = '#b91c1c', AMBER = '#b45309'
const j = async (url, opts) => { const r = await apiFetch(`${API_BASE}${url}`, opts); const d = await r.json().catch(() => ({})); if (!r.ok) throw new Error(d.error || `HTTP ${r.status}`); return d }
const BAND = { high: ['High', GREEN], mid: ['Middle', '#555'], low: ['Low', AMBER] }

function Box({ title, right, children, tint = '#f8f6f4' }) {
  return (
    <div className="rounded-xl mb-3 overflow-hidden" style={{ border: '1px solid #e8e4e0' }}>
      <div className="px-3 py-2 flex items-center justify-between gap-2" style={{ backgroundColor: tint }}>
        <div className="text-[10px] uppercase tracking-wider font-semibold" style={{ color: '#888', fontFamily: 'IBM Plex Mono, monospace' }}>{title}</div>{right}
      </div>
      <div className="px-3 py-2">{children}</div>
    </div>
  )
}

export function SelfWorkStyle() {
  const [d, setD] = useState(null)
  useEffect(() => { j('/api/workstyle/me').then(setD).catch(() => setD({ done: false })) }, [])
  if (!d) return null
  if (!d.done) return <Box title="🧭 How I work"><div className="text-xs" style={{ color: '#888' }}>Not taken yet. It's a step in your onboarding link (about 10 minutes).</div></Box>
  const s = d.simple
  return (
    <Box title="🧭 How I work">
      <div className="text-sm font-bold mb-1.5" style={{ color: '#1a1a1a' }}>{s.headline}</div>
      {s.strengths.map(x => <div key={x.k} className="text-sm py-1" style={{ borderBottom: '1px solid #f3f3f3' }}><b style={{ color: GREEN }}>{x.title}.</b> {x.text}</div>)}
      <div className="text-sm mt-1.5" style={{ color: '#333' }}>{s.style}</div>
      {s.drive && <div className="text-sm mt-1 font-semibold">{s.drive}</div>}
    </Box>
  )
}

function Bar({ name, score, band }) {
  return (
    <div className="py-1">
      <div className="flex justify-between text-xs"><span className="font-semibold" style={{ color: '#1a1a1a' }}>{name}</span><span className="font-bold tabular-nums" style={{ color: BAND[band][1] }}>{score} · {BAND[band][0]}</span></div>
      <div className="h-1.5 rounded-full mt-0.5" style={{ backgroundColor: '#f1ede9' }}><div className="h-1.5 rounded-full" style={{ width: `${score}%`, backgroundColor: BAND[band][1] }} /></div>
    </div>
  )
}

export function MarkWorkStyle({ m }) {
  const [d, setD] = useState(null)
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const [confirmReset, setConfirmReset] = useState(false)
  const load = () => j(`/api/comp/${m.id}/work-style`).then(setD).catch(e => setErr(e.message))
  useEffect(() => { load() }, [m.id]) // eslint-disable-line react-hooks/exhaustive-deps
  if (err) return <div className="text-xs mb-3" style={{ color: RED }}>How I work: {err}</div>
  if (!d) return null
  if (!d.taken) return <Box title="🧭 How they work · only you see this" tint="#fff5f0"><div className="text-xs" style={{ color: '#888' }}>Not taken yet. It's a step in the onboarding link. For people already on the team, send a 🧩 Catch-up link from the Onboarding section below.</div></Box>
  const dp = d.deep
  async function ai() { setBusy(true); try { const r = await j(`/api/comp/${m.id}/work-style/ai`, { method: 'POST' }); setD(x => ({ ...x, ...r })) } catch (e) { setErr(e.message) } finally { setBusy(false) } }
  async function reset() { setBusy(true); try { await j(`/api/comp/${m.id}/work-style`, { method: 'DELETE' }); setConfirmReset(false); await load() } catch (e) { setErr(e.message) } finally { setBusy(false) } }
  return (
    <Box title={`🧭 How ${m.name.split(' ')[0]} works · only you see this`} tint="#fff5f0" right={<span className="text-[10px]" style={{ color: '#999' }}>taken {String(d.taken_at).slice(0, 10)}</span>}>
      <div className="text-[11px] font-semibold uppercase tracking-wider mt-1 mb-1" style={{ color: '#888' }}>Big Five</div>
      {dp.traits.map(t => (
        <div key={t.k} className="mb-2">
          <Bar name={t.name} score={t.score} band={t.band} />
          <div className="text-xs mt-0.5" style={{ color: '#333' }}>{t.what}</div>
          <div className="text-xs" style={{ color: '#555' }}><b>Lead:</b> {t.how}</div>
          {t.watch && <div className="text-xs" style={{ color: AMBER }}>{t.watch}</div>}
        </div>
      ))}
      <div className="text-[11px] font-semibold uppercase tracking-wider mt-3 mb-1" style={{ color: '#888' }}>On the job (our own scenarios)</div>
      {dp.shop.map(t => <Bar key={t.k} name={t.name} score={t.score} band={t.band} />)}
      <div className="text-[11px] font-semibold uppercase tracking-wider mt-3 mb-1" style={{ color: '#888' }}>What drives them (self-picked)</div>
      {dp.motivation.map(x => <div key={x.t} className="text-xs mb-1.5"><b>{x.name}</b> · "{x.statement}"<div style={{ color: '#555' }}>{x.lead}</div></div>)}
      <div className="text-[11px] font-semibold uppercase tracking-wider mt-3 mb-1" style={{ color: '#888' }}>Best fit</div>
      {dp.fit.map((f, i) => <div key={i} className="text-xs" style={{ color: GREEN }}>• {f}</div>)}
      {dp.risks.length > 0 && <><div className="text-[11px] font-semibold uppercase tracking-wider mt-3 mb-1" style={{ color: '#888' }}>Watch for</div>{dp.risks.map((r, i) => <div key={i} className="text-xs" style={{ color: AMBER }}>• {r}</div>)}</>}
      <div className="text-[11px] font-semibold uppercase tracking-wider mt-3 mb-1" style={{ color: '#888' }}>Talking points</div>
      <div className="text-xs font-bold">☕ 90-day coffee</div>{dp.talk['90d'].map((t, i) => <div key={i} className="text-xs" style={{ color: '#333' }}>• {t}</div>)}
      <div className="text-xs font-bold mt-1">🍺 6-month drinks</div>{dp.talk['6mo'].map((t, i) => <div key={i} className="text-xs" style={{ color: '#333' }}>• {t}</div>)}
      <div className="mt-3 rounded-lg p-2.5" style={{ backgroundColor: '#f8f6f4' }}>
        <div className="flex items-center justify-between gap-2"><div className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: '#888' }}>✨ Deep brief</div><button onClick={ai} disabled={busy} className="text-[11px] font-bold rounded-full px-2.5 py-1 text-white disabled:opacity-50" style={{ backgroundColor: ORANGE }}>{busy ? 'Writing…' : d.ai ? '↻ Rewrite' : '✨ Write it'}</button></div>
        {d.ai ? <div className="text-xs mt-2 whitespace-pre-wrap" style={{ color: '#1a1a1a' }}>{d.ai}</div> : <div className="text-[11px] mt-1" style={{ color: '#888' }}>Claude writes a leadership brief from the scores (no name or answers are sent).</div>}
      </div>
      <div className="text-[10px] mt-2" style={{ color: '#999' }}>Big Five: IPIP public-domain items, raw 0–100 (not percentiles). Shop scenarios and drives are our own, for coaching only. Never use for pay, hiring or firing.</div>
      <div className="mt-1.5">{confirmReset
        ? <span className="text-[11px]">Erase their answers so they can retake it? <button onClick={reset} disabled={busy} className="font-bold" style={{ color: RED }}>Yes, reset</button> · <button onClick={() => setConfirmReset(false)} style={{ color: '#888' }}>cancel</button></span>
        : <button onClick={() => setConfirmReset(true)} className="text-[11px]" style={{ color: '#999' }}>Let them retake it</button>}</div>
    </Box>
  )
}
