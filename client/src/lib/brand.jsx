// Absolute ADAS colors from absoluteadas.com (grabbed 2026-10-09).
// Nav/body #0A0A0A, CTA #CD4419, hover #B33A15, Inter on the site.
// The app stays IBM Plex + cream so the shop tool stays readable.
// Tokens live in brandTokens.js (no JSX) so chunked screens can import
// them without a circular boot crash.
import { BRAND } from './brandTokens.js'
export { BRAND }

export function BrandBar() {
  return (
    <header style={{ backgroundColor: BRAND.ink, color: BRAND.white }}>
      <div className="max-w-5xl mx-auto px-4 sm:px-6 py-3 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 min-w-0">
          <img src={import.meta.env.BASE_URL + 'logo.png'} alt="" className="w-8 h-8 object-contain flex-shrink-0" />
          <span className="text-sm font-extrabold tracking-tight truncate">
            Absolute <span style={{ color: BRAND.orange }}>ADAS</span>
          </span>
        </div>
        <a href={`tel:${BRAND.phoneDigits}`} className="text-xs sm:text-sm font-bold flex-shrink-0"
          style={{ color: BRAND.orange }}>
          {BRAND.phone}
        </a>
      </div>
    </header>
  )
}

export function PublicFooter() {
  return (
    <footer className="text-center text-xs py-6 px-4" style={{ color: BRAND.muted }}>
      Absolute ADAS · Mobile ADAS calibration · Western Washington
      <br />
      <a href={`tel:${BRAND.phoneDigits}`} style={{ color: BRAND.orange, fontWeight: 700 }}>{BRAND.phone}</a>
      {' · '}
      <a href={`https://${BRAND.site}`} style={{ color: BRAND.muted }}>{BRAND.site}</a>
    </footer>
  )
}
