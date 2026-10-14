// 💼 Deals — the sales process on top of AdasShops (Mark's spec 2026-10-07, Blount Sales EQ
// qualifiers). A deal = one pursuit of one shop. Stages with server-side gates, TQ/SQ/FQ
// scores → HPP/MPP/LPP priority, activities + stage history, and the Sales Mode queue
// ("make switching into sales mode mindless", Mark 2026-10-08).
// Tables (Datastore, created 2026-10-08): AdasDeals, AdasDealActivities, AdasDealStageHistory.
// The shop's pipeline_stage is DERIVED from its open deal so the Monday list, kickoff texts,
// Customers view and Big 3 onboarding keep working untouched.
import catalyst from 'zcatalyst-sdk-node'

const T = 'AdasDeals', TA = 'AdasDealActivities', TH = 'AdasDealStageHistory'
const ds = req => catalyst.initialize(req, { type: 'advancedio' })
const q = s => String(s ?? '').replace(/'/g, "''")
const str = (v, n) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, n)
const nowIso = () => new Date().toISOString()
const todayPT = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' })

export const STAGES = ['Qualified', 'Prospecting', 'Connected', 'Discovery', 'Bridged', 'Next Step Asked', 'Stalled', 'Implementing', 'Won', 'Lost']
export const OPEN_STAGES = STAGES.filter(s => !['Won', 'Lost'].includes(s))
export const SCORES = ['High', 'Medium', 'Low']
export const DEAL_TYPES = ['New Account', 'Reactivation']
export const SETUPS = ['Dealer', 'Apex', 'Evergreen', 'Kinetic', 'Other mobile', 'None']
export const PAIN_TYPES = ['Cycle time', 'Missed estimate revenue', 'Documentation', 'Comebacks', 'Scheduling', 'Vendor reliability']
export const OBJECTIONS = ['Using dealer', 'Has vendor', 'Price', 'Timing', 'No volume', 'Other']
export const ACTIVITY_TYPES = ['Visit', 'Call', 'Text', 'Email', 'Leave-behind', 'Note']
export const STEP_TAGS = ['Intro', 'Discovery', 'Demo offer', 'Billing talk', 'Follow-up', 'Close', 'Check-in']

// What each stage is FOR, what to say, and which of Blount's five questions you're after.
export const COACH = {
  Qualified:       { goal: 'Decide if this shop is worth the pursuit.', say: 'Score them: Technical (do they have the volume and the cars we calibrate?), Stakeholder (can we reach the owner or the lead estimator?), Fit (DRPs, current setup, distance).', question: 'Is this a High Potential Prospect?', done: 'All three scores filled in.' },
  Prospecting:     { goal: 'Get a real conversation started.', say: '"Hey, I\'m Mark with Absolute ADAS — we\'re the mobile calibration shop that shows up same day. Who handles your ADAS right now?" Stop by with the van; a face beats a call.', question: 'Do I like you?', done: 'One visit or call logged.' },
  Connected:       { goal: 'Find the decision maker and the estimator, and listen.', say: 'Ask what their current setup costs them in days: "When a car needs a calibration, how long before it\'s back on the lot?" Write down THEIR words.', question: 'Do you listen to me?', done: 'Pain in their words, pain types, and the decision maker named.' },
  Discovery:       { goal: 'Bridge their pain to the Absolute Promise.', say: '"Every calibration we recommend, you get paid for — same day, with the report the insurer wants." Show the online report on your phone. Set billing expectations: who pays, how, the Big 3.', question: 'Do you get me and my problems?', done: 'Billing expectations set.' },
  Bridged:         { goal: 'Ask for the next step — a specific car on a specific day.', say: '"Send me the next car that needs a calibration and let us prove it." Get a date, not a maybe.', question: 'Do I trust and believe you?', done: 'A next step with a date.' },
  'Next Step Asked': { goal: 'Deliver what you promised, then paperwork.', say: 'Get the W-9 over, make sure Kat has the contact, confirm the first job. No new asks until the first car is done right.', question: 'Do I trust and believe you?', done: 'W-9 received.' },
  Stalled:         { goal: 'Re-open without pressure.', say: '"Checking in — we calibrated a [make] for [nearby shop] yesterday, same day. Still want to try us on one?" One touch, then let it breathe.', question: 'Do I like you?', done: 'Any activity moves it back to its last live stage.' },
  Implementing:    { goal: 'First two jobs, done right, documented.', say: 'Over-communicate on car one and car two: ETA text, report the same day, invoice the same day. Ask the estimator how it felt.', question: 'Do I trust and believe you?', done: 'Two jobs linked and completed.' },
  Won:             { goal: 'Keep them.', say: '30-day review: "What would make this easier for you?" Ask for one referral.', question: '—', done: '' },
  Lost:            { goal: 'Leave the door open.', say: 'Thank them, log the real reason, set the recontact date if it was timing.', question: '—', done: '' },
}

