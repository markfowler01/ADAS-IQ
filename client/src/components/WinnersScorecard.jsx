// 📕 The Attributes of Winners (Mark 2026-10-28, The Sweaty Startup ch. 9). Every hire must be
// on the list: all five qualities scored 3+ on real examples, zero deal-breakers.
// Saved per candidate by PUT /api/recruit/:id/winner (services/winners.js).
import { useEffect, useRef, useState } from 'react'
import { API_BASE, apiFetch } from '../utils/api.js'

export const PASS = 3
export const TRAITS = [
  { id: 'abundance', label: 'Abundance mindset', look: 'Celebrates team wins, shares what they know, helps coworkers get better',
    qs: ['Tell me about a time you helped another tech get better at their job.', "Who's the best tech you've worked with, and what did you learn from them?"],
    pass: 'Names real people, teaches without being asked, happy when others win', red: 'Hoards knowledge, "I do it all myself", competes with coworkers' },
  { id: 'urgency', label: 'Sense of urgency', look: 'Takes initiative, follows through fast, never needs a reminder',
    qs: ["A collision shop needs the car today and the calibration won't complete. What do you do, step by step?", 'Tell me about the last time you finished something before anyone asked you to.'],
    pass: 'Calls the shop early, has a plan B, moves the same hour', red: 'Waits for instructions, "not my problem", vague timeline' },
  { id: 'challenge', label: 'Challenges leadership', look: 'Respectfully tells the boss when something is wrong',
    qs: ['Tell me about a time you told your boss they were wrong. What happened?', 'If I told you to skip a calibration step to get a car out the door, what would you say?'],
    pass: 'Spoke up with facts, stayed respectful, then committed to the call', red: 'Never disagreed with anyone, or trashes the old boss' },
  { id: 'decisions', label: 'Good decision-making', look: 'Thinks on their own, works the problem, makes sound calls',
    qs: ['A calibration fails with no codes. Walk me through what you check.', 'Tell me about a call you made on your own with nobody to ask. Would you make it again?'],
    pass: 'Logical order: basics first (battery, ride height, alignment, targets), owns the outcome', red: 'Guesses, throws parts at it, needs permission for everything' },
  { id: 'work', label: 'Willing to do the work', look: 'Rolls up sleeves, owns problems, gets it done instead of passing it along',
    qs: ['Tell me about your hardest diagnostic job and how you personally cracked it.', "What's the least fun job you've done at work, and why did you do it?"],
    pass: 'Says "I" with specifics, did the dirty job without being told', red: 'Only "we" and "they", blames tools, parts or the shop' },
]
export const DEALBREAKERS = [
  { id: 'dishonesty', label: 'Dishonesty', signs: 'Lying, stealing, cheating, padding the résumé, faking work', q: 'Tell me about a mistake you made on a car that cost money. Who found it?' },
  { id: 'pessimism', label: 'Pessimism', signs: 'Chronic complaining, blaming others, only sees obstacles', q: 'Why are you leaving your current job?' },
  { id: 'manipulation', label: 'Manipulation', signs: 'Bends facts, plays people against each other', q: "Tell me about a coworker you didn't get along with. How did it end?" },
  { id: 'gossip', label: 'Gossip', signs: 'Runs down coworkers, personal attacks, rumors', q: 'What would your last boss say is your biggest weakness?' },
  { id: 'complacency', label: 'Complacency', signs: "Won't learn, improve or adapt", q: "What's something you learned in the last six months that you didn't know before?" },
]
// ☎️ Reference call (Mark 2026-10-28). Bosses, not friends. Every question maps to a quality or a deal-breaker.
export const REF_QS = [
  { id: 'verify', tag: 'Honesty check', q: n => `How do you know ${n}? How long did you work together, and what was their job?`, listen: 'Matches what they told you. Different title or dates = dishonesty flag.' },
  { id: 'abundance', tag: 'Abundance', q: n => `How did ${n} get along with the other techs? Did they ever help train anyone?`, listen: 'Named examples of teaching or helping.' },
  { id: 'urgency', tag: 'Urgency', q: n => `When a car had to go out today, how did ${n} handle it? Did you ever have to chase them?`, listen: '"Never had to ask twice."' },
  { id: 'challenge', tag: 'Challenges leadership', q: n => `Did ${n} ever push back on you? How did they do it?`, listen: 'Respectful, with facts, then got on board.' },
  { id: 'decisions', tag: 'Decisions', q: n => `What would you trust ${n} to decide on their own? Where did you have to check their work?`, listen: 'Real trust, little babysitting.' },
  { id: 'work', tag: 'Does the work', q: n => `When a job turned ugly, what did ${n} do?`, listen: 'Dug in and owned it, no hand-off.' },
  { id: 'honesty', tag: 'Dishonesty', q: () => 'Any concerns at all about honesty: hours, tools, paperwork, the work itself?', listen: 'Any pause here matters. Ask a follow-up.' },
  { id: 'attitude', tag: 'Pessimism · gossip', q: () => 'How did they handle a bad week? Did they complain much? Any drama with coworkers?', listen: 'Complaining, blaming, drama = deal-breaker.' },
  { id: 'growth', tag: 'Complacency', q: () => 'Did they get better while you knew them? What did they learn?', listen: 'Specific growth, not "they were the same".' },
  { id: 'leave', tag: 'Honesty check', q: () => 'Why did they leave?', listen: 'Same story the candidate told you?' },
  { id: 'rehire', tag: 'The big one', q: () => 'On a scale of 1 to 10, would you hire them again? What keeps it from a 10?', listen: 'Below 8, or a long pause, is a no.' },
  { id: 'else', tag: 'Open door', q: () => "Anything I should know that I didn't ask?", listen: 'Let the silence sit.' },
]
export const RUBRIC = ['No evidence', 'Talk only, no example', 'One weak example', 'A specific real example', 'Several strong examples']

