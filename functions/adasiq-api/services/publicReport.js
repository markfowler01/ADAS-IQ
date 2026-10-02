// 🌐 Online report with "Why?" popups (Mark 2026-10-02: Kinetic's web report — every
// calibration up top, a ✨ bubble that explains why with the OEM document and pages,
// and a Feedback button). One page per scrub at a signed, unguessable link; no login.
// The PDF carries a QR code + link to it. ALLDATA pages are never served here (they
// are licensed to our subscription) — only OEM documents from the library.
import crypto from 'node:crypto'
import catalyst from 'zcatalyst-sdk-node'

let _secret = ''
async function secret(req) {
  if (_secret) return _secret
  const app = catalyst.initialize(req, { type: 'advancedio' })
  const rows = await app.zcql().executeZCQLQuery("SELECT config_value FROM AppConfig WHERE config_key = 'public_report_secret' LIMIT 1")
  _secret = String(rows?.[0]?.AppConfig?.config_value || '')
  if (!_secret) {
    _secret = crypto.randomBytes(24).toString('hex')
    await app.datastore().table('AppConfig').insertRow({ config_key: 'public_report_secret', config_value: _secret })
  }
  return _secret
}
export async function reportToken(req, scrubId) {
  const sig = crypto.createHmac('sha256', await secret(req)).update(`report:${scrubId}`).digest('base64url').slice(0, 22)
  return `${scrubId}.${sig}`
}
export async function scrubIdFromToken(req, token) {
  const [id, sig] = String(token || '').split('.')
  if (!/^\d{1,25}$/.test(id || '') || !sig) return null
  const want = (await reportToken(req, id)).split('.')[1]
  return sig.length === want.length && crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(want)) ? id : null
}
export const PUBLIC_BASE = process.env.API_PUBLIC_BASE || 'https://adas-iq-904191467.development.catalystserverless.com/server/adasiq-api'
export async function reportUrl(req, scrubId) { return `${PUBLIC_BASE}/api/public/report/${await reportToken(req, scrubId)}` }

/** Everything the page needs: the scrub, its calibrations tagged like the PDF, cited docs. */
export async function reportData(req, scrubId, { withDocs = true } = {}) {
  const { getScrub } = await import('./scrubStore.js')
  const s = await getScrub(req, scrubId)
  if (!s) return null
  let cals = (s.payload?.calibrations || []).map(c => ({ ...c }))
  try {
    const fs = await import('./fullService.js')
    const r = s.shop ? await fs.readFullService(req, s.shop) : null
    cals = fs.tagRows(cals, r?.rules, { collision: r ? r.collision : true })
  } catch { /* plain rows */ }
  let cited = []
  if (withDocs) {
    try { const A = await import('./oemAttach.js'); cited = await A.fetchCited(req, await A.citedDocs(req, cals), cals) } catch (e) { console.warn('[public report] docs:', e.message) }
  }
  return { s, cals, cited }
}

const esc = v => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

