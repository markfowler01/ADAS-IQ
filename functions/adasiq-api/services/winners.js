// 📕 The Attributes of Winners (Mark 2026-10-28, from The Sweaty Startup ch. 9): "for my next
// several hires I want to only hire people that would be accepted on his list."
// Five qualities scored 0–4 on evidence (not confidence), five deal-breakers flagged yes/no.
// ON THE LIST = every quality at 3+ and no deal-breakers. One card per candidate in
// AppConfig `winner:<candidateId>` (the candidates table has no JSON column; offers do the same).
import catalyst from 'zcatalyst-sdk-node'

export const TRAITS = ['abundance', 'urgency', 'challenge', 'decisions', 'work']
export const DEALBREAKERS = ['dishonesty', 'pessimism', 'manipulation', 'gossip', 'complacency']
export const PASS_SCORE = 3
const key = id => `winner:${id}`

export function verdict(card) {
  const t = card?.traits || {}, f = card?.flags || {}
  const score = TRAITS.reduce((n, k) => n + (Number(t[k]) || 0), 0)
  const scored = TRAITS.filter(k => t[k] != null).length
  // ☎️ References (Mark 2026-10-28): a pass also needs one called reference who'd rehire, and none who wouldn't.
  const refs = (card?.refs || []).filter(r => r.called_at)
  const refs_ok = refs.some(r => r.rehire === 'yes') && !refs.some(r => r.rehire === 'no' || r.red_flag)
  if (DEALBREAKERS.some(k => f[k])) return { verdict: 'no', score, scored, refs_ok }
  if (TRAITS.every(k => Number(t[k]) >= PASS_SCORE) && refs_ok) return { verdict: 'yes', score, scored, refs_ok }
  return { verdict: 'unproven', score, scored, refs_ok }
}

const clean = (card = {}) => {
  const num = v => (v === null || v === '' || v === undefined ? null : Math.max(0, Math.min(4, Math.round(Number(v) || 0))))
  const str = (v, n) => String(v || '').slice(0, n)
  return {
    traits: Object.fromEntries(TRAITS.map(k => [k, num(card.traits?.[k])])),
    notes: Object.fromEntries(TRAITS.concat(DEALBREAKERS, ['five_years']).map(k => [k, str(card.notes?.[k], 1000)])),   // five_years = the closing question (2026-10-30)
    flags: Object.fromEntries(DEALBREAKERS.map(k => [k, !!card.flags?.[k]])),
    custom: Array.isArray(card.custom) ? card.custom.slice(0, 20).map(q => ({ trait: str(q.trait, 20), q: str(q.q, 400), listen: str(q.listen, 300) })) : [],
    summary: str(card.summary, 2000),
    // ⚡❤️ Mark's top two (2026-10-30): "sense of urgency and do they care" — his own on/off call per candidate.
    top: { urgency: !!card.top?.urgency, cares: !!card.top?.cares },
    fit: card.fit && typeof card.fit === 'object' ? { verdict: ['strong', 'partial', 'poor'].includes(card.fit.verdict) ? card.fit.verdict : 'partial', summary: str(card.fit.summary, 800),
      wants: (card.fit.wants || []).slice(0, 8).map(x => str(x, 200)), can: (card.fit.can || []).slice(0, 8).map(x => str(x, 240)), cant: (card.fit.cant || []).slice(0, 8).map(x => str(x, 240)),
      ask: (card.fit.ask || []).slice(0, 5).map(x => str(x, 240)), answer: str(card.fit.answer, 1000), at: str(card.fit.at, 40) } : null,
    refs: Array.isArray(card.refs) ? card.refs.slice(0, 6).map(r => ({ name: str(r.name, 120), relation: str(r.relation, 60), company: str(r.company, 120), phone: str(r.phone, 40),
      called_at: str(r.called_at, 40), rehire: ['yes', 'hesitant', 'no'].includes(r.rehire) ? r.rehire : '', red_flag: !!r.red_flag,
      answers: Object.fromEntries(Object.entries(r.answers || {}).slice(0, 20).map(([k, v]) => [str(k, 30), str(v, 1500)])) })) : [],
  }
}

