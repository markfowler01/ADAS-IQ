// 🔥 GET SOME! Meeting room (Mark 2026-10-06: "automate as much of this as possible").
// One Chrome tab to share with audio: today's graphic full-screen, the Spotify
// playlist playing in the corner, a countdown to 8:00, and one Start button that
// pauses the music and brings the numbers forward. Opens from
// /app/?meeting=<room token> with NO login (launchd opens it at 7:50 on Mark's Mac),
// so the data comes from the tokened public route, not the staff API.
import { useEffect, useRef, useState } from 'react'
import { API_BASE } from '../utils/api.js'

const ORANGE = '#CD4419'
const ptNow = () => { const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: 'America/Los_Angeles', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }).formatToParts(new Date()).map(x => [x.type, x.value])); return { h: Number(p.hour) % 24, m: Number(p.minute), s: Number(p.second) } }
const playlistId = url => { const m = String(url || '').match(/playlist\/([A-Za-z0-9]+)/); return m ? m[1] : '' }
// `huddle_playlist` may hold several links (comma / newline / space separated): rotate one per day.
const todaysPlaylist = raw => { const ids = String(raw || '').split(/[\s,]+/).map(playlistId).filter(Boolean); if (!ids.length) return ''; const d = new Date(); const doy = Math.floor((d - new Date(d.getFullYear(), 0, 0)) / 86400000); return ids[doy % ids.length] }

