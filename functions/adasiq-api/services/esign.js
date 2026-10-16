// ✍️ In-app e-signature (Mark 2026-10-16, "option 1" after Zoho Sign refused API
// sends on his plan). The signer gets a private link by text + email, reads the
// exact PDF on their phone, types their name, ticks consent, signs with a finger.
// The app stamps the signature + date onto that PDF, adds a signing-record page
// (ESIGN/UETA style: intent, consent, who, when, where, document hash) and emails
// a copy to the signer and to Mark.
//
// Storage (DurableKV, never exposed by another route):
//   esig:<id>           envelope JSON (meta, status, audit)
//   esigpdf:<id>        original PDF, base64
//   esigpdf:<id>:signed signed PDF, base64
// Links are HMAC-signed with SESSION_SECRET (same scheme as onboarding links)
// and die when the envelope is voided or completed.
import crypto from 'crypto'
import catalyst from 'zcatalyst-sdk-node'

const secret = () => { const s = process.env.SESSION_SECRET; if (!s || s.length < 16) throw new Error('SESSION_SECRET is not set — signing links are disabled'); return s }
const kv = async () => import('./durableKV.js')
const appOf = req => catalyst.initialize(req)
const sha = buf => crypto.createHash('sha256').update(buf).digest('hex')
const ptNow = () => new Date().toLocaleString('en-US', { timeZone: 'America/Los_Angeles', dateStyle: 'medium', timeStyle: 'long' })
const ptDate = () => new Date().toLocaleDateString('en-US', { timeZone: 'America/Los_Angeles', month: '2-digit', day: '2-digit', year: 'numeric' })

export function makeToken(env) {
  const body = Buffer.from(JSON.stringify({ type: 'esign', id: env.id, v: env.v || 0, exp: Date.now() + 21 * 86400000 })).toString('base64url')
  return `${body}.${crypto.createHmac('sha256', secret()).update(body).digest('base64url')}`
}
export function verifyToken(token, env) {
  try {
    const [body, sig] = String(token || '').split('.')
    const expect = crypto.createHmac('sha256', secret()).update(body || '').digest('base64url')
    if (!body || !sig || sig.length !== expect.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expect))) return false
    const d = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'))
    return d.type === 'esign' && d.id === env.id && (d.v || 0) === (env.v || 0) && d.exp > Date.now()
  } catch { return false }
}

export async function readEnvelope(req, id) {
  const { kvGet } = await kv()
  const raw = await kvGet(appOf(req), `esig:${String(id).replace(/[^a-z0-9_]/gi, '')}`).catch(() => null)
  try { return raw ? JSON.parse(raw) : null } catch { return null }
}
async function saveEnvelope(req, env) { const { kvSet } = await kv(); await kvSet(appOf(req), `esig:${env.id}`, JSON.stringify(env)) }
export async function readPdf(req, id, signed = false) {
  const { kvGet } = await kv()
  const b64 = await kvGet(appOf(req), `esigpdf:${id}${signed ? ':signed' : ''}`).catch(() => null)
  return b64 ? Buffer.from(b64, 'base64') : null
}

export function linkFor(req, env) {
  const base = process.env.WEB_BASE_URL || `${req.protocol}://${req.get('host')}/app`
  return `${base}/?esign=${encodeURIComponent(env.id)}&t=${encodeURIComponent(makeToken(env))}`
}

/**
 * kind: 'recruit_offer' | 'comp_letter'; ref: candidate id or member id.
 * fields: { sign: {page,x,y,w,h}, date: {page,x,y,w,h} } in PDF points, top-left origin.
 */
