// 🤐 Confidentiality agreement (NDA) signed in onboarding (Mark 2026-10-17:
// "build out into the onboarding a signed NDA").
//
// Written for Washington: no non-compete (RCW 49.62 voids most), and the
// carve-outs RCW 49.44.211 requires (an NDA can't stop anyone talking about
// illegal discrimination, harassment, retaliation, wage-and-hour violations or
// sexual assault). Keeps the NLRA right to talk about pay and working
// conditions, and carries the federal whistleblower notice (18 U.S.C. §1833(b))
// so trade-secret remedies stay available. Have counsel read it once.
//
// Hidden from the portal until Mark OKs the wording: AppConfig nda_enabled = true.
import crypto from 'crypto'

export function ndaSections({ contractor = false } = {}) {
  const rel = contractor ? 'work with Absolute ADAS as an independent contractor' : 'employment with Absolute ADAS'
  const during = contractor ? 'while you work with us' : 'while you work here'
  return [
    { title: '1. What this is', body: `This agreement covers the private business information you will see during your ${rel}. You agree to keep it private, during and after your time with us. "Absolute ADAS" means Absolute ADAS and its owner, Mark Fowler.` },
    { title: '2. What counts as confidential', body: 'Anything about Absolute ADAS that is not public, including: our customer and shop lists, contacts, and relationships; our prices, discounts, insurer pricing, billing rules, and margins; invoices, estimates, scan reports, and job records; the Absolute ADAS app, its code, screens, data, and how it works; our processes, checklists, training material, and handbooks; our vendors, tools, OEM access, and what we pay for them; our financials, plans, and growth strategy; and anything about our people that is not public, like pay or personal details you see while doing your job.' },
    { title: '3. What does not count', body: 'Information that is already public through no fault of yours, that you already knew before working with us and can show it, or that you learn from someone else who had the right to share it.' },
    { title: '4. What you agree to', body: `Use confidential information only to do your work for Absolute ADAS. Do not share it, post it, copy it, or take it, ${during} or after. Do not download, export, or forward customer lists, pricing, or app data to a personal account or device unless Mark asks you to. Keep your app login and passwords to yourself.` },
    { title: '5. When you leave', body: 'On your last day, return or delete everything that holds confidential information: devices, files, photos, printouts, and anything in personal email or cloud accounts. If asked, confirm in writing that you did. Your duty to keep this information private continues after you leave, for as long as the information stays confidential.' },
    { title: '6. What this does NOT stop you from doing', body: 'Nothing in this agreement stops you from: talking about or reporting illegal discrimination, harassment, retaliation, a wage-and-hour violation, sexual assault, or anything else Washington law (RCW 49.44.211) protects; talking with coworkers or others about your own pay, benefits, or working conditions; reporting possible violations of law to, filing a charge with, or taking part in an investigation by any government agency (such as the EEOC, the NLRB, the Washington Department of Labor and Industries, OSHA, or the SEC); testifying truthfully when the law requires it; or talking with your own lawyer. You do not need permission from Absolute ADAS to do any of these things.' },
    { title: '7. Whistleblower notice', body: 'Under federal law (18 U.S.C. § 1833(b)), you cannot be held liable under any trade secret law for sharing a trade secret in confidence with a government official or a lawyer only to report or investigate a suspected violation of law, or in a complaint or other filing in a lawsuit if it is filed under seal.' },
    { title: '8. No non-compete', body: 'This is not a non-compete. Nothing here stops you from working in the industry after you leave. It only protects Absolute ADAS information.' },
    { title: '9. If it is broken', body: 'Sharing confidential information can seriously hurt Absolute ADAS. If that happens, Absolute ADAS can ask a court to stop it and recover its damages, as the law allows.' },
    { title: '10. The rest', body: `Washington law governs this agreement. If any part is found unenforceable, the rest still applies. This agreement does not change ${contractor ? 'the terms of your contractor agreement' : 'the at-will nature of your employment'}. Signing electronically has the same effect as signing on paper.` },
  ]
}

export function ndaHash() {
  const text = JSON.stringify([ndaSections({}), ndaSections({ contractor: true })])
  return crypto.createHash('sha1').update(text).digest('hex').slice(0, 8)
}
