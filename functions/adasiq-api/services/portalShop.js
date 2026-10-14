// Portal isolation + shop-scoped cars / board requests (Mark 2026-10-09).
// Session shop_id is the only shop a caller can see. Guessing another id
// returns empty, not their cars.
import { shopKey, shopTokens, aliasesOf, resolveShop } from './shopResolve.js'
import { listScrubs, getScrub, linkScrubJob } from './scrubStore.js'
import { insertJob, readJobsPublic } from '../routes/jobs.js'
import { postToCliqChannel, AA_JOBS_CHANNEL, DISPATCH_CHANNEL } from './cliq.js'
import { createNotification } from '../routes/notifications.js'

export function namesOf(shop) {
  return [shop?.shop_name, ...aliasesOf(shop)].map(s => String(s || '').trim()).filter(Boolean)
}

export function ownsName(shop, name) {
  if (!shop || !name) return false
  if (shopKey(name) === shopKey(shop.shop_name)) return true
  if (aliasesOf(shop).some(a => shopKey(a) === shopKey(name))) return true
  return false
}

export async function ownsNameResolved(req, shop, name) {
  if (ownsName(shop, name)) return true
  if (!name) return false
  const r = await resolveShop(req, name, { remember: false })
  return !!(r.shop && String(r.shop.id) === String(shop.id) && !r.unmatched)
}

export function ownsScrub(shop, scrub) {
  if (!shop || !scrub) return false
  if (scrub.shopId && String(scrub.shopId) === String(shop.id)) return true
  if (scrub._shopId && String(scrub._shopId) === String(shop.id)) return true
  return ownsName(shop, scrub.shop)
}

export async function ownsScrubResolved(req, shop, scrub) {
  if (ownsScrub(shop, scrub)) return true
  return ownsNameResolved(req, shop, scrub?.shop)
}

export function ownsJob(shop, job) {
  if (!shop || !job) return false
  if (job.crm_shop_id && String(job.crm_shop_id) === String(shop.id)) return true
  return ownsName(shop, job.shop_name)
}

export function ownsInvoice(shop, inv) {
  if (!shop || !inv) return false
  if (inv.crm_shop_id && String(inv.crm_shop_id) === String(shop.id)) return true
  if (shop.zoho_contact_id && String(inv.customer_id || inv.zoho_customer_id || '') === String(shop.zoho_contact_id)) return true
  if (ownsName(shop, inv.customer_name)) return true
  const billing = String(shop.billing_rules?.billing_contact_email || shop.email || '').toLowerCase()
  if (billing && String(inv.customer_email || '').toLowerCase() === billing) return true
  return false
}

function publicCals(scrub) {
  const raw = Array.isArray(scrub?.payload?.calibrations) ? scrub.payload.calibrations : []
  if (raw.length) {
    return raw.map(c => ({
      name: c.calibration_name || c.name || '',
      type: c.cal_type || c.type || '',
      required: c.enabled !== false && (c.required !== false),
    })).filter(c => c.name)
  }
  return (scrub?.sensors || []).map(x => ({
    name: x.n || x.name || '',
    type: x.t || x.type || '',
    required: !!(x.r ?? x.required),
  })).filter(c => c.name)
}

export function publicScrub(scrub, { full = false } = {}) {
  if (!scrub) return null
  const cals = publicCals(scrub)
  const required = cals.filter(c => c.required)
  const out = {
    id: String(scrub.id || ''),
    shop: scrub.shop || '',
    vehicle: scrub.vehicle || [scrub.year, scrub.make, scrub.model].filter(Boolean).join(' '),
    year: scrub.year || '',
    make: scrub.make || '',
    model: scrub.model || '',
    vin: scrub.vin || '',
    ro: scrub.ro || '',
    claim: scrub.claim || '',
    insurer: scrub.insurer || '',
    at: scrub.at || '',
    stage: scrub.stage || 'scrubbed',
    quoteNumber: scrub.quoteNumber || '',
    requiredCount: required.length || Number(scrub.requiredCount || 0),
    required: required.map(c => c.name),
    hasPdf: !!(scrub.fileId || scrub.fileName),
    jobId: scrub.jobId || '',
  }
  if (full) {
    out.calibrations = cals
    out.requiredLines = required
    out.notRequired = cals.filter(c => !c.required).map(c => c.name)
  }
  return out
}

