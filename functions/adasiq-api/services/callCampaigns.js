// Call campaigns for the 3 PM slot (Facebook, Instagram, LinkedIn).
//
// Every day: one father-and-son post.
// Monday–Friday: an insurance-ready post as well.
// Saturday–Sunday: father-and-son only.
//
// Copy is the approved bank. F2 stays off the schedule (it still needs
// Jayden's answer). Each post gets a REAL photo under a code-typeset headline
// (2026-10-24): father-and-son posts rotate through the Father & Son WorkDrive
// folder (curated picks in VanKV family_brand.picks, else every IMG_*.jpeg
// original), insurance posts rotate the van photo library. The same card goes
// to Facebook, Instagram and LinkedIn. No AI lettering anywhere. If no photo
// can be built, Instagram falls back to the plain "Father and son." card and
// Facebook/LinkedIn post text.
//
// Idempotent per Pacific date. A retry will not post a platform that
// already succeeded, and it will not post a platform whose send was
// claimed but never recorded (that one may already be live).
//
// Hold is off. Mark approved the examples on 2026-10-23, so the 3 PM run
// may publish. The hold was not a same-day skip.

const CTA = 'Call or text 1-844-FIX-ADAS.'
const SIGNOFF = 'Father and son. Same day. Done right.'

// Monday of the week the bank starts. Oct 23, 2026 is that week's Friday.
const EPOCH = '2026-10-19'
const STATE_KEY = (dateStr) => `call_campaign_${dateStr}`

// Mark approved the examples on 2026-10-23. The 3 PM run may publish.
export const AWAITING_EXAMPLE_APPROVAL = false

function finish(body) {
  return `${String(body || '').trim()}\n\n${CTA}\n\n${SIGNOFF}`
}

function utcDate(dateStr) {
  const [y, m, d] = String(dateStr).split('-').map(Number)
  return Date.UTC(y, m - 1, d)
}

function isWeekdayDate(dateStr) {
  const dow = new Date(utcDate(dateStr)).getUTCDay()
  return dow >= 1 && dow <= 5
}

// Weekdays from EPOCH through dateStr, inclusive. 0 on the epoch Monday.
function weekdayIndex(dateStr) {
  const start = utcDate(EPOCH)
  const end = utcDate(dateStr)
  let n = 0
  for (let t = start; t <= end; t += 86400000) {
    const dow = new Date(t).getUTCDay()
    if (dow >= 1 && dow <= 5) n++
  }
  return n - 1
}

export const HELD_POSTS = [
  {
    id: 'f2',
    reason: 'Needs Jayden\'s real answer. The draft still says [Jayden\'s answer]. Not scheduled.',
  },
]

// F1, F3, F4. F2 is held.
export const FAMILY_POSTS = [
  {
    id: 'f1',
    title: 'Who shows up',
    text: finish(`Shop owners: who is actually showing up to calibrate your cars?

At Absolute ADAS it is me or my son Jayden. No rotating crew. No stranger in a rented van.

We own this company. Our name is on every calibration, so if a car comes back, it comes back to us. That is why it doesn't.

New to us? Your first car is free if you are not happy with it.`),
  },
  {
    id: 'f3',
    title: 'Our name, your car',
    text: finish(`Every report we hand you has our name on it. Not a franchise name. Ours.

When my son and I sign off on a calibration, we are putting the family on the line. So we do it to the car maker's procedure, every time, and we document it so you get paid.

If a calibration we recommended gets denied, you don't pay us.`),
  },
  {
    id: 'f4',
    title: 'Small on purpose',
    text: finish(`We are not a call center with a fleet you never meet. We are a family shop with two vans.

That means you text us, we answer. You need it today, we route to you. You have a question at 4 PM, you get a real answer.`),
  },
]

