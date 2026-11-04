// 📄 ADAS IQ scrub service terms (2026-11-04). DRAFT: a lawyer reads this
// before signup opens (the signup switch stays off until Mark turns it on).
// Every signup stores the exact VERSION it accepted, so changing the text
// means bumping VERSION, never editing an accepted version in place.
//
// Brand rule: ADAS IQ only. No Absolute ADAS name, people, region or phone here.

export const TERMS_VERSION = '2026-11-04-draft1'
export const TERMS_DRAFT = true

export const TERMS = [
  ['What you get', 'ADAS IQ reads each repair estimate your body shops send through CCC Secure Share and returns a calibration identification report: the ADAS systems on the vehicle and which ones the repair requires to be calibrated, with the estimate lines that trigger each one.'],
  ['What it is not', 'The report is a guide built from the estimate. The vehicle maker’s repair procedures and the pre-repair scan decide what a vehicle needs. You and your technicians stay responsible for checking OEM procedures, doing the work and the results. ADAS IQ is not liable for a missed, extra or wrong calibration call, for repair outcomes, or for any amount more than the fees you paid in the 3 months before the claim.'],
  ['Price', 'You pay the per-VIN price on your account for each vehicle scrubbed. One charge per VIN per repair order; supplements on the same repair order within 30 days are free. New accounts start with free scrubs. Estimates your filters skip are never charged. Prices can change with 30 days’ notice by email.'],
  ['Billing', 'We bill monthly for the month before and charge the card or account on file on the invoice date. If a payment fails we remind you; after 7 days scrubbing pauses (estimates are still kept) and restarts when the balance is paid.'],
  ['Your body shops', 'You may only link body shops that send their estimates to you. You are billed for every linked body shop. Linking a body shop is reviewed before it goes live.'],
  ['CCC data', 'Estimate data comes from CCC Secure Share under CCC’s terms. You agree not to resell it, forward it to anyone not approved by CCC, build price lists from it, or show it to third parties in estimate form. Data stays in the United States. Personal details of vehicle owners and claimants are removed before storage.'],
  ['Your data', 'Your reports, usage and invoices are yours. We use estimate data only to make your reports and to improve the scrubber. We never sell it.'],
  ['Cancel any time', 'Turn off the ADAS IQ app in CCC Secure Share or email us. You pay for scrubs up to that day. No contract term, no cancellation fee.'],
  ['Changes', 'If these terms change we email you first. Using the service after the change date means you accept the new version.'],
]