async function cfgRead(req, k) {
  const rows = await catalyst.initialize(req).zcql().executeZCQLQuery(`SELECT ROWID, config_value FROM AppConfig WHERE config_key = '${k}' LIMIT 1`)
  const r = rows?.[0]?.AppConfig; return r ? { rowid: String(r.ROWID), value: r.config_value } : null
}
export async function readCard(req, id) { const r = await cfgRead(req, key(id)).catch(() => null); try { return r?.value ? JSON.parse(r.value) : null } catch { return null } }
export async function readAllCards(req) {
  const rows = await catalyst.initialize(req).zcql().executeZCQLQuery(`SELECT config_key, config_value FROM AppConfig WHERE config_key LIKE 'winner:*' LIMIT 300`).catch(() => [])
  const out = {}
  for (const x of rows || []) { const r = x.AppConfig || x; try { const c = JSON.parse(r.config_value); out[String(r.config_key).slice(7)] = { ...c, ...verdict(c) } } catch { /* skip */ } }
  return out
}
export async function saveCard(req, id, patch, by) {
  const cur = (await readCard(req, id)) || {}
  const merged = clean({ ...cur, ...patch, traits: { ...cur.traits, ...patch.traits }, notes: { ...cur.notes, ...patch.notes }, flags: { ...cur.flags, ...patch.flags }, custom: patch.custom ?? cur.custom, refs: patch.refs ?? cur.refs, top: { ...cur.top, ...patch.top }, fit: patch.fit !== undefined ? patch.fit : cur.fit })
  const card = { ...merged, updated_at: new Date().toISOString(), updated_by: by || '' }
  const table = catalyst.initialize(req).datastore().table('AppConfig'), row = await cfgRead(req, key(id)), v = JSON.stringify(card)
  if (row) await table.updateRow({ ROWID: row.rowid, config_key: key(id), config_value: v })
  else await table.insertRow({ config_key: key(id), config_value: v })
  return { ...card, ...verdict(card) }
}

/** Call-sheet questions written around this candidate's background (two per quality + three deal-breaker probes). */
export async function tailorQuestions(req, cand) {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY not configured')
  const Anthropic = (await import('@anthropic-ai/sdk')).default
  const client = new Anthropic({ apiKey, timeout: 60000, maxRetries: 1 })
  const prompt = `You are helping Mark Fowler, owner of Absolute ADAS (mobile ADAS calibration, collision shops, Western Washington), prepare a phone interview.

Candidate:
- Name: ${cand.name}
- Applying for: ${cand.role || 'technician'}
- Location: ${cand.city || 'unknown'}
- Experience they wrote: ${cand.experience || '(none)'}
- Certs: ${cand.certs || '(none)'}
- Message: ${cand.message || '(none)'}

Mark only hires people who show these five qualities (scored on real examples, not confidence):
abundance = celebrates team wins, shares knowledge, helps coworkers improve
urgency = takes initiative, follows through fast, no reminders needed
challenge = respectfully tells the boss when something is wrong
decisions = thinks independently, works the problem, makes sound calls
work = rolls up sleeves, owns problems, gets it done instead of passing it along
And he rejects anyone showing: dishonesty, pessimism, manipulation, gossip, complacency.

Write questions built around THIS person's background (their tools, years, remote vs in-person work, location), not generic ones. Each question asks for a specific past example ("Tell me about a time…", "Walk me through…"). Plain spoken English, one sentence each, the way Mark would say it on the phone.

Return ONLY JSON: an array of 13 objects {"trait": one of abundance|urgency|challenge|decisions|work|dealbreaker, "q": the question, "listen": what a strong answer includes or the red flag to catch, under 20 words}. Two per quality, three dealbreaker probes.`
  let resp
  try { resp = await client.messages.create({ model: 'claude-opus-5-5', max_tokens: 8000, messages: [{ role: 'user', content: prompt }] }) }
  catch (e) { if (e.status !== 404 && e.status !== 400) throw e; resp = await client.messages.create({ model: 'claude-sonnet-4-6', max_tokens: 8000, messages: [{ role: 'user', content: prompt }] }) }
  const text = (resp.content || []).map(b => b.text || '').join('')
  const m = text.match(/\[[\s\S]*\]/); if (!m) throw new Error(`No questions came back (${resp.model} · ${resp.stop_reason}): ${text.slice(0, 200)}`)
  return JSON.parse(m[0]).filter(x => x && x.q)
}

