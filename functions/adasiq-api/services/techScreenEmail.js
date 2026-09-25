// 📧 The electrical diagnostic screen, sent to a candidate the moment they
// apply (Mark 2026-09-25: "when people apply through the careers page I want
// them to automatically get this email after applying with this job from me").
//
// Candidates will usually have no ADAS calibration experience — that is fine
// and the email says so. What we cannot teach quickly is diagnostic thinking,
// so that is what the six questions test. Design notes and the scoring sheet:
// vault 01 Absolute ADAS/People/HR/Hiring/.
//
// Sent once per candidate, from Mark, plain words, third-grade reading level.
import catalyst from 'zcatalyst-sdk-node'

const SENT_KEY = id => `tech_screen_sent:${String(id).replace(/[^0-9a-z]/gi, '')}`.slice(0, 64)

export const QUESTIONS = [
  { n: 1, q: 'A headlight is dim. The battery reads 12.6 volts. With the lamp on, you read 9.8 volts at the bulb connector. What does that tell you, and what do you measure next?' },
  { n: 2, q: 'A customer says the battery is dead every three days. After the car sits 45 minutes you read 450 milliamps. Walk me through how you find it.' },
  { n: 3, q: 'A sensor signal circuit reads 0 volts at the connector. You unplug the sensor and the same wire reads 5 volts. What is wrong?' },
  { n: 4, q: 'Three modules will not communicate. Where do you start, and what do you expect your meter to read?' },
  { n: 5, q: 'A shop replaced a quarter panel. Now the blind spot radar sets a code. What do you go look at first?' },
  { n: 6, q: 'You replaced a part and the same fault came back a week later. What did you probably skip?' },
]

const esc = s => String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

