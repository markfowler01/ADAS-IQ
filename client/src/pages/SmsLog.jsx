// SMS Log — Phase 1 rebuild (2026-07-07).
//
// Two-pane layout: left rail is a list of conversation threads, right
// pane is the selected conversation with a compose box at the bottom.
// Reads/writes /api/sms endpoints. Auto-refreshes threads every 30s so
// inbound messages appear without a manual reload.
//
// From-number selector at the top: Local (425) vs Toll-Free (844).
// Choice is persisted in localStorage. Every outbound send uses the
// selected number.

import { useEffect, useState, useCallback, useRef } from 'react'
import { API_BASE, apiFetch } from '../utils/api.js'
import Navbar from '../components/Navbar.jsx'

const ORANGE = '#CD4419'

function fmt$(n)   { return `$${Math.round(n || 0).toLocaleString('en-US')}` }
function fmtTime(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  const now = new Date()
  const sameDay = d.toDateString() === now.toDateString()
  if (sameDay) return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) + ' ' + d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
}
function fmtPhone(input) {
  const d = String(input || '').replace(/\D/g, '')
  if (d.length === 10) return `(${d.slice(0,3)}) ${d.slice(3,6)}-${d.slice(6)}`
  if (d.length === 11 && d[0] === '1') return `(${d.slice(1,4)}) ${d.slice(4,7)}-${d.slice(7)}`
  return input || ''
}

