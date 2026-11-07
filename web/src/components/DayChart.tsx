import { useState } from 'react'

import { fmtHours, hours, weekSeconds, yMax, type Entry } from '../lib/data'
import { shortLabel } from '../lib/dates'
import { isWeekend } from '../lib/multi'

const W = 640
const H = 230
const M = { top: 12, right: 12, bottom: 26, left: 34 }
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const SHORT_RANGE = 31 // up to this many days every ~10th day is labelled with its day number
const NO_DOTS_ABOVE = 62

/** Axis labels for a long range: month starts ("1 Nov") plus a few evenly spaced days, kept a full step away from any month start (so labels stay >= 48 viewBox units apart up to ~120 days). */
function longLabels(days: string[]): Map<number, string> {
  const name = (d: string) => `${+d.slice(8)} ${MONTHS[+d.slice(5, 7) - 1]}`
  const starts = days.flatMap((d, i) => (d.endsWith('-01') ? [i] : []))
  const out = new Map<number, string>()
  if (starts.length >= 6) {
    const stride = Math.ceil(starts.length / 12)
    starts.forEach((i, k) => k % stride === 0 && out.set(i, name(days[i])))
    return out
  }
  const step = Math.ceil(days.length / 8)
  starts.forEach((i) => out.set(i, name(days[i])))
  for (let i = 0; i < days.length; i += step) {
    if (starts.every((s) => Math.abs(s - i) >= step)) out.set(i, name(days[i]))
  }
  return out
}

/** Line chart of the hours per day over `days` (any length up to a year); weekends shaded, real hours plotted. */
export function DayChart({ byDay, days, label, refHours = 8 }: { byDay: Map<string, Entry[]>; days: string[]; label: string; refHours?: number }) {
  const [hover, setHover] = useState<number | null>(null)
  const pts = days.map((d) => ({ d, h: hours(weekSeconds(byDay, [d])) }))
  const max = yMax(byDay, days, refHours)
  const step = max > 20 ? 4 : max <= 6 ? 1 : 2
  const ticks = Array.from({ length: Math.floor(max / step) + 1 }, (_, i) => i * step)
  const n = Math.max(1, days.length - 1)
  const x = (i: number) => M.left + (days.length === 1 ? (W - M.left - M.right) / 2 : (i / n) * (W - M.left - M.right))
  const y = (h: number) => M.top + (1 - h / max) * (H - M.top - M.bottom)
  const bw = (W - M.left - M.right) / Math.max(1, days.length)
  const path = pts.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)} ${y(p.h).toFixed(1)}`).join(' ')
  const long = days.length > SHORT_RANGE
  const labelEvery = Math.ceil(days.length / 10)
  const longMap = long ? longLabels(days) : null
  const labelAt = (i: number): string | null =>
    longMap ? (longMap.get(i) ?? null) : i % labelEvery === 0 || i === pts.length - 1 ? String(+pts[i].d.slice(8)) : null
  const peak = pts.reduce((a, p) => (p.h > a.h ? p : a), pts[0])
  const summary = `Hours per day, ${label}: ${pts.reduce((a, p) => a + p.h, 0).toFixed(1)} h in total, busiest day ${shortLabel(peak.d)} with ${fmtHours(peak.h * 3600)}`
  const hp = hover === null ? null : pts[hover]
  return (
    <div className="lc-wrap">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={summary} className="lc">
        {ticks.map((t) => (
          <g key={t}>
            <line className="grid" x1={M.left} x2={W - M.right} y1={y(t)} y2={y(t)} />
            <text className="axis" x={M.left - 6} y={y(t)} textAnchor="end" dominantBaseline="middle">{t}</text>
          </g>
        ))}
        {pts.map((p, i) => isWeekend(p.d) && <rect key={p.d} className="wk" x={x(i) - bw / 2} y={M.top} width={bw} height={H - M.top - M.bottom} />)}
        <line className="ref" x1={M.left} x2={W - M.right} y1={y(refHours)} y2={y(refHours)} />
        <text className="axis" x={W - M.right} y={y(refHours) - 4} textAnchor="end">{refHours} h</text>
        <path className="area" d={`${path} L${x(pts.length - 1)} ${y(0)} L${x(0)} ${y(0)}Z`} />
        <path className="line" d={path} />
        {days.length <= NO_DOTS_ABOVE && pts.map((p, i) => p.h > 0 && <circle key={p.d} className="dot" cx={x(i)} cy={y(p.h)} r={2.6} />)}
        {pts.map((p, i) => {
          const t = labelAt(i)
          return t && <text key={p.d} className="axis" x={x(i)} y={H - 8} textAnchor="middle">{t}</text>
        })}
        {hp && <circle className="focus" cx={x(hover!)} cy={y(hp.h)} r={5} />}
        {pts.map((p, i) => (
          <rect
            key={p.d}
            className="hit"
            x={x(i) - bw / 2}
            y={M.top}
            width={bw}
            height={H - M.top - M.bottom}
            onMouseEnter={() => setHover(i)}
            onMouseLeave={() => setHover((h) => (h === i ? null : h))}
          />
        ))}
      </svg>
      {hp && (
        <div className="tooltip" role="tooltip" style={{ left: `${Math.min(85, Math.max(15, (x(hover!) / W) * 100))}%` }}>
          <strong>{shortLabel(hp.d)}</strong>
          <div className="tt-row"><span className="tt-text">Hours</span><span className="tt-h">{fmtHours(hp.h * 3600)}</span></div>
        </div>
      )}
    </div>
  )
}
