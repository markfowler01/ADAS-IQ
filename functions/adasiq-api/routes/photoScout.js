// 📸 /api/photo-scout — review screen for the Photo Scout agent (services/photoScout.js). Staff only.
//   GET  /?state=pick|approved|used|rejected|skip   rows, best first
//   GET  /thumb/:fileId                              640px JPEG of a job photo (for the grid)
//   POST /run { days?, max? }                        scout now (returns summary; may run past the 30s gateway)
//   POST /:id/state { state }                        approve / reject / mark used
import express from 'express'
import * as S from '../services/photoScout.js'

const router = express.Router()
router.use(express.json())
const fail = (res, e) => res.status(e.status || 500).json({ error: e.message })

router.get('/', async (req, res) => { try { res.json({ ok: true, rows: await S.listScout(req, { state: String(req.query.state || '') }) }) } catch (e) { fail(res, e) } })
router.get('/thumb/:fileId', async (req, res) => {
  try {
    const { getAccessToken } = await import('../services/zoho.js'); const { downloadFile } = await import('../services/workdrive.js'); const sharp = (await import('sharp')).default
    const { buffer } = await downloadFile(String(req.params.fileId), await getAccessToken())
    const out = await sharp(buffer).rotate().resize({ width: 640, height: 640, fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 72 }).toBuffer()
    res.set('Content-Type', 'image/jpeg'); res.set('Cache-Control', 'private, max-age=86400'); res.send(out)
  } catch (e) { fail(res, e) }
})
router.post('/run', async (req, res) => {
  try { res.json({ ok: true, ...(await S.scout(req, { days: Math.min(Number(req.body?.days) || 3, 3650), max: Math.min(Number(req.body?.max) || 24, 60) })) }) } catch (e) { fail(res, e) }
})
router.post('/:id/state', async (req, res) => { try { res.json(await S.setState(req, req.params.id, String(req.body?.state || ''))) } catch (e) { fail(res, e) } })

export default router