export function renderReport({ s, cals, cited }, token) {
  const req = cals.filter(c => c.enabled && !c._fs), fsv = cals.filter(c => c.enabled && c._fs), notReq = cals.filter(c => !c.enabled && !c._fs)
  const rows = [...req, ...fsv, ...notReq]
  const vehicle = [s.year, s.make, s.model].filter(Boolean).join(' ') || s.vehicle || 'Vehicle'
  const docLink = (n, page) => `${esc(token)}/doc/${n}${page ? `#page=${page}` : ''}`
  const why = c => {
    const name = String(c.calibration_name || '').replace(/\s*calibration$/i, '')
    const q = c.enabled ? `Why is a ${name}${c.cal_type ? ` – ${c.cal_type}` : ''} calibration required?` : `Why isn't a ${name} calibration required?`
    const refs = (c._refs || []).map(r => `<div class="ref"><b>OEM Reference:</b> Attachment ${r.n} — ${esc(r.title)}${r.pages.length ? `, see page${r.pages.length > 1 ? 's' : ''} ${r.pages.join(', ')}` : ''}<br><a class="btn" target="_blank" href="${docLink(r.n, r.pages[0])}">Open the OEM document${r.pages[0] ? ` at page ${r.pages[0]}` : ''} ↗</a></div>`).join('')
    return { q, a: c.justification || (c.enabled ? 'Required by the vehicle manufacturer for this repair.' : 'No operation on this estimate disturbs this sensor.'), refs }
  }
  const rowHtml = rows.map((c, i) => {
    const w = why(c), on = !!c.enabled
    const type = on ? (c._fs ? 'Full Service' : (c.cal_type || 'Required')) : 'Not required'
    return `<tr class="${on ? 'on' : 'off'}">
      <td><span class="dot ${on ? 'r' : ''}"></span><b>${esc(String(c.calibration_name || '').replace(/\s*calibration$/i, ''))}</b></td>
      <td>${on ? esc(c.trigger || '') : '—'} <button class="why" data-i="${i}" title="Why?">✨</button></td>
      <td class="ln">${on ? esc(c.line_references || '—') : '—'}</td>
      <td><span class="type ${on ? (c._fs ? 'fs' : 'req') : 'nr'}">${esc(type)}</span></td>
      <td><button class="fb" data-i="${i}" title="Feedback">💬</button></td>
    </tr>
    <template id="w${i}"><h3>Q: ${esc(w.q)}</h3><p><b>A:</b> ${esc(w.a)}</p>${w.refs}</template>`
  }).join('')
  const docs = cited.map(d => `<li><a target="_blank" href="${docLink(d.n)}">Attachment ${d.n} — ${esc(d.row.doc_oem ? d.row.doc_oem + ': ' : '')}${esc(d.row.doc_title)}</a>${d.row.doc_published_date ? ` <span class="muted">(${esc(d.row.doc_published_date)})</span>` : ''}</li>`).join('')
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(vehicle)} · Absolute ADAS</title>
<style>
:root{--o:#CD4419;--ink:#1a1a1a;--g:#6b7280;--bd:#e8e4e0}
*{box-sizing:border-box}body{margin:0;background:#f5f3f0;font-family:-apple-system,Helvetica,Arial,sans-serif;color:var(--ink)}
.top{background:var(--o);color:#fff;padding:16px 20px;display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px}
.top b{font-size:20px}.wrap{max-width:980px;margin:0 auto;padding:16px}
.card{background:#fff;border:1px solid var(--bd);border-radius:12px;padding:16px;margin-bottom:14px}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px}.k{font-size:11px;color:var(--g);text-transform:uppercase;letter-spacing:.04em}.v{font-weight:700}
.tiles{display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:10px}.tile{border-radius:12px;padding:14px;background:#fff5f0;border:1px solid #f6c3b1}.tile.gray{background:#f5f5f4;border-color:var(--bd)}.tile b{font-size:30px;color:var(--o)}.tile.gray b{color:var(--g)}
table{width:100%;border-collapse:collapse;font-size:14px}th{background:var(--o);color:#fff;text-align:left;padding:9px;font-size:12px}td{padding:9px;border-bottom:1px solid #f0ece8;vertical-align:top}
tr.off td{color:#a8a29e}.dot{display:inline-block;width:9px;height:9px;border-radius:50%;border:1.5px solid #bdb7b1;margin-right:8px}.dot.r{background:var(--o);border-color:var(--o)}
.type{font-size:11px;font-weight:800;padding:3px 8px;border-radius:999px;white-space:nowrap}.type.req{background:#fde8de;color:var(--o)}.type.fs{background:#e0f2fe;color:#0369a1}.type.nr{background:#f5f5f4;color:#a8a29e}
.ln{white-space:nowrap}button.why,button.fb{border:0;background:#f5f3ff;border-radius:999px;cursor:pointer;padding:3px 7px;font-size:13px}button.fb{background:#f5f5f4}
.modal{position:fixed;inset:0;background:rgba(0,0,0,.45);display:none;align-items:flex-end;justify-content:center;padding:12px}.modal.show{display:flex}
@media(min-width:640px){.modal{align-items:center}}.sheet{background:#fff;border-radius:16px;max-width:620px;width:100%;padding:18px;max-height:85vh;overflow:auto}
.sheet h3{margin:0 0 8px;font-size:16px}.ref{background:#faf5ff;border:1px solid #e9d5ff;border-radius:10px;padding:10px;margin-top:10px;font-size:13px;color:#5b21b6}
.btn{display:inline-block;margin-top:8px;background:#5b21b6;color:#fff;border-radius:8px;padding:7px 12px;text-decoration:none;font-weight:700;font-size:13px}
.close{float:right;border:0;background:#f5f5f4;border-radius:999px;width:30px;height:30px;font-size:16px;cursor:pointer}
textarea,select{width:100%;border:1.5px solid #ddd;border-radius:8px;padding:8px;font:inherit;margin-top:6px}.send{background:var(--ink);color:#fff;border:0;border-radius:10px;padding:10px 14px;font-weight:800;margin-top:10px;cursor:pointer}
.muted{color:var(--g);font-size:12px}.box{border:1.5px solid var(--o);background:#fff7ed;border-radius:12px;padding:12px;margin-top:10px;font-size:14px}
@media(max-width:640px){th:nth-child(3),td:nth-child(3){display:none}table{font-size:13px}}
</style></head><body>
<div class="top"><b>Absolute ADAS</b><span>ADAS Calibration &amp; Diagnostic Report${s.ro ? ` · RO ${esc(s.ro)}` : ''}</span></div>
<div class="wrap">
<div class="card"><div style="font-size:20px;font-weight:800">${esc(vehicle)}</div>${s.vin ? `<div class="muted">VIN ${esc(s.vin)}</div>` : ''}
<div class="grid" style="margin-top:10px">${[['Shop', s.shop], ['RO', s.ro], ['Insurer', s.insurer], ['Claim', s.claim]].filter(([, v]) => v).map(([k, v]) => `<div><div class="k">${k}</div><div class="v">${esc(v)}</div></div>`).join('')}</div></div>
<div class="tiles" style="margin-bottom:14px"><div class="tile"><b>${req.length}</b><div>Calibrations required</div></div>${fsv.length ? `<div class="tile" style="background:#f0f9ff;border-color:#bae6fd"><b style="color:#0369a1">${fsv.length}</b><div>Full Service</div></div>` : ''}<div class="tile gray"><b>${notReq.length}</b><div>Checked, not required</div></div></div>
<div class="card" style="padding:0;overflow:hidden"><div style="padding:14px 16px;font-weight:800;font-size:17px">Operations <span class="muted" style="font-weight:400">— tap ✨ for why, 💬 to send us feedback</span></div>
<table><thead><tr><th>Sensor</th><th>Repair triggers</th><th>Lines</th><th>Type</th><th></th></tr></thead><tbody>${rowHtml}</tbody></table></div>
<div class="card"><div style="font-weight:800">Required on every collision repair</div>
<div class="box"><b>Seatbelts &amp; Post-Collision Safety Inspection (SRS, steering columns)</b> — required. OEM service information requires assessment of seat belt tensioners, SRS components and steering columns on any vehicle involved in a collision.</div>
<div class="box"><b>Pre-Repair &amp; Post-Repair Diagnostic Scans</b> — required. ${esc(s.make || 'The manufacturer')}'s collision position statement requires a pre-repair scan (warning lights are not a reliable indicator) and a post-repair scan to confirm every system communicates with no new faults.</div></div>
${docs ? `<div class="card"><div style="font-weight:800;margin-bottom:6px">Supporting OEM documents</div><ul style="margin:0;padding-left:18px">${docs}</ul></div>` : ''}
<p class="muted" style="text-align:center">Absolute ADAS · Mobile ADAS Calibration &amp; Diagnostics · Lake Stevens, WA · absoluteadas.com</p>
</div>
<div class="modal" id="m"><div class="sheet"><button class="close" onclick="m.classList.remove('show')">✕</button><div id="mc"></div></div></div>
<script>
const m=document.getElementById('m'),mc=document.getElementById('mc'),names=${JSON.stringify(rows.map(c => String(c.calibration_name || '')))};
document.querySelectorAll('button.why').forEach(b=>b.onclick=()=>{mc.innerHTML=document.getElementById('w'+b.dataset.i).innerHTML;m.classList.add('show')});
document.querySelectorAll('button.fb').forEach(b=>b.onclick=()=>{const n=names[b.dataset.i];mc.innerHTML='<h3>Feedback on '+n.replace(/[<>&]/g,'')+'</h3><select id="k"><option>I have a question</option><option>I disagree with this</option><option>Something is missing</option></select><textarea id="t" rows="4" placeholder="Your note (optional)"></textarea><input id="who" placeholder="Your name (optional)" style="width:100%;border:1.5px solid #ddd;border-radius:8px;padding:8px;margin-top:6px"><button class="send" id="s">Send to Absolute ADAS</button><div id="ok" class="muted"></div>';m.classList.add('show');
document.getElementById('s').onclick=async()=>{const r=await fetch(location.pathname+'/feedback',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({sensor:n,kind:document.getElementById('k').value,note:document.getElementById('t').value,who:document.getElementById('who').value})});document.getElementById('ok').textContent=r.ok?'✓ Sent. Thank you — we will follow up.':'Could not send. Text us at (425) 675-1329.'}});
m.onclick=e=>{if(e.target===m)m.classList.remove('show')};
</script></body></html>`
}