// Priority from the three qualifiers (Mark's rule): HPP = 2+ High and no Low; LPP = 2+ Low; else MPP.
export function computePriority({ tq_score, sq_score, fq_score }) {
  const s = [tq_score, sq_score, fq_score].map(x => String(x || ''))
  const highs = s.filter(x => x === 'High').length, lows = s.filter(x => x === 'Low').length
  if (!s.every(Boolean)) return ''
  if (highs >= 2 && lows === 0) return 'HPP'
  if (lows >= 2) return 'LPP'
  return 'MPP'
}

// Stage gates — what a deal must carry BEFORE it can enter a stage. Returns the blocking message or ''.
export function gateFor(stage, d, { objection = '' } = {}) {
  const miss = []
  const scores = ['tq_score', 'sq_score', 'fq_score'].every(k => SCORES.includes(String(d[k] || '')))
  switch (stage) {
    case 'Prospecting': if (!scores) miss.push('all three scores (Technical / Stakeholder / Fit)'); break
    case 'Connected': if (!(d._activity_count > 0 || d._has_visit_or_call)) miss.push('at least one Visit or Call logged'); break
    case 'Discovery':
      if (!String(d.pain_in_their_words || '').trim()) miss.push('the pain in their own words')
      if (!(parseList(d.pain_types).length)) miss.push('at least one pain type')
      if (!String(d.decision_maker_id || '').trim()) miss.push('the decision maker'); break
    case 'Bridged': if (d.billing_expectations_set !== true) miss.push('billing expectations set'); break
    case 'Next Step Asked': if (!String(d.next_step || '').trim() || !d.next_step_date) miss.push('a next step with a date'); break
    case 'Implementing': if (d.w9_received !== true) miss.push('the W-9 received'); break
    case 'Won': if (!d.first_job_id || !d.second_job_id) miss.push('the first and second job linked'); break
    case 'Lost':
      if (!String(d.lost_reason || '').trim()) miss.push('a lost reason')
      if ((objection === 'Timing' || d.objection_type === 'Timing' || /timing/i.test(String(d.lost_reason || ''))) && !d.recontact_date) miss.push('a recontact date (lost on timing)'); break
    default: break
  }
  if (OPEN_STAGES.includes(stage) && stage !== 'Qualified' && stage !== 'Stalled' && stage !== 'Implementing') {
    if (d.next_step_date && d.next_step_date < todayPT() && stage !== 'Prospecting') miss.push('a FUTURE next step date (the current one is past)')
  }
  return miss.length ? `Can't move to ${stage} without ${miss.join(', ')}.` : ''
}
export const parseList = v => { if (Array.isArray(v)) return v; try { const a = JSON.parse(v || '[]'); return Array.isArray(a) ? a : [] } catch { return String(v || '').split(/\s*[,|]\s*/).filter(Boolean) } }