export const INSURANCE_POSTS = [
  {
    id: 'w1-mon',
    title: 'ADAS Maps',
    text: finish(`Estimators: you can request Absolute ADAS right inside ADAS Maps. Pull up the car, pick Absolute ADAS, and we're on it. We're a preferred vendor for State Farm, Allstate, USAA, GEICO, and Progressive. Car ready by noon? Most days it's calibrated the same day, with the OEM printout the adjuster wants.`),
  },
  {
    id: 'w1-tue',
    title: 'State Farm',
    text: finish(`State Farm claim and a camera to calibrate? We're a State Farm preferred vendor. Priced to State Farm's schedule. Documented the way State Farm pays. You don't chase the supplement. We built the paperwork for it.`),
  },
  {
    id: 'w1-wed',
    title: 'The denied calibration',
    text: finish(`Shop owners: how many calibrations did you eat this year because the carrier said no? We only recommend what the car maker requires and we document it the way carriers pay. If a calibration we recommended still gets denied, you don't pay us. That's the Absolute Promise.`),
  },
  {
    id: 'w1-thu',
    title: 'Allstate + Kinetic',
    text: finish(`Allstate claim? We're an Allstate preferred vendor too. Every estimate runs through more than one scrubber, including Kinetic, an Allstate-preferred scrubber. The calibrations on the bill are the ones Allstate expects to see.`),
  },
  {
    id: 'w1-fri',
    title: 'Same day',
    text: finish(`Car's promised Monday and the cal isn't done? Text the van by noon. Most days it drives out today, with the paperwork in your folder before we leave the lot.`),
  },
  {
    id: 'w2-mon',
    title: 'Scrubbers',
    text: finish(`A missed calibration costs you twice. Once when the car comes back. Again when nobody pays for it. We run every estimate through multiple scrubbers, Kinetic included. If the car maker requires it, we catch it before the car is done. Not after.`),
  },
  {
    id: 'w2-tue',
    title: 'ADAS Maps, next car',
    text: finish(`Already on ADAS Maps for State Farm or Allstate? Next car, request Absolute ADAS. If you're not happy with that first one, it's free.`),
  },
  {
    id: 'w2-wed',
    title: 'Any carrier',
    text: finish(`Whose claim is it? Doesn't matter to us. We're a preferred vendor for State Farm, Allstate, USAA, GEICO, and Progressive. State Farm, Allstate, and GEICO jobs are priced to their schedules. Every job gets the same OEM printout and calibration ID report, so the adjuster has nothing to argue with.`),
  },
  {
    id: 'w2-thu',
    title: 'Growing',
    text: finish(`October 2025: one van. Today: two vans and about 65 shops, dealers and repair businesses from Bellingham to Olympia. We grew one way. Show up the same day, do it right, get the shop paid.`),
  },
  {
    id: 'w2-fri',
    title: 'We fight it with you',
    text: finish(`Carrier pushing back on a calibration? You're not on your own. We document every job the way insurers want it, and if a carrier pushes back, we fight it with you.`),
  },
  {
    id: 'w3-mon',
    title: 'State Farm, part 2',
    text: finish(`On a State Farm job, the calibration report matters as much as the calibration. As a State Farm preferred vendor, we hand you both: the OEM procedure done, and the paperwork that gets it paid.`),
  },
  {
    id: 'w3-tue',
    title: 'Before the supplement',
    text: finish(`Want to know every calibration a car needs before you write the supplement? Send us the estimate. We scrub it through multiple scrubbers, Kinetic included, and tell you what the car maker requires.`),
  },
  {
    id: 'w3-wed',
    title: 'Allstate, part 2',
    text: finish(`Allstate preferred vendor. Kinetic, an Allstate-preferred scrubber, in our estimate check. Same-day calibration in your bay. That's the whole pitch.`),
  },
  {
    id: 'w3-thu',
    title: 'Rental clock',
    text: finish(`Every day a car waits on one calibration is another rental day on the claim. Text the van by noon and it goes back today, most days.`),
  },
  {
    id: 'w3-fri',
    title: 'The Promise, part 2',
    text: finish(`We guarantee you get paid for every calibration we recommend. If it's recommended, done and still denied, you don't pay us. No other fine print.`),
  },
]

export function pickCallCampaigns(dateStr) {
  const dayIndex = Math.round((utcDate(dateStr) - utcDate(EPOCH)) / 86400000)
  const family = FAMILY_POSTS[((dayIndex % FAMILY_POSTS.length) + FAMILY_POSTS.length) % FAMILY_POSTS.length]
  const weekday = isWeekdayDate(dateStr)
  const insurance = weekday
    ? INSURANCE_POSTS[((weekdayIndex(dateStr) % INSURANCE_POSTS.length) + INSURANCE_POSTS.length) % INSURANCE_POSTS.length]
    : null
  return {
    date: dateStr,
    weekday,
    family: { id: family.id, title: family.title, text: family.text },
    insurance: insurance ? { id: insurance.id, title: insurance.title, text: insurance.text } : null,
  }
}

