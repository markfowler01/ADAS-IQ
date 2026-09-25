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
  const body = `<div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;font-size:15px;line-height:1.55;color:#1a1a1a">
<p>${hi}</p>
<p>Thanks for applying. I read every one of these myself.</p>
<p><b>You do not need ADAS calibration experience.</b> We teach that, and most people pick it up in a few weeks. What I cannot teach fast is how you think through an electrical problem. So that is what I ask about.</p>
<p>Here are six questions. Answer them in your own words, right in a reply to this email. Short is fine. I care about <b>how you would test it</b>, not whether you name the right part.</p>
<ol style="padding-left:18px">
${QUESTIONS.map(x => `<li style="margin:10px 0">${esc(x.q)}</li>`).join('\n')}
</ol>
<p style="margin-top:18px"><b>One more thing, and it is the part I look at first.</b><br>
Send me a video, about 90 seconds. Do a voltage drop test on your own car and say your readings out loud as you go. Phone camera is fine. I am not grading the car or the lighting.</p>
<p>If something in here is not your strong suit, say so. I would rather know.</p>
<p>Reply when you get a chance. If I like how you think, the next step is a short call with me, and then a paid day out with one of our techs on real cars.</p>
<p>Thanks,<br>
<b>Mark Fowler</b><br>
Absolute ADAS<br>
(844) 349-2327</p>
</div>`
  const text = `${firstName ? `Hi ${firstName},` : 'Hi,'}

Thanks for applying. I read every one of these myself.

You do not need ADAS calibration experience. We teach that. What I cannot teach fast is how you think through an electrical problem, so that is what I ask about.

Answer these in your own words, right in a reply. Short is fine. I care about how you would test it, not whether you name the right part.

${QUESTIONS.map(x => `${x.n}. ${x.q}`).join('\n\n')}

One more thing, and it is the part I look at first: send me a video, about 90 seconds. Do a voltage drop test on your own car and say your readings out loud. Phone camera is fine.

If something in here is not your strong suit, say so. I would rather know.

If I like how you think, the next step is a short call with me, then a paid day out with one of our techs on real cars.

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