// ── rows ────────────────────────────────────────────────────────────────────
const COLS = 'ROWID, shop_id, shop_name, deal_owner, deal_type, deal_stage, stage_entered_at, tq_score, sq_score, fq_score, priority_level, current_setup, est_monthly_volume, drp_affiliations, pain_in_their_words, pain_types, decision_maker_id, estimator_id, next_step, next_step_date, billing_expectations_set, w9_received, first_job_id, second_job_id, objection_type, lost_reason, recontact_date, created_at, updated_at, meta'
function shape(r) {
  let meta = {}; try { meta = JSON.parse(r.meta || '{}') || {} } catch { meta = {} }
  return {
    id: String(r.ROWID || ''), shop_id: r.shop_id || '', shop_name: r.shop_name || '', owner: r.deal_owner || '', deal_type: r.deal_type || 'New Account',
    stage: r.deal_stage || 'Qualified', stage_entered_at: r.stage_entered_at || '', tq_score: r.tq_score || '', sq_score: r.sq_score || '', fq_score: r.fq_score || '',
    priority: r.priority_level || '', current_setup: r.current_setup || '', est_monthly_volume: Number(r.est_monthly_volume || 0) || 0, drp_affiliations: r.drp_affiliations || '',
    pain_in_their_words: r.pain_in_their_words || '', pain_types: parseList(r.pain_types), decision_maker_id: r.decision_maker_id || '', estimator_id: r.estimator_id || '',
    next_step: r.next_step || '', next_step_date: r.next_step_date ? String(r.next_step_date).slice(0, 10) : '', billing_expectations_set: r.billing_expectations_set === true || r.billing_expectations_set === 'true',
    w9_received: r.w9_received === true || r.w9_received === 'true', first_job_id: r.first_job_id || '', second_job_id: r.second_job_id || '', objection_type: r.objection_type || '', lost_reason: r.lost_reason || '',
    recontact_date: r.recontact_date ? String(r.recontact_date).slice(0, 10) : '', created_at: r.created_at || '', updated_at: r.updated_at || '', meta,
    days_in_stage: r.stage_entered_at ? Math.max(0, Math.floor((Date.now() - new Date(r.stage_entered_at).getTime()) / 86400000)) : 0,
    next_step_overdue: !!(r.next_step_date && String(r.next_step_date).slice(0, 10) < todayPT()),
  }
}
const toRow = d => ({
  shop_id: str(d.shop_id, 64), shop_name: str(d.shop_name, 200), deal_owner: str(d.owner, 40), deal_type: str(d.deal_type, 30), deal_stage: str(d.stage, 30), stage_entered_at: d.stage_entered_at || null,
  tq_score: str(d.tq_score, 10), sq_score: str(d.sq_score, 10), fq_score: str(d.fq_score, 10), priority_level: str(d.priority, 10), current_setup: str(d.current_setup, 40),
  est_monthly_volume: Number(d.est_monthly_volume) || 0, drp_affiliations: str(d.drp_affiliations, 255), pain_in_their_words: String(d.pain_in_their_words || '').slice(0, 9000),
  pain_types: JSON.stringify(parseList(d.pain_types)).slice(0, 255), decision_maker_id: str(d.decision_maker_id, 64), estimator_id: str(d.estimator_id, 64),
  next_step: str(d.next_step, 255), next_step_date: d.next_step_date || null, billing_expectations_set: !!d.billing_expectations_set, w9_received: !!d.w9_received,
  first_job_id: str(d.first_job_id, 64), second_job_id: str(d.second_job_id, 64), objection_type: str(d.objection_type, 40), lost_reason: str(d.lost_reason, 255), recontact_date: d.recontact_date || null,
  created_at: d.created_at || nowIso(), updated_at: nowIso(), meta: JSON.stringify(d.meta || {}).slice(0, 9000),
})