// Unified phone page: three tabs — Messages, Calls, Voicemails. Was
// originally SMS-only; call log + voicemail views tacked on 2026-07-08
// after the Twilio voice status callback started populating /api/calls
// and /api/voicemails. All three share the same top header (from-number
// toggle + New button).
export default function SmsLog({ user, onLogout, currentScreen, onNavigate }) {
  // 'messages' | 'calls' | 'voicemails' — persisted per-browser.
  const [tab, setTab] = useState(() => {
    try { return localStorage.getItem('aa_phone_tab') || 'messages' } catch { return 'messages' }
  })
  useEffect(() => {
    try { localStorage.setItem('aa_phone_tab', tab) } catch {}
  }, [tab])

  const [showSetup, setShowSetup] = useState(false)
  const [showDial,  setShowDial]  = useState(false)

  const [threads,       setThreads]       = useState([])
  const [calls,         setCalls]         = useState([])
  const [voicemails,    setVoicemails]    = useState([])
  const [loading,       setLoading]       = useState(true)
  const [err,           setErr]           = useState('')
  const [selectedPhone, setSelectedPhone] = useState(null)
  const [conversation,  setConversation]  = useState([])
  const [convoLoading,  setConvoLoading]  = useState(false)
  const [draft,         setDraft]         = useState('')
  const [sending,       setSending]       = useState(false)
  const [toast,         setToast]         = useState('')

  // New-conversation composer (when no threads exist or user wants a
  // fresh recipient).
  const [showNew,   setShowNew]   = useState(false)
  const [newTo,     setNewTo]     = useState('')
  const [newBody,   setNewBody]   = useState('')

  // From-number selector: 'local' (425) or 'tollfree' (844).
  const [fromLine, setFromLine] = useState(() => {
    try { return localStorage.getItem('aa_sms_from_line') || 'local' } catch { return 'local' }
  })
  useEffect(() => {
    try { localStorage.setItem('aa_sms_from_line', fromLine) } catch {}
  }, [fromLine])

  const refreshTimerRef = useRef(null)

  const loadCalls = useCallback(async () => {
    try {
      const r = await apiFetch(`${API_BASE}/api/calls`)
      const j = await r.json()
      if (r.ok) setCalls(j.calls || [])
    } catch { /* silent — non-critical */ }
  }, [])

  const loadVoicemails = useCallback(async () => {
    try {
      const r = await apiFetch(`${API_BASE}/api/voicemails`)
      const j = await r.json()
      if (r.ok) setVoicemails(j.voicemails || [])
    } catch { /* silent */ }
  }, [])

  const [lastStatus, setLastStatus] = useState('')
  const loadThreads = useCallback(async () => {
    try {
      // Cache-bust every fetch so a stale service-worker/browser cache
      // can't shadow a fresh reply.
      const r = await apiFetch(`${API_BASE}/api/sms/threads?_=${Date.now()}`, {
        cache: 'no-store',
      })
      const raw = await r.text()
      let j = null
      try { j = JSON.parse(raw) } catch { j = null }
      setLastStatus(`HTTP ${r.status} · ${r.ok ? (j?.threads?.length ?? 0) : (raw || '').slice(0, 80)}`)
      if (!r.ok) throw new Error(j?.error || `HTTP ${r.status}: ${raw.slice(0, 80)}`)
      setThreads(j?.threads || [])
      setErr('')
    } catch (e) {
      setErr(e.message)
      setLastStatus(`err: ${e.message}`)
    } finally {
      setLoading(false)
    }
  }, [])

  const [convoContact, setConvoContact] = useState({ contact_name: '', shop_name: '', shop_id: '' })
  const loadConversation = useCallback(async (phone, { silent = false } = {}) => {
    if (!phone) return
    if (!silent) setConvoLoading(true)
    try {
      const r = await apiFetch(`${API_BASE}/api/sms/threads/${encodeURIComponent(phone)}?_=${Date.now()}`, { cache: 'no-store' })
      const j = await r.json()
      if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`)
      setConversation(j.messages || [])
      setConvoContact({
        contact_name: j.contact_name || '',
        shop_name:    j.shop_name    || '',
        shop_id:      j.shop_id      || '',
      })
    } catch (e) {
      if (!silent) showToast(`Load failed: ${e.message}`)
    } finally {
      if (!silent) setConvoLoading(false)
    }
  }, [])

  useEffect(() => {
    loadThreads()
    loadCalls()
    loadVoicemails()
  }, [loadThreads, loadCalls, loadVoicemails])
  useEffect(() => {
    // Auto-refresh all four feeds every 10s. Includes the currently-open
    // conversation so new inbound messages appear without having to
    // re-tap the thread.
    const refresh = () => {
      loadThreads()
      loadCalls()
      loadVoicemails()
      if (selectedPhone) loadConversation(selectedPhone, { silent: true })
    }
    refreshTimerRef.current = setInterval(refresh, 10_000)
    return () => clearInterval(refreshTimerRef.current)
  }, [loadThreads, loadCalls, loadVoicemails, loadConversation, selectedPhone])
  useEffect(() => {
    if (selectedPhone) loadConversation(selectedPhone)
  }, [selectedPhone, loadConversation])

  function showToast(m) {
    setToast(m)
    setTimeout(() => setToast(''), 3500)
  }

  async function sendReply() {
    const body = draft.trim()
    if (!body || !selectedPhone) return
    setSending(true)
    try {
      const r = await apiFetch(`${API_BASE}/api/sms/send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ to: selectedPhone, body, from: fromLine }),
      })
      const j = await r.json()
      if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`)
      setDraft('')
      // Optimistic append + reload for authoritative state.
      setConversation(prev => [...prev, j.message])
      loadThreads()
      // Twilio accepted, but if we couldn't persist to cache the
      // conversation view will lose the message on next refresh.
      // Surface it so the user knows the send worked but the log won't
      // show it — instead of silently disappearing.
      if (j.persisted === false) {
        showToast(`⚠ Sent (Twilio SID ${j.sid}) but log-save failed: ${j.persist_error || 'unknown'}`)
      }
    } catch (e) {
      showToast(`Send failed: ${e.message}`)
    } finally {
      setSending(false)
    }
  }

  async function sendNew() {
    const to = newTo.trim()
    const body = newBody.trim()
    if (!to || !body) return
    setSending(true)
    try {
      const r = await apiFetch(`${API_BASE}/api/sms/send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ to, body, from: fromLine }),
      })
      const j = await r.json()
      if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`)
      setNewTo('')
      setNewBody('')
      setShowNew(false)
      await loadThreads()
      if (j.message?.to_number) setSelectedPhone(j.message.to_number)
      if (j.persisted === false) {
        showToast(`⚠ Sent (Twilio SID ${j.sid}) but log-save failed: ${j.persist_error || 'unknown'}`)
      }
    } catch (e) {
      showToast(`Send failed: ${e.message}`)
    } finally {
      setSending(false)
    }
  }

  return (
    <div className="min-h-screen flex flex-col" style={{ backgroundColor: '#f5f3f0' }}>
      <Navbar user={user} onLogout={onLogout} currentScreen={currentScreen} onNavigate={onNavigate} />

      {/* Header */}
      <div className="sticky top-0 z-10 px-4 py-3"
        style={{ backgroundColor: '#f5f3f0', borderBottom: '1px solid #e8e4e0' }}>
        <div className="max-w-6xl mx-auto flex items-center justify-between gap-2 flex-wrap">
          <div>
            <div className="text-xs uppercase tracking-wider"
              style={{ color: '#888', fontFamily: 'IBM Plex Mono, monospace' }}>
              SMS Log
            </div>
            <div className="text-base font-bold" style={{ color: '#1a1a1a' }}>
              Text messages
            </div>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            {/* From-number selector */}
            <div className="rounded-lg overflow-hidden text-xs font-semibold flex" style={{ border: `1px solid ${ORANGE}` }}>
              <button
                onClick={() => setFromLine('local')}
                className="px-3 py-1.5"
                style={{ backgroundColor: fromLine === 'local' ? ORANGE : 'white', color: fromLine === 'local' ? 'white' : ORANGE }}
              >Local (425)</button>
              <button
                onClick={() => setFromLine('tollfree')}
                className="px-3 py-1.5"
                style={{ backgroundColor: fromLine === 'tollfree' ? ORANGE : 'white', color: fromLine === 'tollfree' ? 'white' : ORANGE }}
              >844-FIX-ADAS</button>
            </div>
            <button
              onClick={() => { setLoading(true); loadThreads(); loadCalls(); loadVoicemails() }}
              className="text-xs font-semibold rounded-lg px-3 py-1.5"
              style={{ color: '#666', border: '1px solid #e0dbd6', backgroundColor: 'white' }}
              title={`Last fetch: ${lastStatus || '—'}`}
            >🔄 {lastStatus.startsWith('HTTP') ? lastStatus.split('·')[1]?.trim() || '?' : '?'}</button>
            <button
              onClick={() => setShowNew(true)}
              className="text-xs font-bold rounded-lg px-3 py-1.5 text-white"
              style={{ backgroundColor: ORANGE }}
            >✏️ New</button>
            <button
              onClick={() => setShowDial(true)}
              className="text-xs font-bold rounded-lg px-3 py-1.5 text-white"
              style={{ backgroundColor: '#0e7490' }}
              title="Click-to-call — Twilio rings your cell then bridges you"
            >📞 Dial</button>
            <button
              onClick={() => setShowSetup(true)}
              className="text-xs font-semibold rounded-lg px-3 py-1.5"
              style={{ color: '#666', border: '1px solid #e0dbd6', backgroundColor: 'white' }}
              title="Twilio credentials & ring-cascade numbers"
            >⚙ Setup</button>
          </div>
        </div>
      </div>

      {/* Tab bar */}
      <div className="max-w-6xl w-full mx-auto px-4 pt-2 flex gap-1 text-sm font-semibold">
        {[
          { id: 'messages',   label: `💬 Messages${threads.length      ? ' · ' + threads.length      : ''}` },
          { id: 'calls',      label: `📞 Calls${calls.length           ? ' · ' + calls.length         : ''}` },
          { id: 'voicemails', label: `🎧 Voicemails${voicemails.length ? ' · ' + voicemails.length   : ''}` },
        ].map(t => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className="px-3 py-2 rounded-t-lg"
            style={{
              backgroundColor: tab === t.id ? 'white' : 'transparent',
              color: tab === t.id ? '#1a1a1a' : '#666',
              borderBottom: tab === t.id ? `2px solid ${ORANGE}` : '2px solid transparent',
            }}
          >{t.label}</button>
        ))}
      </div>

      {/* Body */}
      <main className={
        tab === 'messages'
          ? 'flex-1 max-w-6xl w-full mx-auto p-4 grid grid-cols-1 md:grid-cols-3 gap-3'
          : 'flex-1 max-w-6xl w-full mx-auto p-4'
      } style={{ minHeight: 0 }}>

      {tab === 'calls' && (
        <div className="rounded-2xl bg-white p-2" style={{ border: '1px solid #ebebeb' }}>
          {calls.length === 0 ? (
            <div className="text-sm p-4" style={{ color: '#888' }}>No calls logged yet.</div>
          ) : (
            <ul className="divide-y" style={{ borderColor: '#f0ece8' }}>
              {calls.map(c => {
                const isInbound = c.direction !== 'outbound'
                const other = isInbound ? c.from_number : c.to_number
                const line  = c.line_type === 'tollfree' ? '844' : (c.line_type === 'local' ? '425' : '')
                const status = c.status || ''
                const missed = ['no-answer', 'busy', 'failed', 'canceled', 'ringing'].includes(status) && !c.duration_seconds
                return (
                  <li key={c.call_sid} className="px-3 py-3 flex items-center justify-between gap-2">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span style={{ fontSize: 14 }}>
                          {isInbound ? (missed ? '↙️' : '📥') : '📤'}
                        </span>
                        <div className="font-semibold text-sm" style={{ color: '#1a1a1a' }}>
                          {fmtPhone(other) || 'Unknown'}
                        </div>
                        {line && <span className="text-[10px] px-1.5 py-0.5 rounded" style={{ backgroundColor: '#f5f3f0', color: '#666' }}>{line}</span>}
                        {missed && <span className="text-[10px] font-bold" style={{ color: '#b45309' }}>Missed</span>}
                      </div>
                      <div className="text-xs mt-0.5" style={{ color: '#888' }}>
                        {fmtTime(c.timestamp)}
                        {c.duration_seconds ? ` · ${c.duration_seconds}s` : ''}
                        {status && ` · ${status}`}
                      </div>
                    </div>
                    <div className="flex gap-1.5 flex-shrink-0 flex-wrap justify-end">
                      {c.recording_url && (
                        <a href={c.recording_url.includes('?') ? c.recording_url : `${c.recording_url}.mp3`}
                          target="_blank" rel="noopener noreferrer"
                          className="text-xs font-semibold px-2.5 py-1 rounded-lg"
                          style={{ color: '#7e22ce', border: '1px solid #7e22ce' }}
                          title={`Play recording (${c.recording_duration_sec || '?'}s)`}
                        >▶ Play</a>
                      )}
                      <a href={`tel:${other}`}
                        className="text-xs font-semibold px-2.5 py-1 rounded-lg"
                        style={{ color: ORANGE, border: `1px solid ${ORANGE}` }}
                      >📞 Call</a>
                      <button onClick={() => { setTab('messages'); setSelectedPhone(other); loadConversation(other) }}
                        className="text-xs font-semibold px-2.5 py-1 rounded-lg"
                        style={{ color: '#0e7490', border: '1px solid #0e7490' }}
                      >💬 Text</button>
                    </div>
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      )}

      {tab === 'voicemails' && (
        <div className="rounded-2xl bg-white p-2" style={{ border: '1px solid #ebebeb' }}>
          {voicemails.length === 0 ? (
            <div className="text-sm p-4" style={{ color: '#888' }}>No voicemails.</div>
          ) : (
            <ul className="divide-y" style={{ borderColor: '#f0ece8' }}>
              {voicemails.map(v => {
                const line = v.line_type === 'tollfree' ? '844' : (v.line_type === 'local' ? '425' : '')
                return (
                  <li key={v.call_sid} className="px-3 py-3">
                    <div className="flex items-center justify-between gap-2 flex-wrap">
                      <div className="flex items-center gap-2">
                        <span style={{ fontSize: 14 }}>🎧</span>
                        <div className="font-semibold text-sm" style={{ color: '#1a1a1a' }}>
                          {fmtPhone(v.from_number) || 'Unknown'}
                        </div>
                        {line && <span className="text-[10px] px-1.5 py-0.5 rounded" style={{ backgroundColor: '#f5f3f0', color: '#666' }}>{line}</span>}
                      </div>
                      <div className="text-xs" style={{ color: '#888' }}>
                        {fmtTime(v.timestamp)}
                        {v.recording_duration_sec ? ` · ${v.recording_duration_sec}s` : ''}
                      </div>
                    </div>
                    {v.transcription ? (
                      <div className="text-sm mt-2 rounded-lg p-2" style={{ color: '#1a1a1a', backgroundColor: '#fafaf9' }}>
                        "{v.transcription}"
                      </div>
                    ) : (
                      <div className="text-xs mt-2" style={{ color: '#888' }}>
                        {v.transcription_status === 'pending' || !v.transcription_status
                          ? '⏳ Transcription pending…'
                          : `⚠ Transcription ${v.transcription_status}`}
                      </div>
                    )}
                    <div className="flex gap-2 mt-2">
                      {v.recording_url && (
                        <a href={v.recording_url.includes('?') ? v.recording_url : `${v.recording_url}.mp3`}
                          target="_blank" rel="noopener noreferrer"
                          className="text-xs font-semibold px-2.5 py-1 rounded-lg"
                          style={{ color: ORANGE, border: `1px solid ${ORANGE}` }}
                        >▶ Play</a>
                      )}
                      <a href={`tel:${v.from_number}`}
                        className="text-xs font-semibold px-2.5 py-1 rounded-lg"
                        style={{ color: ORANGE, border: `1px solid ${ORANGE}` }}
                      >📞 Call back</a>
                      <button onClick={() => { setTab('messages'); setSelectedPhone(v.from_number); loadConversation(v.from_number) }}
                        className="text-xs font-semibold px-2.5 py-1 rounded-lg"
                        style={{ color: '#0e7490', border: '1px solid #0e7490' }}
                      >💬 Text</button>
                    </div>
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      )}

      {tab === 'messages' && (<>


        {/* Threads list */}
        <div className="rounded-2xl bg-white p-2 md:col-span-1 flex flex-col" style={{ border: '1px solid #ebebeb', maxHeight: '75vh' }}>
          {loading ? (
            <div className="text-sm p-4" style={{ color: '#888' }}>Loading…</div>
          ) : err ? (
            <div className="text-sm p-4" style={{ color: '#991b1b' }}>{err}</div>
          ) : threads.length === 0 ? (
            <div className="text-sm p-4" style={{ color: '#888' }}>No conversations yet. Tap ✏️ New to start.</div>
          ) : (
            <div className="overflow-y-auto">
              {threads.map(t => (
                <button
                  key={t.phone}
                  onClick={() => setSelectedPhone(t.phone)}
                  className="w-full text-left rounded-xl p-3 mb-1"
                  style={{
                    backgroundColor: selectedPhone === t.phone ? '#fff5f0' : 'transparent',
                    borderLeft: selectedPhone === t.phone ? `3px solid ${ORANGE}` : '3px solid transparent',
                  }}
                >
                  <div className="flex items-baseline justify-between gap-2">
                    <div className="font-semibold text-sm truncate" style={{ color: '#1a1a1a' }}>
                      {t.contact_name || t.phone_pretty || fmtPhone(t.phone)}
                    </div>
                    <div className="text-[10px] flex-shrink-0" style={{ color: '#888' }}>
                      {fmtTime(t.last_timestamp)}
                    </div>
                  </div>
                  {(t.contact_name || t.shop_name) && (
                    <div className="text-[11px] truncate" style={{ color: '#888' }}>
                      {t.shop_name || t.phone_pretty || fmtPhone(t.phone)}
                      {t.contact_name && t.shop_name ? ` · ${t.phone_pretty || fmtPhone(t.phone)}` : ''}
                    </div>
                  )}
                  <div className="text-xs truncate mt-0.5" style={{ color: '#666' }}>
                    {t.last_direction === 'outbound' ? '↗ ' : '↘ '}{t.last_body || '(media)'}
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Conversation pane */}
        <div className="rounded-2xl bg-white md:col-span-2 flex flex-col" style={{ border: '1px solid #ebebeb', maxHeight: '75vh' }}>
          {!selectedPhone ? (
            <div className="flex-1 flex items-center justify-center text-sm p-4" style={{ color: '#888' }}>
              Select a conversation on the left, or start a new one.
            </div>
          ) : (
            <>
              <div className="px-4 py-3 flex items-center justify-between" style={{ borderBottom: '1px solid #f0ece8' }}>
                <div>
                  <div className="font-semibold text-sm" style={{ color: '#1a1a1a' }}>
                    {convoContact.contact_name || fmtPhone(selectedPhone)}
                  </div>
                  {convoContact.shop_name && (
                    <div className="text-xs font-medium" style={{ color: ORANGE }}>
                      {convoContact.shop_name}
                    </div>
                  )}
                  <div className="text-[10px]" style={{ color: '#888' }}>
                    {convoContact.contact_name ? `${fmtPhone(selectedPhone)} · ` : ''}{selectedPhone}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {convoContact.shop_id && onNavigate && (
                    <button
                      onClick={() => onNavigate('crm')}
                      className="text-xs font-semibold px-2.5 py-1 rounded-lg"
                      style={{ color: '#0e7490', border: '1px solid #0e7490' }}
                      title={`Open CRM (shop: ${convoContact.shop_name})`}
                    >📇 CRM</button>
                  )}
                  <a href={`tel:${selectedPhone}`}
                    className="text-xs font-semibold px-2.5 py-1 rounded-lg"
                    style={{ color: ORANGE, border: `1px solid ${ORANGE}` }}
                  >📞 Call</a>
                </div>
              </div>

              {convoLoading ? (
                <div className="flex-1 p-4 text-sm" style={{ color: '#888' }}>Loading conversation…</div>
              ) : (
                <div className="flex-1 overflow-y-auto p-3 space-y-2" style={{ minHeight: 0 }}>
                  {conversation.map(m => {
                    const isOut = m.direction === 'outbound'
                    return (
                      <div key={m.message_sid || m.timestamp} className={`flex ${isOut ? 'justify-end' : 'justify-start'}`}>
                        <div className="max-w-[75%] rounded-2xl px-3 py-2"
                          style={{
                            backgroundColor: isOut ? ORANGE : '#f0ece8',
                            color: isOut ? 'white' : '#1a1a1a',
                          }}>
                          {m.body && (
                            <div className="text-sm whitespace-pre-wrap break-words">{m.body}</div>
                          )}
                          {/* MMS media — proxied via /api/sms/media/:sid/:idx.
                              Fetches with the user's session token, streams
                              back the raw bytes from Twilio. Images render
                              inline; anything else shows a download link. */}
                          {Array.isArray(m.media) && m.media.length > 0 && (
                            <div className={m.body ? 'mt-2 space-y-1' : 'space-y-1'}>
                              {m.media.map((media, i) => {
                                const src = `${API_BASE}${media.proxy_url}`
                                const isImg = String(media.contentType || '').startsWith('image/')
                                return isImg ? (
                                  <a key={i} href={src} target="_blank" rel="noopener noreferrer"
                                    className="block rounded-lg overflow-hidden"
                                    style={{ backgroundColor: 'rgba(0,0,0,0.05)' }}>
                                    <img src={src} alt="MMS attachment"
                                      style={{ display: 'block', maxWidth: '100%', maxHeight: 200, objectFit: 'cover' }} />
                                  </a>
                                ) : (
                                  <a key={i} href={src} target="_blank" rel="noopener noreferrer"
                                    className="block text-xs underline"
                                    style={{ color: isOut ? 'white' : '#1a1a1a' }}>
                                    📎 {media.contentType || 'Attachment'} #{i + 1}
                                  </a>
                                )
                              })}
                            </div>
                          )}
                          {!m.body && (!m.media || m.media.length === 0) && (
                            <div className="text-sm italic" style={{ opacity: 0.7 }}>(no content)</div>
                          )}
                          <div className="text-[9px] mt-1" style={{ opacity: 0.75 }}>
                            {fmtTime(m.timestamp)}
                            {isOut && m.line_type ? ` · ${m.line_type === 'tollfree' ? '844' : '425'}` : ''}
                            {isOut && m.sender ? ` · ${m.sender}` : ''}
                          </div>
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}

              {/* Reply composer */}
              <div className="p-3 flex items-end gap-2" style={{ borderTop: '1px solid #f0ece8' }}>
                <textarea
                  value={draft}
                  onChange={e => setDraft(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendReply() }
                  }}
                  placeholder={`Reply from ${fromLine === 'tollfree' ? '844-FIX-ADAS' : 'Local (425)'}…`}
                  rows={1}
                  className="flex-1 px-3 py-2 rounded-lg text-sm resize-none"
                  style={{ border: '1px solid #e5e7eb', backgroundColor: '#fafaf9' }}
                />
                <button
                  onClick={sendReply}
                  disabled={sending || !draft.trim()}
                  className="text-sm font-bold rounded-lg px-4 py-2 text-white"
                  style={{ backgroundColor: sending || !draft.trim() ? '#e5e7eb' : ORANGE }}
                >{sending ? '…' : 'Send'}</button>
              </div>
            </>
          )}
        </div>
      </>)}
      </main>

      {/* New-message modal */}
      {showNew && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4"
          style={{ backgroundColor: 'rgba(0,0,0,0.5)' }}
          onClick={e => e.target === e.currentTarget && setShowNew(false)}>
          <div className="bg-white rounded-t-2xl sm:rounded-2xl shadow-2xl w-full max-w-md">
            <div className="flex items-center justify-between px-5 py-4 border-b" style={{ borderColor: '#f0ece8' }}>
              <h2 className="text-base font-bold" style={{ color: '#1a1a1a' }}>✏️ New Message</h2>
              <button onClick={() => setShowNew(false)} className="text-2xl leading-none" style={{ color: '#888' }}>×</button>
            </div>
            <div className="p-5 space-y-3">
              <div>
                <label className="text-[11px] uppercase tracking-wider font-semibold" style={{ color: '#666' }}>To (phone)</label>
                <input value={newTo} onChange={e => setNewTo(e.target.value)}
                  placeholder="(425) 555-1234"
                  type="tel" inputMode="tel"
                  className="w-full mt-1 px-3 py-2.5 rounded-lg text-sm"
                  style={{ border: '1px solid #e5e7eb', backgroundColor: '#fafaf9' }} />
              </div>
              <div>
                <label className="text-[11px] uppercase tracking-wider font-semibold" style={{ color: '#666' }}>
                  Message (sending from {fromLine === 'tollfree' ? '844-FIX-ADAS' : 'Local 425'})
                </label>
                <textarea value={newBody} onChange={e => setNewBody(e.target.value)}
                  rows={4} placeholder="Type your message…"
                  className="w-full mt-1 px-3 py-2.5 rounded-lg text-sm"
                  style={{ border: '1px solid #e5e7eb', backgroundColor: '#fafaf9' }} />
              </div>
            </div>
            <div className="flex items-center justify-end gap-2 p-4 border-t" style={{ borderColor: '#f0ece8' }}>
              <button onClick={() => setShowNew(false)}
                className="text-sm font-semibold rounded-lg px-4 py-2"
                style={{ color: '#666', backgroundColor: '#f5f3f0' }}>Cancel</button>
              <button onClick={sendNew}
                disabled={sending || !newTo.trim() || !newBody.trim()}
                className="text-sm font-bold rounded-lg px-4 py-2 text-white"
                style={{ backgroundColor: sending || !newTo.trim() || !newBody.trim() ? '#e5e7eb' : ORANGE }}
              >{sending ? 'Sending…' : 'Send'}</button>
            </div>
          </div>
        </div>
      )}

      {showSetup && (
        <PhoneSetupModal onClose={() => setShowSetup(false)} showToast={showToast} />
      )}

      {showDial && (
        <DialModal
          fromLine={fromLine}
          setFromLine={setFromLine}
          onClose={() => setShowDial(false)}
          showToast={showToast}
          onDialed={() => { loadCalls(); setShowDial(false); setTab('calls') }}
        />
      )}

      {toast && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[80] px-4 py-2.5 rounded-2xl shadow-xl text-sm font-medium text-white"
          style={{ backgroundColor: '#1a1a1a', whiteSpace: 'nowrap' }}>{toast}</div>
      )}
    </div>
  )
}

// ── Dial Modal — click-to-call ───────────────────────────────────────────────
// Mark types a number, picks a From line, taps Call. Twilio rings his cell
// first; when he answers, it bridges to the target. The outside party sees
// whichever line was picked as caller ID.
function DialModal({ fromLine, setFromLine, onClose, showToast, onDialed }) {
  const [to,      setTo]      = useState('')
  const [dialing, setDialing] = useState(false)
  const [error,   setError]   = useState(null)

  async function dial() {
    const target = to.trim()
    if (!target) return
    setDialing(true)
    setError(null)
    try {
      const r = await apiFetch(`${API_BASE}/api/calls/dial`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ to: target, from_line: fromLine }),
      })
      const j = await r.json()
      if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`)
      showToast(`📞 Ringing your cell — pick up to connect to ${target}`)
      onDialed && onDialed()
    } catch (e) {
      setError(e.message)
    } finally {
      setDialing(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4"
      style={{ backgroundColor: 'rgba(0,0,0,0.5)' }}
      onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="bg-white rounded-t-2xl sm:rounded-2xl shadow-2xl w-full max-w-md">
        <div className="flex items-center justify-between px-5 py-4 border-b" style={{ borderColor: '#f0ece8' }}>
          <div>
            <h2 className="text-base font-bold" style={{ color: '#1a1a1a' }}>📞 Click-to-Call</h2>
            <p className="text-xs text-gray-400 mt-0.5">Twilio rings your cell first, then bridges to the target.</p>
          </div>
          <button onClick={onClose} className="text-2xl leading-none" style={{ color: '#888' }}>×</button>
        </div>

        <div className="p-5 space-y-3">
          <div>
            <label className="text-[11px] uppercase tracking-wider font-semibold" style={{ color: '#666' }}>Number to call</label>
            <input
              autoFocus
              value={to}
              onChange={e => setTo(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && to.trim()) dial() }}
              placeholder="(425) 555-1234"
              type="tel"
              inputMode="tel"
              className="w-full mt-1 px-3 py-2.5 rounded-lg text-lg font-mono"
              style={{ border: '1px solid #e5e7eb', backgroundColor: '#fafaf9' }}
            />
          </div>

          <div>
            <label className="text-[11px] uppercase tracking-wider font-semibold" style={{ color: '#666' }}>Caller ID</label>
            <div className="rounded-lg overflow-hidden text-sm font-semibold flex mt-1" style={{ border: `1px solid ${ORANGE}` }}>
              <button
                onClick={() => setFromLine('local')}
                className="flex-1 py-2"
                style={{ backgroundColor: fromLine === 'local' ? ORANGE : 'white', color: fromLine === 'local' ? 'white' : ORANGE }}
              >Local (425)</button>
              <button
                onClick={() => setFromLine('tollfree')}
                className="flex-1 py-2"
                style={{ backgroundColor: fromLine === 'tollfree' ? ORANGE : 'white', color: fromLine === 'tollfree' ? 'white' : ORANGE }}
              >844-FIX-ADAS</button>
            </div>
          </div>

          {error && (
            <div className="text-xs rounded-lg p-2" style={{ backgroundColor: '#fef2f2', color: '#991b1b' }}>
              {error}
            </div>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 p-4 border-t" style={{ borderColor: '#f0ece8' }}>
          <button onClick={onClose}
            className="text-sm font-semibold rounded-lg px-4 py-2"
            style={{ color: '#666', backgroundColor: '#f5f3f0' }}>Cancel</button>
          <button
            onClick={dial}
            disabled={dialing || !to.trim()}
            className="text-sm font-bold rounded-lg px-4 py-2 text-white"
            style={{ backgroundColor: dialing || !to.trim() ? '#e5e7eb' : '#0e7490' }}
          >
            {dialing ? 'Connecting…' : '📞 Call'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Phone Setup Modal ────────────────────────────────────────────────────────
// Displays every phone-config key with its current status (env / cache /
// unset). Editing a field and clicking Save writes to Catalyst Cache via
// POST /api/phone-config so Mark doesn't need to touch env vars.
function PhoneSetupModal({ onClose, showToast }) {
  const [entries, setEntries] = useState([])
  const [drafts,  setDrafts]  = useState({})
  const [loading, setLoading] = useState(true)
  const [saving,  setSaving]  = useState({})

  const load = useCallback(async () => {
    try {
      const r = await apiFetch(`${API_BASE}/api/phone-config`)
      const j = await r.json()
      if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`)
      setEntries(j.entries || [])
    } catch (e) {
      showToast(`Load failed: ${e.message}`)
    } finally { setLoading(false) }
  }, [showToast])

  useEffect(() => { load() }, [load])

  async function save(key) {
    const value = drafts[key] ?? ''
    setSaving(s => ({ ...s, [key]: true }))
    try {
      const r = await apiFetch(`${API_BASE}/api/phone-config`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key, value }),
      })
      const respText = await r.text()
      let j
      try { j = JSON.parse(respText) } catch { j = { error: `Non-JSON: ${respText.slice(0, 300)}` } }
      if (!r.ok) {
        const debugInfo = [
          `HTTP: ${r.status}`,
          `Error: ${j.error || 'unknown'}`,
          j.debug ? `Debug: ${JSON.stringify(j.debug, null, 2).slice(0, 400)}` : null,
          `Sent key: "${key}"`,
          `Sent value length: ${value.length}`,
        ].filter(Boolean).join('\n\n')
        // Alert stays on screen until dismissed so we can actually read it
        alert(`Save failed:\n\n${debugInfo}`)
        return
      }
      setDrafts(d => { const n = { ...d }; delete n[key]; return n })
      await load()
      showToast(`✅ ${key} saved`)
    } catch (e) {
      console.error('[phone-config save]', e)
      alert(`Save failed: ${e.message}\n\nStack: ${e.stack || '(no stack)'}`)
    } finally {
      setSaving(s => ({ ...s, [key]: false }))
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4"
      style={{ backgroundColor: 'rgba(0,0,0,0.5)' }}
      onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="bg-white rounded-t-2xl sm:rounded-2xl shadow-2xl w-full max-w-lg flex flex-col" style={{ maxHeight: '92vh' }}>
        <div className="flex items-center justify-between px-5 py-4 border-b flex-shrink-0" style={{ borderColor: '#f0ece8' }}>
          <div>
            <h2 className="text-base font-bold" style={{ color: '#1a1a1a' }}>⚙ Phone Setup</h2>
            <p className="text-xs text-gray-400 mt-0.5">Twilio credentials + ring-cascade numbers. Stored in Catalyst Cache.</p>
          </div>
          <button onClick={onClose} className="text-2xl leading-none" style={{ color: '#888' }}>×</button>
        </div>

        <div className="p-5 space-y-3 overflow-y-auto">
          {loading ? (
            <div className="text-sm" style={{ color: '#888' }}>Loading…</div>
          ) : entries.map(e => {
            const draft = drafts[e.key]
            const hasDraft = draft !== undefined
            return (
              <div key={e.key} className="rounded-xl p-3" style={{ backgroundColor: '#fafaf9', border: '1px solid #ebebeb' }}>
                <div className="flex items-baseline justify-between gap-2 mb-1 flex-wrap">
                  <label className="font-semibold text-sm" style={{ color: '#1a1a1a' }}>
                    {e.label}{e.required && <span style={{ color: '#dc2626' }}> *</span>}
                  </label>
                  <span className="text-[10px] font-semibold uppercase tracking-wider"
                    style={{ color: e.source === 'unset' ? '#b45309' : e.source === 'env' ? '#0e7490' : '#15803d' }}>
                    {e.source === 'env' ? '● ENV LOCKED' : e.source === 'cache' ? '● SAVED' : '○ UNSET'}
                  </span>
                </div>
                {e.help && <div className="text-[11px] mb-1.5" style={{ color: '#888' }}>{e.help}</div>}
                <div className="flex items-center gap-1.5">
                  <input
                    type={e.secret ? 'password' : 'text'}
                    value={hasDraft ? draft : (e.value || '')}
                    onChange={ev => setDrafts(d => ({ ...d, [e.key]: ev.target.value }))}
                    placeholder={e.source === 'unset' ? '(not set)' : ''}
                    disabled={e.source === 'env'}
                    className="flex-1 px-3 py-2 rounded-lg text-sm font-mono"
                    style={{
                      border: '1px solid #e5e7eb',
                      backgroundColor: e.source === 'env' ? '#f5f3f0' : 'white',
                      color: e.source === 'env' ? '#888' : '#1a1a1a',
                    }}
                  />
                  {e.source !== 'env' && (
                    <button
                      onClick={() => save(e.key)}
                      disabled={!hasDraft || saving[e.key]}
                      className="text-xs font-bold rounded-lg px-3 py-2 text-white"
                      style={{ backgroundColor: !hasDraft || saving[e.key] ? '#e5e7eb' : ORANGE }}
                    >{saving[e.key] ? '…' : 'Save'}</button>
                  )}
                </div>
              </div>
            )
          })}
        </div>
        <div className="p-4 border-t flex justify-end flex-shrink-0" style={{ borderColor: '#f0ece8' }}>
          <button onClick={onClose}
            className="text-sm font-semibold rounded-lg px-4 py-2"
            style={{ color: '#666', backgroundColor: '#f5f3f0' }}>Done</button>
        </div>
      </div>
    </div>
  )
}