export async function listShopScrubs(req, shop) {
  const token = shopTokens(shop.shop_name)[0] || shop.shop_name
  const queries = [...new Set([shop.shop_name, token, ...namesOf(shop).slice(0, 4)])]
  const seen = new Map()
  for (const q of queries) {
    if (!q || String(q).length < 3) continue
    const { scrubs } = await listScrubs(req, { shop: q, limit: 80, maxScan: 900 })
    for (const s of scrubs || []) {
      if (seen.has(s.id)) continue
      if (await ownsScrubResolved(req, shop, s)) seen.set(s.id, publicScrub(s))
    }
  }
  return [...seen.values()].sort((a, b) => String(b.at || '').localeCompare(String(a.at || '')))
}

export async function getShopScrub(req, shop, id) {
  const scrub = await getScrub(req, id)
  if (!scrub || !(await ownsScrubResolved(req, shop, scrub))) return null
  return { raw: scrub, public: publicScrub(scrub, { full: true }) }
}

function linesFromScrub(scrub) {
  const raw = Array.isArray(scrub?.payload?.calibrations) && scrub.payload.calibrations.length
    ? scrub.payload.calibrations
    : (scrub.sensors || []).map(x => ({
      calibration_name: x.n, cal_type: x.t, trigger: x.g, line_references: x.l,
      justification: '', enabled: !!x.r,
    }))
  return raw.map(c => ({
    calibration_name: c.calibration_name || c.name || '',
    cal_type: c.cal_type || c.type || '',
    trigger: c.trigger || '',
    line_references: c.line_references || c.lines || '',
    justification: c.justification || c.why || '',
    enabled: c.enabled !== false && (c.required !== false),
  })).filter(c => c.calibration_name)
}

async function notifyRequest(req, job, { quote = false } = {}) {
  const vehicle = job.vehicle || [job.year, job.make, job.model].filter(Boolean).join(' ')
  const shop = job.shop_name || 'Unknown shop'
  const reqBy = job.technician ? ` · 👤 Requested by ${job.technician}` : ''
  const ro = job.quote_number ? ` · RO# ${job.quote_number}` : ''
  const header = quote ? '📝 *Quote Requested*' : '🆕 *Job Requested*'
  const via = ' · shop portal'
  const msg = [`${header} · ${shop}${via}`, `${vehicle || 'Vehicle TBD'}${ro}${reqBy}`].join('\n')
  await postToCliqChannel(AA_JOBS_CHANNEL, msg).catch(e => console.warn('[portal] aajobs', e.message))
  await postToCliqChannel(DISPATCH_CHANNEL, msg).catch(e => console.warn('[portal] dispatch', e.message))
  await createNotification(req, {
    to: 'Kath', toEmail: 'k.belmonte@absoluteadas.com',
    type: 'job_requested',
    title: `${quote ? 'New quote request' : 'New job request'}: ${shop}`,
    body: `${vehicle || 'Vehicle TBD'}${reqBy}${ro} · portal`,
    jobId: job.id, job,
    skipCliq: true, skipTechChannel: true,
  }).catch(e => console.warn('[portal] notif', e.message))
}