export function winnerVerdict(w) {
  const t = w?.traits || {}, f = w?.flags || {}
  if (DEALBREAKERS.some(d => f[d.id])) return 'no'
  if (TRAITS.every(x => Number(t[x.id]) >= PASS) && refsOk(w)) return 'yes'
  return 'unproven'
}
const calledRefs = w => (w?.refs || []).filter(r => r.called_at)
export const refsOk = w => calledRefs(w).some(r => r.rehire === 'yes') && !calledRefs(w).some(r => r.rehire === 'no' || r.red_flag)
const score = w => TRAITS.reduce((n, x) => n + (Number(w?.traits?.[x.id]) || 0), 0)
const LOOK = {
  yes: { text: '📕 ON THE LIST', bg: '#dcfce7', fg: '#15803d', bd: '#86efac' },
  unproven: { text: '⚠️ UNPROVEN', bg: '#fef3c7', fg: '#92400e', bd: '#fcd34d' },
  no: { text: '❌ NOT ON THE LIST', bg: '#fee2e2', fg: '#b91c1c', bd: '#fca5a5' },
}

export function WinnerBadge({ w, small = false }) {
  const v = winnerVerdict(w), l = LOOK[v]
  return <span className={`${small ? 'text-[10px] px-1.5 py-0.5' : 'text-xs px-2 py-1'} font-extrabold rounded-full whitespace-nowrap`} style={{ backgroundColor: l.bg, color: l.fg, border: `1px solid ${l.bd}` }}>{l.text}{v !== 'no' ? ` · ${score(w)}/20` : ''}</span>
}

export function WinnersBanner() {
  return (
    <div className="rounded-xl px-3 py-2 mb-3 text-xs" style={{ backgroundColor: '#1a1a1a', color: 'white' }}>
      <b>📕 Next hires: Sweaty Startup list only.</b> All five qualities at {PASS}+ on real examples (abundance · urgency · challenges you · decisions · does the work), zero deal-breakers (dishonest · pessimist · manipulator · gossip · complacent), and a called reference who'd hire them again.
    </div>
  )
}

/** Gate for Offer / Hired: returns true to go ahead. */
export function confirmWinner(c, stage) {
  if (c?.kind === 'partner' || !['offer', 'hired'].includes(stage)) return true
  const v = winnerVerdict(c.winner)
  if (v === 'yes') return true
  return window.confirm(v === 'no'
    ? `❌ ${c.name} has a deal-breaker flagged. Your rule: Sweaty Startup list only.\n\nMove to ${stage === 'hired' ? 'Hired' : 'Offer'} anyway?`
    : `⚠️ ${c.name} isn't proven on the list yet (every quality needs ${PASS}+ on a real example, plus a reference who'd rehire).\n\nMove to ${stage === 'hired' ? 'Hired' : 'Offer'} anyway?`)
}

