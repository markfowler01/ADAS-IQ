import { Router } from 'express'
import axios from 'axios'
import { getMailAccessToken, getMailAccountId, sendMail } from '../services/mail.js'

const router = Router()

const SHOPS_KEY    = 'crm_shops'
const CATALYST_API = 'https://api.catalyst.zoho.com'
const REMINDER_TO  = 'mf@absoluteadas.com'

function catalystHeaders(req) {
  const token = req.headers['x-zc-admin-cred-token'] || req.headers['x-zc-user-cred-token'] || ''
  return { Authorization: `Zoho-oauthtoken ${token}`, 'Content-Type': 'application/json' }
}
function catalystProjectId(req) {
  return req.headers['x-zc-projectid'] || process.env.CATALYST_PROJECT_ID || ''
}

async function readShops(req) {
  const url = `${CATALYST_API}/baas/v1/project/${catalystProjectId(req)}/cache/${SHOPS_KEY}`
  try {
    const r = await axios.get(url, { headers: catalystHeaders(req) })
    const val = r.data?.data?.cache_value
    return val ? JSON.parse(val) : []
  } catch (e) {
    if (e.response?.status === 404) return []
    throw e
  }
}

function todayString() {
  return new Date().toLocaleDateString('en-CA')
}

function daysSince(isoDate) {
  if (!isoDate) return null
  try {
    const d    = new Date(isoDate.includes('T') ? isoDate : isoDate + 'T00:00:00')
    const diff = Math.floor((Date.now() - d.getTime()) / 86400000)
    return diff
  } catch { return null }
}

function stageLabel(id) {
  const map = {
    target: 'Target', contacted: 'Contacted', interested: 'Interested',
    proposal: 'Proposal', active: 'Active', lost: 'Lost',
  }
  return map[id] || id
}