export async function requestFromScrub(req, shop, user, scrubId, kind) {
  const hit = await getShopScrub(req, shop, scrubId)
  if (!hit) return { ok: false, status: 404, error: 'Car not found' }
  const scrub = hit.raw
  const quote = kind === 'quote'
  if (quote && (scrub.stage === 'quoted' || scrub.quoteNumber)) {
    return { ok: true, already: true, scrub: hit.public, message: `Quote ${scrub.quoteNumber || 'already sent'}` }
  }
  if (!quote && (scrub.stage === 'requested' || scrub.stage === 'job') && scrub.jobId) {
    return { ok: true, already: true, scrub: hit.public, message: 'This car is already on our board' }
  }
  const cals = linesFromScrub(scrub)
  const reqNames = cals.filter(c => c.enabled).map(c => c.calibration_name)
  const who = user?.name || user?.username || shop.shop_name
  const notes = [
    `${quote ? '📝 Quote requested' : '📋 Job requested'} from the shop portal · ${who}`,
    reqNames.length ? `Required: ${reqNames.join(', ')}` : 'Scrub found nothing required — check before dispatch',
    scrub.fileId ? `CCC estimate: https://workdrive.zoho.com/file/${scrub.fileId}` : '',
  ].filter(Boolean).join('\n')
  const job = await insertJob(req, {
    shop_name: shop.shop_name,
    crm_shop_id: String(shop.id),
    customer: { kind: 'shop', name: shop.shop_name, zoho_contact_id: shop.zoho_contact_id || '' },
    year: scrub.year || '', make: scrub.make || '', model: scrub.model || '',
    vehicle: [scrub.year, scrub.make, scrub.model].filter(Boolean).join(' ') || scrub.vehicle || '',
    vin: scrub.vin || '', insurer: scrub.insurer || '',
    quote_number: scrub.ro || '', ro_number: scrub.ro || '',
    technician: who,
    notes,
    status: 'job_requested',
    via_request: true,
    request_type: quote ? 'quote' : 'job',
    submitted_via_portal: true,
    calibrations: JSON.stringify(cals),
  })
  const stage = quote ? 'quote_requested' : 'requested'
  await linkScrubJob(req, scrub.id, { jobId: String(job.id), stage }).catch(() => {})
  await notifyRequest(req, job, { quote })
  const next = await getShopScrub(req, shop, scrubId)
  return {
    ok: true,
    job: { id: job.id, status: job.status },
    scrub: next?.public || hit.public,
    message: quote
      ? 'Quote requested. We will send pricing.'
      : 'Job requested. We will dispatch and confirm.',
  }
}

export async function requestManualJob(req, shop, user, body = {}) {
  const who = user?.name || user?.username || body.requested_by_name || shop.shop_name
  const vehicle = [body.year, body.make, body.model].filter(Boolean).join(' ')
  const cals = Array.isArray(body.calibrations) ? body.calibrations : []
  const job = await insertJob(req, {
    shop_name: shop.shop_name,
    crm_shop_id: String(shop.id),
    customer: { kind: 'shop', name: shop.shop_name, zoho_contact_id: shop.zoho_contact_id || '' },
    year: (body.year || '').trim(), make: (body.make || '').trim(), model: (body.model || '').trim(),
    vehicle, vin: (body.vin || '').trim(), insurer: (body.insurer || '').trim(),
    quote_number: (body.ro_number || '').trim(), ro_number: (body.ro_number || '').trim(),
    technician: who,
    notes: [
      `📋 Job requested from the shop portal · ${who}`,
      body.requested_date ? `Preferred date: ${body.requested_date}` : '',
      body.requested_by_phone ? `Phone: ${body.requested_by_phone}` : '',
      (body.notes || '').trim(),
    ].filter(Boolean).join('\n'),
    status: 'job_requested',
    via_request: true,
    request_type: 'job',
    submitted_via_portal: true,
    calibrations: JSON.stringify(cals.map(n => ({ calibration_name: String(n), enabled: true }))),
    scheduled_date: body.requested_date || '',
  })
  await notifyRequest(req, job, { quote: false })
  return { ok: true, job: { id: job.id, status: job.status } }
}

export async function listShopJobs(req, shop) {
  const jobs = await readJobsPublic(req)
  let merge = (j, _m) => j
  let stateMap = {}
  try {
    const d = await import('./dispatch.js')
    merge = d.mergeJobState
    stateMap = await d.readJobState(req)
  } catch { /* status still works off the board */ }
  const out = []
  for (const j of jobs) {
    if (ownsJob(shop, j) || await ownsNameResolved(req, shop, j.shop_name)) out.push(merge(j, stateMap))
  }
  return out.sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')))
}

function techFirst(name) {
  const n = String(name || '').trim()
  if (!n) return ''
  if (/jayden|jaden/i.test(n)) return 'Jayden'
  if (/^mark\b/i.test(n)) return 'Mark'
  return n.split(/\s+/)[0]
}

function dateLabel(iso) {
  const d = String(iso || '').slice(0, 10)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return ''
  try {
    return new Date(`${d}T12:00:00`).toLocaleDateString('en-US', {
      weekday: 'short', month: 'short', day: 'numeric', timeZone: 'America/Los_Angeles',
    })
  } catch { return d }
}

