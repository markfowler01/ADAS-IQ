// Resend integration for ADAS Brew.
// Iterates the subscriber list (stored in Catalyst cache) and POSTs one email
// per subscriber to Resend's /emails endpoint. Simple, no audience sync needed.

import axios from 'axios'

const RESEND_API = 'https://api.resend.com'

function envBundle() {
  return {
    apiKey: process.env.RESEND_API_KEY || '',
    fromEmail: process.env.BREW_FROM_EMAIL || 'brew@adas-iq.com',
    fromName: process.env.BREW_FROM_NAME || 'Mark @ ADAS Brew',
  }
}

function isConfigured() {
  return Boolean(envBundle().apiKey)
}

/**
 * Send one email via Resend.
 * @param {{ to: string, subject: string, html: string, text?: string }} payload
 * @returns {Promise<{ ok: boolean, id?: string, error?: string }>}
 */
async function sendOne({ to, subject, html, text }) {
  const e = envBundle()
  if (!e.apiKey) return { ok: false, error: 'RESEND_API_KEY not configured' }

  try {
    const res = await axios.post(
      `${RESEND_API}/emails`,
      {
        from: `${e.fromName} <${e.fromEmail}>`,
        to: [to],
        subject,
        html,
        text: text || undefined,
      },
      {
        headers: {
          Authorization: `Bearer ${e.apiKey}`,
          'Content-Type': 'application/json',
        },
        timeout: 15000,
        validateStatus: s => s < 500,
      }
    )
    if (res.status >= 200 && res.status < 300 && res.data?.id) {
      return { ok: true, id: res.data.id }
    }
    return { ok: false, error: `Resend ${res.status}: ${JSON.stringify(res.data).slice(0, 300)}` }
  } catch (err) {
    return { ok: false, error: err.message }
  }
}

/**
 * Send to a list of recipients. Returns aggregate result + per-recipient detail.
 * Throttles to ~5 req/sec to stay well under Resend's 10/sec rate limit.
 * @param {{ recipients: string[], subject: string, html: string, text?: string }} payload
 */
export async function sendBroadcast({ recipients, subject, html, text }) {
  if (!isConfigured()) {
    console.log(`[brew] DRY RUN — Resend not configured. Would send "${subject}" to ${recipients.length} recipient(s).`)
    return { status: 'queued', dryRun: true, sent: 0, failed: 0, total: recipients.length, results: [] }
  }

  const results = []
  let sent = 0
  let failed = 0

  for (let i = 0; i < recipients.length; i++) {
    const to = recipients[i]
    const r = await sendOne({ to, subject, html, text })
    results.push({ to, ok: r.ok, id: r.id || null, error: r.error || null })
    if (r.ok) sent++
    else failed++
    // Throttle ~200ms between sends
    if (i < recipients.length - 1) await new Promise(r => setTimeout(r, 200))
  }

  const status = failed === 0 ? 'sent' : (sent === 0 ? 'error' : 'partial')
  return { status, sent, failed, total: recipients.length, results }
}

export const resendConfigured = isConfigured
