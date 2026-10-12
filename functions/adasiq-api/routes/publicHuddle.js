// 🌐 /api/public/huddle/:token.png — the GET SOME! Meeting graphic behind an
// unguessable token (sales numbers never sit at a guessable public URL). The
// PNG lives in WorkDrive (Command Center → 01_Ops → GET SOME Meeting); the token
// → file id map is AppConfig `huddle_img:<token>`.
import express from 'express'
import catalyst from 'zcatalyst-sdk-node'
const router = express.Router()
router.get('/:token.png', async (req, res) => {
  try {
    const token = String(req.params.token || '').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 40)
    if (!token) return res.status(404).end()
    const r = await catalyst.initialize(req, { type: 'advancedio' }).zcql().executeZCQLQuery(`SELECT config_value FROM AppConfig WHERE config_key = 'huddle_img:${token}' LIMIT 1`)
    const fileId = r?.[0]?.AppConfig?.config_value
    if (!fileId) return res.status(404).end()
    const { getAccessToken } = await import('../services/zoho.js'); const { downloadFile } = await import('../services/workdrive.js')
    const { buffer } = await downloadFile(fileId, await getAccessToken())
    res.set('Content-Type', 'image/png').set('Cache-Control', 'public, max-age=86400').send(buffer)
  } catch (e) { res.status(500).json({ error: e.message }) }
})
// Meeting room data behind the room token (set once: AppConfig huddle_room_token).
router.get('/room/:token', async (req, res) => {
  try {
    const M = await import('../services/morningHuddle.js')
    if (!(await M.roomTokenOk(req, String(req.params.token || '')))) return res.status(404).json({ error: 'not found' })
    const [img, cfg] = await Promise.all([M.ensureTodayImage(req), M.roomConfig(req)])
    res.json({ ok: true, ...cfg, image_url: img.url, date: img.date })
  } catch (e) { res.status(500).json({ error: e.message }) }
})
// 🔀 Shuffle (Mark 2026-10-12: "I want it on shuffle so you don't hear the same song every day").
// The Spotify embed has no shuffle control, so the room plays its own queue: every track from
// every playlist in huddle_playlist, read from Spotify's public embed page (trackList), cached 12 h.
const _tracks = { at: 0, key: '', list: [] }
router.get('/room/:token/tracks', async (req, res) => {
  try {
    const M = await import('../services/morningHuddle.js')
    if (!(await M.roomTokenOk(req, String(req.params.token || '')))) return res.status(404).json({ error: 'not found' })
    const cfg = await M.roomConfig(req)
    const ids = [...new Set((String(cfg.playlist || '').match(/playlist\/([A-Za-z0-9]{22})/g) || []).map(x => x.split('/')[1]))]
    const key = ids.join(',')
    if (_tracks.key === key && Date.now() - _tracks.at < 12 * 3600e3 && _tracks.list.length) return res.json({ ok: true, cached: true, tracks: _tracks.list })
    const axios = (await import('axios')).default
    const seen = new Set(), list = []
    for (const id of ids) {
      try {
        const html = String((await axios.get(`https://open.spotify.com/embed/playlist/${id}`, { headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh) AppleWebKit/537.36 Chrome/128 Safari/537.36' }, timeout: 15000 })).data || '')
        const m = html.match(/<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/)
        let tl = []
        if (m) { try { const j = JSON.parse(m[1]); const walk = o => { if (!o || typeof o !== 'object') return; if (Array.isArray(o.trackList)) tl = tl.concat(o.trackList); for (const v of Object.values(o)) if (v && typeof v === 'object') walk(v) }; walk(j) } catch { /* fall through */ } }
        if (!tl.length) tl = [...html.matchAll(/"uri":"(spotify:track:[A-Za-z0-9]{22})","uid":"[^"]*","title":"((?:[^"\\]|\\.)*)","subtitle":"((?:[^"\\]|\\.)*)"/g)].map(x => ({ uri: x[1], title: x[2], subtitle: x[3] }))
        for (const t of tl) if (t?.uri && /^spotify:track:/.test(t.uri) && !seen.has(t.uri)) { seen.add(t.uri); list.push({ uri: t.uri, title: t.title || '', artist: t.subtitle || '', ms: Number(t.duration) || 0 }) }
      } catch (e) { console.warn('[huddle tracks]', id, e.message) }
    }
    Object.assign(_tracks, { at: Date.now(), key, list })
    res.json({ ok: true, playlists: ids.length, tracks: list })
  } catch (e) { res.status(500).json({ error: e.message }) }
})
export default router
