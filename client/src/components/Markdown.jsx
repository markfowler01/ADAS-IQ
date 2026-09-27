// Tiny markdown renderer for runbooks kept as .md next to the code
// (Mark 2026-09-27: the laptop setup runbooks). Handles exactly what those
// documents use — headings, paragraphs, bullet and numbered lists,
// checkboxes, tables, fenced code and inline emphasis. No dependency, because
// the app ships to a phone and a markdown library is not worth the bytes.
const ORANGE = '#CD4419'

function inline(text, key) {
  // `code`, **bold**, and bare links, in one pass.
  const parts = []
  let rest = String(text)
  const re = /(`[^`]+`)|(\*\*[^*]+\*\*)|(https?:\/\/[^\s)]+)/
  let i = 0
  for (;;) {
    const m = rest.match(re)
    if (!m) { if (rest) parts.push(rest); break }
    if (m.index > 0) parts.push(rest.slice(0, m.index))
    const tok = m[0]
    if (tok.startsWith('`')) parts.push(<code key={`${key}c${i}`} style={{ backgroundColor: '#f1ede9', padding: '1px 5px', borderRadius: 4, fontFamily: 'IBM Plex Mono, monospace', fontSize: '.92em' }}>{tok.slice(1, -1)}</code>)
    else if (tok.startsWith('**')) parts.push(<b key={`${key}b${i}`}>{tok.slice(2, -2)}</b>)
    else parts.push(<a key={`${key}a${i}`} href={tok} target="_blank" rel="noreferrer" style={{ color: ORANGE, fontWeight: 700 }}>{tok}</a>)
    rest = rest.slice(m.index + tok.length); i++
  }
  return parts
}

const splitRow = line => line.replace(/^\||\|$/g, '').split('|').map(c => c.trim())

export default function Markdown({ text }) {
  const lines = String(text || '').split('\n')
  const out = []
  let i = 0
  const H = { 1: { size: 22, mt: 4 }, 2: { size: 18, mt: 22 }, 3: { size: 15, mt: 16 }, 4: { size: 14, mt: 12 } }

  while (i < lines.length) {
    const line = lines[i]

    // fenced code
    if (/^```/.test(line)) {
      const lang = line.replace(/^```/, '').trim()
      const body = []
      i++
      while (i < lines.length && !/^```/.test(lines[i])) { body.push(lines[i]); i++ }
      i++
      out.push(
        <div key={`k${i}`} className="rounded-xl overflow-hidden my-3" style={{ border: '1px solid #2d2a28' }}>
          {lang && <div className="px-3 py-1.5 text-[11px] font-bold uppercase" style={{ backgroundColor: '#2d2a28', color: '#d6d3d1', letterSpacing: '.08em' }}>{lang}</div>}
          <pre className="overflow-x-auto" style={{ margin: 0, padding: '12px 14px', backgroundColor: '#1c1917', color: '#e7e5e4', fontFamily: 'IBM Plex Mono, monospace', fontSize: 12.5, lineHeight: 1.55 }}>{body.join('\n')}</pre>
        </div>
      )
      continue
    }

    // table
    if (/^\s*\|/.test(line) && /^\s*\|[\s:-]+\|/.test(lines[i + 1] || '')) {
      const head = splitRow(line)
      i += 2
      const rows = []
      while (i < lines.length && /^\s*\|/.test(lines[i])) { rows.push(splitRow(lines[i])); i++ }
      out.push(
        <div key={`t${i}`} className="overflow-x-auto my-3 rounded-xl" style={{ border: '1px solid #e0dbd6' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13.5 }}>
            <thead><tr>{head.map((h, n) => <th key={n} style={{ textAlign: 'left', padding: '9px 11px', backgroundColor: '#faf9f7', color: '#57534e', fontWeight: 800, borderBottom: '1px solid #e0dbd6', whiteSpace: 'nowrap' }}>{inline(h, `th${n}`)}</th>)}</tr></thead>
            <tbody>{rows.map((r, n) => (
              <tr key={n}>{r.map((c, m) => <td key={m} style={{ padding: '9px 11px', borderTop: '1px solid #f1ede9', color: '#33302e', verticalAlign: 'top' }}>{inline(c, `td${n}_${m}`)}</td>)}</tr>
            ))}</tbody>
          </table>
        </div>
      )
      continue
    }

    // heading
    const h = line.match(/^(#{1,4})\s+(.*)$/)
    if (h) {
      const lvl = h[1].length, st = H[lvl]
      out.push(<div key={`h${i}`} style={{ fontSize: st.size, fontWeight: 800, color: lvl === 1 ? ORANGE : '#1a1a1a', marginTop: st.mt, marginBottom: 6, lineHeight: 1.25 }}>{inline(h[2], `hh${i}`)}</div>)
      i++; continue
    }

    // checkbox
    const cb = line.match(/^\s*[-*]\s+\[( |x|X)\]\s+(.*)$/)
    if (cb) {
      out.push(
        <div key={`c${i}`} className="flex items-start gap-2" style={{ margin: '5px 0' }}>
          <span style={{ flex: '0 0 16px', width: 16, height: 16, marginTop: 2, borderRadius: 4, border: `1.5px solid ${cb[1] === ' ' ? '#c7c2bc' : ORANGE}`, backgroundColor: cb[1] === ' ' ? 'white' : ORANGE, color: 'white', fontSize: 11, lineHeight: '14px', textAlign: 'center', fontWeight: 900 }}>{cb[1] === ' ' ? '' : '✓'}</span>
          <span style={{ fontSize: 14.5, lineHeight: 1.5, color: '#33302e' }}>{inline(cb[2], `cc${i}`)}</span>
        </div>
      )
      i++; continue
    }

    // numbered
    const ol = line.match(/^\s*(\d+)\.\s+(.*)$/)
    if (ol) {
      out.push(
        <div key={`o${i}`} className="flex items-start gap-2" style={{ margin: '5px 0' }}>
          <span style={{ flex: '0 0 22px', color: ORANGE, fontWeight: 800, fontSize: 14 }}>{ol[1]}.</span>
          <span style={{ fontSize: 14.5, lineHeight: 1.5, color: '#33302e' }}>{inline(ol[2], `oo${i}`)}</span>
        </div>
      )
      i++; continue
    }

    // bullet
    const ul = line.match(/^(\s*)[-*]\s+(.*)$/)
    if (ul) {
      out.push(
        <div key={`u${i}`} className="flex items-start gap-2" style={{ margin: '4px 0', paddingLeft: Math.min(ul[1].length, 8) * 2 }}>
          <span style={{ flex: '0 0 10px', color: ORANGE, fontWeight: 900 }}>·</span>
          <span style={{ fontSize: 14.5, lineHeight: 1.5, color: '#33302e' }}>{inline(ul[2], `uu${i}`)}</span>
        </div>
      )
      i++; continue
    }

    // rule
    if (/^\s*---+\s*$/.test(line)) { out.push(<div key={`r${i}`} style={{ height: 1, backgroundColor: '#e0dbd6', margin: '16px 0' }} />); i++; continue }

    if (line.trim()) out.push(<p key={`p${i}`} style={{ fontSize: 14.5, lineHeight: 1.6, color: '#33302e', margin: '8px 0' }}>{inline(line, `pp${i}`)}</p>)
    i++
  }
  return <div>{out}</div>
}
