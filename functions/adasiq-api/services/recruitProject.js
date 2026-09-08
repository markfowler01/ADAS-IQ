// Recruiting "first project" (Mark 2026-09-07): ~2 hours after someone
// applies, they get a professional email with a small project — a
// 2–5 min video answering five questions + a Word doc that must contain
// the exact line "Same Day. Done Right." They submit on a token-keyed
// upload page hosted by this function; the card moves to 🧪 Project,
// the .docx is checked for the words, and Mark gets a Cliq ping.
//
// Questions pick themselves from the role on the application: everyone
// gets the universal five; "ADAS Calibration Technician" swaps the first
// two for real calibration questions (Mark: "not everyone that applies
// knows ADAS").
import { inflateRawSync } from 'zlib'
import crypto from 'crypto'

export const REQUIRED_WORDS = 'Same Day. Done Right.'
export const PROJECT_DEADLINE_HOURS = 72
export const PROJECT_DELAY_HOURS = 2
const API_BASE_URL = 'https://adas-iq-904191467.development.catalystserverless.com/server/adasiq-api'

const UNIVERSAL = [
  "Tell me about the hardest problem you've ever fixed — on a car or anything else. How did you figure it out?",
  'Explain something technical you know well to someone who knows nothing about it. Anything — brakes, a phone, a tool.',
  'A shop is upset because a job took longer than promised. What do you say, and what do you do?',
  'Tell me about a mistake you made at work and what you changed afterward.',
  'Why this job, and where do you want to be in three years?',
]
const ADAS_SWAP = [
  "Walk me through a front radar calibration you've done. What did you check first, and what would make you stop and not calibrate?",
  'A shop says the ADAS light is off, so the car is fine. How do you explain why a calibration is still required?',
]
export function questionsFor(role) {
  const isTech = /adas calibration technician/i.test(String(role || ''))
  return isTech ? [ADAS_SWAP[0], ADAS_SWAP[1], ...UNIVERSAL.slice(2)] : UNIVERSAL
}

export function newToken() { return crypto.randomBytes(24).toString('base64url') }
export function projectUrl(token) { return `${API_BASE_URL}/api/public/recruit/project/${token}` }

// ── The email ────────────────────────────────────────────────────────────
export function buildProjectEmail(c) {
  const first = String(c.name || '').trim().split(/\s+/)[0] || 'there'
  const qs = questionsFor(c.role)
  const url = projectUrl(c.project_token)
  const esc = s => String(s).replace(/[<>&]/g, ch => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[ch]))
  const qHtml = qs.map((q, i) => `<li style="margin:0 0 10px">${esc(q)}</li>`).join('')
  const qText = qs.map((q, i) => `${i + 1}. ${q}`).join('\n')
  const subject = 'Your first project with Absolute ADAS'
  const html = `
<div style="font-family:Inter,-apple-system,Helvetica,Arial,sans-serif;font-size:15px;line-height:1.6;color:#1a1a1a;max-width:640px;margin:0 auto;padding:8px 4px">
  <p>Hi ${esc(first)},</p>
  <p>Thanks for applying. Before we talk on the phone I'd like to see how you think and how you communicate, so here's a small project. It's the same thing we ask of everyone.</p>
  <p><strong>1. A short video (2–5 minutes, your phone is fine).</strong> Answer the five questions below out loud, like you're explaining to a shop owner standing next to the car. No editing, no script — I want the real you.</p>
  <p><strong>2. A Word document.</strong> Title it with your name, put your answers to the same five questions in writing (a few sentences each is plenty), and include this exact line somewhere in the document:</p>
  <p style="font-size:18px;font-weight:800;letter-spacing:.01em;margin:6px 0 16px;color:#CD4419">“${esc(REQUIRED_WORDS)}”</p>
  <p><strong>The five questions:</strong></p>
  <ol style="padding-left:22px;margin:0 0 18px">${qHtml}</ol>
  <p>Send both within <strong>${PROJECT_DEADLINE_HOURS} hours</strong> using your private link — it takes two minutes:</p>
  <p style="margin:14px 0 22px"><a href="${url}" style="display:inline-block;background:#CD4419;color:#fff;text-decoration:none;font-weight:800;padding:13px 22px;border-radius:10px">Submit my project →</a></p>
  <p style="font-size:13px;color:#666">If the button doesn't work, copy this link: <a href="${url}" style="color:#CD4419">${url}</a></p>
  <p>Looking forward to it.</p>
  <p style="margin-top:22px"><strong>Mark Fowler</strong><br>Owner, Absolute ADAS<br><span style="color:#666">Lake Stevens, WA · absoluteadas.com</span></p>
</div>`
  const text = `Hi ${first},

Thanks for applying. Before we talk on the phone I'd like to see how you think and how you communicate, so here's a small project. It's the same thing we ask of everyone.

1. A SHORT VIDEO (2-5 minutes, your phone is fine). Answer the five questions below out loud, like you're explaining to a shop owner standing next to the car. No editing, no script — I want the real you.

2. A WORD DOCUMENT. Title it with your name, put your answers to the same five questions in writing (a few sentences each is plenty), and include this exact line somewhere in the document:

"${REQUIRED_WORDS}"

The five questions:
${qText}

Send both within ${PROJECT_DEADLINE_HOURS} hours using your private link — it takes two minutes:
${url}

Looking forward to it.

Mark Fowler
Owner, Absolute ADAS
Lake Stevens, WA · absoluteadas.com`
  return { subject, html, text }
}

