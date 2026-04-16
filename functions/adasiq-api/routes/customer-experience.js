// NPS surveys, referral tracking, portal welcome onboarding.

import express from 'express'
import crypto from 'crypto'
import catalyst from 'zcatalyst-sdk-node'
import { sendEmail, getBranding } from '../services/comms.js'

const router = express.Router()

function getSegment(req) {
  return catalyst.initialize(req).cache().segment()
}

function isNotFound(e) {
  return e?.statusCode === 404 || e?.errorInfo?.statusCode === 404
}

async function cacheSet(segment, key, value) {
  const str = typeof value === 'string' ? value : JSON.stringify(value)
  try { await segment.update(key, str) }
  catch (e) { await segment.put(key, str) }
}

async function cacheGet(segment, key, fallback = null) {
  try {
    const val = await segment.getValue(key)
    return val ? JSON.parse(val) : fallback
  } catch (e) {
    if (isNotFound(e)) return fallback
    throw e
  }
}

function isAdmin(req) { return req.user?.role !== 'technician' }

// Signed token for NPS responses (no login required)
function tokenSecret() { return process.env.SESSION_SECRET || 'adasiq-portal-secret' }

function signToken(payload, expiresInMs = 90 * 24 * 60 * 60 * 1000) {
  const data = { ...payload, exp: Date.now() + expiresInMs }
  const body = Buffer.from(JSON.stringify(data)).toString('base64url')
  const sig = crypto.createHmac('sha256', tokenSecret()).update(body).digest('base64url')
  return `${body}.${sig}`
}

function verifyToken(token) {
  if (!token) return null
  const [body, sig] = token.split('.')
  if (!body || !sig) return null
  const expected = crypto.createHmac('sha256', tokenSecret()).update(body).digest('base64url')
  if (sig !== expected) return null
  try {
    const data = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'))
    if (data.exp && data.exp < Date.now()) return null
    return data
  } catch { return null }
}

function webBase(req) {
  return process.env.WEB_BASE_URL
    || `${req.protocol}://${req.get('host')}/app`
}

async function readShops(req) {
  try {
    const app = catalyst.initialize(req)
    const tbl = app.datastore().table('CRMShops')
    const rows = await tbl.getAllRows()
    return rows.map(r => {
      const row = r.toJSON ? r.toJSON() : r
      const shop = { id: row.ROWID, ...row }
      try { if (typeof shop.billing_rules === 'string') shop.billing_rules = JSON.parse(shop.billing_rules) } catch {}
      return shop
    })
  } catch { return [] }
}

// ── NPS survey ──────────────────────────────────────────────────────────────