export async function listDeals(req, { stage = '', owner = '', open = null, shop_id = '' } = {}) {
  const where = []
  if (stage) where.push(`deal_stage = '${q(stage)}'`)
  if (owner) where.push(`deal_owner = '${q(owner)}'`)
  if (shop_id) where.push(`shop_id = '${q(shop_id)}'`)
  const out = [], seen = new Set()
  for (let off = 0; off < 5000; off += 300) {
    const rows = await ds(req).zcql().executeZCQLQuery(`SELECT ${COLS} FROM ${T}${where.length ? ' WHERE ' + where.join(' AND ') : ''} ORDER BY CREATEDTIME DESC LIMIT 300 OFFSET ${off}`)
    const b = (rows || []).map(r => r[T] || r)
    for (const r of b) { const id = String(r.ROWID); if (seen.has(id)) continue; seen.add(id); out.push(shape(r)) }
    if (b.length < 300) break
  }
  return open === true ? out.filter(d => OPEN_STAGES.includes(d.stage)) : open === false ? out.filter(d => !OPEN_STAGES.includes(d.stage)) : out
}
export async function getDeal(req, id) {
  const rows = await ds(req).zcql().executeZCQLQuery(`SELECT ${COLS} FROM ${T} WHERE ROWID = ${String(id).replace(/\D/g, '')} LIMIT 1`)
  const r = (rows || []).map(x => x[T] || x)[0]
  return r ? shape(r) : null
}
export async function createDeal(req, input, by = 'staff') {
  const { getAllShops } = await import('../routes/shops.js')
  const shops = await getAllShops(req)
  const shop = shops.find(s => String(s.id) === String(input.shop_id)) || shops.find(s => String(s.shop_name).toLowerCase() === String(input.shop_name || '').toLowerCase())
  if (!shop) throw Object.assign(new Error('shop not found in the CRM'), { status: 404 })
  const existing = (await listDeals(req, { shop_id: String(shop.id), open: true }))[0]
  if (existing) return { deal: existing, existed: true }
  const d = { ...input, shop_id: String(shop.id), shop_name: shop.shop_name, owner: input.owner || shop.assigned_to || 'Mark', deal_type: DEAL_TYPES.includes(input.deal_type) ? input.deal_type : (['active', 'active2', 'lost', 'denied'].includes(shop.pipeline_stage) ? 'Reactivation' : 'New Account'), stage: 'Qualified', stage_entered_at: nowIso(), created_at: nowIso() }
  d.priority = computePriority(d)
  const row = await ds(req).datastore().table(T).insertRow(toRow(d))
  const deal = shape({ ...toRow(d), ROWID: row.ROWID })
  await logHistory(req, deal.id, '', 'Qualified', by, 'created')
  return { deal, existed: false }
}
export async function updateDeal(req, id, patch, by = 'staff') {
  const cur = await getDeal(req, id); if (!cur) throw Object.assign(new Error('deal not found'), { status: 404 })
  const next = { ...cur, ...patch, id: cur.id, stage: cur.stage, stage_entered_at: cur.stage_entered_at, created_at: cur.created_at }
  next.priority = computePriority(next)
  await ds(req).datastore().table(T).updateRow({ ROWID: cur.id, ...toRow(next) })
  return getDeal(req, id)
}
export async function logHistory(req, dealId, from, to, by, note = '') {
  await ds(req).datastore().table(TH).insertRow({ deal_id: String(dealId), from_stage: str(from, 30), to_stage: str(to, 30), changed_by: str(by, 80), changed_at: nowIso(), note: str(note, 255) })
}
export async function listHistory(req, dealId) {
  const rows = await ds(req).zcql().executeZCQLQuery(`SELECT ROWID, deal_id, from_stage, to_stage, changed_by, changed_at, note FROM ${TH} WHERE deal_id = '${q(dealId)}' ORDER BY CREATEDTIME DESC LIMIT 100`)
  return (rows || []).map(x => x[TH] || x).map(r => ({ id: String(r.ROWID), from: r.from_stage || '', to: r.to_stage || '', by: r.changed_by || '', at: r.changed_at || '', note: r.note || '' }))
}
export async function listActivities(req, dealId, limit = 100) {
  const rows = await ds(req).zcql().executeZCQLQuery(`SELECT ROWID, deal_id, shop_id, activity_type, step_tag, summary, created_by, created_at, meta FROM ${TA} WHERE deal_id = '${q(dealId)}' ORDER BY CREATEDTIME DESC LIMIT ${limit}`)
  return (rows || []).map(x => x[TA] || x).map(r => { let meta = {}; try { meta = JSON.parse(r.meta || '{}') } catch {} ; return { id: String(r.ROWID), type: r.activity_type || '', step_tag: r.step_tag || '', summary: r.summary || '', by: r.created_by || '', at: r.created_at || '', meta } })
}
export async function recentActivities(req, sinceIso) {
  const rows = await ds(req).zcql().executeZCQLQuery(`SELECT ROWID, deal_id, shop_id, activity_type, step_tag, created_by, created_at FROM ${TA} WHERE created_at >= '${q(sinceIso)}' ORDER BY CREATEDTIME DESC LIMIT 300`)
  return (rows || []).map(x => x[TA] || x).map(r => ({ id: String(r.ROWID), deal_id: r.deal_id, shop_id: r.shop_id, type: r.activity_type || '', step_tag: r.step_tag || '', by: r.created_by || '', at: r.created_at || '' }))
}

