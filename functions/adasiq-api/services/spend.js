// 💵 Claude spend on scrubbing (Mark 2026-09-30: "$10 a day" — keep scrubbing,
// alert at $10 and every $10 after). Every scrub-side Claude client is wrapped
// so each response's token usage is priced and added up; flush() writes the
// running total for the Pacific day to Cache and alerts when a $10 line is
// crossed. Totals are close, not accounting-exact (two instances can add at once).
import catalyst from 'zcatalyst-sdk-node'

// $ per million tokens: input, output, cache write, cache read
const PRICE = {
  'claude-opus-4-7': [5, 25, 6.25, 0.5], 'claude-opus-4-6': [5, 25, 6.25, 0.5], 'claude-opus-4-5': [5, 25, 6.25, 0.5],
  'claude-sonnet-4-6': [3, 15, 3.75, 0.3], 'claude-haiku-4-5': [1, 5, 1.25, 0.1],
}
const ALERT_EVERY = 10   // dollars
let pending = 0          // dollars not yet flushed

export function costOf(model, u = {}) {
  const p = PRICE[String(model || '').replace(/-\d{8}$/, '')] || PRICE['claude-opus-4-7']
  return ((u.input_tokens || 0) * p[0] + (u.output_tokens || 0) * p[1] + (u.cache_creation_input_tokens || 0) * p[2] + (u.cache_read_input_tokens || 0) * p[3]) / 1e6
}

/** Wrap an Anthropic client so messages.create adds its cost to the pending total. */
export function tracked(client) {
  const create = client.messages.create.bind(client.messages)
  client.messages.create = async (params, opts) => {
    const r = await create(params, opts)
    try { pending += costOf(params?.model || r?.model, r?.usage) } catch { /* never block a scrub */ }
    return r
  }
  return client
}

const dayKey = () => `scrub_spend_${new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles' }).format(new Date()).replace(/-/g, '')}`

/** Add what this instance spent to today's total; alert when a $10 line is crossed. */
export async function flush(req) {
  if (!pending) return null
  const add = pending; pending = 0
  try {
    const seg = catalyst.initialize(req).cache().segment()
    const k = dayKey()
    let before = 0; try { before = Number(await seg.getValue(k)) || 0 } catch { before = 0 }
    const after = Math.round((before + add) * 10000) / 10000
    await seg.put(k, String(after), 48)
    if (Math.floor(after / ALERT_EVERY) > Math.floor(before / ALERT_EVERY)) {
      const line = Math.floor(after / ALERT_EVERY) * ALERT_EVERY
      const msg = `💵 Scrubbing has spent $${after.toFixed(2)} on Claude today (passed $${line}). Still scrubbing — nothing is held. You'll hear again at $${line + ALERT_EVERY}.`
      let breakdown = ''
      try { const { spendDay } = await import('./aiSpend.js'); const d = await spendDay(req); if (d.rows.length) breakdown = `\nWhole app today: $${d.total.toFixed(2)} · top: ${d.rows.slice(0, 4).map(r => `${r.feature.replace(/^(services|routes)\//, '')} $${r.dollars.toFixed(2)} (${r.calls})`).join(', ')}` } catch { /* fine */ }
      try { const { createNotification } = await import('../routes/notifications.js'); await createNotification(req, { to: 'Mark', toEmail: 'mark@absoluteadas.com', type: 'spend', title: `💵 Scrub spend today: $${after.toFixed(2)}`, body: msg + breakdown, skipTechChannel: true }) } catch { /* fine */ }
      try { const { postToCliqChannel, DISPATCH_CHANNEL } = await import('./cliq.js'); await postToCliqChannel(DISPATCH_CHANNEL, msg + breakdown) } catch { /* fine */ }
    }
    return after
  } catch (e) { pending += add; console.warn('[spend] flush failed:', e.message); return null }
}

export async function todaySpend(req) {
  try { return Number(await catalyst.initialize(req).cache().segment().getValue(dayKey())) || 0 } catch { return 0 }
}