// Admin: trigger monthly NPS send to all active shops
router.post('/nps/send-survey', async (req, res) => {
  if (!isAdmin(req)) return res.status(403).json({ error: 'Admin only' })
  try {
    const shops = await readShops(req)
    const active = shops.filter(s => ['active', 'active2'].includes(s.pipeline_stage))

    const branding = await getBranding(req)
    let sent = 0, skipped = 0
    const errors = []

    for (const shop of active) {
      const email = shop.billing_rules?.billing_contact_email || shop.email
      if (!email) { skipped++; continue }

      const token = signToken({ type: 'nps', shop_id: shop.id, sent_at: Date.now() })
      const baseUrl = `${webBase(req)}/nps?s=${encodeURIComponent(shop.id)}&t=${encodeURIComponent(token)}`

      // Quick-response links embedded per score (1-10)
      const scoreButtons = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(n => {
        const color = n <= 6 ? '#dc2626' : n <= 8 ? '#f59e0b' : '#16a34a'
        return `<a href="${baseUrl}&score=${n}" style="display:inline-block;width:32px;height:32px;line-height:32px;text-align:center;background:${color};color:white;text-decoration:none;border-radius:4px;margin:2px;font-weight:600;">${n}</a>`
      }).join('')

      try {
        await sendEmail(req, {
          to: email,
          subject: `How are we doing, ${shop.shop_name}?`,
          category: 'nps_survey',
          related_id: shop.id,
          body: `
            <div style="font-family:system-ui,sans-serif;max-width:560px;padding:24px;">
              <div style="background:${branding.primary_color};color:white;padding:14px 20px;border-radius:8px;margin-bottom:16px;">
                <strong style="font-size:16px;">${branding.company_name}</strong>
              </div>
              <p>Hi ${shop.contact_name || 'there'},</p>
              <p>Quick favor — on a scale of 1 to 10, <strong>how likely are you to recommend ${branding.company_name} to another body shop?</strong></p>
              <div style="text-align:center;margin:24px 0;">
                <div style="color:#888;font-size:11px;margin-bottom:6px;">Not likely → Very likely</div>
                ${scoreButtons}
              </div>
              <p style="font-size:13px;color:#888;">Click a number above — takes 5 seconds. You can optionally add a comment on the next page.</p>
              <p style="color:#888;font-size:13px;margin-top:24px;">Thanks for your business!<br>— ${branding.email_signature}</p>
            </div>
          `,
        })
        sent++
      } catch (e) {
        errors.push({ shop: shop.shop_name, error: e.message })
      }
    }
    res.json({ sent, skipped, errors, total_active: active.length })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

// Public: submit NPS response (from email link or web form)
router.post('/nps/respond', async (req, res) => {
  try {
    const token = req.body?.token || req.query.t
    const data = verifyToken(token)
    if (!data || data.type !== 'nps') return res.status(401).json({ error: 'Invalid link' })

    const score = Number(req.body?.score)
    if (!Number.isFinite(score) || score < 0 || score > 10) {
      return res.status(400).json({ error: 'Score must be 0-10' })
    }

    const segment = getSegment(req)
    const responses = (await cacheGet(segment, 'nps_responses', [])) || []

    const entry = {
      id: `nps_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      shop_id: data.shop_id,
      score,
      comment: req.body?.comment || '',
      category: score <= 6 ? 'detractor' : score <= 8 ? 'passive' : 'promoter',
      submitted_at: new Date().toISOString(),
    }
    responses.unshift(entry)
    await cacheSet(segment, 'nps_responses', responses.slice(0, 5000))
    res.json({ ok: true, score, category: entry.category })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

// Public: lookup a survey by token (for the public landing page)
router.get('/nps/survey', async (req, res) => {
  const token = req.query.t
  const data = verifyToken(token)
  if (!data || data.type !== 'nps') return res.status(401).json({ error: 'Invalid link' })
  try {
    const shops = await readShops(req)
    const shop = shops.find(s => s.id === data.shop_id)
    res.json({ shop_name: shop?.shop_name || 'our customer' })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

// Admin: NPS report
router.get('/nps/report', async (req, res) => {
  if (!isAdmin(req)) return res.status(403).json({ error: 'Admin only' })
  try {
    const segment = getSegment(req)
    const responses = (await cacheGet(segment, 'nps_responses', [])) || []
    const shops = await readShops(req)
    const shopsById = new Map(shops.map(s => [s.id, s]))

    const promoters = responses.filter(r => r.category === 'promoter').length
    const detractors = responses.filter(r => r.category === 'detractor').length
    const passives = responses.filter(r => r.category === 'passive').length
    const total = responses.length
    const nps = total > 0 ? Math.round(((promoters - detractors) / total) * 100) : 0

    const enriched = responses.map(r => ({
      ...r,
      shop_name: shopsById.get(r.shop_id)?.shop_name || '—',
    }))

    res.json({
      total_responses: total, promoters, passives, detractors, nps_score: nps,
      responses: enriched.slice(0, 100),
      recent_detractors: enriched.filter(r => r.category === 'detractor').slice(0, 10),
    })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

// ── Referral tracking ───────────────────────────────────────────────────────

router.get('/referrals/report', async (req, res) => {
  if (!isAdmin(req)) return res.status(403).json({ error: 'Admin only' })
  try {
    const shops = await readShops(req)

    // Group by referral_source
    const bySource = {}
    for (const s of shops) {
      const src = s.referral_source || '(unknown)'
      if (!bySource[src]) bySource[src] = { source: src, shops: [], count: 0 }
      bySource[src].shops.push({
        id: s.id,
        shop_name: s.shop_name,
        pipeline_stage: s.pipeline_stage,
        created_at: s.created_at,
      })
      bySource[src].count++
    }

    // Shops that referred (referred_by_shop_id)
    const byReferrer = {}
    for (const s of shops) {
      if (!s.referred_by_shop_id) continue
      const refShop = shops.find(x => x.id === s.referred_by_shop_id)
      const key = refShop?.shop_name || s.referred_by_shop_id
      if (!byReferrer[key]) byReferrer[key] = { referrer: key, referred: [] }
      byReferrer[key].referred.push({
        shop_name: s.shop_name, pipeline_stage: s.pipeline_stage,
      })
    }

    res.json({
      total_shops: shops.length,
      by_source: Object.values(bySource).sort((a, b) => b.count - a.count),
      by_referrer: Object.values(byReferrer).sort((a, b) => b.referred.length - a.referred.length),
    })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

// Send a thank-you email to a referrer
router.post('/referrals/thank', async (req, res) => {
  if (!isAdmin(req)) return res.status(403).json({ error: 'Admin only' })
  try {
    const { referrer_shop_id, referred_shop_name, custom_message } = req.body
    const shops = await readShops(req)
    const ref = shops.find(s => s.id === referrer_shop_id)
    if (!ref) return res.status(404).json({ error: 'Referrer not found' })
    const email = ref.billing_rules?.billing_contact_email || ref.email
    if (!email) return res.status(400).json({ error: 'No email on file' })

    const branding = await getBranding(req)

    await sendEmail(req, {
      to: email,
      subject: `Thanks for the referral, ${ref.shop_name}!`,
      category: 'referral_thank_you',
      related_id: ref.id,
      body: `
        <div style="font-family:system-ui,sans-serif;max-width:560px;padding:24px;">
          <div style="background:${branding.primary_color};color:white;padding:14px 20px;border-radius:8px;margin-bottom:16px;">
            <strong style="font-size:16px;">${branding.company_name}</strong>
          </div>
          <p>Hi ${ref.contact_name || 'team'},</p>
          <p>Just wanted to say <strong>thank you</strong> for referring ${referred_shop_name || 'a fellow shop'} to us.
             Referrals from partners we already work with mean everything — they tell us we're doing right by you.</p>
          ${custom_message ? `<p>${custom_message}</p>` : ''}
          <p>If there's ever anything we can do better, call me direct.</p>
          <p style="color:#888;font-size:13px;margin-top:24px;">— ${branding.email_signature}<br>${branding.website}</p>
        </div>
      `,
    })
    res.json({ ok: true })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

// ── Portal welcome onboarding email ──────────────────────────────────────────

router.post('/portal/welcome', async (req, res) => {
  if (!isAdmin(req)) return res.status(403).json({ error: 'Admin only' })
  try {
    const { shop_id } = req.body
    const shops = await readShops(req)
    const shop = shops.find(s => s.id === shop_id)
    if (!shop) return res.status(404).json({ error: 'Shop not found' })
    const email = shop.billing_rules?.billing_contact_email || shop.email
    if (!email) return res.status(400).json({ error: 'No email on file' })

    const branding = await getBranding(req)
    const portalUrl = `${webBase(req)}/portal`

    await sendEmail(req, {
      to: email,
      subject: `Welcome to the ${branding.company_name} Customer Portal`,
      category: 'portal_welcome',
      related_id: shop.id,
      body: `
        <div style="font-family:system-ui,sans-serif;max-width:560px;padding:24px;">
          <div style="background:${branding.primary_color};color:white;padding:14px 20px;border-radius:8px;margin-bottom:16px;">
            <strong style="font-size:16px;">${branding.company_name}</strong>
          </div>
          <p>Hi ${shop.contact_name || 'team'},</p>
          <p>We've set up a self-service portal for <strong>${shop.shop_name}</strong>.
             In about 30 seconds, you can:</p>
          <ul style="color:#555;">
            <li>📄 Download any invoice as a PDF — insurance or shop copy</li>
            <li>💳 Pay invoices online via card or ACH (instant)</li>
            <li>🚗 Submit new calibration requests directly from your office</li>
            <li>📊 See the full history of work we've done for you</li>
          </ul>
          <p style="text-align:center;margin:28px 0;">
            <a href="${portalUrl}"
               style="background:${branding.primary_color};color:white;padding:14px 28px;border-radius:8px;text-decoration:none;font-weight:600;font-size:15px;">
              Open Customer Portal →
            </a>
          </p>
          <p style="font-size:13px;color:#888;">
            To log in, just enter this email address (<code>${email}</code>) and we'll send you a secure login link —
            no password required.
          </p>
          <p style="color:#888;font-size:13px;margin-top:24px;">— ${branding.email_signature}<br>${branding.website}</p>
        </div>
      `,
    })
    res.json({ ok: true, sent_to: email })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

export default router