// ─── Generate action steps based on pipeline state ────────────────────────────
function buildActionSteps(shops, today) {
  const steps = []
  const activeShops = shops.filter(s => s.pipeline_stage !== 'lost')

  // 1. Overdue follow-ups
  const overdue = activeShops.filter(s => s.next_followup && s.next_followup < today)
  if (overdue.length > 0) {
    const names = overdue.slice(0, 3).map(s => s.shop_name).join(', ')
    steps.push({
      priority: 1,
      icon: '🔴',
      text: `Clear ${overdue.length} overdue follow-up${overdue.length !== 1 ? 's' : ''} — start with ${names}${overdue.length > 3 ? ` +${overdue.length - 3} more` : ''}.`,
    })
  }

  // 2. Due today
  const dueToday = activeShops.filter(s => s.next_followup === today)
  if (dueToday.length > 0) {
    const names = dueToday.slice(0, 2).map(s => s.shop_name).join(' and ')
    steps.push({
      priority: 2,
      icon: '📅',
      text: `Follow up with ${dueToday.length} shop${dueToday.length !== 1 ? 's' : ''} due today: ${names}${dueToday.length > 2 ? ` +${dueToday.length - 2} more` : ''}.`,
    })
  }

  // 3. Stale proposals (in Proposal stage > 7 days with no recent activity)
  const staleProposals = activeShops.filter(s => {
    if (s.pipeline_stage !== 'proposal') return false
    const lastAct = Array.isArray(s.activities) && s.activities.length > 0
      ? s.activities.slice().sort((a, b) => new Date(b.date) - new Date(a.date))[0]
      : null
    const daysSinceAct = lastAct ? daysSince(lastAct.date) : daysSince(s.created_at)
    return (daysSinceAct || 0) > 7
  })
  if (staleProposals.length > 0) {
    const names = staleProposals.slice(0, 2).map(s => s.shop_name).join(', ')
    steps.push({
      priority: 3,
      icon: '📋',
      text: `Check in on ${staleProposals.length} stale proposal${staleProposals.length !== 1 ? 's' : ''} — ${names}${staleProposals.length > 2 ? ` +${staleProposals.length - 2} more` : ''} haven't heard from you in over a week.`,
    })
  }

  // 4. Interested shops with no follow-up date set
  const interestedNoDate = activeShops.filter(s =>
    s.pipeline_stage === 'interested' && !s.next_followup
  )
  if (interestedNoDate.length > 0) {
    steps.push({
      priority: 4,
      icon: '🤝',
      text: `Schedule follow-ups for ${interestedNoDate.length} Interested shop${interestedNoDate.length !== 1 ? 's' : ''} — they have no date set yet.`,
    })
  }

  // 5. Targets with zero activity (never contacted)
  const coldTargets = activeShops.filter(s =>
    s.pipeline_stage === 'target' &&
    (!Array.isArray(s.activities) || s.activities.length === 0) &&
    !s.last_contact
  )
  if (coldTargets.length > 0) {
    steps.push({
      priority: 5,
      icon: '🎯',
      text: `${coldTargets.length} Target${coldTargets.length !== 1 ? 's' : ''} haven't been contacted yet — pick ${Math.min(3, coldTargets.length)} to visit or call today.`,
    })
  }

  // 6. Active shops — last activity > 30 days ago (check-in time)
  const activeNeedingTouchbase = activeShops.filter(s => {
    if (s.pipeline_stage !== 'active') return false
    const lastAct = Array.isArray(s.activities) && s.activities.length > 0
      ? s.activities.slice().sort((a, b) => new Date(b.date) - new Date(a.date))[0]
      : null
    const days = lastAct ? daysSince(lastAct.date) : daysSince(s.created_at)
    return (days || 0) > 30
  })
  if (activeNeedingTouchbase.length > 0) {
    const names = activeNeedingTouchbase.slice(0, 2).map(s => s.shop_name).join(', ')
    steps.push({
      priority: 6,
      icon: '✅',
      text: `Touch base with ${activeNeedingTouchbase.length} Active customer${activeNeedingTouchbase.length !== 1 ? 's' : ''} — ${names} haven't heard from you in 30+ days.`,
    })
  }

  // 7. Healthy pipeline — positive message if nothing urgent
  if (steps.length === 0) {
    const activeCount  = activeShops.filter(s => s.pipeline_stage === 'active').length
    const targetCount  = activeShops.filter(s => s.pipeline_stage === 'target').length
    steps.push({
      priority: 1,
      icon: '🌟',
      text: `Pipeline looks clean — no overdue follow-ups! You have ${activeCount} active customer${activeCount !== 1 ? 's' : ''} and ${targetCount} target${targetCount !== 1 ? 's' : ''} to work.`,
    })
    if (targetCount > 0) {
      steps.push({
        priority: 2,
        icon: '🎯',
        text: `Pick 3–5 targets from your list and make first contact today.`,
      })
    }
  }

  // Cap at 5 steps, sorted by priority
  return steps.sort((a, b) => a.priority - b.priority).slice(0, 5)
}

function shopRow(shop, isOverdue, today) {
  const name     = shop.shop_name || 'Unknown'
  const contact  = shop.people?.[0]?.name || shop.contact_name || ''
  const phone    = shop.people?.[0]?.phone || shop.phone || ''
  const stage    = stageLabel(shop.pipeline_stage)
  const daysOver = isOverdue
    ? Math.round((new Date(today) - new Date(shop.next_followup + 'T00:00:00')) / 86400000)
    : 0
  const color    = isOverdue ? '#dc2626' : '#b45309'

  return `
    <tr style="border-bottom:1px solid #f0eeec;">
      <td style="padding:10px 8px;">
        <strong style="color:#1a1a1a;">${name}</strong>
        ${contact ? `<br><span style="color:#888;font-size:12px;">${contact}</span>` : ''}
      </td>
      <td style="padding:10px 8px;color:#555;font-size:13px;">${stage}</td>
      <td style="padding:10px 8px;">
        ${phone
          ? `<a href="tel:${phone}" style="color:#15803d;font-size:13px;">${phone}</a>`
          : '<span style="color:#bbb;font-size:12px;">—</span>'}
      </td>
      <td style="padding:10px 8px;">
        <span style="background:${isOverdue ? '#fee2e2' : '#fef3c7'};color:${color};
          font-size:11px;font-weight:600;padding:2px 8px;border-radius:20px;">
          ${isOverdue ? `${daysOver}d overdue` : 'Due today'}
        </span>
      </td>
    </tr>`
}