export function screenEmail(firstName) {
  const hi = firstName ? `Hi ${esc(firstName)},` : 'Hi,'
  const subject = 'Your application — six questions from Mark at Absolute ADAS'
  const body = `<div style="background:#f5f3f0;padding:24px 12px;font-family:-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif">
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="max-width:600px;margin:0 auto;background:#ffffff;border-radius:14px;overflow:hidden;box-shadow:0 2px 10px rgba(0,0,0,.06)">
  <tr><td style="background:#CD4419;padding:20px 26px">
    <div style="font-size:21px;font-weight:800;color:#ffffff;letter-spacing:-.2px">Absolute ADAS</div>
    <div style="font-size:12px;color:rgba(255,255,255,.88);letter-spacing:.09em;text-transform:uppercase;margin-top:3px">Mobile ADAS Calibration &amp; Diagnostics</div>
  </td></tr>

  <tr><td style="padding:26px 26px 6px">
    <p style="margin:0 0 14px;font-size:16px;line-height:1.55;color:#1a1a1a">${hi}</p>
    <p style="margin:0 0 14px;font-size:16px;line-height:1.55;color:#1a1a1a">Thanks for applying. I read every one of these myself.</p>
    <p style="margin:0 0 14px;font-size:16px;line-height:1.55;color:#1a1a1a"><b>You do not need ADAS calibration experience.</b> We teach that, and most people pick it up in a few weeks. What I cannot teach fast is how you think through an electrical problem. So that is what I ask about.</p>
    <p style="margin:0 0 6px;font-size:16px;line-height:1.55;color:#1a1a1a">Answer these in your own words, right in a reply to this email. Short is fine. I care about <b>how you would test it</b>, not whether you name the right part.</p>
  </td></tr>

  <tr><td style="padding:10px 26px 4px">
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
${QUESTIONS.map(x => `      <tr><td style="padding:0 0 10px">
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background:#faf9f7;border:1px solid #eee8e3;border-radius:10px">
          <tr>
            <td width="42" valign="top" style="padding:14px 0 14px 14px">
              <div style="width:28px;height:28px;border-radius:14px;background:#CD4419;color:#fff;font-weight:800;font-size:14px;text-align:center;line-height:28px">${x.n}</div>
            </td>
            <td style="padding:14px 16px 14px 8px;font-size:15px;line-height:1.5;color:#26221f">${esc(x.q)}</td>
          </tr>
        </table>
      </td></tr>`).join('\n')}
    </table>
  </td></tr>

  <tr><td style="padding:8px 26px 4px">
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background:#fff5f0;border:2px solid #CD4419;border-radius:12px">
      <tr><td style="padding:16px 18px">
        <div style="font-size:17px;font-weight:800;color:#CD4419;margin-bottom:6px">🎥 One more thing, and it is the part I look at first</div>
        <div style="font-size:15px;line-height:1.55;color:#7c2d12">Send me a video, about 90 seconds. Do a voltage drop test on your own car and say your readings out loud as you go. Phone camera is fine. I am not grading the car or the lighting.</div>
      </td></tr>
    </table>
  </td></tr>

  <tr><td style="padding:18px 26px 4px">
    <p style="margin:0 0 14px;font-size:16px;line-height:1.55;color:#1a1a1a">If something in here is not your strong suit, say so. I would rather know.</p>
    <p style="margin:0 0 4px;font-size:13px;font-weight:800;color:#8a8580;letter-spacing:.08em;text-transform:uppercase">What happens next</p>
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin:0 0 4px">
      <tr><td style="padding:5px 0;font-size:15px;color:#33302e"><b style="color:#CD4419">1.</b> &nbsp;You reply with your answers and the video</td></tr>
      <tr><td style="padding:5px 0;font-size:15px;color:#33302e"><b style="color:#CD4419">2.</b> &nbsp;A short call with me</td></tr>
      <tr><td style="padding:5px 0;font-size:15px;color:#33302e"><b style="color:#CD4419">3.</b> &nbsp;A <b>paid</b> day out with me on real cars</td></tr>
    </table>
  </td></tr>

  <tr><td style="padding:20px 26px 26px">
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="border-top:1px solid #efeae6">
      <tr><td style="padding-top:16px">
        <div style="font-size:16px;font-weight:800;color:#1a1a1a">Mark Fowler</div>
        <div style="font-size:14px;color:#6b6560;margin-top:2px">Founder, Absolute ADAS</div>
        <div style="font-size:14px;margin-top:8px"><a href="tel:+18443492327" style="color:#CD4419;font-weight:700;text-decoration:none">(844) 349-2327</a>
          &nbsp;·&nbsp; <a href="https://absoluteadas.com" style="color:#CD4419;font-weight:700;text-decoration:none">absoluteadas.com</a></div>
      </td></tr>
    </table>
  </td></tr>
</table>
<div style="max-width:600px;margin:14px auto 0;text-align:center;font-size:12px;color:#a8a29e">Same day. Done right.</div>
</div>`

  const text = `${firstName ? `Hi ${firstName},` : 'Hi,'}

Thanks for applying. I read every one of these myself.

You do not need ADAS calibration experience. We teach that. What I cannot teach fast is how you think through an electrical problem, so that is what I ask about.

Answer these in your own words, right in a reply. Short is fine. I care about how you would test it, not whether you name the right part.

${QUESTIONS.map(x => `${x.n}. ${x.q}`).join('\n\n')}

One more thing, and it is the part I look at first: send me a video, about 90 seconds. Do a voltage drop test on your own car and say your readings out loud. Phone camera is fine.

If something in here is not your strong suit, say so. I would rather know.

If I like how you think, the next step is a short call, then a paid day out with me on real cars.

Thanks,
Mark Fowler
Absolute ADAS
(844) 349-2327`
  return { subject, body, text }
}

/** Send it once. Never throws — an email problem must not lose an application. */
export async function sendTechScreen(req, candidate, { force = false } = {}) {
  const to = String(candidate?.email || '').trim().toLowerCase()
  if (!to) return { sent: false, why: 'no email on the application' }
  const app = catalyst.initialize(req, { type: 'advancedio' })
  const key = SENT_KEY(candidate.id || to)
  if (!force) {
    try { const r = await app.zcql().executeZCQLQuery(`SELECT ROWID FROM AppConfig WHERE config_key = '${key}' LIMIT 1`); if (r?.[0]) return { sent: false, why: 'already sent' } } catch { /* fall through */ }
  }
  const first = String(candidate.name || '').trim().split(/\s+/)[0] || ''
  const { subject, body } = screenEmail(first)
  try {
    const { getMailAccessToken, getMailAccountIdFor, sendMail } = await import('./mail.js')
    const token = await getMailAccessToken()
    const accountId = await getMailAccountIdFor(token, 'mark@absoluteadas.com')
    await sendMail(token, accountId, { to, subject, body })
    try { await app.datastore().table('AppConfig').insertRow({ config_key: key, config_value: new Date().toISOString() }) } catch { /* stamp is best effort */ }
    console.log(`[tech-screen] sent to ${to} (${candidate.name || ''})`)
    return { sent: true, to }
  } catch (e) {
    console.warn('[tech-screen] send failed:', e.message)
    return { sent: false, why: e.message }
  }
}
