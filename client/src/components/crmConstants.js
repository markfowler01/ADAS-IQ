export const ORANGE = '#CD4419'

export const STAGES = [
  { id: 'target',     label: 'Targets',    emoji: '🎯', color: '#7c3aed', bg: '#ede9fe' },
  { id: 'contacted',  label: 'Contacted',  emoji: '📞', color: '#b45309', bg: '#fef3c7' },
  { id: 'interested', label: 'Interested', emoji: '🤝', color: '#0e7490', bg: '#cffafe' },
  { id: 'proposal',   label: 'Proposal',   emoji: '📋', color: '#c2410c', bg: '#fff7ed' },
  { id: 'active2',    label: 'Second Active', emoji: '🔄', color: '#0e7490', bg: '#cffafe' },
  { id: 'active',     label: 'Active',     emoji: '✅', color: '#15803d', bg: '#dcfce7' },
  { id: 'denied',     label: 'Denied',     emoji: '🚫', color: '#b91c1c', bg: '#fee2e2' },
  { id: 'lost',       label: 'Lost',       emoji: '❌', color: '#6b7280', bg: '#f3f4f6' },
]

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
  'AVSC', 'MOS', 'ATE', 'Evergreen', 'Ivan',
  'Airbag Services', 'Reighn Calibrations', 'ProTech',
]

export const REGIONS = [
  'Dallas', 'Fort Worth', 'Houston', 'Austin', 'San Antonio',
  'Oklahoma City', 'Tulsa', 'Other',
]

export const TEAM_MEMBERS = ['Mark', 'Jaden']

// Substitutes {shop_name}, {contact_name}, {contact_first} in template strings
export function fillTemplate(text, shop) {
  const contactName  = shop.people?.[0]?.name || ''
  const contactFirst = contactName.split(' ')[0] || contactName
  return text
    .replace(/\{shop_name\}/g,    shop.shop_name    || 'your shop')
    .replace(/\{contact_name\}/g, contactName       || 'there')
    .replace(/\{contact_first\}/g, contactFirst     || 'there')
    .replace(/\{phone\}/g,        shop.phone        || '')
    .replace(/\{region\}/g,       shop.region       || 'your area')
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
