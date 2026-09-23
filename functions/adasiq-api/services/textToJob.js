// 📱 Text → Job Request (Mark 2026-09-23: "if one of our shops says blank
// and blank car is ready I want it to automatically create a job request…
// the team needs to know it came via text… all the information they
// provide"). Runs inline on every inbound shop text (Twilio gives us ~15s,
// Catalyst freezes after the response), so: cheap regex gate first, Haiku
// only when the text smells like work, one card per vehicle, a second text
// about the same car lands on the open card instead of a twin.
import Anthropic from '@anthropic-ai/sdk'
import { postToCliqChannel, AA_JOBS_CHANNEL, DISPATCH_CHANNEL } from './cliq.js'
import { formatPhonePretty } from './twilio.js'

const WORK_RE = /\b(ready|calib|program|reflash|diag|scan|adas|vin|ro\s*#?\s*\d|stock\s*#?\s*\d|come (by|out|over)|swing by|schedule|reschedule|tomorrow|today|this (morning|afternoon)|monday|tuesday|wednesday|thursday|friday|needs?|can you|pick ?up|drop|windshield|glass|cracked|camera|radar|blind spot|alignment|last 4|hold off|hold|not ready|cancel|push (it|that)|bump)\b/i
const CHATTER_RE = /^(ok|okay|k+|kk+|thanks?|thank you|thx|ty|sweet|awesome|great|cool|sounds good|see (ya|you)|yes|no|yep|nope|👍|🙏|lol)\W*$/i

const ptToday = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
const ptWeekday = () => new Intl.DateTimeFormat('en-US', { timeZone: 'America/Los_Angeles', weekday: 'long' }).format(new Date())
const ptTime = () => new Intl.DateTimeFormat('en-US', { timeZone: 'America/Los_Angeles', hour: 'numeric', minute: '2-digit' }).format(new Date())

export function looksLikeWork(body) {
  const t = String(body || '').trim()
  if (t.length < 8 || CHATTER_RE.test(t)) return false
  if (/^(reacted|liked|loved|laughed at|emphasized|questioned|disliked) /i.test(t)) return false   // tapbacks arriving as text
  return WORK_RE.test(t)
}

const SCHEMA = `{
  "intent": "new_job" | "update" | "hold" | "question" | "chatter",
  "vehicles": [{
    "year": "", "make": "", "model": "",
    "vin": "",            // full 17 or the last 4 they gave, letters/digits only, else ""
    "ro": "",             // RO / stock / ticket number if given, else ""
    "services": [],       // e.g. ["Rear park sensor calibration", "Programming"] — their words, cleaned
    "needed_by_date": "", // YYYY-MM-DD resolved from today, or ""
    "needed_by_text": "", // their words: "by lunch", "first thing tomorrow", ""
    "note": ""            // anything else about THIS car (glass cracked, keys in the visor…)
  }],
  "summary": "",          // one plain line for the team
  "confidence": 0.0       // 0–1 that this is a real work request for the vehicle(s) above
}`

export async function extractJobsFromText({ body, shop, sender }) {
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
  const prompt = `You read text messages from auto body / repair shops to Absolute ADAS, a mobile ADAS calibration + programming + diagnostics company. Turn this text into job requests.

Today is ${ptWeekday()} ${ptToday()} (Pacific). Shop: ${shop || 'unknown'}. Sender: ${sender || 'unknown'}.

Rules:
- One entry in "vehicles" per distinct car. A different RO, VIN/last-4, or year/make/model is a different car. "3444 is ready" and "3805 will be ready as well" = two cars (4-digit numbers next to "vin" or on their own are VIN last-4).
- intent "new_job" = a car is ready / will be ready / needs work / can you come. A shop saying a car "is ready" or "will be ready" with only a VIN, last-4, RO or vehicle is a job request for THAT car (ready = ready for us to calibrate/program) — intent new_job, confidence ≥ 0.8, services [] if they didn't say. "update" = extra detail about a car (keys, location, parts) with no new car. "hold" = hold off / not ready / cancel / push it. "question" = asking something, no car to schedule. "chatter" = none of the above.
- Keep their words for services and needed_by_text. Don't invent a VIN, RO or vehicle that isn't in the text. Empty string when unknown.
- Reply with JSON only, exactly this shape:
${SCHEMA}

Text:
"""${String(body).slice(0, 1200)}"""`
  const msg = await client.messages.create({ model: 'claude-haiku-4-5', max_tokens: 700, messages: [{ role: 'user', content: prompt }] })
  const raw = msg.content?.[0]?.text || ''
  const jsonText = raw.slice(raw.indexOf('{'), raw.lastIndexOf('}') + 1)
  const out = JSON.parse(jsonText)
  out.vehicles = Array.isArray(out.vehicles) ? out.vehicles.filter(v => v && (v.year || v.make || v.model || v.vin || v.ro)) : []
  out.confidence = Number(out.confidence) || 0
  return out
}

const vehicleLabel = v => [v.year, v.make, v.model].filter(Boolean).join(' ').trim()
const cleanVin = v => String(v || '').toUpperCase().replace(/[^A-Z0-9]/g, '')

/**
 * Inbound shop text → job request card(s). Called from the Twilio inbound
 * handler. Never throws — returns { created: [], appended: [], flagged: bool }.
 */
export async function maybeCreateJobsFromText(req, { from, body, contact, lineType, jobs }) {
  const out = { created: [], appended: [], flagged: false, skipped: '' }
  try {
    if (!looksLikeWork(body)) { out.skipped = 'not work'; return out }
    const shop = contact?.shop_name || ''
    const name = contact?.contact_name || ''
    const who = name && shop ? `${name} @ ${shop}` : (name || shop || formatPhonePretty(from))
    const stamp = `${ptToday()} ${ptTime()}`
    const x = await extractJobsFromText({ body, shop, sender: name })
    console.log(`[text→job] ${who}: intent=${x.intent} conf=${x.confidence} vehicles=${x.vehicles.length} · ${x.summary}`)
    const { createNotification } = await import('../routes/notifications.js')
    const threadUrl = `https://adas-iq-904191467.development.catalystserverless.com/app/index.html?thread=${encodeURIComponent(from)}`

    // "Hold off" with no car named → the shop's one open request, if there is exactly one.
    if (shop && x.intent === 'hold' && !x.vehicles.length) {
      try {
        const open = (await jobs.readAll(req)).filter(j => j.status === 'job_requested' && String(j.shop_name || '').toLowerCase() === shop.toLowerCase())
        if (open.length === 1) x.vehicles = [{ year: open[0].year || '', make: open[0].make || '', model: open[0].model || '', vin: open[0].vin || '', ro: open[0].quote_number || '', services: [], needed_by_date: '', needed_by_text: '', note: x.summary || '' }]
      } catch { /* fall through to the Kat flag */ }
    }
    // Unknown sender or a shaky read → Kat decides, no card.
    if (!shop || x.confidence < 0.6 || !['new_job', 'update', 'hold'].includes(x.intent) || !x.vehicles.length) {
      if (x.intent === 'chatter' || x.intent === 'question') { out.skipped = x.intent; return out }
      out.flagged = true
      await createNotification(req, { to: 'Kath', toEmail: 'k.belmonte@absoluteadas.com', type: 'job_requested', title: `📱 Text may be a job — create it? (${who})`, body: `"${String(body).slice(0, 200)}" · ${x.summary || ''}`.slice(0, 300), skipCliq: true, skipTechChannel: true }).catch(() => {})
      await postToCliqChannel(DISPATCH_CHANNEL, `📱 *Text looks like a job* — ${shop ? '' : 'number not in the CRM · '}${who}\n"${String(body).slice(0, 300)}"\n${x.summary ? `_${x.summary}_\n` : ''}Nothing created — [open the thread](${threadUrl}) and request it if it's real.`).catch(() => {})
      return out
    }

    for (const v of x.vehicles) {
      const vehicle = vehicleLabel(v)
      const vin = cleanVin(v.vin)
      const probe = { shop_name: shop, vehicle, year: v.year || '', make: v.make || '', model: v.model || '', vin, quote_number: v.ro || '', notes: '' }
      const match = await jobs.findOpenRequestFor(req, probe).catch(() => null)
      const line = `📱 ${stamp} · ${who} texted: "${String(body).slice(0, 400)}"`
      const detail = [v.services?.length ? `Asked for: ${v.services.join(', ')}` : '', v.needed_by_text ? `Needed: ${v.needed_by_text}${v.needed_by_date ? ` (${v.needed_by_date})` : ''}` : '', v.note ? `Note: ${v.note}` : ''].filter(Boolean).join(' · ')
      if (match) {
        const hold = x.intent === 'hold'
        const notes = `${hold ? '🛑 HOLD — ' : ''}${line}${detail ? `\n${detail}` : ''}\n${match.notes || ''}`.trim().slice(0, 9000)
        const patch = { ...match, notes }
        if (vin.length === 17 && !match.vin) patch.vin = vin
        if (v.ro && !match.quote_number) patch.quote_number = v.ro
        if (v.needed_by_date && !match.scheduled_date) patch.scheduled_date = v.needed_by_date
        const upd = await jobs.updateJob(req, match.id, patch)
        out.appended.push({ id: match.id, vehicle: upd.vehicle, hold })
        await postToCliqChannel(DISPATCH_CHANNEL, `${hold ? '🛑' : '📱'} *${hold ? 'Hold from a text' : 'Text added to the request'}* · ${shop} · ${upd.vehicle || vehicle}${upd.quote_number ? ` · RO ${upd.quote_number}` : ''}\n"${String(body).slice(0, 300)}"${detail ? `\n${detail}` : ''}\n[💬 thread](${threadUrl})`).catch(() => {})
        continue
      }
      if (x.intent === 'hold') continue   // nothing open to hold
      // 'update' about a car with no open card = it's new to us → card.
      const job = await jobs.insertJob(req, {
        status: 'job_requested', via_request: true, request_type: 'text',
        shop_name: shop, customer: { kind: 'shop', id: '', name: shop, zoho_contact_id: '' },
        vehicle, year: v.year || '', make: v.make || '', model: v.model || '', vin,
        quote_number: String(v.ro || '').slice(0, 40), scheduled_date: v.needed_by_date || '',
        technician: '', notes: `${line}${detail ? `\n${detail}` : ''}`.slice(0, 9000),
      })
      out.created.push({ id: job.id, vehicle, vin, ro: v.ro || '' })
      const head = `📱 *Job Requested — via TEXT* · ${shop}`
      const l2 = `${vehicle || 'Vehicle TBD'}${vin ? ` · VIN ${vin.length === 17 ? vin : '…' + vin.slice(-4)}` : ''}${v.ro ? ` · RO ${v.ro}` : ''}${v.needed_by_text ? ` · ⏰ ${v.needed_by_text}` : ''}`
      const l3 = `${name ? `👤 ${name} · ` : ''}"${String(body).slice(0, 240)}"${v.services?.length ? `\n🔧 ${v.services.join(', ')}` : ''}`
      const msg = `${head}\n${l2}\n${l3}\n[💬 thread](${threadUrl})`
      await postToCliqChannel(AA_JOBS_CHANNEL, msg).catch(e => console.warn('[text→job aajobs]', e.message))
      await postToCliqChannel(DISPATCH_CHANNEL, msg).catch(e => console.warn('[text→job dispatch]', e.message))
      await createNotification(req, { to: 'Kath', toEmail: 'k.belmonte@absoluteadas.com', type: 'job_requested', title: `📱 Text → job request: ${shop}`, body: `${vehicle || 'Vehicle TBD'}${v.ro ? ` · RO ${v.ro}` : ''}${v.needed_by_text ? ` · ${v.needed_by_text}` : ''}`, jobId: job.id, job, skipCliq: true, skipTechChannel: true }).catch(() => {})
    }
    return out
  } catch (e) {
    console.warn('[text→job] failed (text still logged):', e.message)
    out.skipped = `error: ${e.message}`
    return out
  }
}
