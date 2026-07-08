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

export default function SmsLog({ user, onLogout, currentScreen, onNavigate }) {
  const [threads,       setThreads]       = useState([])
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

  const loadThreads = useCallback(async () => {
    try {
      const r = await apiFetch(`${API_BASE}/api/sms/threads`)
      const j = await r.json()
      if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`)
      setThreads(j.threads || [])
      setErr('')
    } catch (e) {
      setErr(e.message)
    } finally {
      setLoading(false)
    }
  }, [])

  const loadConversation = useCallback(async (phone) => {
    if (!phone) return
    setConvoLoading(true)
    try {
      const r = await apiFetch(`${API_BASE}/api/sms/threads/${encodeURIComponent(phone)}`)
      const j = await r.json()
      if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`)
      setConversation(j.messages || [])
    } catch (e) {
      showToast(`Load failed: ${e.message}`)
    } finally {
      setConvoLoading(false)
    }
  }, [])

  useEffect(() => { loadThreads() }, [loadThreads])
  useEffect(() => {
    // Auto-refresh threads every 30s to pick up inbound messages.
    refreshTimerRef.current = setInterval(loadThreads, 30_000)
    return () => clearInterval(refreshTimerRef.current)
  }, [loadThreads])
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
              onClick={() => setShowNew(true)}
              className="text-xs font-bold rounded-lg px-3 py-1.5 text-white"
              style={{ backgroundColor: ORANGE }}
            >✏️ New</button>
          </div>
        </div>
      </div>

      {/* Body */}
      <main className="flex-1 max-w-6xl w-full mx-auto p-4 grid grid-cols-1 md:grid-cols-3 gap-3" style={{ minHeight: 0 }}>

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
                      {t.phone_pretty || fmtPhone(t.phone)}
                    </div>
                    <div className="text-[10px] flex-shrink-0" style={{ color: '#888' }}>
                      {fmtTime(t.last_timestamp)}
                    </div>
                  </div>
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
                    {fmtPhone(selectedPhone)}
                  </div>
                  <div className="text-[10px]" style={{ color: '#888' }}>{selectedPhone}</div>
                </div>
                <a href={`tel:${selectedPhone}`}
                  className="text-xs font-semibold px-2.5 py-1 rounded-lg"
                  style={{ color: ORANGE, border: `1px solid ${ORANGE}` }}
                >📞 Call</a>
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
                          <div className="text-sm whitespace-pre-wrap break-words">{m.body || '(media)'}</div>
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

      {toast && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[80] px-4 py-2.5 rounded-2xl shadow-xl text-sm font-medium text-white"
          style={{ backgroundColor: '#1a1a1a', whiteSpace: 'nowrap' }}>{toast}</div>
      )}
    </div>
  )
}