function blankResults() {
  return { facebook: null, instagram: null, linkedin: null }
}

function needsSend(rec) {
  if (!rec) return true
  if (rec.ok) return false
  // Claimed and not yet recorded: the post may already be live. Do not retry.
  if (rec.claimed && rec.ok == null) return false
  return true
}

async function postPlatform(platform, text, imageUrl) {
  if (platform === 'facebook') {
    const { postTextToFacebookPage, postToFacebookPage } = await import('./metaPosting.js')
    return imageUrl ? postToFacebookPage({ imageUrl, caption: text }) : postTextToFacebookPage({ message: text })
  }
  if (platform === 'linkedin') {
    const { postToLinkedIn, postImageToLinkedIn } = await import('./brewLinkedIn.js')
    const r = imageUrl ? await postImageToLinkedIn({ imageUrl, text }) : await postToLinkedIn({ text })
    if (r?.dryRun) return { ok: false, error: 'linkedin_not_configured' }
    return r
  }
  if (platform === 'instagram') {
    if (!imageUrl) return { ok: false, error: 'no_image' }
    const { postToInstagram } = await import('./metaPosting.js')
    return postToInstagram({ imageUrl, caption: text })
  }
  return { ok: false, error: 'unknown_platform' }
}

async function ensureImage(dateStr) {
  const { composeAdCardImage } = await import('./absoluteAdCardImage.js')
  const { commitBinaryFile } = await import('./brewArchive.js')
  const sharp = (await import('sharp')).default
  const blank = await sharp({
    create: { width: 1080, height: 1080, channels: 3, background: '#141414' },
  }).png().toBuffer()
  const png = await composeAdCardImage({
    photoBuffer: blank,
    imageHeadline: 'Father and son.',
  })
  const uploaded = await commitBinaryFile({
    path: `absolute-ad/call-campaign-${dateStr}.png`,
    buffer: png,
    message: `Absolute ADAS call campaign card ${dateStr}`,
  })
  if (!uploaded?.ok || !uploaded.rawUrl) {
    return { ok: false, error: uploaded?.error || 'image_upload_failed' }
  }
  return { ok: true, url: uploaded.rawUrl }
}

const FAMILY_ROTATION_KEY = 'family_photo_rotation'
const VAN_ROTATION_KEY = 'call_campaign_van_rotation'

async function familyPhotoIds(req) {
  const { getVal } = await import('./vanDatastore.js')
  const brand = (await getVal(req, 'family_brand').catch(() => null)) || {}
  if (Array.isArray(brand.picks) && brand.picks.length) return brand.picks
  if (!brand.photos_folder_id) return []
  const { getAccessToken } = await import('./zoho.js')
  const { listChildren } = await import('./workdrive.js')
  const items = await listChildren(brand.photos_folder_id, await getAccessToken(), { folders: false })
  // Originals only: skips WorkDrive's timestamped duplicates and the AI concept PNGs.
  return (items || []).filter(f => /^IMG_\d+\.(jpe?g|heic)$/i.test(f.name)).map(f => f.id)
}

async function pickFamilyPhoto(req, { peek = false, id: forceId = null } = {}) {
  const ids = await familyPhotoIds(req)
  if (!ids.length) return null
  const { getVal, setVal } = await import('./vanDatastore.js')
  const rot = (await getVal(req, FAMILY_ROTATION_KEY).catch(() => null)) || {}
  const id = forceId || [...ids].sort((a, b) => ((rot[a] || 0) - (rot[b] || 0)) || String(a).localeCompare(String(b)))[0]
  const { downloadVanPhoto } = await import('./vanPhotoLibrary.js')
  const { buffer } = await downloadVanPhoto(id)
  if (!peek) {
    rot[id] = Date.now()
    for (const k of Object.keys(rot)) if (!ids.includes(k)) delete rot[k]
    await setVal(req, FAMILY_ROTATION_KEY, rot).catch(() => {})
  }
  return { id, buffer }
}