/** Modal panel: verdict + open the call sheet. */
export function WinnersPanel({ c, onOpenSheet }) {
  const w = c.winner, v = winnerVerdict(w)
  const low = TRAITS.filter(x => !(Number(w?.traits?.[x.id]) >= PASS)).map(x => x.label).concat(refsOk(w) ? [] : [calledRefs(w).some(r => r.rehire === 'no' || r.red_flag) ? 'a reference raised a concern' : 'a reference who would rehire'])
  const flags = DEALBREAKERS.filter(d => w?.flags?.[d.id]).map(d => d.label)
  return (
    <div className="rounded-xl p-3 mb-4" style={{ backgroundColor: LOOK[v].bg, border: `1px solid ${LOOK[v].bd}` }}>
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <p className="text-[11px] font-bold uppercase tracking-widest" style={{ color: LOOK[v].fg }}>📕 Attributes of Winners</p>
        <WinnerBadge w={w} />
      </div>
      <p className="text-xs mt-1" style={{ color: '#444' }}>
        {flags.length ? <>Deal-breaker: <b>{flags.join(', ')}</b>. Not a hire.</>
          : v === 'yes' ? 'Every quality proven with a real example. Clear to make an offer.'
          : <>Still need proof on: <b>{low.join(', ')}</b>.</>}
      </p>
      <button onClick={onOpenSheet} className="mt-2 text-xs font-bold rounded-lg px-3 py-2" style={{ backgroundColor: '#1a1a1a', color: 'white' }}>📞 Open call sheet</button>
    </div>
  )
}

