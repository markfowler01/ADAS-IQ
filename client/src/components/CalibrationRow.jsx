const ORANGE = '#CD4419'

export default function CalibrationRow({ cal, onToggle }) {
  const { calibration_name, cal_type, trigger, line_references, justification, enabled } = cal

  return (
    <div
      onClick={onToggle}
      style={{
        backgroundColor: 'white',
        border: `1.5px solid ${enabled ? '#e8d5ce' : '#e8e8e8'}`,
        borderRadius: '12px',
        padding: '16px',
        opacity: enabled ? 1 : 0.4,
        cursor: 'pointer',
        transition: 'all 0.18s ease',
        boxShadow: enabled ? '0 2px 8px rgba(205,68,25,0.06)' : 'none',
      }}
    >
      <div className="flex items-start gap-3">
        {/* Text content */}
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold leading-snug" style={{ color: '#1a1a1a' }}>
            {calibration_name}
          </p>

          {/* Tags */}
          {(cal_type || trigger || line_references) && (
            <div className="flex flex-wrap gap-1.5 mt-2">
              {cal_type && (
                <Tag color="gray">{cal_type}</Tag>
              )}
              {trigger && (
                <Tag color="orange">{trigger}</Tag>
              )}
              {line_references && (
                <Tag color="gray">Lines {line_references}</Tag>
              )}
            </div>
          )}

          {/* Justification */}
          {justification && (
            <p
              className="text-xs italic mt-2 leading-relaxed"
              style={{ color: '#888' }}
            >
              {justification}
            </p>
          )}
        </div>

        {/* Toggle */}
        <div className="flex-shrink-0 pt-0.5">
          <Toggle on={enabled} />
        </div>
      </div>
    </div>
  )
}

function Tag({ color, children }) {
  const styles =
    color === 'orange'
      ? { backgroundColor: '#fdeee8', color: ORANGE }
      : { backgroundColor: '#f2f2f2', color: '#666' }

  return (
    <span
      className="text-xs font-medium px-2 py-0.5 rounded-full"
      style={{ fontFamily: "'IBM Plex Mono', monospace", ...styles }}
    >
      {children}
    </span>
  )
}

function Toggle({ on }) {
  return (
    <div
      style={{
        width: '40px',
        height: '22px',
        borderRadius: '11px',
        backgroundColor: on ? ORANGE : '#d4d4d4',
        position: 'relative',
        transition: 'background-color 0.18s ease',
        flexShrink: 0,
      }}
    >
      <div
        style={{
          position: 'absolute',
          top: '3px',
          left: on ? '21px' : '3px',
          width: '16px',
          height: '16px',
          borderRadius: '50%',
          backgroundColor: 'white',
          boxShadow: '0 1px 3px rgba(0,0,0,0.2)',
          transition: 'left 0.18s ease',
        }}
      />
    </div>
  )
}