// Phone originals are ~12 MP; full-size sharp work has taken the function
// down before. Shrink first, then take a square. topBias 0.25 keeps faces in
// people shots; vans sit lower in frame (0.30).
async function squareForCard(buffer, topBias) {
  const sharp = (await import('sharp')).default
  const small = await sharp(buffer).rotate().resize(1600, 1600, { fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 92 }).toBuffer()
  const m = await sharp(small).metadata()
  const side = Math.min(m.width, m.height)
  return sharp(small)
    .extract({ left: Math.round((m.width - side) / 2), top: Math.round((m.height - side) * topBias), width: side, height: side })
    .resize(1080, 1080).jpeg({ quality: 90 }).toBuffer()
}

export async function buildSlotImage(req, dateStr, slotName, title, opts = {}) {
  let photo = null
  let source = null
  if (slotName === 'family') {
    const p = await pickFamilyPhoto(req, opts).catch(() => null)
    if (p) { photo = await squareForCard(p.buffer, 0.25); source = `family:${p.id}` }
  }
  if (!photo) {
    const { pickNextVanPhotoDatastore } = await import('./vanPhotoLibrary.js')
    const v = await pickNextVanPhotoDatastore(req, VAN_ROTATION_KEY).catch(() => null)
    if (v?.buffer) { photo = await squareForCard(v.buffer, 0.30); source = `van:${v.name}` }
  }
  if (!photo) return { ok: false, error: 'no_photo' }
  const { composeAdCardImage } = await import('./absoluteAdCardImage.js')
  const png = await composeAdCardImage({ photoBuffer: photo, imageHeadline: title })
  const { uploadImageToCloudinary, cloudinaryImageConfigured } = await import('./cloudinaryImage.js')
  if (cloudinaryImageConfigured()) {
    const sharp = (await import('sharp')).default
    const jpg = await sharp(png).jpeg({ quality: 90 }).toBuffer()
    const up = await uploadImageToCloudinary({ buffer: jpg, publicId: `call-campaign-${dateStr}-${slotName}` })
    if (up.ok) return { ok: true, url: up.url, source }
  }
  const { commitBinaryFile } = await import('./brewArchive.js')
  const c = await commitBinaryFile({ path: `absolute-ad/call-campaign-${dateStr}-${slotName}.png`, buffer: png, message: `Call campaign card ${dateStr} ${slotName}` })
  return c?.ok && c.rawUrl ? { ok: true, url: c.rawUrl, source } : { ok: false, error: c?.error || 'image_upload_failed' }
}

async function publishSlot(req, setVal, key, state, slotName) {
  const slot = state[slotName]
  if (!slot?.text) return
  const todo = []
  const slotImage = state.images?.[slotName] || state.image_url || null
  for (const platform of ['facebook', 'linkedin', 'instagram']) {
    if (platform === 'instagram' && !slotImage) continue
    if (!needsSend(state.results[slotName][platform])) continue
    state.results[slotName][platform] = { claimed: true, at: new Date().toISOString() }
    todo.push(platform)
  }
  if (!todo.length) return
  await setVal(req, key, state)
  await Promise.all(todo.map(async (platform) => {
    let result
    try {
      result = await postPlatform(platform, slot.text, slotImage)
    } catch (e) {
      result = { ok: false, error: e.message }
    }
    state.results[slotName][platform] = {
      claimed: true,
      ok: Boolean(result?.ok),
      id: result?.id || null,
      error: result?.ok ? null : (result?.error || 'post_failed'),
      at: new Date().toISOString(),
    }
  }))
  await setVal(req, key, state)
}

function slotDone(results, slotName, wantInstagram) {
  const row = results?.[slotName]
  if (!row?.facebook?.ok || !row?.linkedin?.ok) return false
  if (wantInstagram && !row?.instagram?.ok) return false
  return true
}