// 🌅🔍 Is Absolute ADAS the right fit? (Mark 2026-10-30: "use AI to decipher everybody's answer and help me
// decide if Absolute ADAS is the right fit for them. Can we fulfill their wants and desires?")
// Reads the five-year answer (+ interview notes) against what the company can honestly offer.
// Keep COMPANY true — nothing promised here that Mark hasn't built or said.
const COMPANY = `Absolute ADAS — mobile ADAS calibration (cameras, radar, blind spot, steering angle, scans) done on site at collision and repair shops, Western Washington along I-5 (Bellingham to Olympia). Owner Mark Fowler works in the field; his son Jayden is a technician; Kat runs operations, billing and dispatch. Small team, growing.
What the work is: driving a van shop to shop, setting up targets, running OEM procedures with Autel tools, photos and reports in the app, talking with estimators and shop owners (never the car owner). Early starts, weather, lots of driving, same-day service.
What we can offer: hands-on training on real cars every day; a clear apprentice → technician ladder with sign-offs; working directly with the owner; your own van and route as you prove yourself; more responsibility as we grow (lead tech, training new techs, running a van, later running a market — expansion to Boise, Portland, Phoenix and the Bay Area is planned, not open yet); a company built to grow big (goal: $30M a year by 2036) where early people grow with it; team culture that celebrates wins (daily GET SOME meeting).
What we cannot offer: a desk or remote job; a 9-to-5 in one building; a big corporate ladder or HR department; a dealership or our own repair shop (we are mobile only); guaranteed management titles on a timeline; anything about pay beyond what's in an offer letter.`

export async function judgeFit(req, cand, card) {
  const answer = String(card?.notes?.five_years || '').trim()
  if (!answer) throw Object.assign(new Error('Write their five-year answer first'), { status: 400 })
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY not configured')
  const Anthropic = (await import('@anthropic-ai/sdk')).default
  const client = new Anthropic({ apiKey, timeout: 60000, maxRetries: 1 })
  const notes = TRAITS.map(k => card?.notes?.[k] ? `${k}: ${card.notes[k]}` : '').filter(Boolean).join('\n')
  const prompt = `You help Mark Fowler, owner of Absolute ADAS, decide whether his company can give a candidate the future they want.

THE COMPANY (only promise what is here):
${COMPANY}

THE CANDIDATE
Name: ${cand.name} · applying for: ${cand.role || 'technician'} · ${cand.city || ''}
Experience they wrote: ${cand.experience || '(none)'}
Mark's interview notes:
${notes || '(none)'}

THE QUESTION Mark asked: "Picture five years from now. You're really happy. You love your job, the people, what you're responsible for. What does that look like?"
THEIR ANSWER (Mark's notes): ${answer}

Work out what they actually want (work, people, responsibility, lifestyle, money, place). For each want, decide honestly whether Absolute ADAS can give it, partly, or not. Be direct; a poor fit said plainly saves both sides a bad hire.

Return ONLY JSON:
{"verdict":"strong|partial|poor","summary":"two plain sentences for Mark","wants":["what they want, short"],"can":["want → how we can deliver it, specific to us"],"cant":["want → why we can't or only partly"],"ask":["1-3 follow-up questions Mark should ask to close the gap"]}`
  let resp
  try { resp = await client.messages.create({ model: 'claude-opus-5-5', max_tokens: 3000, messages: [{ role: 'user', content: prompt }] }) }
  catch (e) { if (e.status !== 404 && e.status !== 400) throw e; resp = await client.messages.create({ model: 'claude-sonnet-4-6', max_tokens: 3000, messages: [{ role: 'user', content: prompt }] }) }
  const text = (resp.content || []).map(b => b.text || '').join('')
  const m = text.match(/\{[\s\S]*\}/); if (!m) throw new Error(`No answer came back (${resp.model} · ${resp.stop_reason})`)
  const j = JSON.parse(m[0])
  return { ...j, answer, at: new Date().toISOString() }
}
