export const ORANGE = '#CD4419'

export const STAGES = [
  // Mark's own stages (2026-09-15). Ids stay what the app has always used so
  // every shop keeps its place; only the words and the order changed.
  { id: 'target',     label: 'Not contacted',                    emoji: '🎯', color: '#7c3aed', bg: '#ede9fe' },
  { id: 'contacted',  label: 'Contacted',                        emoji: '📞', color: '#b45309', bg: '#fef3c7' },
  { id: 'interested', label: 'Shown interest',                   emoji: '🤝', color: '#0e7490', bg: '#cffafe' },
  { id: 'proposal',   label: 'High value offer · free demo',     emoji: '🎁', color: '#c2410c', bg: '#fff7ed' },
  { id: 'active',     label: 'Current customer',                 emoji: '✅', color: '#15803d', bg: '#dcfce7' },
  { id: 'active2',    label: 'Own ADAS guy · we are backup',     emoji: '🔄', color: '#0369a1', bg: '#e0f2fe' },
  { id: 'denied',     label: 'Own ADAS guy · not interested',    emoji: '🚫', color: '#b91c1c', bg: '#fee2e2' },
  { id: 'lost',       label: 'Lost',                             emoji: '❌', color: '#6b7280', bg: '#f3f4f6' },
]
// Max quiet days per stage before a shop shows on the Monday list (null = no clock; denied gets a 90-day check-back)
export const STAGE_QUIET = { target: 30, contacted: 14, interested: 10, proposal: 5, active: 30, active2: 45, denied: 90, lost: null, trial: 5, dormant: 90 }
export const IN_PLAY_STAGES = ['contacted', 'interested', 'proposal']
export const IN_PLAY_CAP = 10
export const STAGE_EXIT = { target: 'Nobody has talked to them yet', contacted: 'We reached them; find the decision maker', interested: 'They asked questions or want to see more', proposal: 'High value offer or free calibration demo on the table', active: 'They send us cars', active2: 'They have their own ADAS guy; we are the backup — tag who', denied: 'They have their own ADAS guy and are not interested right now — tag who' }
// Stages where "who do they use" matters (competitor tag on the card)
export const COMPETITOR_STAGES = ['active2', 'denied', 'lost']

export const ACTIVITY_TYPES = [
  { id: 'call',    label: 'Call',    icon: '📞', color: '#15803d', bg: '#dcfce7' },
  { id: 'visit',   label: 'Visit',   icon: '🚗', color: '#1d4ed8', bg: '#dbeafe' },
  { id: 'email',   label: 'Email',   icon: '✉️',  color: '#7c3aed', bg: '#ede9fe' },
  { id: 'meeting', label: 'Meeting', icon: '🤝', color: '#b45309', bg: '#fef3c7' },
  { id: 'note',    label: 'Note',    icon: '📝', color: '#6b7280', bg: '#f3f4f6' },
]

export const TITLES = [
  'Owner', 'General Manager', 'Service Manager', 'Service Advisor',
  'Estimator', 'Parts Manager', 'Receptionist', 'Accounting',
  'Technician', 'Detailer', 'Other',
]

export const REFERRAL_SOURCES = [
  'Cold Call', 'Cold Visit', 'Google', 'Referral', 'Trade Show', 'Social Media', 'Other',
]

export const LOST_REASONS = [
  'Price too high', 'Using competitor', 'No ADAS volume', 'Not interested', 'No response', 'Other',
]

export const DENIED_REASONS = [
  'Happy with current provider', 'Price too high', 'Not enough volume',
  'Do their own calibrations', 'Not interested', 'No response', 'Other',
]

// Known competitors — shown in Lost/Denied stage competitor pickers
export const DEFAULT_COMPETITORS = [
  // Mark 2026-09-15: the calibration companies we run into. AVSC = Audio Visual, Redmond.
  'Evergreen Calibration', 'AVSC', 'MOS', 'ATE', 'ProTech',
  'Reighn Calibrations', 'Airbag Services', 'Ivan',
]

