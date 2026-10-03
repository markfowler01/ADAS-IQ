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

export default router
