const ORANGE = '#CD4419'

export default function JobCard({ job }) {
  return (
    <div>
      <p
        className="text-xs font-semibold uppercase tracking-widest mb-2"
        style={{ fontFamily: "'IBM Plex Mono', monospace", color: '#999' }}
      >
        Job Details
      </p>
      <div
        className="bg-white rounded-xl p-5"
        style={{
          borderLeft: `3px solid ${ORANGE}`,
          boxShadow: '0 2px 10px 0 rgba(0,0,0,0.06)',
        }}
      >
        {/* Vehicle — full width orange badge */}
        <div className="mb-4">
          <span
            className="text-xs font-medium uppercase tracking-wider mr-2"
            style={{ fontFamily: "'IBM Plex Mono', monospace", color: '#aaa' }}
          >
            Vehicle
          </span>
          <span
            className="inline-block px-3 py-1 rounded-full text-sm font-semibold"
            style={{ backgroundColor: '#fdeee8', color: ORANGE }}
          >
            {job.vehicle || '—'}
          </span>
        </div>

        {/* Year / Make / Model row */}
        {(job.year || job.make || job.model) && (
          <div className="grid grid-cols-3 gap-x-4 mb-4 pb-4" style={{ borderBottom: '1px solid #f0ece8' }}>
            <Field label="Year" value={job.year} />
            <Field label="Make" value={job.make} />
            <Field label="Model" value={job.model} />
          </div>
        )}

        {/* 2-col grid for job fields */}
        <div className="grid grid-cols-2 gap-x-6 gap-y-3">
          <Field label="Shop" value={job.shop} />
          <Field label="RO Number" value={job.ro_number} />
          <Field label="Insurer" value={job.insurer} />
          <Field label="Claim" value={job.claim} />
        </div>

        {/* VIN — full width, mono */}
        {job.vin && (
          <div className="mt-3 pt-3" style={{ borderTop: '1px solid #f0ece8' }}>
            <span
              className="text-xs font-medium uppercase tracking-wider"
              style={{ fontFamily: "'IBM Plex Mono', monospace", color: '#aaa' }}
            >
              VIN
            </span>
            <p
              className="text-sm mt-0.5"
              style={{
                fontFamily: "'IBM Plex Mono', monospace",
                color: '#777',
                letterSpacing: '0.05em',
              }}
            >
              {job.vin}
            </p>
          </div>
        )}
      </div>
    </div>
  )
}

function Field({ label, value }) {
  return (
    <div>
      <p
        className="text-xs font-medium uppercase tracking-wider"
        style={{ fontFamily: "'IBM Plex Mono', monospace", color: '#aaa' }}
      >
        {label}
      </p>
      <p className="text-sm font-medium mt-0.5" style={{ color: '#2a2a2a' }}>
        {value || '—'}
      </p>
    </div>
  )
}
