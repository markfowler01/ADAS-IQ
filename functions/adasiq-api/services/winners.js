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
    notes: Object.fromEntries(TRAITS.concat(DEALBREAKERS).map(k => [k, str(card.notes?.[k], 1000)])),
    flags: Object.fromEntries(DEALBREAKERS.map(k => [k, !!card.flags?.[k]])),
    custom: Array.isArray(card.custom) ? card.custom.slice(0, 20).map(q => ({ trait: str(q.trait, 20), q: str(q.q, 400), listen: str(q.listen, 300) })) : [],
    summary: str(card.summary, 2000),
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
  const merged = clean({ ...cur, ...patch, traits: { ...cur.traits, ...patch.traits }, notes: { ...cur.notes, ...patch.notes }, flags: { ...cur.flags, ...patch.flags }, custom: patch.custom ?? cur.custom, refs: patch.refs ?? cur.refs })
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
  const client = new Anthropic({ apiKey, timeout: 25000, maxRetries: 1 })
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
  try { resp = await client.messages.create({ model: 'claude-opus-5-5', max_tokens: 2000, messages: [{ role: 'user', content: prompt }] }) }
  catch (e) { if (e.status !== 404 && e.status !== 400) throw e; resp = await client.messages.create({ model: 'claude-sonnet-4-6', max_tokens: 2000, messages: [{ role: 'user', content: prompt }] }) }
  const text = (resp.content || []).map(b => b.text || '').join('')
  const m = text.match(/\[[\s\S]*\]/); if (!m) throw new Error(`No questions came back (${resp.model} · ${resp.stop_reason}): ${text.slice(0, 200)}`)
  return JSON.parse(m[0]).filter(x => x && x.q)
}