// Six I-5 zones, Bellingham → Olympia (2026-09-15). Stored in the shop's `region`.
export const ZONES = [
  { id: 'north',     label: 'North',       owner: 'Jayden', day: 'Mon' },
  { id: 'snohomish', label: 'Snohomish',   owner: 'Jayden', day: 'Tue · Thu' },
  { id: 'eastside',  label: 'Eastside',    owner: 'Mark',   day: 'Wed' },
  { id: 'seattle',   label: 'Seattle',     owner: 'Mark',   day: 'Thu' },
  { id: 'south',     label: 'South Sound', owner: 'Mark',   day: 'Fri (alt)' },
  { id: 'olympia',   label: 'Olympia',     owner: 'Mark',   day: 'Fri (alt)' },
]
export const REGIONS = ZONES.map(z => z.id)
export const zoneLabel = id => ZONES.find(z => z.id === id)?.label || id || ''

export const TEAM_MEMBERS = ['Mark', 'Jayden']

// Substitutes {shop_name}, {contact_name}, {contact_first} in template strings
export function fillTemplate(text, shop) {
  const contactName  = shop.people?.[0]?.name || ''
  const contactFirst = contactName.split(' ')[0] || contactName
  return text
    .replace(/\{shop_name\}/g,    shop.shop_name    || 'your shop')
    .replace(/\{contact_name\}/g, contactName       || 'there')
    .replace(/\{contact_first\}/g, contactFirst     || 'there')
    .replace(/\{phone\}/g,        shop.phone        || '')
    .replace(/\{region\}/g,       zoneLabel(shop.region) || 'your area')
}

export const TEMPLATES = [
  {
    id: 'first_text',
    label: 'First Contact — Text',
    scenario: 'Reaching out cold',
    channel: 'sms',
    icon: '💬',
    text: `Hi {contact_first}! My name's Mark with Absolute ADAS. We handle ADAS calibrations for body shops in {region} — same day, fully certified. Would love to connect!`,
  },
  {
    id: 'first_email',
    label: 'First Contact — Email',
    scenario: 'Reaching out cold',
    channel: 'email',
    subject: 'ADAS Calibrations for {shop_name}',
    icon: '✉️',
    text: `Hi {contact_first},\n\nMy name is Mark Fowler with Absolute ADAS. We specialize in ADAS calibrations exclusively for body shops like {shop_name}.\n\nWe're same-day, mobile, and fully OEM-certified — no hassle for your team.\n\nI'd love to stop by and introduce myself. Would this week work?\n\nMark Fowler\nAbsolute ADAS\n(your number here)`,
  },
  {
    id: 'followup_visit',
    label: 'Follow-Up After Visit',
    scenario: 'After stopping by',
    channel: 'sms',
    icon: '🚗',
    text: `Hey {contact_first}, great meeting you today at {shop_name}! We're ready to take your ADAS work whenever you are. Just send us the RO and we handle everything. Any questions?`,
  },
  {
    id: 'proposal_followup',
    label: 'Proposal Follow-Up',
    scenario: 'After sending pricing',
    channel: 'sms',
    icon: '📋',
    text: `Hi {contact_first}, just checking in on the ADAS proposal I sent over. Happy to answer any questions or set up a quick demo. What are your thoughts?`,
  },
  {
    id: 'reengage',
    label: 'Re-Engagement',
    scenario: 'Haven\'t heard back',
    channel: 'sms',
    icon: '🔄',
    text: `Hey {contact_first}! It's Mark from Absolute ADAS — been a while! Hope things are good at {shop_name}. We've been growing and wanted to reconnect. Any ADAS work we can help with?`,
  },
  {
    id: 'welcome',
    label: 'Welcome New Customer',
    scenario: 'Just went Active',
    channel: 'email',
    subject: 'Welcome to Absolute ADAS!',
    icon: '🎉',
    text: `Hi {contact_first},\n\nWelcome aboard! We're thrilled to be partnering with {shop_name}.\n\nOur team is ready to handle all your calibration needs — just send us the RO and vehicle info and we'll take it from there. We're same-day and fully certified.\n\nLooking forward to working together!\n\nMark Fowler\nAbsolute ADAS`,
  },
  {
    id: 'annual_checkin',
    label: 'Annual Check-In',
    scenario: '3x per year touchbase',
    channel: 'email',
    subject: 'Checking In — Absolute ADAS',
    icon: '📅',
    text: `Hi {contact_first},\n\nJust wanted to reach out and say hello — it's Mark from Absolute ADAS.\n\nHope things are going great at {shop_name}. We've been growing our team and expanding our capabilities. If you ever need fast, certified ADAS calibrations, we're here.\n\nLet me know if there's anything we can do for you!\n\nMark Fowler\nAbsolute ADAS`,
  },
]
