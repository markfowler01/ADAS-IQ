// 🏭 Ops Hub state — vans, equipment, laptops, OEM subscriptions — kept on the
// server so every staff login sees the same page (2026-10-03: until now it lived
// in each person's browser, and the OEM dates were placeholders). One AppConfig
// row per section: ops_locations, ops_assets, ops_laptops, ops_oem.
import express from 'express'
import multer from 'multer'
import catalyst from 'zcatalyst-sdk-node'

const router = express.Router()
const KEYS = ['locations', 'assets', 'laptops', 'oem']
const app = req => catalyst.initialize(req, { type: 'advancedio' })
async function readKey(req, key) {
  const r = await app(req).zcql().executeZCQLQuery(`SELECT ROWID, config_value FROM AppConfig WHERE config_key = 'ops_${key}' LIMIT 1`)
  const row = r?.[0]?.AppConfig
  if (!row) return { row: null, value: null }
  try { return { row, value: JSON.parse(row.config_value || 'null') } } catch { return { row, value: null } }
}

router.get('/state', async (req, res) => {
  try {
    const out = {}
    for (const k of KEYS) out[k] = (await readKey(req, k)).value
    res.json({ ok: true, state: out })
  } catch (e) { res.status(500).json({ error: e.message }) }
})

router.put('/state/:key', express.json({ limit: '2mb' }), async (req, res) => {
  try {
    const key = String(req.params.key)
    if (!KEYS.includes(key)) return res.status(400).json({ error: 'unknown section' })
    if (!Array.isArray(req.body?.value)) return res.status(400).json({ error: 'value must be a list' })
    // Photos stay in the browser (data: URLs are far too big for a config row).
    const value = req.body.value.map(x => { const o = { ...x }; for (const k of Object.keys(o)) if (typeof o[k] === 'string' && o[k].startsWith('data:')) delete o[k]; return o })
    const json = JSON.stringify(value)
    if (json.length > 200000) return res.status(413).json({ error: 'too big — trim notes or photos' })
    const { row } = await readKey(req, key)
    const t = app(req).datastore().table('AppConfig')
    if (row) await t.updateRow({ ROWID: row.ROWID, config_value: json })
    else await t.insertRow({ config_key: `ops_${key}`, config_value: json })
    res.json({ ok: true, count: value.length, by: req.user?.name || req.user?.email || '' })
  } catch (e) { res.status(500).json({ error: e.message }) }
})

// ↔ Tool transfer between vans (Mark 2026-10-04): the move itself is saved with the
// Ops state; this tells #dispatch who moved what, so the one rare target set is never
// a mystery.
router.post('/transfer', express.json(), async (req, res) => {
  try {
    const { item, from, to, note } = req.body || {}
    const by = req.user?.name || req.user?.email || 'someone'
    const { postToCliqChannel, DISPATCH_CHANNEL } = await import('../services/cliq.js')
    await postToCliqChannel(DISPATCH_CHANNEL, `↔ *Tool transfer* · *${String(item || '').slice(0, 120)}* · ${from || 'Spare'} → ${to || 'Spare'} · by ${by}${note ? `\n"${String(note).slice(0, 200)}"` : ''}`).catch(() => {})
    res.json({ ok: true, by })
  } catch (e) { res.status(500).json({ error: e.message }) }
})

// One-time cleanup (2026-10-04): the page shipped with made-up renewal dates, and a
// browser that still had them pushed them up as the shared copy. Blank exactly those
// dates (same name, same date, no purchase date entered). ?dry=1 lists only.
router.post('/clean-placeholder-dates', async (req, res) => {
  try {
    const fs = await import('fs'); const path = await import('path'); const url = await import('url')
    const here = path.dirname(url.fileURLToPath(import.meta.url))
    const known = JSON.parse(fs.readFileSync(path.join(here, '../services/opsPlaceholderDates.json'), 'utf8'))
    const dry = String(req.query.dry || '') === '1'
    const out = { oem: [], assets: [] }
    const o = await readKey(req, 'oem')
    if (Array.isArray(o.value)) {
      const next = o.value.map(x => { if (!x.purchased && x.renewal && known.oem[x.name] === x.renewal) { out.oem.push(`${x.name} ${x.renewal}`); return { ...x, renewal: '' } } return x })
      if (!dry && out.oem.length) await app(req).datastore().table('AppConfig').updateRow({ ROWID: o.row.ROWID, config_value: JSON.stringify(next) })
    }
    const a = await readKey(req, 'assets')
    if (Array.isArray(a.value)) {
      const next = a.value.map(x => { if (x.sub_exp && known.assets[x.id] === x.sub_exp) { out.assets.push(`${x.name} ${x.sub_exp}`); return { ...x, sub_exp: '' } } return x })
      if (!dry && out.assets.length) await app(req).datastore().table('AppConfig').updateRow({ ROWID: a.row.ROWID, config_value: JSON.stringify(next) })
    }
    res.json({ ok: true, dry, cleared: out })
  } catch (e) { res.status(500).json({ error: e.message }) }
})