/** Full-screen call sheet: questions, 0–4 per quality, deal-breaker flags. Saves as you tap. */
export function CallSheet({ c, onClose, onSaved }) {
  const [w, setW] = useState(() => ({ traits: {}, notes: {}, flags: {}, custom: [], ...(c.winner || {}) }))
  const [saving, setSaving] = useState(''), [err, setErr] = useState(''), [tailoring, setTailoring] = useState(false)
  const timer = useRef(null), pending = useRef({})
  async function send(body) {
    setSaving('Saving…')
    try {
      const r = await apiFetch(`${API_BASE}/api/recruit/${c.id}/winner`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      const j = await r.json(); if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`)
      onSaved(j.winner); setSaving('✓ Saved'); setErr('')
    } catch (e) { setErr(e.message); setSaving('') }
  }
  // Notes save after a pause; taps save right away.
  function queue(part, now = false) {
    for (const k of Object.keys(part)) pending.current[k] = Array.isArray(part[k]) ? part[k] : { ...(pending.current[k] || {}), ...part[k] }
    clearTimeout(timer.current)
    const go = () => { const b = pending.current; pending.current = {}; send(b) }
    if (now) go(); else timer.current = setTimeout(go, 900)
  }
  useEffect(() => () => { clearTimeout(timer.current); if (Object.keys(pending.current).length) send(pending.current) }, [])
  const setTrait = (k, n) => { const val = w.traits?.[k] === n ? null : n; setW(x => ({ ...x, traits: { ...x.traits, [k]: val } })); queue({ traits: { [k]: val } }, true) }
  const setNote = (k, t) => { setW(x => ({ ...x, notes: { ...x.notes, [k]: t } })); queue({ notes: { [k]: t } }) }
  const setFlag = (k) => { const val = !w.flags?.[k]; setW(x => ({ ...x, flags: { ...x.flags, [k]: val } })); queue({ flags: { [k]: val } }, true) }
  async function tailor() {
    setTailoring(true); setErr('')
    try {
      const r = await apiFetch(`${API_BASE}/api/recruit/${c.id}/winner/tailor`, { method: 'POST' })
      const j = await r.json(); if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`)
      setW(x => ({ ...x, custom: j.winner.custom })); onSaved(j.winner)
    } catch (e) { setErr(e.message) } finally { setTailoring(false) }
  }
  const [tab, setTab] = useState('call')
  const setRefs = (refs, now = false) => { setW(x => ({ ...x, refs })); queue({ refs }, now) }
  const custom = w.custom || []
  const box = { border: '1px solid #e0dbd6', backgroundColor: 'white' }
  return (
    <div className="fixed inset-0 z-[60] bg-white overflow-y-auto">
      <div className="sticky top-0 z-10 bg-white px-4 py-3 flex items-center justify-between gap-2" style={{ borderBottom: '1px solid #ebebeb' }}>
        <div className="min-w-0">
          <p className="text-[11px] font-bold uppercase tracking-widest" style={{ color: '#888' }}>📞 Call sheet · Attributes of Winners</p>
          <p className="text-base font-extrabold truncate" style={{ color: '#1a1a1a' }}>{c.name}<span className="text-xs font-semibold ml-2" style={{ color: '#888' }}>{[c.role, c.city].filter(Boolean).join(' · ')}</span></p>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <WinnerBadge w={w} />
          <button onClick={onClose} className="text-2xl leading-none px-1" style={{ color: '#888' }}>×</button>
        </div>
      </div>
      <div className="max-w-2xl mx-auto px-4 py-4 pb-24 space-y-4">
        <div className="flex items-center gap-2 flex-wrap text-xs">
          {c.phone && <a href={`tel:${String(c.phone).replace(/[^\d+]/g, '')}`} className="font-bold rounded-lg px-3 py-2" style={{ backgroundColor: '#1a1a1a', color: 'white' }}>📞 Call {c.phone}</a>}
          <button onClick={tailor} disabled={tailoring} className="font-bold rounded-lg px-3 py-2" style={{ backgroundColor: '#f5f3f0', color: '#555', border: '1px solid #e0dbd6' }}>{tailoring ? 'Writing…' : custom.length ? '✨ Rewrite questions for this résumé' : '✨ Write questions for this résumé'}</button>
          <span style={{ color: err ? '#dc2626' : '#888' }}>{err || saving}</span>
        </div>
        <div className="inline-flex rounded-full p-0.5" style={{ backgroundColor: '#f5f3f0' }}>
          {[['call', '📞 Interview'], ['refs', `☎️ References · ${calledRefs(w).length}/${(w.refs || []).length}`]].map(([k, l]) => <button key={k} onClick={() => setTab(k)} className="text-xs font-bold rounded-full px-3 py-1.5" style={tab === k ? { backgroundColor: '#1a1a1a', color: 'white' } : { color: '#666' }}>{l}</button>)}
        </div>
        {tab === 'refs' && <References c={c} refs={w.refs || []} onChange={setRefs} box={box} />}
        {tab === 'call' && <>
        {c.experience && <div className="rounded-lg p-3 text-xs" style={{ backgroundColor: '#f9f8f7', color: '#444' }}><b>They wrote:</b> {c.experience}</div>}
        <p className="text-xs" style={{ color: '#666' }}>Score the <b>evidence</b>, not the confidence. {RUBRIC.map((r, i) => `${i} ${r.toLowerCase()}`).join(' · ')}. Pass = {PASS}+ on all five.</p>

        {TRAITS.map((t, i) => {
          const mine = custom.filter(q => q.trait === t.id), val = w.traits?.[t.id]
          return (
            <div key={t.id} className="rounded-xl p-3" style={{ border: `2px solid ${val >= PASS ? '#86efac' : val != null ? '#fcd34d' : '#ebebeb'}` }}>
              <div className="flex items-start justify-between gap-2">
                <div><p className="text-sm font-extrabold" style={{ color: '#1a1a1a' }}>{i + 1}. {t.label}</p><p className="text-xs" style={{ color: '#888' }}>{t.look}</p></div>
              </div>
              <ul className="mt-2 space-y-1.5">
                {mine.map((q, k) => <li key={`c${k}`} className="text-sm" style={{ color: '#1a1a1a' }}>✨ “{q.q}”{q.listen && <div className="text-[11px]" style={{ color: '#888' }}>Listen for: {q.listen}</div>}</li>)}
                {t.qs.map((q, k) => <li key={k} className="text-sm" style={{ color: mine.length ? '#777' : '#1a1a1a' }}>“{q}”</li>)}
              </ul>
              <p className="text-[11px] mt-2"><span style={{ color: '#15803d' }}>✅ {t.pass}</span><br /><span style={{ color: '#b91c1c' }}>🚩 {t.red}</span></p>
              <div className="flex gap-1.5 mt-2">
                {[0, 1, 2, 3, 4].map(n => <button key={n} onClick={() => setTrait(t.id, n)} title={RUBRIC[n]} className="w-10 h-10 rounded-lg text-sm font-extrabold"
                  style={val === n ? { backgroundColor: n >= PASS ? '#15803d' : n >= 2 ? '#d97706' : '#b91c1c', color: 'white' } : { backgroundColor: '#f5f3f0', color: '#555' }}>{n}</button>)}
                <span className="text-[11px] self-center ml-1" style={{ color: '#888' }}>{val != null ? RUBRIC[val] : 'not scored'}</span>
              </div>
              <textarea value={w.notes?.[t.id] || ''} onChange={e => setNote(t.id, e.target.value)} rows={2} placeholder="The example they gave…" className="w-full rounded-lg px-3 py-2 text-sm mt-2" style={box} />
            </div>
          )
        })}

        <div className="rounded-xl p-3" style={{ border: '2px solid #fecaca', backgroundColor: '#fffafa' }}>
          <p className="text-sm font-extrabold" style={{ color: '#b91c1c' }}>🚫 Deal-breakers · any one = not a hire</p>
          {custom.filter(q => q.trait === 'dealbreaker').map((q, k) => <p key={k} className="text-sm mt-1.5" style={{ color: '#1a1a1a' }}>✨ “{q.q}”{q.listen && <span className="block text-[11px]" style={{ color: '#888' }}>Listen for: {q.listen}</span>}</p>)}
          {DEALBREAKERS.map(d => (
            <div key={d.id} className="mt-2 pt-2" style={{ borderTop: '1px solid #fee2e2' }}>
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0"><p className="text-sm font-bold" style={{ color: '#1a1a1a' }}>{d.label} <span className="text-[11px] font-normal" style={{ color: '#888' }}>{d.signs}</span></p><p className="text-xs" style={{ color: '#555' }}>“{d.q}”</p></div>
                <button onClick={() => setFlag(d.id)} className="text-xs font-bold rounded-full px-3 py-1.5 flex-shrink-0" style={w.flags?.[d.id] ? { backgroundColor: '#b91c1c', color: 'white' } : { backgroundColor: 'white', color: '#888', border: '1px solid #e0dbd6' }}>{w.flags?.[d.id] ? '🚩 Flagged' : 'Clear'}</button>
              </div>
              {w.flags?.[d.id] && <textarea value={w.notes?.[d.id] || ''} onChange={e => setNote(d.id, e.target.value)} rows={2} placeholder="What you saw or heard…" className="w-full rounded-lg px-3 py-2 text-sm mt-2" style={box} />}
            </div>
          ))}
        </div>
        <div className="rounded-xl p-3" style={{ border: '2px solid #bfdbfe', backgroundColor: '#f8fbff' }}>
          <p className="text-sm font-extrabold" style={{ color: '#1e40af' }}>☎️ Before you hang up: references</p>
          <p className="text-sm mt-1" style={{ color: '#1a1a1a' }}>“I'd like to talk to your last two direct bosses. Not friends, bosses. Who are they, and what will they tell me about you?”</p>
          <p className="text-[11px] mt-1" style={{ color: '#888' }}>Their answer is its own honesty test: compare it to what the boss actually says. Add them on the References tab.</p>
        </div>
        </>}
        <p className="text-[11px]" style={{ color: '#aaa' }}>From The Sweaty Startup, chapter 9 (The Attributes of Winners). Character comes from this sheet; skill comes from the electrical screen and the paid day out. You need both.</p>
      </div>
    </div>
  )
}

