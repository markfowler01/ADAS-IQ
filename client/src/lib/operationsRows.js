// Operations table rows. The scrub screen and the battery-reset test share
// this filter so a row the test keeps is the row the table renders.

export const FS_ITEMS = [
  { key: 'headlamp', emoji: '💡', label: 'Headlamp aim (manual)', match: /^(?!.*(adaptive|level|swivel|afs|matrix|module|initiali|calibration|electronic)).*(headlamp|headlight)/i },
  { key: 'bsm_rr', emoji: '📡', label: 'Blind spot aim after rear bumper removal', match: /rear bumper removed/i, optional: true },
  { key: 'tpms', emoji: '🛞', label: 'TPMS relearn', match: /\btpms\b|tire pressure/i },
  { key: 'resets', emoji: '🪟', label: 'Battery-disconnect resets', match: /window|sunroof|moon ?roof|power (liftgate|tailgate|sliding door)|initiali[sz]ation after battery|battery.*reset|reset.*battery/i },
]

export const fsItemFor = name => FS_ITEMS.find(f => f.match.test(String(name || ''))) || null

const NISSAN_BATTERY = /battery.?disconnect reset|\bbattery reset\b|operations required after disconnecting battery/i

export const nissanBatteryLine = (line, vehicle) => /nissan|infiniti/i.test(String(vehicle || '')) && NISSAN_BATTERY.test(`${line?.name || ''} ${line?.title || ''} ${line?.n || ''}`)

export const fsIsOff = fsr => !!fsr && fsr.collision !== false && !fsr.on

// Full Service OFF drops FS extras. A Nissan battery reset stays: it is a
// report row, whether or not anyone marked it learned.
export const dropFsLines = (lines, fsr, vehicle = '') => fsIsOff(fsr)
  ? lines.filter(l => l.reportRequired || nissanBatteryLine(l, vehicle) || !fsItemFor(l.name || l.n))
  : lines

export function operationLine(c) {
  return {
    name: c.sensor || c.calibration_name || '',
    title: c.operation_title || '',
    required: c.enabled === true && !/^(CONDITIONAL:|REVIEW NEEDED|NOT REQUIRED)/.test(c.classification || ''),
    reportRequired: !!(c._reportRequired || c._onReport),
    learned: c._learned || '',
    lines: c.line_references || '',
    trigger: c.trigger || '',
    classification: c.classification || '',
  }
}

/** The rows the Operations table renders, in order, when Full Service is off or on. */
export function operationsList(calibrations, { vehicle = '', make = '', fsOff = false } = {}) {
  const vehicleBits = `${make} ${vehicle}`.trim()
  const lines = (calibrations || []).map(operationLine)
  const fsr = fsOff ? { collision: true, on: false } : null
  return dropFsLines(lines, fsr, vehicleBits).map(l => ({
    ...l,
    onReport: !!(l.reportRequired || nissanBatteryLine(l, vehicleBits)),
    label: l.title || l.name,
  })).filter(l => l.required || l.onReport || l.name || l.title)
}