/** Shop-facing status — never leak dispatched_jaden / internal board names. */
export function shopJobView(j) {
  const status = String(j.status || '')
  const quote = status === 'job_requested' && ['quote', 'equote'].includes(String(j.request_type || '').toLowerCase())
  const tech = techFirst(j.technician)
  const when = dateLabel(j.scheduled_date)
  const booked = !!when

  let stage = 'requested'
  let label = 'Requested'
  let message = 'We have your request. We’ll book a day.'

  if (status === 'cancelled' || status === 'dead') {
    stage = 'cancelled'; label = 'Cancelled'; message = 'This one is cancelled.'
  } else if (status === 'complete' || j.invoiced === true || j.invoiced === 'true') {
    stage = 'complete'; label = 'Complete'; message = 'Done and invoiced.'
  } else if (j.completed_at || status === 'ready_invoice') {
    stage = 'done'; label = 'Done'; message = 'Work is done. Invoice is next.'
  } else if (status === 'pending_parts') {
    stage = 'waiting_parts'; label = 'Waiting on parts'; message = 'Parked until parts are in.'
  } else if (j.started_at) {
    stage = 'at_shop'; label = 'At your shop'
    message = tech ? `${tech} is at your shop.` : 'We are at your shop.'
  } else if (j.en_route_at) {
    stage = 'on_the_way'; label = 'On the way'
    message = tech ? `${tech} is on the way.` : 'We are on the way.'
  } else if (quote) {
    stage = 'quoted'; label = 'Quote requested'; message = 'Quote is in. We’ll send numbers.'
  } else if (status === 'quoted') {
    stage = 'quoted'; label = 'Quoted'; message = 'Quote is with you.'
  } else if (status.startsWith('dispatched') || (booked && status !== 'job_requested')) {
    stage = 'booked'; label = 'Booked'
    message = when ? `Booked for ${when}.` : (tech ? `${tech} is assigned.` : 'On the calendar.')
  } else if (status === 'need_dispatch' || status === 'needs_dispatch') {
    stage = 'scheduling'; label = 'Scheduling'
    message = when ? `On our board — you asked for ${when}.` : 'On our board — we’ll book a day.'
  } else if (status === 'job_requested') {
    stage = 'requested'; label = 'Requested'
    message = when ? `We have your request. You asked for ${when}.` : 'We have your request. We’ll book a day.'
  }

  return {
    stage, label, message,
    scheduled_date: j.scheduled_date || '',
    scheduled_label: when,
    technician: tech,
    live: stage === 'on_the_way' || stage === 'at_shop',
    open: !['complete', 'cancelled', 'done'].includes(stage),
  }
}

export async function listShopEstimates(req, shop) {
  const pct = await shopDiscountPct(req, shop)
  const out = []
  try {
    const { readQuoteRecords } = await import('../routes/shopQuotes.js')
    const recs = await readQuoteRecords(req)
    for (const q of recs || []) {
      const books = shop.zoho_contact_id && String(q.customer_id) === String(shop.zoho_contact_id)
      if (!books && !ownsName(shop, q.shop) && !(await ownsNameResolved(req, shop, q.shop))) continue
      if (q.status === 'dead') continue
      const list = Number(q.insurance_total || q.total) || 0
      const paid = Number(q.cost_total) || 0
      const saved = paid > 0 && list > paid ? r2(list - paid) : r2(list * pct / 100)
      out.push({
        id: q.estimate_id,
        number: q.estimate_number || '',
        vehicle: q.vehicle || '',
        vin: q.vin || '',
        ro: q.ro_number || '',
        insurer: q.insurer || '',
        total: list,
        you_pay: paid > 0 ? paid : r2(list - saved),
        saved,
        discount_pct: pct,
        status: q.status || '',
        sent_at: q.sent_at || q.created_at || '',
      })
    }
  } catch (e) { console.warn('[portal] estimates:', e.message) }
  const jobs = await listShopJobs(req, shop)
  for (const j of jobs) {
    if (!j.quote_number && !j.zoho_estimate_id) continue
    if (out.some(e => e.number === j.quote_number || e.id === j.zoho_estimate_id)) continue
    const list = Number(j.quote_total || j.total || 0)
    const saved = r2(list * pct / 100)
    out.push({
      id: j.zoho_estimate_id || j.id,
      number: j.quote_number || '',
      vehicle: j.vehicle || [j.year, j.make, j.model].filter(Boolean).join(' '),
      vin: j.vin || '',
      ro: j.ro_number || '',
      insurer: j.insurer || '',
      total: list,
      you_pay: r2(list - saved),
      saved,
      discount_pct: pct,
      status: j.status === 'quoted' ? 'quoted' : (j.request_type === 'quote' ? 'requested' : j.status || ''),
      sent_at: j.created_at || '',
    })
  }
  out.sort((a, b) => String(b.sent_at || '').localeCompare(String(a.sent_at || '')))
  return out
}