// ── .docx text + the words check ─────────────────────────────────────────
// A .docx is a zip; the text lives in word/document.xml. Minimal zip
// reader (central directory → local header → inflateRaw) so no extra deps.
export function docxText(buf) {
  const eocd = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]))
  if (eocd < 0) throw new Error('Not a .docx (zip) file')
  const cdOffset = buf.readUInt32LE(eocd + 16)
  const entries = buf.readUInt16LE(eocd + 10)
  let p = cdOffset
  for (let i = 0; i < entries; i++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) break
    const method = buf.readUInt16LE(p + 10)
    const csize = buf.readUInt32LE(p + 20)
    const nameLen = buf.readUInt16LE(p + 28), extraLen = buf.readUInt16LE(p + 30), commentLen = buf.readUInt16LE(p + 32)
    const localOff = buf.readUInt32LE(p + 42)
    const name = buf.toString('utf8', p + 46, p + 46 + nameLen)
    p += 46 + nameLen + extraLen + commentLen
    if (name !== 'word/document.xml') continue
    const lnameLen = buf.readUInt16LE(localOff + 26), lextraLen = buf.readUInt16LE(localOff + 28)
    const start = localOff + 30 + lnameLen + lextraLen
    const data = buf.subarray(start, start + csize)
    const xml = (method === 8 ? inflateRawSync(data) : data).toString('utf8')
    return xml.replace(/<w:tab\/>/g, ' ').replace(/<\/w:p>/g, '\n').replace(/<[^>]+>/g, '')
  }
  throw new Error('word/document.xml not found — is this a .docx?')
}
const norm = s => String(s).toLowerCase().replace(/[^a-z0-9]/g, '')
export function hasRequiredWords(text) { return norm(text).includes(norm(REQUIRED_WORDS)) }

// ── The upload page (served by the function; dark site style) ───────────
export function projectPageHtml(c, { done = false, error = '' } = {}) {
  const first = String(c?.name || '').trim().split(/\s+/)[0] || 'there'
  const qs = questionsFor(c?.role)
  const esc = s => String(s).replace(/[<>&"]/g, ch => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[ch]))
  const body = done ? `
    <div class="brand">Absolute ADAS</div>
    <h1>Got it, ${esc(first)}. 👊</h1>
    <p class="lede">Your project is in. Mark reads and watches every one himself — expect to hear back within a few days.</p>` : `
    <div class="brand">Absolute ADAS · First project</div>
    <h1>Hi ${esc(first)} — send your project here.</h1>
    <p class="lede">Your Word document and your video. The document must include the exact line <b style="color:#CD4419">“${esc(REQUIRED_WORDS)}”</b>.</p>
    <details><summary>The five questions (for reference)</summary><ol>${qs.map(q => `<li>${esc(q)}</li>`).join('')}</ol></details>
    ${error ? `<div class="msg err">${esc(error)}</div>` : ''}
    <form method="POST" enctype="multipart/form-data">
      <label for="doc">Word document (.docx)</label>
      <input id="doc" name="doc" type="file" accept=".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document" required>
      <label for="video_link">Video link <small>(unlisted YouTube, Google Drive, iCloud, Dropbox…)</small></label>
      <input id="video_link" name="video_link" type="url" placeholder="https://…">
      <label for="video">…or upload the video file <small>(optional, up to 25 MB)</small></label>
      <input id="video" name="video" type="file" accept="video/*">
      <input class="hp" name="website" tabindex="-1" autocomplete="off">
      <button id="b" type="submit" onclick="this.disabled=true;this.textContent='Sending…';this.form.submit()">Submit my project →</button>
      <p class="foot">Two minutes. If anything fails, reply to Mark's email and attach the files instead.</p>
    </form>`
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>First project · Absolute ADAS</title>
<style>*{box-sizing:border-box}body{margin:0;background:#0d0d0d;font-family:Inter,-apple-system,Helvetica,Arial,sans-serif;color:#fff;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:32px 16px}.card{background:#f0ece6;color:#1a1a1a;max-width:560px;width:100%;border-radius:16px;box-shadow:0 12px 40px rgba(0,0,0,.4);padding:36px 30px;border-top:5px solid #CD4419}.brand{font-size:11px;font-weight:800;letter-spacing:.16em;color:#CD4419;text-transform:uppercase;margin-bottom:8px}h1{font-size:26px;margin:0 0 10px;font-weight:900;line-height:1.15}.lede{color:#444;font-size:15px;line-height:1.55;margin:0 0 14px}details{margin:0 0 10px;font-size:14px;color:#444}summary{cursor:pointer;font-weight:700;color:#1a1a1a}ol{padding-left:20px}li{margin:6px 0}label{display:block;font-size:12px;font-weight:700;color:#444;margin:16px 0 6px;letter-spacing:.04em;text-transform:uppercase}label small{font-weight:500;text-transform:none;letter-spacing:0;color:#888}input{width:100%;padding:12px 14px;font-size:15px;border:1.5px solid #d9d4cc;border-radius:9px;background:#fff;color:#1a1a1a;font-family:inherit}input[type=file]{padding:10px 12px;color:#444}input:focus{outline:none;border-color:#CD4419}button{display:block;width:100%;background:#CD4419;color:#fff;font-size:16px;font-weight:800;padding:15px 22px;border-radius:10px;border:none;cursor:pointer;margin-top:22px;font-family:inherit}button:disabled{opacity:.6}.msg{padding:12px 14px;border-radius:9px;font-size:14px;margin:14px 0 0}.err{background:#fee2e2;color:#b91c1c;border:1px solid #fca5a5}.foot{margin-top:14px;font-size:12px;color:#777}.hp{position:absolute;left:-9999px}</style></head>
<body><div class="card">${body}</div></body></html>`
}
