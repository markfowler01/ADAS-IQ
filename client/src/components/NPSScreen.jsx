import { useState, useEffect } from 'react'
import { API_BASE } from '../utils/portal'

const ORANGE = '#CD4419'

export default function NPSScreen() {
  const [shopName, setShopName] = useState('our customer')
  const [score, setScore] = useState(null)
  const [comment, setComment] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [done, setDone] = useState(false)
  const [error, setError] = useState('')

  const params = typeof window !== 'undefined' ? new URLSearchParams(window.location.search) : null
  const token = params?.get('t') || ''
  const preselectedScore = params?.get('score')

  useEffect(() => {
    if (!token) { setError('Missing token'); return }
    fetch(`${API_BASE}/api/cx/nps/survey?t=${encodeURIComponent(token)}`)
      .then(r => r.json())
      .then(d => {
        if (d.shop_name) setShopName(d.shop_name)
      })
      .catch(() => {})
    if (preselectedScore != null) {
      const n = Number(preselectedScore)
      if (Number.isFinite(n) && n >= 0 && n <= 10) setScore(n)
    }
  }, [token, preselectedScore])

  async function submit() {
    if (score === null) return
    setSubmitting(true)
    setError('')
    try {
      const r = await fetch(`${API_BASE}/api/cx/nps/respond`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, score, comment }),
      })
      const data = await r.json()
      if (!r.ok) throw new Error(data.error || 'Submit failed')
      setDone(true)
    } catch (e) {
      setError(e.message)
    } finally {
      setSubmitting(false)
    }
  }

  if (done) {
    return (
      <Center>
        <p className="text-6xl mb-3">🙏</p>
        <p className="text-xl font-bold mb-2" style={{ color: '#16a34a' }}>Thank you!</p>
        <p className="text-sm text-gray-500">Your feedback helps us get better.</p>
      </Center>
    )
  }

  return (
    <div className="min-h-screen px-4 py-8 flex items-center justify-center"
      style={{ backgroundColor: '#fafafa' }}>
      <div className="max-w-md w-full">
        <div className="text-center mb-5">
          <div className="inline-block px-4 py-2 rounded-xl mb-3"
            style={{ backgroundColor: ORANGE }}>
            <span className="text-white font-bold text-lg">ABSOLUTE ADAS</span>
          </div>
        </div>

        <div className="rounded-xl bg-white p-6 shadow-sm" style={{ border: '1px solid #f0ece8' }}>
          <p className="text-sm text-gray-500 mb-2">Hi {shopName},</p>
          <h1 className="text-xl font-bold mb-4" style={{ color: '#1a1a1a' }}>
            How likely are you to recommend us to another shop?
          </h1>

          <div className="flex gap-1 justify-between mb-2">
            {[0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(n => {
              const bg = n <= 6 ? '#dc2626' : n <= 8 ? '#f59e0b' : '#16a34a'
              const selected = score === n
              return (
                <button key={n} onClick={() => setScore(n)}
                  className="flex-1 py-3 rounded text-white font-semibold transition-transform"
                  style={{
                    backgroundColor: bg,
                    opacity: score === null || selected ? 1 : 0.4,
                    transform: selected ? 'scale(1.1)' : 'scale(1)',
                    fontSize: '13px',
                  }}>
                  {n}
                </button>
              )
            })}
          </div>
          <div className="flex justify-between text-xs text-gray-400 mb-5">
            <span>Not likely</span>
            <span>Very likely</span>
          </div>

          {score !== null && (
            <>
              <label className="block text-xs font-medium text-gray-600 mb-1">
                What's the main reason for your score? <span className="text-gray-400">(optional)</span>
              </label>
              <textarea value={comment} rows="3"
                onChange={e => setComment(e.target.value)}
                placeholder="Anything we could do better or did great?"
                className="w-full border rounded-lg px-3 py-2 text-sm mb-4"
                style={{ borderColor: '#e5e7eb' }} />

              {error && <p className="text-sm text-red-600 mb-3">{error}</p>}
              <button onClick={submit} disabled={submitting}
                className="w-full py-3 rounded-lg font-semibold text-white"
                style={{ backgroundColor: ORANGE, opacity: submitting ? 0.6 : 1 }}>
                {submitting ? 'Submitting…' : 'Submit'}
              </button>
            </>
          )}
        </div>
        <p className="text-center text-xs text-gray-400 mt-4">
          Thank you for being a customer.
        </p>
      </div>
    </div>
  )
}

function Center({ children }) {
  return (
    <div className="min-h-screen flex items-center justify-center px-4" style={{ backgroundColor: '#fafafa' }}>
      <div className="max-w-md w-full text-center p-8 rounded-xl bg-white shadow-sm"
        style={{ border: '1px solid #f0ece8' }}>
        {children}
      </div>
    </div>
  )
}