function parseBR(shop) {
  const br = shop?.billing_rules
  if (!br) return {}
  if (typeof br === 'string') { try { return JSON.parse(br) || {} } catch { return {} } }
  return typeof br === 'object' && br ? br : {}
}

const r2 = n => Math.round((Number(n) || 0) * 100) / 100

export async function shopDiscountPct(req, shop) {
  const br = parseBR(shop)
  if (Number.isFinite(Number(br.discount_value))) return Math.max(0, Math.min(60, Number(br.discount_value)))
  const type = br.customer_type || ''
  if (!type || type === 'body_shop') return 25
  return 0
}

/** List minus cost — what the shop keeps vs paying our full price. */
export async function shopSavings(req, shop, invoices = []) {
  const pct = await shopDiscountPct(req, shop)
  let list = 0, cost = 0, saved = 0, jobs = 0
  const seen = new Set()

  try {
    const { readQuoteRecords } = await import('../routes/shopQuotes.js')
    for (const q of (await readQuoteRecords(req)) || []) {
      const books = shop.zoho_contact_id && String(q.customer_id) === String(shop.zoho_contact_id)
      if (!books && !ownsName(shop, q.shop) && !(await ownsNameResolved(req, shop, q.shop))) continue
      if (q.status === 'dead') continue
      const ins = Number(q.insurance_total || q.total) || 0
      const paid = Number(q.cost_total) || 0
      if (q.estimate_id) seen.add(String(q.estimate_id))
      if (q.estimate_number) seen.add(String(q.estimate_number))
      if (q.status === 'billed' && ins > 0 && paid > 0) {
        list += ins; cost += paid; saved += r2(ins - paid); jobs += 1
        if (q.cost_invoice_id) seen.add(String(q.cost_invoice_id))
        if (q.cost_invoice_number) seen.add(String(q.cost_invoice_number))
      } else if (ins > 0 && pct > 0) {
        const keep = r2(ins * pct / 100)
        list += ins; cost += r2(ins - keep); saved += keep; jobs += 1
      }
    }
  } catch (e) { console.warn('[portal] savings quotes:', e.message) }

  try {
    for (const j of await listShopJobs(req, shop)) {
      const jobList = Number(j.quote_total || j.total || 0)
      if (!(jobList > 0) || pct <= 0) continue
      if (j.quote_number && seen.has(String(j.quote_number))) continue
      if (j.zoho_estimate_id && seen.has(String(j.zoho_estimate_id))) continue
      const keep = r2(jobList * pct / 100)
      list += jobList; cost += r2(jobList - keep); saved += keep; jobs += 1
    }
  } catch { /* jobs optional */ }

  for (const inv of invoices) {
    if (inv.status === 'void') continue
    if (inv.invoice_type === 'insurance') continue
    const id = String(inv.id || ''), num = String(inv.invoice_number || '')
    if (seen.has(id) || seen.has(num)) continue
    const total = Number(inv.total) || 0
    const disc = Number(inv.discount) || 0
    const ipct = Number(inv.discount_pct) || pct
    if (disc > 0) {
      list += r2(total + disc); cost += total; saved += r2(disc); jobs += 1
    } else if (ipct > 0 && total > 0) {
      const listAmt = Number(inv.subtotal) > total ? Number(inv.subtotal) : r2(total / (1 - ipct / 100))
      list += listAmt; cost += total; saved += r2(listAmt - total); jobs += 1
    }
  }

  return {
    discount_pct: pct,
    saved: r2(saved),
    list: r2(list),
    cost: r2(cost),
    jobs,
  }
}