export async function createEnvelope(req, { kind, ref, subject, signer, pdf, fields, sentBy = 'Mark Fowler', invite = {} }) {
  const id = `es_${Date.now().toString(36)}${crypto.randomBytes(4).toString('hex')}`
  const env = { id, v: 0, kind, ref, subject, signer: { name: signer.name, email: String(signer.email || '').toLowerCase(), phone: signer.phone || '' },
    fields, status: 'sent', sent_at: new Date().toISOString(), sent_by: sentBy, original_sha256: sha(pdf), audit: [{ at: new Date().toISOString(), what: `Sent by ${sentBy}` }] }
  const { kvSet } = await kv()
  await kvSet(appOf(req), `esigpdf:${id}`, pdf.toString('base64'))
  await saveEnvelope(req, env)
  const delivery = await deliver(req, env, invite)
  env.audit.push({ at: new Date().toISOString(), what: `Link delivered: ${[delivery.sms?.ok && `text to ${delivery.sms.to}`, delivery.email?.ok && `email to ${delivery.email.to}`].filter(Boolean).join(', ') || 'not delivered'}` })
  await saveEnvelope(req, env)
  return { env, delivery, link: linkFor(req, env) }
}

async function deliver(req, env, { sms, emailIntro }) {
  const link = linkFor(req, env), first = env.signer.name.split(' ')[0], out = { sms: null, email: null }
  if (env.signer.phone) {
    try { const { sendTwilioSMS } = await import('./twilio.js'); const r = await sendTwilioSMS({ to: env.signer.phone, body: `${sms || `Hey ${first}, it's Mark. Here's your letter from Absolute ADAS. Read it and sign right on your phone:`} ${link}` }); out.sms = r?.ok ? { ok: true, to: env.signer.phone } : { ok: false, error: r?.error || 'failed' } } catch (e) { out.sms = { ok: false, error: e.message } }
  }
  if (env.signer.email) {
    try {
      const { getMailAccessToken, getMailAccountId, sendMail } = await import('./mail.js')
      const token = await getMailAccessToken(); const accountId = await getMailAccountId(token)
      const html = `<div style="font-family:-apple-system,Helvetica,Arial,sans-serif;max-width:560px;color:#1a1a1a"><div style="background:#CD4419;color:white;padding:14px 18px;border-radius:10px 10px 0 0;font-weight:700">Absolute ADAS · ${env.kind === 'recruit_offer' ? 'Your offer' : 'Your offer letter'}</div><div style="border:1px solid #e8e4e0;border-top:none;padding:18px;border-radius:0 0 10px 10px"><p>Hi ${first},</p><p>${emailIntro || "Here's your letter from Absolute ADAS. Read it over and sign right on your phone. It takes a minute."}</p><p style="text-align:center;margin:20px 0"><a href="${link}" style="background:#15803d;color:white;text-decoration:none;padding:12px 22px;border-radius:10px;font-weight:700">Read and sign</a></p><p>Questions? Call or text me anytime.<br>Mark</p><p style="color:#888;font-size:12px">This link is just for you and works for 21 days. You'll get a copy of the signed letter by email.</p></div></div>`
      await sendMail(token, accountId, { to: env.signer.email, subject: env.subject, body: html }); out.email = { ok: true, to: env.signer.email }
    } catch (e) { out.email = { ok: false, error: e.message } }
  }
  return out
}

export async function voidEnvelope(req, id, why = 'Withdrawn') {
  const env = await readEnvelope(req, id)
  if (!env || env.status !== 'sent') return env
  env.status = 'voided'; env.v = (env.v || 0) + 1; env.voided_at = new Date().toISOString()
  env.audit.push({ at: env.voided_at, what: `Voided: ${why}` })
  await saveEnvelope(req, env)
  return env
}

