/** The app's mark: blue arrows around a clock. Fixed colours (same drawing as public/favicon.svg, minus the title). */
export function Logo({ height = 32 }: { height?: number }) {
  return (
    <svg className="logo" viewBox="0 0 48 48" height={height} width={height} aria-hidden="true" focusable="false">
      <path d="M8 21 L20.5 6.8 L23.5 12.5 L15.5 21 Z" fill="#fff" stroke="#0052CC" strokeWidth="1" strokeLinejoin="round"/>
      <path d="M27 40 L41.2 27.5 L35.5 24.5 L27 32.5 Z" fill="#fff" stroke="#0052CC" strokeWidth="1" strokeLinejoin="round"/>
      <path fill="#2684FF" d="M5.5,22.9722h0a8.7361,8.7361,0,0,0,8.7361,8.7361h2.0556v2.0556A8.7361,8.7361,0,0,0,25.0278,42.5h0V22.9722Z"/>
      <path fill="#2684FF" d="M22.9722,5.5h0a8.7361,8.7361,0,0,0,8.7361,8.7361h2.0556v2.0556A8.7361,8.7361,0,0,0,42.5,25.0278h0V5.5Z"/>
      <circle cx="24" cy="24" r="9.6" fill="#fff"/>
      <circle cx="24" cy="24" r="8.2" fill="#0052CC"/>
      <path d="M24 17.6v1.6M30.4 24h-1.6M24 30.4v-1.6M17.6 24h1.6" stroke="#fff" strokeWidth="1.4" strokeLinecap="round"/>
      <path d="M24 19V24H28" fill="none" stroke="#fff" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  )
}
