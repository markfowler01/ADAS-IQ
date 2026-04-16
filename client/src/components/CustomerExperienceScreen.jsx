import { useState, useEffect, useCallback } from 'react'
import Navbar from './Navbar'
import { API_BASE, apiFetch, ORANGE, fmt } from './books/shared'

export default function CustomerExperienceScreen({ user, onLogout, currentScreen, onNavigate }) {
  const [tab, setTab] = useState('nps')
  const [nps, setNps] = useState(null)
  const [referrals, setReferrals] = useState(null)
  const [shops, setShops] = useState([])
  const [loading, setLoading] = useState(true)
  const [sending, setSending] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [n, r, s] = await Promise.all([
        apiFetch(`${API_BASE}/api/cx/nps/report`).then(r => r.json()),
        apiFetch(`${API_BASE}/api/cx/referrals/report`).then(r => r.json()),
        apiFetch(`${API_BASE}/api/shops`).then(r => r.json()),
      ])
      setNps(n); setReferrals(r); setShops(Array.isArray(s) ? s : [])
    } catch (e) { console.error(e) }
    finally { setLoading(false) }
  }, [])

  useEffect(() => { load() }, [load])

  async function sendNPS() {
    if (!confirm('Send NPS survey to all Active customers right now?')) return
    setSending(true)
    try {
      const r = await apiFetch(`${API_BASE}/api/cx/nps/send-survey`, { method: 'POST' }).then(r => r.json())
      alert(`NPS sent: ${r.sent} · Skipped (no email): ${r.skipped}`)
      load()
    } catch (e) { alert('Failed: ' + e.message) }
    finally { setSending(false) }
  }

  async function sendWelcome(shopId) {
    try {
      const r = await apiFetch(`${API_BASE}/api/cx/portal/welcome`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ shop_id: shopId }),
      }).then(r => r.json())
      if (r.error) throw new Error(r.error)
      alert(`Welcome email sent to ${r.sent_to}`)
    } catch (e) { alert('Failed: ' + e.message) }
  }

  async function thankReferrer(entry) {
    const referrer = shops.find(s => s.shop_name === entry.referrer)
    if (!referrer) return alert('Referrer not found in CRM')
    const referredNames = entry.referred.map(r => r.shop_name).join(', ')
    try {
      await apiFetch(`${API_BASE}/api/cx/referrals/thank`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          referrer_shop_id: referrer.id || referrer.ROWID,
          referred_shop_name: referredNames,
        }),
      })
      alert(`Thank you email sent to ${referrer.shop_name}`)
    } catch (e) { alert('Failed: ' + e.message) }
  }

  const tabs = [
    { id: 'nps', label: 'NPS & Reviews' },
    { id: 'referrals', label: 'Referrals' },
    { id: 'welcome', label: 'Portal Welcome' },
  ]

  return (
    <div className="min-h-screen" style={{ backgroundColor: 'white' }}>
      <Navbar user={user} onLogout={onLogout} currentScreen={currentScreen} onNavigate={onNavigate} />
      <div className="max-w-5xl mx-auto px-4 sm:px-6 py-6">
        <div className="mb-6">
          <h1 className="text-2xl font-bold" style={{ color: '#1a1a1a' }}>Customer Experience</h1>
          <p className="text-sm text-gray-500 mt-0.5">NPS surveys, referral tracking, portal onboarding</p>
        </div>

        <div className="flex gap-0 mb-6 border-b overflow-x-auto" style={{ borderColor: '#ebebeb' }}>
          {tabs.map(t => (
            <button key={t.id} onClick={() => setTab(t.id)}
              className="text-sm px-4 py-2.5 font-medium transition-colors whitespace-nowrap"
              style={{
                color: tab === t.id ? ORANGE : '#666',
                borderBottom: tab === t.id ? `2px solid ${ORANGE}` : '2px solid transparent',
                marginBottom: '-1px',
              }}>
              {t.label}
            </button>
          ))}
        </div>

        {loading ? (
          <div className="py-16 text-center text-gray-400 text-sm">Loading…</div>
        ) : (
          <>
            {tab === 'nps' && nps && (
              <div className="space-y-5">
                <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                  <Card label="NPS Score" value={nps.nps_score} bg="#fff7f5" color={ORANGE} />
                  <Card label="Promoters" value={nps.promoters} bg="#f0fdf4" color="#15803d" />
                  <Card label="Passives" value={nps.passives} bg="#fef3c7" color="#b45309" />
                  <Card label="Detractors" value={nps.detractors} bg="#fef2f2" color="#b91c1c" />
                </div>

                <div className="rounded-xl border p-5 shadow-sm flex items-center justify-between gap-3"
                  style={{ borderColor: '#f0ece8' }}>
                  <div>
                    <p className="text-sm font-semibold" style={{ color: '#1a1a1a' }}>Send monthly NPS survey</p>
                    <p className="text-xs text-gray-500 mt-0.5">Emails all Active customers</p>
                  </div>
                  <button onClick={sendNPS} disabled={sending}
                    className="text-sm px-4 py-2 rounded-lg font-semibold text-white"
                    style={{ backgroundColor: ORANGE, opacity: sending ? 0.6 : 1 }}>
                    {sending ? 'Sending…' : 'Send NPS Now'}
                  </button>
                </div>

                {nps.recent_detractors.length > 0 && (
                  <div className="rounded-xl border shadow-sm" style={{ borderColor: '#f0ece8' }}>
                    <div className="px-5 py-3 border-b" style={{ borderColor: '#f0ece8' }}>
                      <h3 className="text-sm font-semibold" style={{ color: '#b91c1c' }}>
                        ⚠️ Recent Detractors ({nps.recent_detractors.length})
                      </h3>
                    </div>
                    <div className="divide-y" style={{ borderColor: '#f7f4f1' }}>
                      {nps.recent_detractors.map(r => (
                        <div key={r.id} className="px-5 py-3">
                          <div className="flex justify-between items-start mb-1">
                            <strong>{r.shop_name}</strong>
                            <span className="text-xs px-2 py-0.5 rounded-full"
                              style={{ backgroundColor: '#fee2e2', color: '#b91c1c' }}>
                              Score: {r.score}
                            </span>
                          </div>
                          {r.comment && <p className="text-sm text-gray-600">{r.comment}</p>}
                          <p className="text-xs text-gray-400">{new Date(r.submitted_at).toLocaleDateString()}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}

            {tab === 'referrals' && referrals && (
              <div className="space-y-5">
                <div className="rounded-xl border shadow-sm" style={{ borderColor: '#f0ece8' }}>
                  <div className="px-5 py-3 border-b" style={{ borderColor: '#f0ece8' }}>
                    <h3 className="text-sm font-semibold" style={{ color: '#1a1a1a' }}>Shops Who Referred Others</h3>
                  </div>
                  {referrals.by_referrer.length === 0 ? (
                    <div className="py-10 text-center text-gray-400 text-sm">
                      No referrals tracked yet. Add "Referred by" in the shop detail panel.
                    </div>
                  ) : (
                    <div className="divide-y" style={{ borderColor: '#f7f4f1' }}>
                      {referrals.by_referrer.map(entry => (
                        <div key={entry.referrer} className="px-5 py-3 flex items-center justify-between">
                          <div>
                            <p className="text-sm font-semibold">{entry.referrer}</p>
                            <p className="text-xs text-gray-500">
                              Referred {entry.referred.length}: {entry.referred.map(r => r.shop_name).join(', ')}
                            </p>
                          </div>
                          <button onClick={() => thankReferrer(entry)}
                            className="text-xs px-3 py-1.5 rounded-md font-semibold text-white"
                            style={{ backgroundColor: ORANGE }}>
                            💌 Send Thank You
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                <div className="rounded-xl border shadow-sm" style={{ borderColor: '#f0ece8' }}>
                  <div className="px-5 py-3 border-b" style={{ borderColor: '#f0ece8' }}>
                    <h3 className="text-sm font-semibold" style={{ color: '#1a1a1a' }}>Referral Sources</h3>
                  </div>
                  <div className="divide-y" style={{ borderColor: '#f7f4f1' }}>
                    {referrals.by_source.map(s => (
                      <div key={s.source} className="px-5 py-2 flex justify-between">
                        <span className="text-sm text-gray-600">{s.source}</span>
                        <span className="text-sm font-semibold">{s.count}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {tab === 'welcome' && (
              <div>
                <p className="text-sm text-gray-500 mb-4">
                  Send portal onboarding email to any shop — includes their email and a guide to submit jobs, pay invoices, download PDFs.
                </p>
                <div className="rounded-xl border shadow-sm" style={{ borderColor: '#f0ece8' }}>
                  <div className="divide-y" style={{ borderColor: '#f7f4f1' }}>
                    {shops.filter(s => s.email || s.billing_rules?.billing_contact_email)
                      .filter(s => ['active', 'active2'].includes(s.pipeline_stage))
                      .map(s => (
                        <div key={s.id || s.ROWID} className="px-5 py-3 flex justify-between items-center">
                          <div>
                            <p className="text-sm font-semibold">{s.shop_name}</p>
                            <p className="text-xs text-gray-500">
                              {s.billing_rules?.billing_contact_email || s.email}
                            </p>
                          </div>
                          <button onClick={() => sendWelcome(s.id || s.ROWID)}
                            className="text-xs px-3 py-1.5 rounded-md font-semibold text-white"
                            style={{ backgroundColor: ORANGE }}>
                            Send Welcome
                          </button>
                        </div>
                      ))}
                  </div>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}

function Card({ label, value, bg, color }) {
  return (
    <div className="rounded-xl p-4 shadow-sm" style={{ backgroundColor: bg }}>
      <p className="text-xs font-medium" style={{ color }}>{label}</p>
      <p className="text-2xl font-bold mt-1" style={{ color }}>{value}</p>
    </div>
  )
}
