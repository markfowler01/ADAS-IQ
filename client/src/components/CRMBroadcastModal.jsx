import { useState } from 'react'
import { API_BASE, apiFetch } from '../utils/api.js'
import { STAGES, TEMPLATES } from './crmConstants.js'

const ORANGE = '#CD4419'

export default function CRMBroadcastModal({ shops, onClose }) {
  const [stage,   setStage]   = useState('')   // '' = all
  const [subject, setSubject] = useState('')
  const [body,    setBody]    = useState('')
  const [tmplId,  setTmplId]  = useState('')
  const [sending, setSending] = useState(false)
  const [result,  setResult]  = useState(null)
  const [error,   setError]   = useState(null)

  // Recipients = shops in selected stage with at least one email
  const recipients = shops.filter(s => {
    if (stage && s.pipeline_stage !== stage) return false
    return !!(s.people?.[0]?.email || s.email)
  })

  // Shops without email in selection (for info only)
  const noEmail = shops.filter(s => {
    if (stage && s.pipeline_stage !== stage) return false
    return !(s.people?.[0]?.email || s.email)
  }).length

  const emailTemplates = TEMPLATES.filter(t => t.channel === 'email')

  function applyTemplate(t) {
    setTmplId(t.id)
    setSubject(t.subject || t.label)
    setBody(t.text)
  }

  async function handleSend() {
    if (!subject.trim()) { setError('Subject is required'); return }
    if (!body.trim())    { setError('Message is required'); return }
    if (recipients.length === 0) { setError('No shops with email addresses in this selection'); return }
    setSending(true); setError(null)
    try {
      const res = await apiFetch(`${API_BASE}/api/shops/broadcast`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ stage: stage || null, subject, body }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Broadcast failed')
      setResult(data)
    } catch (e) {
      setError(e.message)
    } finally {
      setSending(false)
    }
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center"
      style={{ backgroundColor: 'rgba(0,0,0,0.5)' }}
      onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="w-full sm:max-w-lg bg-white overflow-hidden shadow-2xl"
        style={{ maxHeight: '92vh', display: 'flex', flexDirection: 'column', borderRadius: '20px 20px 0 0' }}>

        {/* Handle */}
        <div className="flex justify-center pt-3 pb-1 sm:hidden">
          <div className="w-10 h-1 rounded-full" style={{ backgroundColor: '#ddd' }} />
        </div>

        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4" style={{ borderBottom: '1px solid #ebebeb' }}>
          <div>
            <h2 className="text-base font-bold" style={{ color: '#1a1a1a' }}>Broadcast Email</h2>
            <p className="text-xs mt-0.5" style={{ color: '#888' }}>Send to everyone in your pipeline</p>
          </div>
          <button onClick={onClose} className="w-8 h-8 rounded-full flex items-center justify-center"
            style={{ backgroundColor: '#f5f3f0', color: '#888' }}>✕</button>
        </div>

        {result ? (
          /* ── Done ── */
          <div className="flex-1 flex flex-col items-center justify-center py-14 gap-4 px-6">
            <div className="w-16 h-16 rounded-full flex items-center justify-center text-3xl"
              style={{ backgroundColor: '#f0fdf4' }}>✅</div>
            <p className="text-xl font-bold text-center" style={{ color: '#1a1a1a' }}>
              Sent to {result.sent} shops!
            </p>
            {result.skipped > 0 && (
              <p className="text-sm text-center" style={{ color: '#888' }}>
                {result.skipped} skipped — no email on file
              </p>
            )}
            <button onClick={onClose}
              className="mt-2 text-sm font-semibold px-7 py-3 rounded-xl text-white"
              style={{ backgroundColor: ORANGE }}>
              Done
            </button>
          </div>
        ) : (
          <>
            <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5">

              {/* ── Audience ── */}
              <div>
                <label className="block text-xs font-semibold text-gray-500 mb-2 uppercase tracking-wide">
                  Send To
                </label>
                <div className="flex flex-wrap gap-2">
                  <button onClick={() => setStage('')}
                    className="text-xs font-semibold px-3 py-1.5 rounded-full border transition-all"
                    style={!stage
                      ? { backgroundColor: ORANGE, color: 'white', borderColor: ORANGE }
                      : { backgroundColor: 'transparent', color: '#888', borderColor: '#ddd' }}>
                    Everyone
                  </button>
                  {STAGES.map(s => {
                    const cnt = shops.filter(sh =>
                      sh.pipeline_stage === s.id && (sh.people?.[0]?.email || sh.email)
                    ).length
                    if (cnt === 0) return null
                    return (
                      <button key={s.id} onClick={() => setStage(s.id)}
                        className="text-xs font-semibold px-3 py-1.5 rounded-full border transition-all"
                        style={stage === s.id
                          ? { backgroundColor: s.bg, color: s.color, borderColor: s.color }
                          : { backgroundColor: 'transparent', color: '#888', borderColor: '#ddd' }}>
                        {s.emoji} {s.label} ({cnt})
                      </button>
                    )
                  })}
                </div>

                {/* Recipient count */}
                <div className="mt-2 flex items-center gap-2">
                  <span className="text-xs font-semibold px-2.5 py-1 rounded-full"
                    style={recipients.length > 0
                      ? { backgroundColor: '#dcfce7', color: '#15803d' }
                      : { backgroundColor: '#fee2e2', color: '#dc2626' }}>
                    {recipients.length > 0 ? `✓ ${recipients.length} recipients` : '⚠️ 0 recipients'}
                  </span>
                  {noEmail > 0 && (
                    <span className="text-xs" style={{ color: '#aaa' }}>
                      ({noEmail} skipped — no email)
                    </span>
                  )}
                </div>
              </div>

              {/* ── Templates ── */}
              <div>
                <label className="block text-xs font-semibold text-gray-500 mb-2 uppercase tracking-wide">
                  Start from template
                  <span className="normal-case font-normal ml-1" style={{ color: '#bbb' }}>optional</span>
                </label>
                <div className="space-y-1.5">
                  {emailTemplates.map(t => (
                    <button key={t.id} onClick={() => applyTemplate(t)}
                      className="w-full text-left px-3 py-2 rounded-xl text-sm transition-colors"
                      style={tmplId === t.id
                        ? { backgroundColor: '#fff4f0', border: `1px solid ${ORANGE}`, color: ORANGE }
                        : { backgroundColor: '#f9f8f7', border: '1px solid #ebebeb', color: '#555' }}>
                      <span className="mr-1.5">{t.icon}</span>
                      <span className="font-medium">{t.label}</span>
                      <span className="text-xs ml-2" style={{ color: '#aaa' }}>{t.scenario}</span>
                    </button>
                  ))}
                </div>
              </div>

              {/* ── Subject ── */}
              <div>
                <label className="block text-xs font-semibold text-gray-500 mb-1 uppercase tracking-wide">Subject</label>
                <input className="w-full border rounded-xl px-3 py-2.5 text-sm focus:outline-none"
                  style={{ borderColor: '#e0dbd6' }}
                  value={subject} onChange={e => { setSubject(e.target.value); setTmplId('') }}
                  placeholder="Checking In — Absolute ADAS" />
              </div>

              {/* ── Body ── */}
              <div>
                <label className="block text-xs font-semibold text-gray-500 mb-1 uppercase tracking-wide">
                  Message
                  <span className="normal-case font-normal ml-1.5" style={{ color: '#bbb' }}>
                    — {'{shop_name}'} &amp; {'{contact_first}'} are personalized per shop
                  </span>
                </label>
                <textarea className="w-full border rounded-xl px-3 py-2.5 text-sm focus:outline-none resize-none font-sans leading-relaxed"
                  style={{ borderColor: '#e0dbd6' }}
                  rows={9}
                  value={body}
                  onChange={e => { setBody(e.target.value); setTmplId('') }}
                  placeholder={`Hi {contact_first},\n\nJust wanted to reach out and say hello…\n\nMark Fowler\nAbsolute ADAS`} />
              </div>

              {error && (
                <div className="px-3 py-2.5 rounded-xl text-sm"
                  style={{ backgroundColor: '#fff0ed', border: '1px solid #e8c5b0', color: ORANGE }}>
                  {error}
                </div>
              )}
            </div>

            {/* ── Footer ── */}
            <div className="flex items-center justify-between px-5 py-4" style={{ borderTop: '1px solid #ebebeb' }}>
              <button onClick={onClose}
                className="text-sm px-4 py-2 rounded-xl font-medium"
                style={{ color: '#888', backgroundColor: '#f5f3f0' }}>
                Cancel
              </button>
              <button onClick={handleSend} disabled={sending || recipients.length === 0}
                className="flex items-center gap-2 text-sm px-5 py-2.5 rounded-xl font-semibold text-white transition-opacity"
                style={{ backgroundColor: ORANGE, opacity: sending || recipients.length === 0 ? 0.5 : 1 }}>
                {sending ? (
                  <>
                    <svg className="animate-spin" width="14" height="14" viewBox="0 0 24 24" fill="none">
                      <circle cx="12" cy="12" r="10" stroke="rgba(255,255,255,0.3)" strokeWidth="3"/>
                      <path d="M12 2a10 10 0 0 1 10 10" stroke="white" strokeWidth="3" strokeLinecap="round"/>
                    </svg>
                    Sending…
                  </>
                ) : (
                  <>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/>
                    </svg>
                    Send to {recipients.length} shops
                  </>
                )}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