/**
 * GET /api/crm-reminder/run
 * Protected by X-Cron-Secret (CRM_CRON_SECRET env var).
 * Sends Mark a morning briefing: follow-up list + pipeline action steps.
 */
router.get('/run', async (req, res) => {
  const cronSecret = process.env.CRM_CRON_SECRET
  if (cronSecret && req.headers['x-cron-secret'] !== cronSecret) {
    return res.status(401).json({ error: 'Unauthorized' })
  }

  try {
    const shops = await readShops(req)
    const today = todayString()

    const overdue  = shops.filter(s => s.pipeline_stage !== 'lost' && s.next_followup && s.next_followup < today)
    const dueToday = shops.filter(s => s.pipeline_stage !== 'lost' && s.next_followup === today)
    const steps    = buildActionSteps(shops, today)

    const dateLabel = new Date().toLocaleDateString('en-US', {
      weekday: 'long', month: 'long', day: 'numeric', year: 'numeric',
    })

    // Pipeline snapshot
    const stageOrder = ['target', 'contacted', 'interested', 'proposal', 'active']
    const snapshot = stageOrder.map(id => {
      const cnt   = shops.filter(s => s.pipeline_stage === id).length
      const label = stageLabel(id)
      const emojis = { target:'🎯', contacted:'📞', interested:'🤝', proposal:'📋', active:'✅' }
      return { id, label, cnt, emoji: emojis[id] }
    }).filter(s => s.cnt > 0)

    const html = `
      <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;max-width:640px;margin:0 auto;color:#333;background:#f5f3f0;padding:24px;">

        <!-- Header -->
        <div style="background:#CD4419;padding:20px 24px;border-radius:12px 12px 0 0;">
          <h1 style="margin:0;color:white;font-size:20px;font-weight:700;">☀️ Good morning, Mark</h1>
          <p style="margin:6px 0 0;color:rgba(255,255,255,0.85);font-size:14px;">${dateLabel}</p>
        </div>

        <div style="background:white;border:1px solid #ebebeb;border-top:none;border-radius:0 0 12px 12px;padding:0 0 4px;">

          <!-- Action Steps -->
          <div style="padding:20px 24px 16px;">
            <h2 style="font-size:15px;color:#1a1a1a;margin:0 0 12px;font-weight:700;">
              Today's Action Steps
            </h2>
            <table style="width:100%;border-collapse:collapse;">
              ${steps.map((step, i) => `
                <tr>
                  <td style="width:28px;padding:7px 8px 7px 0;vertical-align:top;font-size:16px;">${step.icon}</td>
                  <td style="padding:7px 0;font-size:13px;color:#333;line-height:1.5;border-bottom:1px solid #f5f3f0;">
                    <strong style="color:#1a1a1a;">${i + 1}.</strong> ${step.text}
                  </td>
                </tr>`).join('')}
            </table>
          </div>

          <!-- Pipeline Snapshot -->
          <div style="padding:0 24px 20px;">
            <h2 style="font-size:13px;color:#888;margin:0 0 10px;font-weight:600;text-transform:uppercase;letter-spacing:0.05em;">
              Pipeline Snapshot
            </h2>
            <div style="display:flex;gap:8px;flex-wrap:wrap;">
              ${snapshot.map(s => `
                <div style="background:#f9f8f7;border:1px solid #ebebeb;border-radius:10px;padding:10px 14px;min-width:70px;text-align:center;">
                  <div style="font-size:18px;font-weight:700;color:#1a1a1a;">${s.cnt}</div>
                  <div style="font-size:11px;color:#888;margin-top:2px;">${s.emoji} ${s.label}</div>
                </div>`).join('')}
            </div>
          </div>

          ${(overdue.length > 0 || dueToday.length > 0) ? `
          <!-- Follow-Up Tables -->
          <div style="padding:0 24px 20px;">

            ${dueToday.length > 0 ? `
            <h2 style="font-size:14px;color:#b45309;margin:0 0 8px;font-weight:700;">
              📌 Due Today (${dueToday.length})
            </h2>
            <table style="width:100%;border-collapse:collapse;margin-bottom:20px;">
              <thead>
                <tr style="background:#fef3c7;">
                  <th style="padding:8px;text-align:left;font-size:11px;color:#888;text-transform:uppercase;font-weight:600;">Shop</th>
                  <th style="padding:8px;text-align:left;font-size:11px;color:#888;text-transform:uppercase;font-weight:600;">Stage</th>
                  <th style="padding:8px;text-align:left;font-size:11px;color:#888;text-transform:uppercase;font-weight:600;">Phone</th>
                  <th style="padding:8px;text-align:left;font-size:11px;color:#888;text-transform:uppercase;font-weight:600;"></th>
                </tr>
              </thead>
              <tbody>${dueToday.map(s => shopRow(s, false, today)).join('')}</tbody>
            </table>
            ` : ''}

            ${overdue.length > 0 ? `
            <h2 style="font-size:14px;color:#dc2626;margin:0 0 8px;font-weight:700;">
              ⚠️ Overdue (${overdue.length})
            </h2>
            <table style="width:100%;border-collapse:collapse;">
              <thead>
                <tr style="background:#fee2e2;">
                  <th style="padding:8px;text-align:left;font-size:11px;color:#888;text-transform:uppercase;font-weight:600;">Shop</th>
                  <th style="padding:8px;text-align:left;font-size:11px;color:#888;text-transform:uppercase;font-weight:600;">Stage</th>
                  <th style="padding:8px;text-align:left;font-size:11px;color:#888;text-transform:uppercase;font-weight:600;">Phone</th>
                  <th style="padding:8px;text-align:left;font-size:11px;color:#888;text-transform:uppercase;font-weight:600;"></th>
                </tr>
              </thead>
              <tbody>${overdue.map(s => shopRow(s, true, today)).join('')}</tbody>
            </table>
            ` : ''}

          </div>
          ` : ''}

          <!-- Footer -->
          <div style="padding:16px 24px;border-top:1px solid #f5f3f0;text-align:center;">
            <a href="https://adas-iq-904191467.development.catalystserverless.com/app/index.html"
              style="display:inline-block;background:#CD4419;color:white;font-size:13px;font-weight:600;
                padding:10px 24px;border-radius:10px;text-decoration:none;">
              Open CRM →
            </a>
            <p style="color:#bbb;font-size:11px;margin:12px 0 0;">
              ADAS IQ · Daily briefing · 7:30 AM
            </p>
          </div>

        </div>
      </div>`

    const totalDue = overdue.length + dueToday.length
    const subject  = totalDue > 0
      ? `☀️ ${totalDue} follow-up${totalDue !== 1 ? 's' : ''} today — ADAS IQ Morning Briefing`
      : `☀️ Pipeline looks good — ADAS IQ Morning Briefing`

    const mailToken     = await getMailAccessToken()
    const mailAccountId = await getMailAccountId(mailToken)
    await sendMail(mailToken, mailAccountId, { to: REMINDER_TO, subject, body: html })

    console.log(`[crm-reminder] Sent: ${dueToday.length} today, ${overdue.length} overdue, ${steps.length} action steps`)
    res.json({ sent: true, dueToday: dueToday.length, overdue: overdue.length, actionSteps: steps.length })
  } catch (err) {
    console.error('[crm-reminder]', err.message)
    res.status(500).json({ error: err.message })
  }
})

export default router