export async function publishCallCampaigns(req) {
  if (AWAITING_EXAMPLE_APPROVAL) {
    return { ok: true, skipped: true, reason: 'awaiting_example_approval' }
  }

  const { isMarketingPaused } = await import('./marketingKillSwitch.js')
  if (await isMarketingPaused(req, 'social')) {
    return { ok: true, skipped: true, reason: 'marketing_paused' }
  }

  const dateStr = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' })
  const picked = pickCallCampaigns(dateStr)
  const key = STATE_KEY(dateStr)
  const { getVal, setVal } = await import('./vanDatastore.js')

  let state = await getVal(req, key).catch(() => null)
  if (!state || state.date !== dateStr) {
    state = {
      date: dateStr,
      weekday: picked.weekday,
      family: picked.family,
      insurance: picked.insurance,
      image_url: null,
      image_error: null,
      results: { family: blankResults(), insurance: blankResults() },
      created_at: new Date().toISOString(),
    }
    await setVal(req, key, state)
  }

  const postingAge = state.posting_at ? Date.now() - Date.parse(state.posting_at) : Infinity
  if (state.status === 'posting' && postingAge < 3 * 60 * 1000) {
    return { ok: true, skipped: true, reason: 'in_flight', date: dateStr }
  }
  state.status = 'posting'
  state.posting_at = new Date().toISOString()
  await setVal(req, key, state)

  // Lock the copy chosen for this date. A retry uses the same text.
  if (!state.family?.text) state.family = picked.family
  if (picked.insurance && !state.insurance?.text) state.insurance = picked.insurance
  if (!state.results) state.results = { family: blankResults(), insurance: blankResults() }
  if (!state.results.family) state.results.family = blankResults()
  if (!state.results.insurance) state.results.insurance = blankResults()

  if (!state.images) state.images = {}
  for (const slotName of ['family', 'insurance']) {
    const slot = state[slotName]
    if (!slot?.text || state.images[slotName]) continue
    const built = await buildSlotImage(req, dateStr, slotName, slot.title || 'Same day. Done right.').catch(e => ({ ok: false, error: e.message }))
    if (built.ok) {
      state.images[slotName] = built.url
      state.image_sources = { ...(state.image_sources || {}), [slotName]: built.source }
    } else {
      state.image_errors = { ...(state.image_errors || {}), [slotName]: built.error }
    }
    await setVal(req, key, state)
  }

  const needFallbackCard = ['family', 'insurance'].some(s => state[s]?.text && !state.images[s])
  if (needFallbackCard && !state.image_url) {
    const image = await ensureImage(dateStr).catch(e => ({ ok: false, error: e.message }))
    if (image.ok) {
      state.image_url = image.url
      state.image_error = null
    } else {
      state.image_error = image.error || 'image_failed'
    }
    await setVal(req, key, state)
  }

  const before = JSON.stringify(state.results)
  await publishSlot(req, setVal, key, state, 'family')
  if (state.insurance?.text) await publishSlot(req, setVal, key, state, 'insurance')
  const postedSomething = JSON.stringify(state.results) !== before

  const familyDone = slotDone(state.results, 'family', true)
  const insuranceDone = state.insurance?.text ? slotDone(state.results, 'insurance', true) : true
  state.status = familyDone && insuranceDone ? 'published' : 'partial'
  state.updated_at = new Date().toISOString()
  await setVal(req, key, state)

  if (postedSomething) {
    try {
      const { postToCliqChannelById, MARK_ALERT_CHANNEL_ID } = await import('./cliq.js')
      const line = (name, row) => {
        if (!row) return null
        const bit = (p) => row[p]?.ok ? 'ok' : (row[p]?.error || (row[p]?.claimed ? 'claimed' : 'skipped'))
        return `${name}: Facebook ${bit('facebook')}, Instagram ${bit('instagram')}, LinkedIn ${bit('linkedin')}`
      }
      const msg = [
        state.status === 'published'
          ? `Call campaigns posted ${dateStr}`
          : `Call campaigns partial ${dateStr}`,
        line(state.family?.title || 'Family', state.results.family),
        state.insurance?.text ? line(state.insurance?.title || 'Insurance', state.results.insurance) : 'Insurance: weekend, not scheduled',
        state.image_sources ? `Photos: ${Object.entries(state.image_sources).map(([k, v]) => `${k} ${v}`).join(', ')}` : '',
        state.image_error ? `Instagram card: ${state.image_error}` : '',
      ].filter(Boolean).join('\n').slice(0, 1500)
      await postToCliqChannelById(MARK_ALERT_CHANNEL_ID, msg).catch(() => {})
    } catch { /* alert is not the post */ }
  }

  return {
    ok: state.status === 'published',
    skipped: !postedSomething && state.status === 'published',
    reason: !postedSomething && state.status === 'published' ? 'already_posted' : undefined,
    date: dateStr,
    family_id: state.family?.id || null,
    insurance_id: state.insurance?.id || null,
    status: state.status,
    image: Boolean(state.image_url || Object.keys(state.images || {}).length),
    images: state.images || {},
  }
}
