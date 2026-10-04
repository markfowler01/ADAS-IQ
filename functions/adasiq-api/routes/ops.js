// 🏭 Ops Hub state — vans, equipment, laptops, OEM subscriptions — kept on the
// server so every staff login sees the same page (2026-10-03: until now it lived
// in each person's browser, and the OEM dates were placeholders). One AppConfig
// row per section: ops_locations, ops_assets, ops_laptops, ops_oem.
import express from 'express'
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

export default router
