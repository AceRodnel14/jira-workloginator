import { useState } from 'react'

import { addDays, clampWeek, mondayOf, shortLabel, weekDays } from '../lib/dates'
import { assignColours, daySegments, fmtHours, hours, splitSegments, weekSeconds, yMax, type Entry } from '../lib/data'

const W = 720
const H = 320
const M = { top: 12, right: 12, bottom: 34, left: 40 }
const PW = W - M.left - M.right
const PH = H - M.top - M.bottom
const GAP = 2

type Props = {
  byDay: Map<string, Entry[]>
  from: string
  to: string
  monday: string
  onWeek: (monday: string) => void
}

export function WeekChart({ byDay, from, to, monday, onWeek }: Props) {
  const [active, setActive] = useState<string | null>(null)
  const days = weekDays(monday)
  const colours = assignColours(byDay, days)
  const max = yMax(byDay, days)
  const step = max > 20 ? 4 : 2
  const ticks = Array.from({ length: Math.floor(max / step) + 1 }, (_, i) => i * step)
  const slot = PW / 7
  const barW = Math.min(56, slot * 0.6)
  const y = (h: number) => M.top + PH - (h / max) * PH
  const atFirst = monday <= mondayOf(from)
  const atLast = monday >= mondayOf(to)
  const activeIdx = active ? days.indexOf(active) : -1
  const activeSegs = active ? daySegments(byDay.get(active)) : []
  const activeTotal = active ? weekSeconds(byDay, [active]) : 0

  return (
    <div className="chart">
      <div className="row between chart-nav">
        <button type="button" className="btn small" disabled={atFirst} onClick={() => onWeek(clampWeek(monday, -1, from, to))}>
          Prev
        </button>
        <strong>
          {monday} .. {addDays(monday, 6)}: {fmtHours(weekSeconds(byDay, days))}
        </strong>
        <button type="button" className="btn small" disabled={atLast} onClick={() => onWeek(clampWeek(monday, 1, from, to))}>
          Next
        </button>
      </div>
      <div className="chart-wrap">
        <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Hours per day, week of ${monday}`} data-testid="week-chart">
          {ticks.map((t) => (
            <g key={t}>
              <line className="grid" x1={M.left} x2={W - M.right} y1={y(t)} y2={y(t)} />
              <text className="axis" x={M.left - 6} y={y(t)} textAnchor="end" dominantBaseline="middle">
                {t}
              </text>
            </g>
          ))}
          <text className="axis" x={4} y={M.top - 2} dominantBaseline="hanging">h</text>
          {days.map((d, i) => {
            const inRange = d >= from && d <= to
            const cx = M.left + slot * i + slot / 2
            const x = cx - barW / 2
            const segs = daySegments(byDay.get(d))
            const total = weekSeconds(byDay, [d])
            const split = active === d
            const label = `${shortLabel(d)}: ${fmtHours(total)}`
            return (
              <g
                key={d}
                className={inRange ? 'day' : 'day dim'}
                tabIndex={inRange ? 0 : undefined}
                role={inRange ? 'img' : undefined}
                aria-label={inRange ? label : undefined}
                data-day={d}
                onMouseEnter={() => inRange && setActive(d)}
                onMouseLeave={() => setActive((a) => (a === d ? null : a))}
                onFocus={() => inRange && setActive(d)}
                onBlur={() => setActive((a) => (a === d ? null : a))}
              >
                {inRange && <rect className="hit" x={cx - slot / 2} y={M.top} width={slot} height={PH} />}
                {inRange && total > 0 && !split && <rect className="bar solid" x={x} y={y(hours(total))} width={barW} height={PH - (y(hours(total)) - M.top)} rx={3} />}
                {inRange &&
                  split &&
                  splitSegments(segs, colours, y, GAP).map((g) => (
                    <rect key={g.key} className={`seg s${g.slot}${g.repeat ? ' repeat' : ''}`} x={x} y={g.y} width={barW} height={g.height} rx={2} />
                  ))}
                <text className={`axis${inRange ? '' : ' dimmed'}`} x={cx} y={H - 12} textAnchor="middle">
                  {shortLabel(d)}
                </text>
              </g>
            )
          })}
        </svg>
        {active && activeIdx >= 0 && (
          <div
            className="tooltip"
            role="tooltip"
            style={{ left: `${Math.min(80, Math.max(20, ((M.left + slot * activeIdx + slot / 2) / W) * 100))}%` }}
          >
            <strong>{shortLabel(active)}</strong>
            {activeSegs.length === 0 && <div className="muted">no logs</div>}
            {activeSegs.map((s) => {
              const c = colours.get(s.key)!
              return (
                <div key={s.key} className="tt-row">
                  <span className={`swatch s${c.slot}`} aria-hidden="true" />
                  <span className="tt-text">
                    {s.key} {s.summary}
                  </span>
                  <span className="tt-h">{fmtHours(s.seconds)}</span>
                </div>
              )
            })}
            {activeSegs.length > 0 && <div className="tt-total">Total {fmtHours(activeTotal)}</div>}
          </div>
        )}
      </div>
    </div>
  )
}
