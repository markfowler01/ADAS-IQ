// Shop Talk — private weekly two-tech cut from ADAS Brew.
// Stays in the app until Mark says an episode is good enough to publish.

import { useEffect, useRef, useState } from 'react'
import Navbar from '../components/Navbar'
import { API_BASE, apiFetch } from '../utils/api.js'

const ORANGE = '#CD4419'

export default function ShopTalkScreen({ user, onLogout, currentScreen, onNavigate }) {
  const [script, setScript] = useState(null)
  const [loading, setLoading] = useState(true)
  const [cutting, setCutting] = useState(false)
  const [error, setError] = useState(null)
  const [idx, setIdx] = useState(-1)
  const [playing, setPlaying] = useState(false)
  const [combinedUrl, setCombinedUrl] = useState('')
  const [status, setStatus] = useState('')
  const stopRef = useRef(false)
  const audioRef = useRef(null)

  useEffect(() => {
    let dead = false
    ;(async () => {
      try {
        const r = await apiFetch(`${API_BASE}/api/shop-talk/latest`)
        const j = await r.json()
        if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`)
        if (!dead) setScript(j.script || null)
      } catch (e) { if (!dead) setError(e.message) }
      finally { if (!dead) setLoading(false) }
    })()
    return () => { dead = true }
  }, [])

  useEffect(() => () => {
    stopRef.current = true
    try { audioRef.current?.pause() } catch {}
    if (combinedUrl) URL.revokeObjectURL(combinedUrl)
  }, [combinedUrl])

  async function readJson(r) {
    const text = await r.text()
    let j = {}
    try { j = JSON.parse(text) } catch { j = {} }
    if (!r.ok) {
      const timedOut = r.status === 408 || r.status === 504 || r.status === 502 || r.status === 524 || !text || /<!doctype|<html/i.test(text)
      throw new Error(j.error || (timedOut ? 'Timed out. Hit Cut this week again.' : `HTTP ${r.status}`))
    }
    return j
  }

  async function cutWeek() {
    setCutting(true); setError(null)
    try {
      setStatus('Pulling last week’s Brew…')
      const src = await readJson(await apiFetch(`${API_BASE}/api/shop-talk/sources`, { method: 'POST' }))
      setStatus(`Writing Carl and Cole from ${src.issues?.length || 0} issues…`)
      const j = await readJson(await apiFetch(`${API_BASE}/api/shop-talk/script`, { method: 'POST' }))
      setScript(j.script)
      setCombinedUrl('')
      setIdx(-1)
      setStatus('')
    } catch (e) { setError(e.message) }
    finally { setCutting(false); setStatus('') }
  }

  function stopPlay() {
    stopRef.current = true
    try { audioRef.current?.pause() } catch {}
    setPlaying(false)
  }

  function playBlob(blob) {
    return new Promise(resolve => {
      const url = URL.createObjectURL(blob)
      const a = new Audio(url)
      audioRef.current = a
      const done = () => { URL.revokeObjectURL(url); resolve() }
      a.onended = done
      a.onerror = done
      a.play().catch(done)
    })
  }

  async function playEpisode() {
    if (!script?.turns?.length) return
    stopRef.current = false
    setPlaying(true)
    setError(null)
    const blobs = []
    try {
      for (let i = 0; i < script.turns.length; i++) {
        if (stopRef.current) break
        setIdx(i)
        setStatus(`Speaking ${i + 1} of ${script.turns.length}…`)
        const turn = script.turns[i]
        const who = turn.who === 'cole' ? 'cole' : 'carl'
        let r = await apiFetch(`${API_BASE}/api/shop-talk/line`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ who, text: turn.text }),
        })
        if (!r.ok) {
          r = await apiFetch(`${API_BASE}/api/shop-talk/line`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ who, text: turn.text }),
          })
        }
        if (!r.ok) {
          const j = await r.json().catch(() => ({}))
          throw new Error(j.error || `Line ${i + 1} failed`)
        }
        const blob = await r.blob()
        blobs.push(blob)
        if (stopRef.current) break
        await playBlob(blob)
      }
      if (blobs.length && !stopRef.current) {
        if (combinedUrl) URL.revokeObjectURL(combinedUrl)
        setCombinedUrl(URL.createObjectURL(new Blob(blobs, { type: 'audio/mpeg' })))
      }
    } catch (e) { setError(e.message) }
    finally {
      setPlaying(false)
      setStatus('')
      if (stopRef.current) setIdx(-1)
    }
  }

  const turns = script?.turns || []

  return (
    <div className="min-h-screen" style={{ backgroundColor: '#f5f3f0' }}>
      <Navbar user={user} onLogout={onLogout} currentScreen={currentScreen} onNavigate={onNavigate} />
      <div className="max-w-3xl mx-auto px-4 sm:px-6 py-8">
        <div className="mb-6">
          <div className="text-xs font-bold tracking-widest uppercase mb-1" style={{ color: ORANGE }}>Private · not published</div>
          <h1 className="text-2xl font-extrabold" style={{ color: '#1a1a1a' }}>Shop Talk</h1>
          <p className="text-sm mt-1" style={{ color: '#6b7280' }}>
            Two techs in the bay. Cut from last week’s ADAS Brew. Carl is the salty one. Nothing leaves this page until you say it is good.
          </p>
        </div>

        <div className="flex flex-wrap gap-2 mb-6">
          <button type="button" disabled={cutting || playing} onClick={cutWeek}
            className="px-4 py-2 rounded-lg text-sm font-semibold text-white disabled:opacity-60"
            style={{ backgroundColor: ORANGE }}>
            {cutting ? 'Cutting the week…' : 'Cut this week'}
          </button>
          {!!turns.length && (
            <button type="button" onClick={playing ? stopPlay : playEpisode}
              className="px-4 py-2 rounded-lg text-sm font-semibold"
              style={{ backgroundColor: playing ? '#1a1a1a' : '#fff', color: playing ? '#fff' : '#1a1a1a', border: '1px solid #e0dbd6' }}>
              {playing ? 'Stop' : 'Play episode'}
            </button>
          )}
          {combinedUrl && (
            <a href={combinedUrl} download={`${(script?.title || 'shop-talk').replace(/\s+/g, '-').toLowerCase()}.mp3`}
              className="px-4 py-2 rounded-lg text-sm font-semibold"
              style={{ backgroundColor: '#fff', color: '#1a1a1a', border: '1px solid #e0dbd6' }}>
              Download MP3
            </a>
          )}
        </div>

        {(status || error) && (
          <div className="text-sm mb-4" style={{ color: error ? '#dc2626' : '#6b7280' }}>
            {error || status}
          </div>
        )}

        {loading && <div className="text-sm" style={{ color: '#9ca3af' }}>Checking for a cut…</div>}

        {!loading && !script && !cutting && (
          <div className="rounded-xl border p-6 text-sm" style={{ borderColor: '#ece8e4', backgroundColor: '#fff', color: '#6b7280' }}>
            No episode yet. Hit <strong style={{ color: '#1a1a1a' }}>Cut this week</strong>. It pulls the last five Brew issues and writes Carl and Cole arguing about them.
          </div>
        )}

        {script && (
          <div className="rounded-xl border overflow-hidden" style={{ borderColor: '#ece8e4', backgroundColor: '#fff' }}>
            <div className="px-5 py-4" style={{ backgroundColor: '#1a1a1a' }}>
              <div className="text-xs font-bold tracking-widest uppercase" style={{ color: ORANGE }}>{script.week_label || 'This week'}</div>
              <div className="text-lg font-bold text-white mt-1">{script.title}</div>
              {script.tagline && <div className="text-sm mt-1" style={{ color: '#d1d5db' }}>{script.tagline}</div>}
              {!!script.sources?.length && (
                <div className="text-xs mt-2" style={{ color: '#9ca3af' }}>
                  From Brew {script.sources.map(s => `#${s.number}`).join(' · ')}
                </div>
              )}
            </div>
            {playing && turns.length > 0 && (
              <div className="h-1" style={{ backgroundColor: '#ece8e4' }}>
                <div className="h-full" style={{ width: `${((idx + 1) / turns.length) * 100}%`, backgroundColor: ORANGE }} />
              </div>
            )}
            <div className="divide-y" style={{ borderColor: '#f3f0ec' }}>
              {turns.map((t, i) => (
                <div key={i} className="px-5 py-3"
                  style={{ backgroundColor: i === idx ? '#fff7f5' : 'transparent' }}>
                  <div className="text-xs font-bold tracking-wide uppercase mb-1"
                    style={{ color: t.who === 'cole' ? '#2563eb' : ORANGE }}>
                    {t.who === 'cole' ? 'Cole' : 'Carl'}
                  </div>
                  <div className="text-sm leading-relaxed" style={{ color: '#1a1a1a' }}>{t.text}</div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
