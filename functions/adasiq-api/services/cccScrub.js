// 📥 CCC Secure Share → scrub (Mark 2026-09-30). CCC pushes each estimate as
// CIECA BMS XML (VehicleDamageEstimateAddRq, 5.4). The webhook (routes/ccc.js)
// only saves the XML and queues it; a scrub worker lands here: read the BMS,
// turn every damage line into one plain text line, and run the same scrubber
// as a PDF (same rulebook, same guard) on the text. No page images, so it's
// faster and cheaper than a PDF scrub, and the RO / VIN / claim come straight
// from CCC instead of being read off a page.

// CIECA labor operation codes → the words on a printed CCC estimate.
const OPS = { OP0: '', OP2: 'R&I', OP4: 'Align', OP5: 'O/H', OP6: 'Refn', OP9: 'Rpr', OP10: 'Rpr (partial)', OP11: 'Repl', OP15: 'Blnd', OP16: 'Subl', OP26: 'PDR' }
const PARTS = { PAA: 'aftermarket', PAG: 'GLASS', PAL: 'recycled OE', PAM: 'reman', PAN: 'new OEM', PAND: 'new OEM', PAO: 'other', PAP: 'new partial', PAR: 're-cored', PAS: 'sublet' }

const unesc = s => String(s ?? '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&').trim()
// First <name>…</name> (namespace prefix tolerated) inside xml.
const tag = (xml, name) => { const m = String(xml || '').match(new RegExp(`<(?:\\w+:)?${name}\\b[^>]*>([\\s\\S]*?)</(?:\\w+:)?${name}>`)); return m ? unesc(m[1].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ')) : '' }
const block = (xml, name) => { const m = String(xml || '').match(new RegExp(`<(?:\\w+:)?${name}\\b[^>]*>([\\s\\S]*?)</(?:\\w+:)?${name}>`)); return m ? m[1] : '' }
const blocks = (xml, name) => [...String(xml || '').matchAll(new RegExp(`<(?:\\w+:)?${name}\\b[^>]*>([\\s\\S]*?)</(?:\\w+:)?${name}>`, 'g'))].map(m => m[1])

/** The fields we use from a BMS estimate. */
export function parseBms(xml) {
  const doc = block(xml, 'DocumentInfo'), admin = block(xml, 'AdminInfo'), veh = block(xml, 'VehicleInfo')
  const shop = block(admin, 'RepairFacility'), ins = block(admin, 'InsuranceCompany'), est = block(admin, 'Estimator')
  const vins = blocks(veh, 'VINNum').map(v => unesc(v).toUpperCase())
  const lines = blocks(xml, 'DamageLineInfo').map(l => ({
    line: tag(l, 'LineNum'), seq: tag(l, 'UniqueSequenceNum'), parent: tag(l, 'ParentLineNum'), supp: tag(l, 'SupplementNum'),
    desc: tag(l, 'LineDesc'), memo: tag(l, 'LineMemo'),
    op: tag(block(l, 'LaborInfo'), 'LaborOperation'), hours: tag(block(l, 'LaborInfo'), 'LaborHours'), laborType: tag(block(l, 'LaborInfo'), 'LaborType'),
    partType: tag(block(l, 'PartInfo'), 'PartType'), glass: /true/i.test(tag(block(l, 'PartInfo'), 'GlassPartInd')), partNum: tag(block(l, 'PartInfo'), 'PartNum'),
    sublet: /true/i.test(tag(block(l, 'SubletInfo'), 'PartSubletInd')),
  }))
  return {
    documentId: tag(doc, 'DocumentID'), version: tag(block(doc, 'DocumentVer'), 'DocumentVerNum') || '0', verCode: tag(block(doc, 'DocumentVer'), 'DocumentVerCode'),
    status: tag(doc, 'DocumentStatus'), ro: tag(block(doc, 'ReferenceInfo'), 'RepairOrderID'),
    shop: tag(block(shop, 'OrgInfo'), 'CompanyName'), shopId: tag(block(shop, 'IDInfo'), 'IDNum'), shopPhone: tag(shop, 'CommPhone'), shopCity: tag(shop, 'City'),
    insurer: tag(block(ins, 'OrgInfo'), 'CompanyName'), estimator: [tag(est, 'FirstName'), tag(est, 'LastName')].filter(Boolean).join(' '), estimatorEmail: tag(est, 'CommEmail'),
    claim: tag(block(xml, 'ClaimInfo'), 'ClaimNum'),
    vin: vins.find(v => /^[A-HJ-NPR-Z0-9]{17}$/.test(v)) || vins[0] || '',
    year: tag(veh, 'ModelYear'), make: tag(veh, 'MakeDesc'), model: tag(veh, 'ModelName'),
    poi: [tag(block(xml, 'PrimaryPOI'), 'POICode'), tag(block(xml, 'SecondaryPOI'), 'POICode')].filter(Boolean),
    lines,
  }
}

/** One text line per estimate line, the way a printed CCC estimate reads. */
export function bmsToText(e) {
  const head = [
    // Minimum necessary to the AI (CCC standards §4.1): no claim number, no people. RO/claim come back from CCC's own fields.
    `Repair facility: ${e.shop}${e.shopCity ? ` (${e.shopCity})` : ''}`, `Insurance: ${e.insurer}`,
    `Vehicle: ${[e.year, e.make, e.model].filter(Boolean).join(' ')}`, `VIN: ${e.vin}`,
    `Estimate version: ${e.verCode === 'SV' ? `Supplement ${e.version}` : 'Original'}${e.status === 'C' ? ' (locked)' : ' (preliminary)'}`,
    e.poi.length ? `Point of impact codes: ${e.poi.join(', ')}` : '',
    'NOTE: CCC Secure Share does not send the vehicle option list. Judge which ADAS systems this vehicle carries from the year/make/model/VIN and the estimate lines themselves.',
  ].filter(Boolean).join('\n')
  const body = e.lines.map(l => [
    l.line || '?', OPS[l.op] ?? l.op ?? '', l.desc, [PARTS[l.partType] || l.partType, l.glass && l.partType !== 'PAG' ? 'GLASS' : '', l.sublet && l.partType !== 'PAS' ? 'SUBLET' : ''].filter(Boolean).join(', '),
    l.hours ? `${l.hours} hr` : '', [l.supp && l.supp !== '0' ? `S${String(l.supp).padStart(2, '0')}` : '', l.memo].filter(Boolean).join(' · '),
  ].join(' | ')).join('\n')
  return `${head}\n\nLINES:\n${body}`
}

/** Scrub one queued CCC item (item.file = the saved XML in WorkDrive). Throws on failure (the queue retries). */
export async function scrubCccItem(req, item) {
  const { getAccessToken } = await import('./zoho.js'); const { downloadFile } = await import('./workdrive.js')
  const { buffer } = await downloadFile(item.file, await getAccessToken())
  const xml = Buffer.from(buffer).toString('utf8')
  const e = parseBms(xml)
  if (!e.lines.length) throw new Error('no damage lines in the BMS message')
  const text = bmsToText(e)
  const t0 = Date.now()
  const meta = { shop: e.shop, ro_number: e.ro, claim: e.claim, insurer: e.insurer, vin: e.vin, year: e.year, make: e.make, model: e.model }
  const { nothingToCalibrate, adasSignature, noAdasResult } = await import('./fastPath.js')
  const sig = adasSignature(text)
  const sigKey = e.documentId ? `ccc_sig_${String(e.documentId).replace(/[^A-Za-z0-9-]/g, '').slice(0, 60)}` : ''
  const prev = sigKey ? await cfgRead(req, sigKey) : null
  const fast = nothingToCalibrate(text)
  let data, how = 'full'
  if (fast.skip && /honda|acura|mazda|nissan|infiniti/i.test(e.make || '')) fast.skip = false   // Honda: weight sensor check after any collision — never 'nothing to calibrate'
  if (fast.skip) {
    // ⚡ No line touches anything ADAS lives on — no AI read needed.
    data = noAdasResult(meta); how = 'fast: no ADAS lines'
  } else if (prev?.value?.sig === sig && prev?.value?.scrubId) {
    // ⚡ Supplement/re-save with the same ADAS lines as the last version — reuse it.
    try {
      const { getScrub } = await import('./scrubStore.js')
      const old = await getScrub(req, prev.value.scrubId)
      if (old?.payload?.calibrations) { data = { ...old.payload, ...meta, _reused: prev.value.scrubId }; how = 'reused: no ADAS change since last version' }
    } catch { data = null }
  }
  if (!data) {
    let oemRefs = ''
    try { const { oemReferenceBlock } = await import('./positionStatements.js'); oemRefs = await oemReferenceBlock(req, { make: e.make }) } catch { oemRefs = '' }
    const { triggerLines, guardScrub } = await import('./scrubGuard.js')
    const hitsPromise = triggerLines('', { text }); hitsPromise.catch(() => {})
    const { extractFromCccText } = await import('./claude.js')
    const vinP = (e.vin && e.vin.length === 17)
      ? import('./estimator/vin.js').then(V => V.vinEquipment(req, e.vin)).catch(() => null)
      : Promise.resolve(null)
    const equip = await Promise.race([vinP, new Promise(r => setTimeout(() => r(null), 400))])
    data = await extractFromCccText(`${equip ? equip.block + '\n\n' : ''}${text}`, { oemRefs })
    if (equip) data.vin_equipment = equip.summary
    // CCC's own fields beat anything read back by the model.
    Object.assign(data, { shop: e.shop || data.shop, ro_number: e.ro || data.ro_number, claim: e.claim || data.claim, insurer: e.insurer || data.insurer, vin: (e.vin.length === 17 ? e.vin : data.vin) || e.vin, year: e.year || data.year, make: e.make || data.make, model: e.model || data.model })
    data._pdfType = 'CCC'
    try { await guardScrub(data, '', { hitsPromise, text }) } catch (err) { console.warn('[ccc scrub] guard skipped:', err.message) }
  }
  data.vehicle = [data.year, data.make, data.model].filter(Boolean).join(' ')
  const { saveScrub } = await import('./scrubStore.js')
  const saved = await saveScrub(req, { data, source: 'ccc', by: 'CCC Secure Share', sourceSystem: 'CCC', sourceRef: `${e.documentId}#${e.verCode || 'EM'}${e.version}`, file: { id: item.file, name: item.name }, status: how === 'full' ? 'ok' : how.split(':')[0] })
  if (sigKey && saved?.id) { try { await cfgWrite(req, sigKey, prev?.row, { sig, scrubId: saved.id, ver: `${e.verCode || 'EM'}${e.version}`, at: new Date().toISOString() }) } catch { /* fine */ } }
  try { const { flush } = await import('./spend.js'); await flush(req) } catch { /* fine */ }
  const req_ = (data.calibrations || []).filter(c => c.enabled === true).map(c => c.calibration_name)
  const secs = Math.round((Date.now() - t0) / 1000)
  console.log(`[ccc scrub] ${e.shop} · ${data.vehicle} · RO ${e.ro} · ${req_.length} required · ${secs}s · ${how}`)
  try {
    const { postToCliqChannel, DISPATCH_CHANNEL } = await import('./cliq.js')
    await postToCliqChannel(DISPATCH_CHANNEL, `📥 *CCC estimate scrubbed* · ${e.shop}${data.vehicle ? ` · ${data.vehicle}` : ''}${e.ro ? ` · RO ${e.ro}` : ''}${e.verCode === 'SV' ? ` · supplement ${e.version}` : ''}\n${req_.length ? `🔧 ${req_.join(', ')}` : '🔧 No calibrations required'}${how !== 'full' ? ` · ⚡ ${how}` : ''} · in the Scrub Library`)
  } catch { /* fine */ }
  return { ok: true, scrubId: saved?.id || '', required: req_, seconds: secs, shop: e.shop, ro: e.ro, how }
}

// Small AppConfig helpers (supplement fingerprints per CCC estimate).
async function cfgRead(req, key) {
  const catalyst = (await import('zcatalyst-sdk-node')).default
  try { const rows = await catalyst.initialize(req, { type: 'advancedio' }).zcql().executeZCQLQuery(`SELECT ROWID, config_value FROM AppConfig WHERE config_key = '${key}' ORDER BY MODIFIEDTIME DESC LIMIT 1`); const r = rows?.[0]?.AppConfig; if (!r) return null; let v = null; try { v = JSON.parse(r.config_value) } catch { v = null } return { row: String(r.ROWID), value: v } } catch { return null }
}
async function cfgWrite(req, key, row, value) {
  const catalyst = (await import('zcatalyst-sdk-node')).default
  const t = catalyst.initialize(req, { type: 'advancedio' }).datastore().table('AppConfig')
  if (row) await t.updateRow({ ROWID: row, config_key: key, config_value: JSON.stringify(value) }); else await t.insertRow({ config_key: key, config_value: JSON.stringify(value) })
}