// Stamp + certificate. png: data URL of the drawn signature.
export async function stamp(original, env, { name, png, ip, ua, signedAt }) {
  const { PDFDocument, StandardFonts, rgb } = await import('pdf-lib')
  const doc = await PDFDocument.load(original)
  const font = await doc.embedFont(StandardFonts.Helvetica), bold = await doc.embedFont(StandardFonts.HelveticaBold)
  const pages = doc.getPages()
  const img = await doc.embedPng(Buffer.from(String(png).split(',')[1] || '', 'base64'))
  const s = env.fields?.sign, d = env.fields?.date
  if (s && pages[s.page]) {
    const p = pages[s.page], H = p.getHeight()
    const scale = Math.min(s.w / img.width, s.h / img.height)
    const w = img.width * scale, h = img.height * scale
    p.drawImage(img, { x: s.x, y: H - s.y - s.h + (s.h - h) / 2, width: w, height: h })
  }
  if (d && pages[d.page]) { const p = pages[d.page], H = p.getHeight(); p.drawText(ptDate(), { x: d.x + 4, y: H - d.y - d.h / 2 - 4, size: 11, font, color: rgb(0, 0, 0) }) }
  // Signing record page
  const p = doc.addPage([612, 792]); let y = 740
  const line = (k, v, b = false) => { p.drawText(k, { x: 60, y, size: 9, font: bold, color: rgb(0.4, 0.4, 0.4) }); const f = b ? bold : font; let cur = ''; const out = []; for (const w of String(v).split(/\s+/)) { const t = cur ? cur + ' ' + w : w; if (f.widthOfTextAtSize(t, 9) > 360 && cur) { out.push(cur); cur = w } else cur = t } if (cur) out.push(cur); for (const ln of out) { p.drawText(ln, { x: 190, y, size: 9, font: f }); y -= 13 } y -= 5 }
  p.drawText('Signing record', { x: 60, y, size: 18, font: bold, color: rgb(0.8, 0.27, 0.1) }); y -= 30
  line('Document', env.subject); line('Envelope', env.id); line('Original SHA-256', env.original_sha256)
  line('Signer', `${name} (${env.signer.email || 'no email'})`, true)
  line('Consent', 'Signer checked: "I agree to sign this document electronically, and that my electronic signature is the legal equivalent of my handwritten signature."')
  line('Sent', `${new Date(env.sent_at).toLocaleString('en-US', { timeZone: 'America/Los_Angeles', dateStyle: 'medium', timeStyle: 'long' })} by ${env.sent_by}`)
  line('Signed', signedAt); line('IP address', ip || 'unknown'); line('Device', (ua || 'unknown').slice(0, 240))
  for (const a of env.audit) line('Event', `${new Date(a.at).toLocaleString('en-US', { timeZone: 'America/Los_Angeles', dateStyle: 'short', timeStyle: 'short' })} — ${a.what}`)
  p.drawText('Absolute ADAS LLC · signed in the Absolute ADAS app', { x: 60, y: 50, size: 8, font, color: rgb(0.5, 0.5, 0.5) })
  return Buffer.from(await doc.save())
}

async function uploadMailAttachment(token, accountId, { name, buffer, contentType }) {
  const axios = (await import('axios')).default
  const FormData = (await import('form-data')).default
  const form = new FormData(); form.append('attach', buffer, { filename: name, contentType })
  const r = await axios.post(`https://mail.zoho.com/api/accounts/${accountId}/messages/attachments`, form, { params: { fileName: name, uploadType: 'multipart' }, headers: { Authorization: `Zoho-oauthtoken ${token}`, ...form.getHeaders() }, maxBodyLength: Infinity, timeout: 30000 })
  const a = Array.isArray(r.data?.data) ? r.data.data[0] : r.data?.data
  if (!a?.storeName) throw new Error('attachment upload failed')
  return { storeName: a.storeName, attachmentPath: a.attachmentPath, attachmentName: a.attachmentName || name }
}

