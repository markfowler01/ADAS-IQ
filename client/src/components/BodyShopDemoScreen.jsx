import { useState, useRef } from 'react'
import { API_BASE, apiFetch } from '../utils/api.js'

const ORANGE = '#CD4419'
const BLUE = '#0369a1'

export default function BodyShopDemoScreen({ user, onLogout }) {
  const [stage, setStage] = useState('upload') // 'upload' | 'processing' | 'results' | 'requested'
  const [dragOver, setDragOver] = useState(false)
  const [calibrations, setCalibrations] = useState([])
  const [jobData, setJobData] = useState(null)
  const [error, setError] = useState(null)
  const fileInputRef = useRef()

  async function handleFile(file) {
    if (!file || file.type !== 'application/pdf') {
      setError('Please upload a PDF file.')
      return
    }
    setError(null)
    setStage('processing')

    try {
      const form = new FormData()
      form.append('pdf', file)
      const r = await apiFetch(`${API_BASE}/api/extract`, { method: 'POST', body: form })
      const data = await r.json()
      if (!r.ok) throw new Error(data.error || 'Extraction failed')
      setJobData(data)
      setCalibrations((data.calibrations || []).filter(c => c.enabled !== false))
      setStage('results')
    } catch (e) {
      setError(e.message)
      setStage('upload')
    }
  }

  function handleDrop(e) {
    e.preventDefault()
    setDragOver(false)
    handleFile(e.dataTransfer.files?.[0])
  }

  return (
    <div className="min-h-screen flex flex-col" style={{ backgroundColor: '#f5f3f0' }}>

      {/* Header */}
      <header style={{ backgroundColor: 'white', borderBottom: '1px solid #ebebeb' }}>
        <div className="max-w-4xl mx-auto px-6 py-3 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <img src={import.meta.env.BASE_URL + 'logo.png'} alt="Absolute ADAS" className="w-8 h-8 object-contain" />
            <span className="text-base font-bold tracking-tight" style={{ color: '#1a1a1a' }}>Absolute <span style={{ color: ORANGE }}>ADAS</span></span>
            <span className="text-xs px-2 py-0.5 rounded-full font-semibold ml-1" style={{ backgroundColor: '#f0f9ff', color: BLUE }}>Body Shop</span>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-sm text-gray-500">{user?.name}</span>
            <button onClick={onLogout} className="text-xs px-2 py-1 rounded text-gray-400 hover:text-gray-600">Exit Demo</button>
          </div>
        </div>
      </header>

      <div className="flex-1 max-w-4xl mx-auto w-full px-6 py-10">

        {/* Stage: Upload */}
        {stage === 'upload' && (
          <div>
            <div className="mb-8">
              <h1 className="text-2xl font-bold mb-2" style={{ color: '#1a1a1a' }}>ADAS Calibration Check</h1>
              <p className="text-gray-500">Upload your CCC collision estimate to instantly see what ADAS calibrations the vehicle needs.</p>
            </div>

            {error && (
              <div className="rounded-xl p-4 mb-6 text-sm" style={{ backgroundColor: '#fef2f2', color: '#dc2626' }}>{error}</div>
            )}

            <label
              className="block cursor-pointer"
              onDrop={handleDrop}
              onDragOver={e => { e.preventDefault(); setDragOver(true) }}
              onDragLeave={() => setDragOver(false)}
            >
              <div
                className="rounded-2xl border-2 border-dashed p-16 text-center transition-all"
                style={{
                  borderColor: dragOver ? BLUE : '#d1d5db',
                  backgroundColor: dragOver ? '#f0f9ff' : 'white',
                }}
              >
                <div className="text-5xl mb-4">📄</div>
                <p className="text-lg font-semibold text-gray-700 mb-1">Drop your CCC estimate here</p>
                <p className="text-sm text-gray-400">or click to browse · PDF files only</p>
              </div>
              <input ref={fileInputRef} type="file" accept="application/pdf" className="hidden" onChange={e => handleFile(e.target.files?.[0])} />
            </label>

            {/* How it works */}
            <div className="mt-10 grid grid-cols-3 gap-6">
              {[
                { icon: '📤', title: 'Upload Estimate', desc: 'Drop in your CCC ONE collision estimate PDF' },
                { icon: '🔍', title: 'Auto-Detection', desc: 'Absolute ADAS reads the vehicle equipment and repair lines' },
                { icon: '✅', title: 'Instant Report', desc: 'See every calibration needed with OEM justifications' },
              ].map(s => (
                <div key={s.title} className="text-center">
                  <div className="text-3xl mb-2">{s.icon}</div>
                  <p className="font-semibold text-sm text-gray-700">{s.title}</p>
                  <p className="text-xs text-gray-400 mt-1">{s.desc}</p>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Stage: Processing */}
        {stage === 'processing' && (
          <div className="flex flex-col items-center justify-center py-24">
            <img src={import.meta.env.BASE_URL + 'logo.png'} alt="Absolute ADAS" className="w-16 h-16 object-contain mb-6 animate-pulse" />
            <h2 className="text-xl font-bold mb-2" style={{ color: '#1a1a1a' }}>Analyzing estimate…</h2>
            <p className="text-gray-400 text-sm">Reading vehicle equipment and repair operations</p>
          </div>
        )}

        {/* Stage: Results */}
        {stage === 'results' && jobData && (
          <div>
            {/* Vehicle card */}
            <div className="bg-white rounded-2xl p-6 mb-6" style={{ border: '1px solid #ebebeb' }}>
              <div className="flex items-start justify-between">
                <div>
                  <h2 className="text-xl font-bold" style={{ color: '#1a1a1a' }}>{jobData.vehicle}</h2>
                  <div className="flex flex-wrap gap-3 mt-2">
                    {jobData.vin && <span className="text-xs text-gray-400">VIN: {jobData.vin}</span>}
                    {jobData.shop && <span className="text-xs text-gray-400">Shop: {jobData.shop}</span>}
                    {jobData.ro_number && <span className="text-xs text-gray-400">RO#: {jobData.ro_number}</span>}
                    {jobData.insurer && <span className="text-xs text-gray-400">Insurer: {jobData.insurer}</span>}
                  </div>
                </div>
                <div
                  className="flex-shrink-0 w-10 h-10 rounded-full flex items-center justify-center text-white font-bold text-sm"
                  style={{ backgroundColor: calibrations.length > 0 ? ORANGE : '#16a34a' }}
                >
                  {calibrations.length}
                </div>
              </div>
            </div>

            {/* Calibrations */}
            {calibrations.length === 0 ? (
              <div className="bg-white rounded-2xl p-10 text-center" style={{ border: '1px solid #ebebeb' }}>
                <div className="text-4xl mb-3">✅</div>
                <p className="font-semibold text-gray-700">No ADAS calibrations required</p>
                <p className="text-sm text-gray-400 mt-1">Based on the repairs listed in this estimate</p>
              </div>
            ) : (
              <div>
                <h3 className="font-bold text-sm text-gray-500 uppercase tracking-wide mb-3">
                  {calibrations.length} Calibration{calibrations.length !== 1 ? 's' : ''} Required
                </h3>
                <div className="space-y-3 mb-6">
                  {calibrations.map((cal, i) => (
                    <div key={i} className="bg-white rounded-xl p-5" style={{ border: '1px solid #ebebeb' }}>
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex-1">
                          <p className="font-semibold text-sm" style={{ color: '#1a1a1a' }}>{cal.calibration_name}</p>
                          {cal.trigger && (
                            <p className="text-xs text-gray-400 mt-0.5">Trigger: {cal.trigger}</p>
                          )}
                          {cal.justification && (
                            <p className="text-xs text-gray-500 mt-2 leading-relaxed">{cal.justification}</p>
                          )}
                        </div>
                        {cal.cal_type && (
                          <span className="text-xs px-2 py-1 rounded-full flex-shrink-0 font-medium"
                            style={{ backgroundColor: '#f5f3f0', color: '#6b7280' }}>
                            {cal.cal_type}
                          </span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* CTA */}
            {calibrations.length > 0 && stage !== 'requested' && (
              <div className="bg-white rounded-2xl p-6" style={{ border: `2px solid ${BLUE}` }}>
                <h3 className="font-bold mb-1" style={{ color: '#1a1a1a' }}>Ready to schedule calibrations?</h3>
                <p className="text-sm text-gray-500 mb-4">
                  Absolute ADAS provides mobile ADAS calibration services. We come to your shop — no teardown required.
                </p>
                <div className="flex gap-3">
                  <button
                    onClick={() => setStage('requested')}
                    className="px-5 py-2.5 rounded-xl text-sm font-semibold text-white"
                    style={{ backgroundColor: BLUE }}
                  >
                    Request Calibration Service
                  </button>
                  <button
                    onClick={() => { setStage('upload'); setJobData(null); setCalibrations([]) }}
                    className="px-4 py-2.5 rounded-xl text-sm text-gray-500 hover:bg-gray-100"
                  >
                    Upload another
                  </button>
                </div>
              </div>
            )}

            {stage !== 'requested' && calibrations.length === 0 && (
              <button
                onClick={() => { setStage('upload'); setJobData(null); setCalibrations([]) }}
                className="mt-4 text-sm px-4 py-2 rounded-lg text-gray-500 hover:bg-gray-100"
              >
                ← Upload another estimate
              </button>
            )}
          </div>
        )}

        {/* Stage: Requested */}
        {stage === 'requested' && (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <div className="w-16 h-16 rounded-full flex items-center justify-center mb-6 text-3xl" style={{ backgroundColor: '#f0fdf4' }}>
              ✅
            </div>
            <h2 className="text-2xl font-bold mb-3" style={{ color: '#1a1a1a' }}>Request Sent!</h2>
            <p className="text-gray-500 max-w-md mb-2">
              The Absolute ADAS team has been notified and will follow up with you shortly to schedule calibration service.
            </p>
            <p className="text-sm text-gray-400 mb-8">
              {jobData?.vehicle} · {calibrations.length} calibration{calibrations.length !== 1 ? 's' : ''}
            </p>
            <button
              onClick={() => { setStage('upload'); setJobData(null); setCalibrations([]) }}
              className="px-5 py-2.5 rounded-xl text-sm font-semibold text-white"
              style={{ backgroundColor: ORANGE }}
            >
              Check another vehicle
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
