// Ops-channel message formatter stub.
//
// routes/captureCalculator.js dynamically imports
// { formatDispatchMessage, formatInvoicedMessage, formatJobRequestMessage }
// from this module. The dynamic import means startup isn't affected, but
// the calls fail at runtime with ERR_MODULE_NOT_FOUND when the calculator
// tries to post to the ops channel.
//
// Bare stubs return a simple text summary so the calls don't blow up.
// Restore the rich formatters when the source module is recovered.

function summarize(job = {}) {
  const vehicle = job.vehicle || [job.year, job.make, job.model].filter(Boolean).join(' ')
  const parts = [
    job.shop_name || 'Unknown shop',
    vehicle || null,
    job.technician ? '👤 ' + job.technician : null,
    job.quote_number ? 'RO# ' + job.quote_number : null,
  ].filter(Boolean)
  return parts.join(' · ')
}

export function formatDispatchMessage(job)     { return '📋 Dispatch: ' + summarize(job) }
export function formatInvoicedMessage(job)     { return '💵 Invoiced: ' + summarize(job) }
export function formatJobRequestMessage(job)   { return '📥 Job requested: ' + summarize(job) }