// 📄 Digital glovebox (Mark 2026-10-04: "insurance docs and numbers"): each van's
// documents live in WorkDrive under Command Center → 01_Ops → Vans → <van>. The
// folder id is remembered in AppConfig vandocs_<vanId>.
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024 } })
async function vanFolder(req, vanId, vanName, token) {
  const a = app(req); const key = `vandocs_${vanId}`
  const r = await a.zcql().executeZCQLQuery(`SELECT config_value FROM AppConfig WHERE config_key = '${key}' LIMIT 1`)
  const cached = r?.[0]?.AppConfig?.config_value; if (cached) return String(cached)
  const { walkPath } = await import('../services/oemAttach.js')
  const { createFolderUnder } = await import('../services/workdrive.js')
  let vans = await walkPath('Vans', token)
  if (!vans) { const ops = await walkPath('', token); if (!ops) throw new Error('01_Ops folder not found in WorkDrive'); vans = (await createFolderUnder(ops, 'Vans', token)).folderId }
  let mine = await walkPath(`Vans/${vanName}`, token)
  if (!mine) mine = (await createFolderUnder(vans, vanName, token)).folderId
  await a.datastore().table('AppConfig').insertRow({ config_key: key, config_value: String(mine) }).catch(() => {})
  return String(mine)
}
const KINDS = { insurance_card: 'Insurance card', policy: 'Insurance policy', registration: 'Registration', title: 'Title', inspection: 'Inspection', receipt: 'Receipt', other: 'Document' }
router.get('/vans/:id/docs', async (req, res) => {
  try {
    const { getAccessToken } = await import('../services/zoho.js'); const token = await getAccessToken()
    const { listChildren } = await import('../services/workdrive.js')
    const fid = await vanFolder(req, String(req.params.id), String(req.query.name || `Van ${req.params.id}`), token)
    const files = await listChildren(fid, token, { folders: false, max: 500 })
    res.json({ ok: true, folder: fid, files: files.map(f => ({ id: f.id, name: f.name, size: f.size, created: f.created, kind: Object.keys(KINDS).find(k => String(f.name).startsWith(`${k}__`)) || 'other' })).sort((x, y) => String(y.created).localeCompare(String(x.created))) })
  } catch (e) { res.status(500).json({ error: e.message }) }
})
router.post('/vans/:id/docs', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'no file' })
    const { getAccessToken } = await import('../services/zoho.js'); const token = await getAccessToken()
    const { uploadFileToFolder } = await import('../services/workdrive.js')
    const fid = await vanFolder(req, String(req.params.id), String(req.body?.name || `Van ${req.params.id}`), token)
    const kind = KINDS[req.body?.kind] ? req.body.kind : 'other'
    const clean = String(req.file.originalname || 'file').replace(/[^\w .()\-]+/g, '_').slice(0, 120)
    const name = `${kind}__${new Date().toISOString().slice(0, 10)}__${clean}`
    const up = await uploadFileToFolder(fid, name, req.file.buffer, token, req.file.mimetype || 'application/octet-stream')
    res.json({ ok: true, file: { id: up?.fileId || up?.id || '', name }, by: req.user?.name || '' })
  } catch (e) { res.status(500).json({ error: e.message }) }
})
router.get('/doc/:fileId', async (req, res) => {
  try {
    const { getAccessToken } = await import('../services/zoho.js'); const token = await getAccessToken()
    const { downloadFile } = await import('../services/workdrive.js')
    const f = await downloadFile(String(req.params.fileId), token)
    res.set({ 'Content-Type': f.contentType || 'application/octet-stream', 'Content-Disposition': `inline; filename="${String(req.query.name || 'document').replace(/"/g, '')}"`, 'Cache-Control': 'private, max-age=300' }).send(f.buffer)
  } catch (e) { res.status(500).json({ error: e.message }) }
})

// 🏷 QR labels (Mark 2026-10-04): a printable sheet, one label per tool, the QR opens
// the app on that tool. ?van=<id> for one van's gear. Avery 5160-ish, 30 per page.
router.get('/labels', async (req, res) => {
  try {
    const QRCode = (await import('qrcode')).default
    const [assets, locations] = await Promise.all([readKey(req, 'assets'), readKey(req, 'locations')])
    const van = String(req.query.van || '')
    const list = (assets.value || []).filter(a => !van || a.location === van)
    const vanName = id => (locations.value || []).find(l => l.id === id)?.name || 'Spare'
    const base = `${req.protocol}://${req.get('host')}/app/?scan=`
    const cells = []
    for (const a of list) {
      const png = await QRCode.toDataURL(base + encodeURIComponent(a.id), { width: 160, margin: 0, color: { dark: '#1a1a1a', light: '#ffffff' } })
      cells.push(`<div class="l"><img src="${png}"><div class="t"><b>${String(a.name).replace(/</g, '&lt;')}</b>${a.nickname ? `<div>"${String(a.nickname).replace(/</g, '&lt;')}"</div>` : ''}<div class="m">${[a.sn, vanName(a.location), a.bin].filter(Boolean).map(x => String(x).replace(/</g, '&lt;')).join(' · ')}</div><div class="m">Absolute ADAS</div></div></div>`)
    }
    res.set('Content-Type', 'text/html').send(`<!doctype html><html><head><meta charset="utf-8"><title>Tool labels</title><style>
      @page { size: letter; margin: 0.5in 0.19in } body { font-family: -apple-system, Helvetica, Arial, sans-serif; margin: 0 }
      .g { display: grid; grid-template-columns: repeat(3, 2.625in); grid-auto-rows: 1in; column-gap: 0.125in }
      .l { display: flex; align-items: center; gap: 8px; padding: 6px 8px; box-sizing: border-box; overflow: hidden; border: 1px dashed #ddd }
      .l img { width: 0.8in; height: 0.8in; flex: none } .t { font-size: 10px; line-height: 1.25; min-width: 0 } .t b { font-size: 11px; display: block } .m { color: #555; font-size: 9px }
      @media print { .l { border: 0 } .hint { display: none } }
    </style></head><body><p class="hint" style="padding:8px 12px;font-size:12px;color:#555">${cells.length} labels · Avery 5160 (30 per sheet) · File → Print. Scanning a label opens the tool in the app.</p><div class="g">${cells.join('')}</div></body></html>`)
  } catch (e) { res.status(500).json({ error: e.message }) }
})

export default router
