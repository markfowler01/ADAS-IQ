import { useState } from 'react'

const ORANGE = '#CD4419'

export default function ManualAddForm({ onAdd, onCancel }) {
  const [name, setName] = useState('')
  const [justification, setJustification] = useState('')

  function handleSubmit(e) {
    e.preventDefault()
    if (!name.trim()) return
    onAdd({
      calibration_name: name.trim(),
      cal_type: null,
      trigger: null,
      line_references: null,
      justification: justification.trim() || null,
      enabled: true,
    })
  }

  return (
    <div
      className="rounded-xl p-4"
      style={{
        backgroundColor: 'white',
        border: `1.5px solid ${ORANGE}`,
        boxShadow: '0 2px 8px rgba(205,68,25,0.08)',
      }}
    >
      <p className="text-sm font-semibold mb-3" style={{ color: '#1a1a1a' }}>
        Add Calibration Manually
      </p>
      <form onSubmit={handleSubmit} className="flex flex-col gap-3">
        <div>
          <label
            className="text-xs font-medium uppercase tracking-wider block mb-1"
            style={{ fontFamily: "'IBM Plex Mono', monospace", color: '#aaa' }}
          >
            Calibration Name *
          </label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Steering Angle Sensor"
            required
            className="w-full text-sm px-3 py-2 rounded-lg outline-none"
            style={{
              border: '1.5px solid #e0dbd6',
              backgroundColor: '#fafafa',
              color: '#1a1a1a',
            }}
            onFocus={(e) => (e.target.style.borderColor = ORANGE)}
            onBlur={(e) => (e.target.style.borderColor = '#e0dbd6')}
          />
        </div>
        <div>
          <label
            className="text-xs font-medium uppercase tracking-wider block mb-1"
            style={{ fontFamily: "'IBM Plex Mono', monospace", color: '#aaa' }}
          >
            Justification
          </label>
          <textarea
            value={justification}
            onChange={(e) => setJustification(e.target.value)}
            placeholder="OEM position statement and ALLDATA ADAS procedure..."
            rows={3}
            className="w-full text-sm px-3 py-2 rounded-lg outline-none resize-none"
            style={{
              border: '1.5px solid #e0dbd6',
              backgroundColor: '#fafafa',
              color: '#1a1a1a',
            }}
            onFocus={(e) => (e.target.style.borderColor = ORANGE)}
            onBlur={(e) => (e.target.style.borderColor = '#e0dbd6')}
          />
        </div>
        <div className="flex gap-2">
          <button
            type="submit"
            className="flex-1 py-2 rounded-lg text-sm font-semibold text-white"
            style={{ backgroundColor: ORANGE }}
          >
            Add
          </button>
          <button
            type="button"
            onClick={onCancel}
            className="flex-1 py-2 rounded-lg text-sm font-semibold"
            style={{ backgroundColor: '#f0ece8', color: '#666' }}
          >
            Cancel
          </button>
        </div>
      </form>
    </div>
  )
}