/** Log an activity; mirrors to the shop's CRM timeline; a touch un-stalls the deal; next step/date and objection update the deal. */
export async function addActivity(req, dealId, { type, step_tag = '', summary = '', next_step = '', next_step_date = '', objection_type = '', meta = {} }, by = 'staff') {
  const deal = await getDeal(req, dealId); if (!deal) throw Object.assign(new Error('deal not found'), { status: 404 })
  const t = ACTIVITY_TYPES.includes(type) ? type : 'Note'
  await ds(req).datastore().table(TA).insertRow({ deal_id: String(dealId), shop_id: str(deal.shop_id, 64), activity_type: t, step_tag: str(step_tag, 40), summary: String(summary || '').slice(0, 9000), created_by: str(by, 80), created_at: nowIso(), meta: JSON.stringify({ ...meta, next_step, next_step_date, objection_type }).slice(0, 9000) })
  const patch = {}
  if (next_step) patch.next_step = next_step
  if (next_step_date) patch.next_step_date = next_step_date
  if (objection_type) patch.objection_type = objection_type
  patch.meta = { ...(deal.meta || {}), last_touch: nowIso(), touches: (Number(deal.meta?.touches) || 0) + 1 }
  let updated = await updateDeal(req, dealId, patch, by)
  // Mirror to the shop's timeline so the caller card / CRM detail still show one story.
  try {
    const { getAllShops, updateShop } = await import('../routes/shops.js')
    const shop = (await getAllShops(req)).find(s => String(s.id) === String(deal.shop_id))
    if (shop) {
      const map = { Visit: 'visit', Call: 'call', Text: 'note', Email: 'email', 'Leave-behind': 'note', Note: 'note' }
      const act = { id: `a_${Date.now()}${Math.random().toString(36).slice(2, 5)}`, type: map[t] || 'note', at: nowIso(), by, text: `${t}${step_tag ? ` · ${step_tag}` : ''}: ${String(summary || '').slice(0, 300)}${next_step ? ` → next: ${next_step}${next_step_date ? ` (${next_step_date})` : ''}` : ''}` }
      await updateShop(req, shop.id, { ...shop, activities: [...(Array.isArray(shop.activities) ? shop.activities : []), act].slice(-200), last_contact: todayPT(), ...(next_step_date ? { next_followup: next_step_date } : {}) })
    }
  } catch (e) { console.warn('[deals] mirror activity:', e.message) }
  // A real touch brings a Stalled deal back to its last live stage.
  if (updated.stage === 'Stalled' && ['Visit', 'Call', 'Text', 'Email'].includes(t)) {
    const back = updated.meta?.stalled_from && OPEN_STAGES.includes(updated.meta.stalled_from) ? updated.meta.stalled_from : 'Connected'
    updated = await moveDeal(req, dealId, back, by, { note: 'un-stalled by a touch', force: true })
  }
  return updated
}

// Shop pipeline_stage derived from the deal stage (keeps every existing CRM feature working).
const PIPE = { Qualified: 'target', Prospecting: 'contacted', Connected: 'contacted', Discovery: 'interested', Bridged: 'interested', 'Next Step Asked': 'proposal', Stalled: null, Implementing: 'active', Won: 'active', Lost: 'lost' }
export async function moveDeal(req, dealId, stage, by = 'staff', { note = '', force = false, objection = '' } = {}) {
  if (!STAGES.includes(stage)) throw Object.assign(new Error('unknown stage'), { status: 400 })
  const deal = await getDeal(req, dealId); if (!deal) throw Object.assign(new Error('deal not found'), { status: 404 })
  if (deal.stage === stage) return deal
  if (!force) {
    const acts = stage === 'Connected' ? await listActivities(req, dealId, 50) : []
    const block = gateFor(stage, { ...deal, _has_visit_or_call: acts.some(a => a.type === 'Visit' || a.type === 'Call') }, { objection })
    if (block) throw Object.assign(new Error(block), { status: 422, gate: true })
  }
  const meta = { ...(deal.meta || {}) }
  if (stage === 'Stalled') meta.stalled_from = deal.stage
  if (stage === 'Won') meta.won_at = nowIso()
  if (stage === 'Lost') meta.lost_at = nowIso()
  if (stage === 'Implementing') meta.implementing_at = nowIso()
  await ds(req).datastore().table(T).updateRow({ ROWID: deal.id, ...toRow({ ...deal, stage, stage_entered_at: nowIso(), meta, ...(objection ? { objection_type: objection } : {}) }) })
  await logHistory(req, dealId, deal.stage, stage, by, note)
  // Derive the shop's CRM stage.
  try {
    const target = PIPE[stage]
    if (target) {
      const { getAllShops, updateShop } = await import('../routes/shops.js')
      const shop = (await getAllShops(req)).find(s => String(s.id) === String(deal.shop_id))
      if (shop && shop.pipeline_stage !== target && !(target !== 'active' && ['active', 'active2'].includes(shop.pipeline_stage))) {
        const lostTo = stage === 'Lost' && /dealer|vendor/i.test(objection || deal.objection_type || '') ? 'denied' : target
        await updateShop(req, shop.id, { ...shop, pipeline_stage: lostTo, stage_changed_at: nowIso(), ...(stage === 'Lost' ? { lost_reason: deal.lost_reason || '' } : {}) })
      }
    }
  } catch (e) { console.warn('[deals] derive pipeline_stage:', e.message) }
  const after = await getDeal(req, dealId)
  try { await onStageEntered(req, after, by) } catch (e) { console.warn('[deals] stage hook:', e.message) }
  return after
}

