// 📝 Welcome questionnaire page (Mark 2026-10-01). Public, no login: the link
// in "Welcome to Absolute ADAS" carries a signed per-shop token. Tapping an
// answer in the email opens this page with that answer checked; the shop taps
// the rest and presses Done. A GET never saves (mail scanners open links), only
// the Done button does.
import express from 'express'

const router = express.Router()
const esc = s => String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

function page(body) {
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Absolute ADAS</title>
<style>
body{margin:0;background:#fafaf9;font-family:-apple-system,Helvetica,Arial,sans-serif;color:#1a1a1a}
.top{background:#CD4419;color:#fff;font-weight:800;padding:14px 16px;font-size:18px}
.wrap{max-width:520px;margin:0 auto;padding:16px}
.q{background:#fff;border:1.5px solid #e8e4e0;border-radius:14px;padding:14px;margin:10px 0}
.q b{display:block;font-size:16px;margin-bottom:8px}
.opts{display:flex;flex-wrap:wrap;gap:8px}
.opts input{display:none}
.opts label{padding:10px 16px;border-radius:999px;border:2px solid #CD4419;color:#CD4419;font-weight:700;font-size:15px;cursor:pointer}
.opts input:checked+label{background:#CD4419;color:#fff}
.fs{border-color:#0369a1;background:#f0f9ff}
.fs .opts label{border-color:#0369a1;color:#0369a1}.fs .opts input:checked+label{background:#0369a1;color:#fff}
button{width:100%;margin-top:12px;padding:15px;border:0;border-radius:12px;background:#1a1a1a;color:#fff;font-size:17px;font-weight:800}
.note{font-size:13px;color:#666}
</style></head><body><div class="top">Absolute ADAS</div><div class="wrap">${body}</div></body></html>`
}

router.get('/:token', async (req, res) => {
  try {
    const W = await import('../services/shopWelcome.js')
    const id = await W.shopIdFromToken(req, req.params.token)
    if (!id) return res.status(404).send(page('<p>This link is not valid. Text us at (425) 675-1329.</p>'))
    let name = 'your shop', prev = {}
    if (id !== 'test') {
      const { getAllShops } = await import('./shops.js')
      const shop = (await getAllShops(req)).find(x => String(x.id) === String(id))
      if (shop) { name = shop.shop_name; const br = typeof shop.billing_rules === 'string' ? JSON.parse(shop.billing_rules || '{}') : (shop.billing_rules || {}); prev = br.onboarding_answers || {} }
    }
    const pick = { ...prev, ...req.query }
    const qs = W.SHOP_QUESTIONS.map(x => `<div class="q${x.key === 'full_service' ? ' fs' : ''}"><b>${x.key === 'full_service' ? '🧰 ' : ''}${esc(x.q)}</b>${x.key === 'full_service' ? '<div class="note" style="margin:-4px 0 8px">Headlamp aim, TPMS relearn, module programming, and the resets after a battery disconnect. We finish the car.</div>' : ''}<div class="opts">${x.opts.map(([a, l]) => `<input type="radio" id="${x.key}_${a}" name="${x.key}" value="${a}"${pick[x.key] === a ? ' checked' : ''}><label for="${x.key}_${a}">${esc(l)}</label>`).join('')}</div></div>`).join('')
    res.send(page(`<h2 style="margin:6px 0 2px">How do you want to work with us?</h2><div class="note">${esc(name)} · 30 seconds. Tap your answers, then Done.</div>
<form method="post">${qs}<button type="submit">Done</button></form>
<p class="note" style="margin-top:14px">The car maker requires the scans and the safety inspection on every collision car. Either of us can do them. If you do your own post-scans, we add a Calibration Snapshot so the carrier sees every calibration held.</p>`))
  } catch (e) { console.error('[shop-answers GET]', e.message); res.status(500).send(page('<p>Something went wrong. Text us at (425) 675-1329.</p>')) }
})

router.post('/:token', express.urlencoded({ extended: false }), async (req, res) => {
  try {
    const W = await import('../services/shopWelcome.js')
    const id = await W.shopIdFromToken(req, req.params.token)
    if (!id) return res.status(404).send(page('<p>This link is not valid. Text us at (425) 675-1329.</p>'))
    const answers = Object.fromEntries(W.SHOP_QUESTIONS.map(x => [x.key, String(req.body?.[x.key] || '')]))
    if (id !== 'test') await W.applyShopAnswers(req, id, answers)
    else console.log('[shop-answers] test submit', JSON.stringify(answers))
    const fs = answers.full_service === 'yes' ? '<p><b>Full Service:</b> great. Mark will call you to set it up.</p>' : answers.full_service === 'more' ? '<p>Mark will call you about Full Service.</p>' : ''
    res.send(page(`<h2 style="margin:6px 0">✅ Got it. Thank you.</h2><p>We set up your account to match. Change your mind any time: just reply to the email or text (425) 675-1329.</p>${fs}${id === 'test' ? '<p class="note">(Test link: nothing was saved.)</p>' : ''}`))
  } catch (e) { console.error('[shop-answers POST]', e.message); res.status(500).send(page('<p>We could not save that. Text us at (425) 675-1329 and we will set it up.</p>')) }
})

export default router