function References({ c, refs, onChange, box }) {
  const first = String(c.name || 'them').split(' ')[0]
  const [open, setOpen] = useState(() => refs.findIndex(r => !r.called_at))
  const [add, setAdd] = useState({ name: '', relation: 'Boss', company: '', phone: '' })
  const upd = (i, patch, now) => onChange(refs.map((r, k) => k === i ? { ...r, ...patch, called_at: r.called_at || (patch.answers || patch.rehire || patch.red_flag ? new Date().toISOString() : '') } : r), now)
  return (
    <div className="space-y-3">
      <div className="rounded-lg p-3 text-xs" style={{ backgroundColor: '#f8fbff', border: '1px solid #bfdbfe', color: '#334' }}>
        <b>How to run it:</b> call bosses, not friends. Faint praise ("they were fine") is a no. Listen for pauses. If you get voicemail: <i>"Please call me back only if {first} was a great employee."</i> No call back tells you plenty.
      </div>
      {refs.map((r, i) => (
        <div key={i} className="rounded-xl p-3" style={{ border: `2px solid ${r.rehire === 'yes' && !r.red_flag ? '#86efac' : r.rehire === 'no' || r.red_flag ? '#fca5a5' : r.rehire === 'hesitant' ? '#fcd34d' : '#ebebeb'}` }}>
          <button onClick={() => setOpen(open === i ? -1 : i)} className="w-full flex items-center justify-between gap-2 text-left">
            <span className="min-w-0"><b className="text-sm" style={{ color: '#1a1a1a' }}>{r.name || 'Reference'}</b> <span className="text-xs" style={{ color: '#888' }}>{[r.relation, r.company].filter(Boolean).join(' · ')}</span></span>
            <span className="text-[11px] font-bold flex-shrink-0" style={{ color: r.called_at ? '#15803d' : '#888' }}>{r.called_at ? `called ${new Date(r.called_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}` : 'not called'}{r.rehire ? ` · rehire: ${r.rehire}` : ''}{r.red_flag ? ' · 🚩' : ''}</span>
          </button>
          {open === i && <div className="mt-2 space-y-2">
            {r.phone && <a href={`tel:${String(r.phone).replace(/[^\d+]/g, '')}`} className="inline-block text-xs font-bold rounded-lg px-3 py-2" style={{ backgroundColor: '#1a1a1a', color: 'white' }}>📞 Call {r.phone}</a>}
            <p className="text-xs" style={{ color: '#555' }}>Open with: <i>"Hi, this is Mark Fowler with Absolute ADAS. {c.name} is up for a technician job with us and gave me your name. Got five minutes?"</i></p>
            {REF_QS.map(q => (
              <div key={q.id}>
                <p className="text-sm" style={{ color: '#1a1a1a' }}><span className="text-[10px] font-bold uppercase tracking-wide mr-1" style={{ color: '#888' }}>{q.tag}</span>“{q.q(first)}”</p>
                <p className="text-[11px]" style={{ color: '#888' }}>Listen for: {q.listen}</p>
                <textarea value={r.answers?.[q.id] || ''} onChange={e => upd(i, { answers: { ...(r.answers || {}), [q.id]: e.target.value } })} rows={1} className="w-full rounded-lg px-3 py-1.5 text-sm mt-1" style={box} />
              </div>
            ))}
            <div className="flex items-center gap-1.5 flex-wrap pt-1">
              <span className="text-xs font-bold" style={{ color: '#555' }}>Would rehire?</span>
              {[['yes', '✅ Yes'], ['hesitant', '🤔 Hesitant'], ['no', '❌ No']].map(([k, l]) => <button key={k} onClick={() => upd(i, { rehire: r.rehire === k ? '' : k }, true)} className="text-xs font-bold rounded-full px-3 py-1.5" style={r.rehire === k ? { backgroundColor: k === 'yes' ? '#15803d' : k === 'no' ? '#b91c1c' : '#d97706', color: 'white' } : { backgroundColor: 'white', border: '1px solid #e0dbd6', color: '#666' }}>{l}</button>)}
              <button onClick={() => upd(i, { red_flag: !r.red_flag }, true)} className="text-xs font-bold rounded-full px-3 py-1.5 ml-auto" style={r.red_flag ? { backgroundColor: '#b91c1c', color: 'white' } : { backgroundColor: 'white', border: '1px solid #e0dbd6', color: '#888' }}>{r.red_flag ? '🚩 Red flag' : 'No red flags'}</button>
              <button onClick={() => { if (window.confirm(`Remove ${r.name || 'this reference'}?`)) onChange(refs.filter((_, k) => k !== i), true) }} className="text-[11px] underline" style={{ color: '#aaa' }}>remove</button>
            </div>
          </div>}
        </div>
      ))}
      <div className="rounded-xl p-3" style={{ backgroundColor: '#f9f8f7' }}>
        <p className="text-xs font-bold mb-1.5" style={{ color: '#555' }}>+ Add a reference</p>
        <div className="grid grid-cols-2 gap-2">
          <input value={add.name} onChange={e => setAdd({ ...add, name: e.target.value })} placeholder="Name" className="rounded-lg px-3 py-2 text-sm" style={box} />
          <input value={add.phone} onChange={e => setAdd({ ...add, phone: e.target.value })} placeholder="Phone" className="rounded-lg px-3 py-2 text-sm" style={box} />
          <input value={add.company} onChange={e => setAdd({ ...add, company: e.target.value })} placeholder="Company" className="rounded-lg px-3 py-2 text-sm" style={box} />
          <select value={add.relation} onChange={e => setAdd({ ...add, relation: e.target.value })} className="rounded-lg px-3 py-2 text-sm" style={box}>{['Boss', 'Former boss', 'Coworker', 'Customer', 'Other'].map(x => <option key={x}>{x}</option>)}</select>
        </div>
        <button disabled={!add.name.trim()} onClick={() => { onChange([...refs, { ...add, name: add.name.trim(), answers: {} }], true); setOpen(refs.length); setAdd({ name: '', relation: 'Boss', company: '', phone: '' }) }} className="mt-2 text-xs font-bold rounded-lg px-3 py-2 text-white" style={{ backgroundColor: add.name.trim() ? '#1a1a1a' : '#ccc' }}>Add</button>
      </div>
    </div>
  )
}