// Automations on entering a stage (Mark's spec): Implementing → onboarding tasks.
async function onStageEntered(req, deal, by) {
  const { postToCliqChannel, DISPATCH_CHANNEL } = await import('./cliq.js')
  if (deal.stage === 'Implementing') {
    await postToCliqChannel(DISPATCH_CHANNEL, [`🚀 *${deal.shop_name} is implementing* (deal by ${by})`, '• Welcome email — goes out when the CRM card flips Active', '• Cliq group chat with the shop — Mark', `• Scheduling — Kat: first car, same day`, deal.next_step ? `• Next step: ${deal.next_step}${deal.next_step_date ? ` (${deal.next_step_date})` : ''}` : ''].filter(Boolean).join('\n')).catch(() => {})
  }
  if (deal.stage === 'Won') await postToCliqChannel(DISPATCH_CHANNEL, `🏆 *WON · ${deal.shop_name}* — two jobs done. 30-day review on ${addDays(todayPT(), 30)} (deal by ${by}).`).catch(() => {})
  if (deal.stage === 'Lost') await postToCliqChannel(DISPATCH_CHANNEL, `❌ Lost · ${deal.shop_name} — ${deal.lost_reason || deal.objection_type || 'no reason'}${deal.recontact_date ? ` · recontact ${deal.recontact_date}` : ''}`).catch(() => {})
}
const addDays = (iso, n) => { const d = new Date(`${iso}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10) }

// ── Sales Mode queue ─────────────────────────────────────────────────────────
// Order (Mark 2026-10-08): overdue promises → HPP due today → shops near today's jobs → stalled → new HPP with no deal.
export async function salesQueue(req, { owner = '', today = todayPT() } = {}) {
  const deals = await listDeals(req, { open: true })
  const mine = owner ? deals.filter(d => !d.owner || d.owner === owner) : deals
  const { getAllShops } = await import('../routes/shops.js')
  const shops = await getAllShops(req)
  const shopById = new Map(shops.map(s => [String(s.id), s]))
  let todaysRegions = new Set()
  try { const { readJobsPublic } = await import('../routes/jobs.js'); const jobs = (await readJobsPublic(req)).filter(j => String(j.scheduled_date || '').slice(0, 10) === today); todaysRegions = new Set(jobs.map(j => String(j.region || '').toLowerCase()).filter(Boolean)) } catch { /* fine */ }
  const card = (d, why, bucket) => { const s = shopById.get(String(d.shop_id)) || {}; return { deal: d, why, bucket, shop: { id: s.id, name: s.shop_name || d.shop_name, phone: s.phone || '', address: s.address || '', people: s.people || [], region: s.region || '', notes: String(s.notes || '').slice(0, 200), last_contact: s.last_contact || '' }, coach: COACH[d.stage] || COACH.Prospecting } }
  const out = []
  const used = new Set()
  const push = (d, why, bucket) => { if (used.has(d.id)) return; used.add(d.id); out.push(card(d, why, bucket)) }
  for (const d of mine.filter(d => d.next_step_date && d.next_step_date < today).sort((a, b) => a.next_step_date.localeCompare(b.next_step_date))) push(d, `Overdue: "${d.next_step || 'next step'}" was due ${d.next_step_date}`, 'overdue')
  for (const d of mine.filter(d => d.next_step_date === today).sort((a, b) => (a.priority === 'HPP' ? -1 : 1))) push(d, `Due today: ${d.next_step || 'next step'}`, 'today')
  for (const d of mine.filter(d => d.priority === 'HPP' && todaysRegions.has(String(shopById.get(String(d.shop_id))?.region || '').toLowerCase()) && d.stage !== 'Stalled')) push(d, `Near today's jobs (${shopById.get(String(d.shop_id))?.region}) — stop by`, 'nearby')
  for (const d of mine.filter(d => d.stage === 'Stalled').sort((a, b) => b.days_in_stage - a.days_in_stage)) push(d, `Stalled ${d.days_in_stage} days — one light touch`, 'stalled')
  for (const d of mine.filter(d => d.priority === 'HPP' && !d.next_step_date).sort((a, b) => b.days_in_stage - a.days_in_stage)) push(d, 'HPP with no next step — set one', 'no_next_step')
  // New HPP targets with no deal yet: high fit_score shops in the pipeline, not customers.
  const dealShopIds = new Set(deals.map(d => String(d.shop_id)))
  const targets = shops.filter(s => !dealShopIds.has(String(s.id)) && ['target', 'contacted', 'interested'].includes(s.pipeline_stage) && Number(s.fit_score || 0) >= 7).slice(0, 5)
  for (const s of targets) out.push({ deal: null, why: `No deal yet · fit ${s.fit_score}/10 — qualify them`, bucket: 'new', shop: { id: s.id, name: s.shop_name, phone: s.phone || '', address: s.address || '', people: s.people || [], region: s.region || '', notes: String(s.notes || '').slice(0, 200), last_contact: s.last_contact || '' }, coach: COACH.Qualified })
  return { today, count: out.length, queue: out.slice(0, 25), totals: { overdue: out.filter(x => x.bucket === 'overdue').length, today: out.filter(x => x.bucket === 'today').length, nearby: out.filter(x => x.bucket === 'nearby').length, stalled: out.filter(x => x.bucket === 'stalled').length } }
}

/** Next steps due today + overdue (6 AM list; Ada endpoint). */
export async function dueList(req, { today = todayPT() } = {}) {
  const deals = await listDeals(req, { open: true })
  const overdue = deals.filter(d => d.next_step_date && d.next_step_date < today).sort((a, b) => a.next_step_date.localeCompare(b.next_step_date))
  const due = deals.filter(d => d.next_step_date === today)
  const missing = deals.filter(d => !d.next_step_date && !['Qualified', 'Stalled'].includes(d.stage))
  return { today, overdue, due, missing, open: deals.length }
}
export function formatDue(l) {
  const line = d => `• ${d.shop_name} — ${d.next_step || 'next step'}${d.owner ? ` (${d.owner})` : ''}`
  const parts = [`💼 *Sales · ${l.today}* — ${l.open} open deal${l.open === 1 ? '' : 's'}`]
  parts.push(l.due.length ? `*Due today (${l.due.length})*\n${l.due.map(line).join('\n')}` : 'Nothing due today.')
  if (l.overdue.length) parts.push(`*Overdue (${l.overdue.length})*\n${l.overdue.map(d => `${line(d)} · was ${d.next_step_date}`).join('\n')}`)
  if (l.missing.length) parts.push(`*No next step (${l.missing.length})*: ${l.missing.map(d => d.shop_name).join(', ')}`)
  return parts.join('\n\n')
}
export function spokenDue(l) {
  if (!l.open) return ''
  const n = l.due.length + l.overdue.length
  if (!n) return `Sales: ${l.open} open deals, nothing due today.`
  const first = [...l.overdue, ...l.due].slice(0, 3).map(d => `${d.shop_name}, ${d.next_step || 'follow up'}`).join('. ')
  return `Sales: ${l.overdue.length ? `${l.overdue.length} overdue, ` : ''}${l.due.length} due today. ${first}.`
}

/** Daily sweep: no activity in 14 days → Stalled (with history). Lost + recontact date reached → Prospecting. Won + 30 → review task. */
export async function dailySweep(req) {
  const today = todayPT()
  const deals = await listDeals(req)
  const out = { stalled: [], reopened: [], reviews: [] }
  const cutoff = Date.now() - 14 * 86400000
  for (const d of deals) {
    try {
      if (OPEN_STAGES.includes(d.stage) && !['Stalled', 'Qualified', 'Implementing'].includes(d.stage)) {
        const last = new Date(d.meta?.last_touch || d.stage_entered_at || d.created_at || 0).getTime()
        if (last && last < cutoff) { await moveDeal(req, d.id, 'Stalled', 'auto', { note: 'no activity in 14 days', force: true }); out.stalled.push(d.shop_name) }
      }
      if (d.stage === 'Lost' && d.recontact_date && d.recontact_date <= today && !d.meta?.reopened_at) {
        await ds(req).datastore().table(T).updateRow({ ROWID: d.id, ...toRow({ ...d, stage: 'Prospecting', stage_entered_at: nowIso(), next_step: 'Recontact', next_step_date: today, meta: { ...(d.meta || {}), reopened_at: nowIso() } }) })
        await logHistory(req, d.id, 'Lost', 'Prospecting', 'auto', 'recontact date reached'); out.reopened.push(d.shop_name)
      }
      if (d.stage === 'Won' && d.meta?.won_at && !d.meta?.review_posted && Date.now() - new Date(d.meta.won_at).getTime() >= 30 * 86400000) {
        const { postToCliqChannel, DISPATCH_CHANNEL } = await import('./cliq.js')
        await postToCliqChannel(DISPATCH_CHANNEL, `📅 *30-day review · ${d.shop_name}* — ask "what would make this easier?" and for one referral.`).catch(() => {})
        await ds(req).datastore().table(T).updateRow({ ROWID: d.id, ...toRow({ ...d, meta: { ...(d.meta || {}), review_posted: nowIso() } }) }); out.reviews.push(d.shop_name)
      }
    } catch (e) { console.warn('[deals sweep]', d.id, e.message) }
  }
  return out
}

/** Job hooks: a linked job completing → 7-day follow-up (first) or auto-Won (second). */
export async function onJobCompleted(req, job) {
  const deals = await listDeals(req, { open: true })
  const hit = deals.find(d => d.first_job_id === String(job.id) || d.second_job_id === String(job.id))
  if (!hit) return null
  const { postToCliqChannel, DISPATCH_CHANNEL } = await import('./cliq.js')
  if (hit.second_job_id === String(job.id)) { const m = await moveDeal(req, hit.id, 'Won', 'auto', { note: 'second linked job completed', force: true }); return { won: m.id } }
  if (hit.first_job_id === String(job.id)) { await updateDeal(req, hit.id, { next_step: 'Follow up on the first job — how did it feel?', next_step_date: addDays(todayPT(), 7) }, 'auto'); await postToCliqChannel(DISPATCH_CHANNEL, `✅ First job done for *${hit.shop_name}* — follow-up set for ${addDays(todayPT(), 7)}.`).catch(() => {}); return { followup: hit.id } }
  return null
}

/** Scorecard (Mark's spec). */
export async function scorecard(req) {
  const today = todayPT()
  const weekAgo = new Date(Date.now() - 7 * 86400000).toISOString()
  const deals = await listDeals(req)
  const open = deals.filter(d => OPEN_STAGES.includes(d.stage))
  const acts = await recentActivities(req, weekAgo).catch(() => [])
  const hist = []
  for (const d of deals.slice(0, 200)) { try { hist.push(...(await listHistory(req, d.id)).map(h => ({ ...h, deal: d }))) } catch { /* fine */ } }
  const weekMoves = hist.filter(h => h.at >= weekAgo && h.to)
  const monthStart = today.slice(0, 7) + '-01'
  const wins = deals.filter(d => d.stage === 'Won' && String(d.meta?.won_at || '').slice(0, 10) >= monthStart)
  const lost = deals.filter(d => d.stage === 'Lost')
  const count = (arr, f) => arr.reduce((m, x) => { const k = f(x) || '—'; m[k] = (m[k] || 0) + 1; return m }, {})
  const daysPerStage = {}
  for (const s of STAGES) { const entered = hist.filter(h => h.to === s); const exited = hist.filter(h => h.from === s); const ds_ = []; for (const e of entered) { const x = exited.find(h => h.deal.id === e.deal.id && h.at > e.at); if (x) ds_.push((new Date(x.at) - new Date(e.at)) / 86400000) } daysPerStage[s] = ds_.length ? Math.round(ds_.reduce((a, b) => a + b, 0) / ds_.length * 10) / 10 : null }
  const conversion = {}
  for (let i = 0; i < STAGES.length - 1; i++) { const s = STAGES[i]; const reached = new Set(hist.filter(h => h.to === s).map(h => h.deal.id)); const next = new Set(hist.filter(h => reached.has(h.deal.id) && STAGES.indexOf(h.to) > i).map(h => h.deal.id)); conversion[s] = reached.size ? Math.round(next.size / reached.size * 100) : null }
  const { getAllShops } = await import('../routes/shops.js')
  const shops = await getAllShops(req).catch(() => [])
  const dealShopIds = new Set(deals.map(d => String(d.shop_id)))
  const hppNoDeal = shops.filter(s => !dealShopIds.has(String(s.id)) && Number(s.fit_score || 0) >= 8 && !['active', 'active2'].includes(s.pipeline_stage)).map(s => s.shop_name)
  return { today, open: open.length, by_stage: count(open, d => d.stage), by_priority: count(open, d => d.priority), touches_week: acts.length, touches_by_type: count(acts, a => a.type), touches_by_person: count(acts, a => a.by), stage_moves_week: weekMoves.length,
    next_steps: { due_today: open.filter(d => d.next_step_date === today).length, overdue: open.filter(d => d.next_step_date && d.next_step_date < today).length, missing: open.filter(d => !d.next_step_date).length },
    conversion, avg_days_per_stage: daysPerStage, wins_month: wins.map(d => d.shop_name), lost_reasons: count(lost, d => d.lost_reason), top_objections: count(deals.filter(d => d.objection_type), d => d.objection_type), hpp_no_deal: hppNoDeal }
}
