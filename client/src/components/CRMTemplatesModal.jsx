import { useState } from 'react'
import { ORANGE, TEMPLATES, fillTemplate } from './crmConstants.js'

export default function CRMTemplatesModal({ shop, onClose }) {
  const [selected, setSelected] = useState(null)

  const t = selected ? TEMPLATES.find(t => t.id === selected) : null
  const filled = t ? {
    text:    fillTemplate(t.text, shop),
    subject: t.subject ? fillTemplate(t.subject, shop) : '',
  } : null

  const contactPhone = shop.people?.[0]?.phone || shop.phone || ''
  const contactEmail = shop.people?.[0]?.email || shop.email || ''

  function handleSend(channel) {
    if (!t || !filled) return
    if (channel === 'sms') {
      const body = encodeURIComponent(filled.text)
      window.open(`sms:${contactPhone}&body=${body}`, '_blank')
    } else {
      const to      = encodeURIComponent(contactEmail)
      const subject = encodeURIComponent(filled.subject || t.label)
      const body    = encodeURIComponent(filled.text)
      window.open(`mailto:${to}?subject=${subject}&body=${body}`, '_blank')
    }
  }

  function copyText() {
    if (!filled) return
    navigator.clipboard.writeText(filled.text).catch(() => {})
  }

  return (
    <div className="fixed inset-0 z-[70] flex items-end sm:items-center justify-center"
      style={{ backgroundColor: 'rgba(0,0,0,0.5)' }}
      onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="w-full sm:max-w-lg bg-white overflow-hidden shadow-2xl"
        style={{ maxHeight: '90vh', display: 'flex', flexDirection: 'column', borderRadius: '20px 20px 0 0' }}>

        <div className="flex justify-center pt-3 pb-1 sm:hidden">
          <div className="w-10 h-1 rounded-full" style={{ backgroundColor: '#ddd' }} />
        </div>

        <div className="flex items-center justify-between px-5 py-4" style={{ borderBottom: '1px solid #ebebeb' }}>
          <div>
            <h2 className="text-base font-bold" style={{ color: '#1a1a1a' }}>Message Templates</h2>
            <p className="text-xs mt-0.5" style={{ color: '#888' }}>{shop.shop_name}</p>
          </div>
          <button onClick={onClose} className="w-8 h-8 rounded-full flex items-center justify-center"
            style={{ backgroundColor: '#f5f3f0', color: '#888' }}>✕</button>
        </div>

        <div className="flex-1 overflow-y-auto">
          {/* Template list */}
          {!selected && (
            <div className="p-4 space-y-2">
              {TEMPLATES.map(tmpl => (
                <button key={tmpl.id} onClick={() => setSelected(tmpl.id)}
                  className="w-full text-left p-3 rounded-xl transition-colors hover:bg-gray-50"
                  style={{ border: '1px solid #ebebeb' }}>
                  <div className="flex items-center gap-3">
                    <span className="text-xl flex-shrink-0">{tmpl.icon}</span>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold" style={{ color: '#1a1a1a' }}>{tmpl.label}</p>
                      <p className="text-xs mt-0.5" style={{ color: '#888' }}>{tmpl.scenario}</p>
                    </div>
                    <span className="text-xs px-2 py-0.5 rounded-full flex-shrink-0"
                      style={{ backgroundColor: tmpl.channel === 'sms' ? '#dcfce7' : '#ede9fe',
                        color: tmpl.channel === 'sms' ? '#15803d' : '#7c3aed' }}>
                      {tmpl.channel === 'sms' ? '💬 Text' : '✉️ Email'}
                    </span>
                  </div>
                </button>
              ))}
            </div>
          )}

          {/* Preview */}
          {selected && filled && (
            <div className="p-4">
              <button onClick={() => setSelected(null)}
                className="flex items-center gap-1.5 text-xs font-medium mb-4" style={{ color: '#888' }}>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                  <path d="M19 12H5M12 5l-7 7 7 7"/>
                </svg>
                Back to templates
              </button>

              {filled.subject && (
                <div className="mb-3">
                  <p className="text-xs font-semibold text-gray-400 mb-1 uppercase tracking-wide">Subject</p>
                  <p className="text-sm font-medium p-3 rounded-xl" style={{ backgroundColor: '#f9f8f7', color: '#1a1a1a' }}>
                    {filled.subject}
                  </p>
                </div>
              )}

              <div className="mb-4">
                <p className="text-xs font-semibold text-gray-400 mb-1 uppercase tracking-wide">Message</p>
                <pre className="text-sm p-3 rounded-xl whitespace-pre-wrap font-sans leading-relaxed"
                  style={{ backgroundColor: '#f9f8f7', color: '#1a1a1a', border: '1px solid #ebebeb' }}>
                  {filled.text}
                </pre>
              </div>

              <button onClick={copyText}
                className="w-full text-sm font-medium py-2 rounded-xl mb-3"
                style={{ backgroundColor: '#f5f3f0', color: '#555' }}>
                📋 Copy to clipboard
              </button>

              <div className="grid grid-cols-2 gap-2">
                {(contactPhone || t.channel === 'sms') && (
                  <button onClick={() => handleSend('sms')}
                    className="flex items-center justify-center gap-2 py-3 rounded-xl text-sm font-semibold"
                    style={{ backgroundColor: '#dcfce7', color: '#15803d' }}>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
                    </svg>
                    Open in Text
                  </button>
                )}
                {(contactEmail || t.channel === 'email') && (
                  <button onClick={() => handleSend('email')}
                    className="flex items-center justify-center gap-2 py-3 rounded-xl text-sm font-semibold"
                    style={{ backgroundColor: '#ede9fe', color: '#7c3aed' }}>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/>
                      <polyline points="22,6 12,13 2,6"/>
                    </svg>
                    Open in Email
                  </button>
                )}
              </div>

              {!contactPhone && !contactEmail && (
                <p className="text-xs text-center mt-3" style={{ color: '#aaa' }}>
                  Add a phone or email to this shop to send directly
                </p>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