export async function signEnvelope(req, id, { name, consent, png, ip, ua }) {
  const env = await readEnvelope(req, id)
  if (!env) throw new Error('This document was not found.')
  if (env.status === 'completed') throw new Error('This document is already signed.')
  if (env.status !== 'sent') throw new Error('This document was withdrawn. Ask Mark for a new one.')
  const typed = String(name || '').trim()
  if (typed.length < 3) throw new Error('Type your full name.')
  if (!consent) throw new Error('Check the box to agree to sign electronically.')
  if (!/^data:image\/png;base64,/.test(String(png || '')) || String(png).length < 800) throw new Error('Draw your signature in the box.')
  if (String(png).length > 1_500_000) throw new Error('That signature image is too big. Clear it and try again.')
  const original = await readPdf(req, id)
  if (!original || sha(original) !== env.original_sha256) throw new Error('The document could not be verified. Ask Mark to resend it.')
  const signedAt = ptNow()
  const signed = await stamp(original, env, { name: typed, png, ip, ua, signedAt })
  const { kvSet } = await kv()
  await kvSet(appOf(req), `esigpdf:${id}:signed`, signed.toString('base64'))
  env.status = 'completed'; env.signed_at = new Date().toISOString(); env.signed_name = typed; env.ip = ip; env.ua = String(ua || '').slice(0, 300); env.signed_sha256 = sha(signed)
  env.audit.push({ at: env.signed_at, what: `Signed by ${typed} from ${ip || 'unknown IP'}` })
  await saveEnvelope(req, env)
  try { const { cfgReadJson, cfgWriteJson } = await import('../routes/people.js'); const pend = (await cfgReadJson(req, 'esig_pending', [])) || []; if (!pend.includes(id)) await cfgWriteJson(req, 'esig_pending', [...pend, id].slice(-200)) } catch { /* hourly can't retry this one, but the client finish call still runs */ }
  return { env, signed }
}

// Step 2 (its own request, so signing never waits on email/WorkDrive): copies
// to signer + Mark, then the kind's hook (hire + onboarding, or the letter tick).
// Idempotent via flags; the hourly job retries anything left unfinished.
export async function finishEnvelope(req, id) {
  const env = await readEnvelope(req, id)
  if (!env || env.status !== 'completed') return env
  if (!env.copies_sent) {
    try {
      const signed = await readPdf(req, id, true)
      const { getMailAccessToken, getMailAccountId, sendMail } = await import('./mail.js')
      const token = await getMailAccessToken(); const accountId = await getMailAccountId(token)
      const file = `${env.subject.replace(/[^\w .,()-]+/g, ' ').trim()} (signed).pdf`
      const att = await uploadMailAttachment(token, accountId, { name: file, buffer: signed, contentType: 'application/pdf' })
      const first = env.signer.name.split(' ')[0]
      if (env.signer.email) await sendMail(token, accountId, { to: env.signer.email, subject: `Signed: ${env.subject}`, body: `<p>Hi ${first},</p><p>Thanks for signing. Your copy is attached.</p><p>Mark</p>`, attachments: [att] })
      await sendMail(token, accountId, { to: 'mark@absoluteadas.com', subject: `✅ Signed: ${env.subject}`, body: `<p>${env.signed_name} signed ${env.subject}. Signed copy attached.</p>`, attachments: [att] })
      env.copies_sent = new Date().toISOString(); env.audit.push({ at: env.copies_sent, what: 'Signed copies emailed to signer and Mark' })
      await saveEnvelope(req, env)
    } catch (e) { console.log('[esign] copy email failed:', e.message) }
  }
  if (!env.hook_done) {
    try {
      const signed = await readPdf(req, id, true)
      if (env.kind === 'recruit_offer') { const { completeOffer } = await import('../routes/recruit.js'); await completeOffer(req, env.ref, signed, env.signed_at) }
      if (env.kind === 'comp_letter') { const { onLetterSigned } = await import('../routes/comp.js'); await onLetterSigned(req, env.ref, env) }
      env.hook_done = new Date().toISOString(); await saveEnvelope(req, env)
    } catch (e) { console.log('[esign] hook failed:', env.kind, e.message) }
  }
  return env
}


// Hourly: finish anything signed whose copies/hook didn't complete.
export async function maybeFinishEnvelopes(req) {
  const { cfgReadJson, cfgWriteJson } = await import('../routes/people.js')
  const pend = (await cfgReadJson(req, 'esig_pending', [])) || []
  if (!pend.length) return { finished: 0 }
  const left = []
  let finished = 0
  for (const id of pend) {
    const env = await finishEnvelope(req, id).catch(() => null)
    if (env && env.copies_sent && env.hook_done) finished++; else if (env && env.status === 'completed') left.push(id)
  }
  await cfgWriteJson(req, 'esig_pending', left)
  return { finished, left: left.length }
}