export default function MeetingRoom({ token }) {
  const [room, setRoom] = useState(null)
  const [err, setErr] = useState('')
  const [started, setStarted] = useState(false)
  const [musicOn, setMusicOn] = useState(true)
  const musicOnRef = useRef(true)
  const [playing, setPlaying] = useState(false)       // Spotify actually playing (playback_update)
  const [autoBlocked, setAutoBlocked] = useState(false) // browser refused autoplay → show the music button
  const [flash, setFlash] = useState(false)
  const [fallbackEmbed, setFallbackEmbed] = useState(false)   // Spotify's iframe API blocked (extension) → plain embed
  const [tick, setTick] = useState(0)
  const startedRef = useRef(false)
  useEffect(() => { musicOnRef.current = musicOn }, [musicOn])
  const ctrl = useRef(null)          // Spotify EmbedController
  // 🔀 Shuffle queue (Mark 2026-10-12): every track from every playlist, shuffled, songs from the
  // last few mornings pushed to the back, played one full song at a time through the controller.
  const queue = useRef([]); const qi = useRef(0); const advancing = useRef(false)
  const [tracksReady, setTracksReady] = useState(false)
  const [nowPlaying, setNowPlaying] = useState(null)
  const embedEl = useRef(null)

  const load = async () => {
    try {
      const r = await fetch(`${API_BASE}/api/public/huddle/room/${encodeURIComponent(token)}`)
      const j = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`)
      setRoom(j); setErr('')
    } catch (e) { setErr(e.message) }
  }
  useEffect(() => { load(); const t = setInterval(load, 5 * 60 * 1000); return () => clearInterval(t) }, [token])
  useEffect(() => { const t = setInterval(() => setTick(x => x + 1), 1000); return () => clearInterval(t) }, [])
  useEffect(() => {
    if (!room?.playlist || tracksReady) return
    let done = false; const finish = () => { if (!done) { done = true; setTracksReady(true) } }
    fetch(`${API_BASE}/api/public/huddle/room/${encodeURIComponent(token)}/tracks`).then(r => r.json()).then(j => {
      const list = (j.tracks || []).filter(t => t?.uri)
      for (let i = list.length - 1; i > 0; i--) { const k = Math.floor(Math.random() * (i + 1)); [list[i], list[k]] = [list[k], list[i]] }
      let recent = []; try { recent = JSON.parse(localStorage.getItem('gs_recent_tracks') || '[]') } catch { recent = [] }
      const rs = new Set(recent); queue.current = [...list.filter(t => !rs.has(t.uri)), ...list.filter(t => rs.has(t.uri))]
      finish()
    }).catch(finish)
    const t = setTimeout(finish, 4000); return () => clearTimeout(t)
  }, [room?.playlist])
  const remember = uri => { try { const r = JSON.parse(localStorage.getItem('gs_recent_tracks') || '[]').filter(x => x !== uri); r.push(uri); localStorage.setItem('gs_recent_tracks', JSON.stringify(r.slice(-60))) } catch { /* private mode */ } }
  const playAt = i => {
    const c = ctrl.current, q = queue.current; if (!c || !q.length) return
    qi.current = ((i % q.length) + q.length) % q.length; const t = q[qi.current]
    advancing.current = true; setNowPlaying(t); remember(t.uri)
    try { c.loadUri(t.uri); c.play() } catch { /* fine */ }
    setTimeout(() => { advancing.current = false }, 4000)
  }
  const skip = () => { setMusicOn(true); playAt(qi.current + 1) }

  // Spotify iFrame API → a controller we can pause from the Start button.
  useEffect(() => {
    const id = todaysPlaylist(room?.playlist); if (!id || !tracksReady || !embedEl.current || ctrl.current) return
    const first = queue.current[0]
    window.onSpotifyIframeApiReady = (IFrameAPI) => {
      IFrameAPI.createController(embedEl.current, { uri: first ? first.uri : `spotify:playlist:${id}`, width: '100%', height: 152, theme: 'dark' }, c => {
        ctrl.current = c
        if (first) { qi.current = 0; setNowPlaying(first); remember(first.uri) }
        c.addListener('playback_update', e => {
          const d = e?.data || {}; const paused = !!d.isPaused; setPlaying(!paused); if (!paused) setAutoBlocked(false)
          // song finished → next shuffled song (unless the meeting has started and the music is off)
          if (queue.current.length && !advancing.current && d.duration > 0 && d.position >= d.duration - 1200 && !(startedRef.current && !musicOnRef.current)) playAt(qi.current + 1)
        })
        // Music starts on its own ~10 min ahead (Mark 2026-10-06). Chrome allows sound
        // without a click only once it trusts the site (installed as a Chrome app, or used
        // a few mornings); until then the big button is one click.
        if (!startedRef.current) { try { c.play() } catch {} ; setTimeout(() => setPlaying(p => { if (!p) setAutoBlocked(true); return p }), 2500) }
      })
    }
    if (!document.getElementById('spotify-iframe-api')) { const s = document.createElement('script'); s.id = 'spotify-iframe-api'; s.src = 'https://open.spotify.com/embed/iframe-api/v1'; s.async = true; s.onerror = () => setFallbackEmbed(true); document.body.appendChild(s) }
    else if (window.SpotifyIframeApi) window.onSpotifyIframeApiReady(window.SpotifyIframeApi)
    // No controller after 5 s (script blocked by an extension, or Spotify slow) → plain embed so the music is at least one click away.
    const t = setTimeout(() => { if (!ctrl.current) { setFallbackEmbed(true); setAutoBlocked(true) } }, 5000)
    return () => clearTimeout(t)
  }, [room?.playlist, tracksReady])

  const start = () => { if (startedRef.current) return; startedRef.current = true; setStarted(true); setMusicOn(false); try { ctrl.current?.pause() } catch {} ; setFlash(true); setTimeout(() => setFlash(false), 1800) }
  const playMusic = () => { setMusicOn(true); try { ctrl.current?.play() } catch {} ; setAutoBlocked(false) }
  const toggleMusic = () => { setMusicOn(v => { const next = !v; try { next ? ctrl.current?.resume() : ctrl.current?.pause() } catch {} ; return next }) }
  useEffect(() => { const k = e => { if (e.code === 'Space') { e.preventDefault(); toggleMusic() } if (e.key === 'Enter' && !started) start() }; window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k) }, [started])

  // countdown to the start time (PT)
  const [sh, sm] = String(room?.start || '08:00').split(':').map(Number)
  const n = ptNow(); const secsLeft = (sh * 3600 + sm * 60) - (n.h * 3600 + n.m * 60 + n.s)
  const mm = Math.floor(Math.abs(secsLeft) / 60), ss = Math.abs(secsLeft) % 60
  const countdown = secsLeft > 0 ? `${mm}:${String(ss).padStart(2, '0')}` : 'GO'
  // 8:00 on the dot: the meeting starts itself (music pauses, board full) — no click needed.
  useEffect(() => { if (room && !startedRef.current && secsLeft <= 0 && secsLeft > -1800) start() }, [secsLeft, room])

  return (
    <div style={{ position: 'fixed', inset: 0, backgroundColor: '#0b0d11', color: 'white', fontFamily: 'Inter, system-ui, sans-serif', overflow: 'hidden' }}>
      {/* graphic */}
      {room?.image_url && (
        <img src={`${room.image_url}?t=${room.date}`} alt="GET SOME! Meeting" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'contain', transition: 'transform 600ms ease, filter 600ms ease', transform: started ? 'scale(1)' : 'scale(0.96)', filter: started ? 'none' : 'brightness(0.72)' }} />
      )}
      {err && <div style={{ position: 'absolute', top: 24, left: 24, padding: '10px 14px', background: '#7f1d1d', borderRadius: 10, fontSize: 14 }}>{err}</div>}
      {!room && !err && <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', fontSize: 22, opacity: 0.8 }}>Loading today's board…</div>}

      {/* pre-start overlay: countdown + start */}
      {!started && (
        <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 18, pointerEvents: 'none' }}>
          <div style={{ fontSize: 22, letterSpacing: 6, fontWeight: 800, color: ORANGE }}>GET SOME! MEETING · {room?.start || '8:00'}</div>
          <div style={{ fontSize: 160, fontWeight: 900, letterSpacing: -4, lineHeight: 1, textShadow: '0 10px 40px rgba(0,0,0,0.6)' }}>{countdown}</div>
          {autoBlocked && !playing ? (
            <button onClick={playMusic} style={{ pointerEvents: 'auto', marginTop: 10, padding: '18px 44px', fontSize: 26, fontWeight: 800, letterSpacing: 2, color: 'white', background: '#1DB954', border: 0, borderRadius: 16, cursor: 'pointer', boxShadow: '0 12px 40px rgba(29,185,84,0.4)' }}>🎵 START THE MUSIC</button>
          ) : (
            <button onClick={start} style={{ pointerEvents: 'auto', marginTop: 10, padding: '18px 44px', fontSize: 26, fontWeight: 800, letterSpacing: 2, color: 'white', background: ORANGE, border: 0, borderRadius: 16, cursor: 'pointer', boxShadow: '0 12px 40px rgba(205,68,25,0.45)' }}>▶ START THE MEETING</button>
          )}
          <div style={{ fontSize: 13, opacity: 0.6 }}>{playing ? '🎵 music playing · ' : ''}starts itself at {room?.start || '8:00'} · Enter = start now · Space = music on/off</div>
          {room?.meeting_link && <a href={room.meeting_link} target="_blank" rel="noreferrer" style={{ pointerEvents: 'auto', marginTop: 6, padding: '10px 18px', fontSize: 15, fontWeight: 800, color: 'white', background: 'rgba(255,255,255,0.14)', border: '1px solid rgba(255,255,255,0.3)', borderRadius: 12, textDecoration: 'none' }}>📹 Open the Cliq meeting (you start it there, then share this tab)</a>}
          {room && todaysPlaylist(room.playlist) && !playing && <div style={{ fontSize: 12, opacity: 0.5, maxWidth: 520, textAlign: 'center' }}>Chrome lets the music start on its own once it trusts this page (install it as a Chrome app, or just click once). Log in to Spotify in this Chrome for full songs instead of 30-second previews.</div>}
        </div>
      )}

      {/* start flash */}
      {flash && <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', pointerEvents: 'none', background: 'rgba(205,68,25,0.18)' }}><div style={{ fontSize: 180, fontWeight: 900, letterSpacing: -4, color: 'white', textShadow: '0 20px 60px rgba(0,0,0,0.7)', transform: 'rotate(-4deg)' }}>GET SOME!!!</div></div>}
      {/* music */}
      <div style={{ position: 'absolute', right: 20, bottom: 20, width: 360, transition: 'opacity 500ms, transform 500ms', opacity: started && !musicOn ? 0 : 1, transform: started && !musicOn ? 'translateY(40px)' : 'none', pointerEvents: started && !musicOn ? 'none' : 'auto' }}>
        <div style={{ fontSize: 11, letterSpacing: 3, fontWeight: 800, color: ORANGE, marginBottom: 6 }}>🎵 MUSIC{fallbackEmbed ? ' · press play' : ''}</div>
        <div style={{ borderRadius: 14, overflow: 'hidden', boxShadow: '0 12px 40px rgba(0,0,0,0.5)', minHeight: 152, background: 'rgba(0,0,0,0.5)' }}>
          {fallbackEmbed && playlistId(todaysPlaylist(room?.playlist) ? `playlist/${todaysPlaylist(room?.playlist)}` : '')
            ? <iframe title="Spotify" src={`https://open.spotify.com/embed/playlist/${todaysPlaylist(room?.playlist)}?utm_source=generator&theme=0`} width="100%" height="152" frameBorder="0" allow="autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture" loading="eager" style={{ display: 'block' }} />
            : <div ref={embedEl} />}
        </div>
        {!fallbackEmbed && queue.current.length > 0 && <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginTop: 6, fontSize: 12 }}>
          <span style={{ opacity: 0.75, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>🔀 Shuffle · {queue.current.length} songs{nowPlaying ? ` · ${nowPlaying.title} – ${nowPlaying.artist}` : ''}</span>
          <button onClick={skip} style={{ flexShrink: 0, padding: '4px 10px', fontSize: 12, fontWeight: 800, color: 'white', background: 'rgba(255,255,255,0.14)', border: '1px solid rgba(255,255,255,0.3)', borderRadius: 8, cursor: 'pointer' }}>⏭ Skip</button>
        </div>}
        {fallbackEmbed && <div style={{ fontSize: 12, opacity: 0.7, marginTop: 6 }}>Spotify's player script was blocked (ad blocker?). Press ▶ on the player, and allow open.spotify.com in the blocker so it can start by itself.</div>}
        {!todaysPlaylist(room?.playlist) && room && <div style={{ fontSize: 12, opacity: 0.6, marginTop: 6 }}>No playlist set — add a Spotify playlist link in settings.</div>}
      </div>
      {/* small controls after start */}
      {started && (
        <div style={{ position: 'absolute', left: 20, bottom: 20, display: 'flex', gap: 8 }}>
          <button onClick={toggleMusic} style={{ padding: '8px 14px', fontSize: 13, fontWeight: 700, color: 'white', background: 'rgba(255,255,255,0.12)', border: '1px solid rgba(255,255,255,0.2)', borderRadius: 10, cursor: 'pointer' }}>{musicOn ? '⏸ Music' : '🎵 Music'}</button>
          <button onClick={load} style={{ padding: '8px 14px', fontSize: 13, fontWeight: 700, color: 'white', background: 'rgba(255,255,255,0.12)', border: '1px solid rgba(255,255,255,0.2)', borderRadius: 10, cursor: 'pointer' }}>↻ Refresh numbers</button>
          {room?.meeting_link && <a href={room.meeting_link} target="_blank" rel="noreferrer" style={{ padding: '8px 14px', fontSize: 13, fontWeight: 700, color: 'white', background: ORANGE, borderRadius: 10, textDecoration: 'none' }}>📹 Meeting link</a>}
        </div>
      )}
    </div>
  )
}
