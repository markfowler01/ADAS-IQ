import { useState } from 'react'
import { API_BASE, apiFetch } from '../utils/api.js'

const ORANGE = '#CD4419'
const BORDER = '#e0dbd6'
const DARK   = '#1a1a1a'
const MUTED  = '#888'

const TYPES = [
  { id: 'bug',         label: '🐛 Bug',              desc: 'Something is broken or not working right' },
  { id: 'improvement', label: '💡 Improvement',       desc: 'Make an existing feature better' },
  { id: 'feature',     label: '⭐ Feature Request',   desc: 'Something new you want added' },
]

export default function FeedbackModal({ user, onClose }) {
  const [type,        setType]        = useState('bug')
  const [title,       setTitle]       = useState('')
  const [description, setDescription] = useState('')
  const [submitting,  setSubmitting]  = useState(false)
  const [done,        setDone]        = useState(false)
  const [error,       setError]       = useState(null)

  async function handleSubmit() {
    if (!title.trim()) { setError('Please add a title.'); return }
    setSubmitting(true)
    setError(null)
    try {
      const res = await apiFetch(`${API_BASE}/api/feedback`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type,
          title:       title.trim(),
          description: description.trim(),
          reportedBy:  user?.name || 'Unknown',
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Submission failed.')
      setDone(true)
    } catch (e) {
      setError(e.message)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ backgroundColor: 'rgba(0,0,0,0.45)' }}
      onMouseDown={e => { if (e.target === e.currentTarget) onClose() }}
    >
      <div
        className="bg-white rounded-2xl shadow-2xl w-full max-w-lg flex flex-col overflow-hidden"
        style={{ border: '1px solid #ebebeb' }}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4" style={{ borderBottom: '1px solid #ebebeb' }}>
          <h2 className="text-base font-bold" style={{ color: DARK }}>
            {done ? 'Thanks! 🎉' : 'Report / Feedback'}
          </h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl leading-none">×</button>
        </div>

        {done ? (
          /* Success state */
          <div className="flex flex-col items-center justify-center px-6 py-10 text-center">
            <div className="w-14 h-14 rounded-full flex items-center justify-center mb-4"
              style={{ backgroundColor: '#edfaf3' }}>
              <span className="text-2xl">✓</span>
            </div>
            <p className="text-sm font-semibold mb-1" style={{ color: DARK }}>Submitted to Zoho Projects</p>
            <p className="text-sm mb-6" style={{ color: MUTED }}>The team will review it shortly.</p>
            <button
              onClick={onClose}
              className="px-6 py-2 rounded-lg text-sm font-semibold text-white"
              style={{ backgroundColor: ORANGE }}
            >Done</button>
          </div>
        ) : (
          /* Form */
          <div className="px-6 py-5 flex flex-col gap-4">

            {/* Type selector */}
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide mb-2" style={{ color: MUTED }}>Type</p>
              <div className="flex flex-col gap-2">
                {TYPES.map(t => (
                  <label
                    key={t.id}
                    className="flex items-start gap-3 px-3 py-2.5 rounded-lg cursor-pointer transition-all"
                    style={{
                      border: `1.5px solid ${type === t.id ? ORANGE : BORDER}`,
                      backgroundColor: type === t.id ? '#fdf3ef' : 'white',
                    }}
                  >
                    <input
                      type="radio"
                      name="feedback-type"
                      value={t.id}
                      checked={type === t.id}
                      onChange={() => setType(t.id)}
                      className="mt-0.5"
                      style={{ accentColor: ORANGE }}
                    />
                    <div>
                      <p className="text-sm font-semibold" style={{ color: DARK }}>{t.label}</p>
                      <p className="text-xs" style={{ color: MUTED }}>{t.desc}</p>
                    </div>
                  </label>
                ))}
              </div>
            </div>

            {/* Title */}
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide mb-1" style={{ color: MUTED }}>Title</p>
              <input
                type="text"
                value={title}
                onChange={e => setTitle(e.target.value)}
                placeholder="Short summary of the issue or idea…"
                className="w-full px-3 py-2 rounded-lg text-sm outline-none"
                style={{ border: `1px solid ${BORDER}`, color: DARK }}
                onFocus={e => (e.target.style.borderColor = ORANGE)}
                onBlur={e  => (e.target.style.borderColor = BORDER)}
              />
            </div>

            {/* Description */}
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide mb-1" style={{ color: MUTED }}>
                Details <span style={{ color: '#ccc', fontWeight: 400 }}>(optional)</span>
              </p>
              <textarea
                value={description}
                onChange={e => setDescription(e.target.value)}
                placeholder="Steps to reproduce, what you expected, or more context…"
                rows={4}
                className="w-full px-3 py-2 rounded-lg text-sm outline-none resize-y"
                style={{ border: `1px solid ${BORDER}`, color: DARK, minHeight: '80px' }}
                onFocus={e => (e.target.style.borderColor = ORANGE)}
                onBlur={e  => (e.target.style.borderColor = BORDER)}
              />
            </div>

            {/* Reporter */}
            {user?.name && (
              <p className="text-xs" style={{ color: '#aaa' }}>
                Submitting as <strong style={{ color: MUTED }}>{user.name}</strong>
              </p>
            )}

            {/* Error */}
            {error && (
              <div className="px-3 py-2 rounded-lg text-sm"
                style={{ backgroundColor: '#fff0ed', border: `1px solid ${ORANGE}`, color: ORANGE }}>
                {error}
              </div>
            )}

            {/* Actions */}
            <div className="flex items-center gap-2 pt-1">
              <button
                onClick={onClose}
                className="px-4 py-2 rounded-lg text-sm font-medium"
                style={{ backgroundColor: '#f5f3f0', color: MUTED }}
              >Cancel</button>
              <button
                onClick={handleSubmit}
                disabled={submitting}
                className="flex-1 py-2 rounded-lg text-sm font-bold text-white transition-opacity"
                style={{ backgroundColor: ORANGE, opacity: submitting ? 0.7 : 1 }}
              >
                {submitting ? 'Submitting…' : 'Submit to Zoho Projects'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
