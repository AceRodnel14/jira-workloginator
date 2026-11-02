import { addDays, clampWeek, mondayOf, shortLabel, weekDays } from '../lib/dates'
import { daySegments, fmtHours, hours, splitSegments, weekSeconds, yMax, type ColourSlot, type Entry } from '../lib/data'

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
  /** Colour slot per ticket of the week (shared with the day list). */
  colours: Map<string, ColourSlot>
  /** The hovered or focused day (its bar is split per ticket and the day list highlights it). */
  active: string | null
  onActive: (day: string | null) => void
}

export function WeekChart({ byDay, from, to, monday, onWeek, colours, active, onActive }: Props) {
  const days = weekDays(monday)
  const max = yMax(byDay, days)
  const step = max > 20 ? 4 : 2
  const ticks = Array.from({ length: Math.floor(max / step) + 1 }, (_, i) => i * step)
  const slot = PW / 7
  const barW = Math.min(56, slot * 0.6)
  const y = (h: number) => M.top + PH - (h / max) * PH
  const activeIdx = active ? days.indexOf(active) : -1
  const activeTotal = active ? weekSeconds(byDay, [active]) : 0
  const atFirst = monday <= mondayOf(from)
  const atLast = monday >= mondayOf(to)

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
                onMouseEnter={() => inRange && onActive(d)}
                onMouseLeave={() => active === d && onActive(null)}
                onFocus={() => inRange && onActive(d)}
                onBlur={() => active === d && onActive(null)}
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
            className="tooltip small"
            role="tooltip"
            style={{ left: `${((M.left + slot * activeIdx + slot / 2) / W) * 100}%`, top: `${(y(hours(activeTotal)) / H) * 100}%` }}
          >
            {shortLabel(active)}: <strong>{fmtHours(activeTotal)}</strong>
          </div>
        )}
      </div>
    </div>
  )
}
