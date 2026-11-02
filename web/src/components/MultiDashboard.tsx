import { useId, useState } from 'react'

import { fmtHours, hours, weekSeconds, yMax, type Entry } from '../lib/data'
import { shortLabel } from '../lib/dates'
import {
  barWidths, entriesOf, expectedHours, hoursState, isWeekend, monthDays, monthLabel, monthsOf, nextSort, pageMonth, percent, sortByPercent,
  totalHours, workdays, WORKDAY_HOURS, type SortMode, type UserState,
} from '../lib/multi'
import { DayList } from './DayList'
import { ErrorNote } from './ui'

type Row = { u: UserState; byDay: Map<string, Entry[]>; total: number; pct: number | null }

const SORT_LABEL: Record<SortMode, string> = { entered: 'Order: entered', asc: 'Sort by %: low to high', desc: 'Sort by %: high to low' }

export function MultiDashboard({ from, to, users }: { from: string; to: string; users: UserState[] }) {
  const wd = workdays(from, to)
  const expected = expectedHours(from, to)
  const months = monthsOf(from, to)
  const base: Row[] = users.map((u) => {
    const byDay = entriesOf(u)
    const total = totalHours(byDay, from, to)
    return { u, byDay, total, pct: u.error ? null : percent(total, expected) }
  })
  const [sort, setSort] = useState<SortMode>('entered')
  const rows = sortByPercent(base, sort)
  const [open, setOpen] = useState<Set<string>>(() => new Set(users.length ? [users[0].author] : []))
  const [selected, setSelected] = useState<string | undefined>(users[0]?.author)
  const [monthIdx, setMonthIdx] = useState<Record<string, number>>({})
  const idxOf = (a: string) => monthIdx[a] ?? 0

  function toggle(a: string) {
    const next = new Set(open)
    if (next.has(a)) next.delete(a)
    else {
      next.add(a)
      setSelected(a)
    }
    setOpen(next)
  }
  const sel = rows.find((r) => r.u.author === selected)
  const selMonth = sel ? months[idxOf(sel.u.author)] : undefined
  const selDays = selMonth ? monthDays(selMonth, from, to) : []

  return (
    <div className="results-grid with-days multi">
      <div className="results-main">
        <div className="card range-line">
          <span><span className="muted">From:</span> <strong>{from}</strong></span>
          <span><span className="muted">To:</span> <strong>{to}</strong></span>
          <span>
            <span className="muted">Workdays:</span> <strong>{wd}</strong> ({wd} x {WORKDAY_HOURS} h)
          </span>
        </div>
        <div className="row toolbar no-print">
          <button type="button" className="btn small" onClick={() => setOpen(new Set(rows.map((r) => r.u.author)))}>Expand all</button>
          <button type="button" className="btn small" onClick={() => setOpen(new Set())}>Collapse all</button>
          <button type="button" className="btn small" onClick={() => setSort(nextSort(sort))} aria-label={`${SORT_LABEL[sort]}. Click to change`}>
            {SORT_LABEL[sort]}
          </button>
          <button type="button" className="btn small push" onClick={() => window.print()}>Export PDF</button>
        </div>
        {rows.map((r) => (
          <Section
            key={r.u.author}
            row={r}
            from={from}
            to={to}
            expected={expected}
            months={months}
            monthIndex={idxOf(r.u.author)}
            onMonth={(d) => setMonthIdx({ ...monthIdx, [r.u.author]: pageMonth(idxOf(r.u.author), d, months.length) })}
            open={open.has(r.u.author)}
            selected={r.u.author === selected}
            onToggle={() => toggle(r.u.author)}
          />
        ))}
      </div>
      <aside className="card days no-print">
        <h3 className="days-title">{sel ? `Tasks: ${sel.u.author}` : 'Tasks'}</h3>
        {sel && selMonth && <p className="muted days-sub">{monthLabel(selMonth)}</p>}
        {sel && !sel.u.error && <DayList byDay={sel.byDay} days={selDays} skipEmpty label={`Tasks of ${sel.u.author}`} />}
        {sel?.u.error && <p className="muted">No tasks: {sel.u.error}</p>}
        {!sel && <p className="muted">Expand a user to see the tasks.</p>}
      </aside>
    </div>
  )
}

type SectionProps = {
  row: Row
  from: string
  to: string
  expected: number
  months: string[]
  monthIndex: number
  onMonth: (delta: number) => void
  open: boolean
  selected: boolean
  onToggle: () => void
}

function Section({ row, from, to, expected, months, monthIndex, onMonth, open, selected, onToggle }: SectionProps) {
  const id = useId()
  const { u, byDay, total, pct } = row
  const state = hoursState(pct)
  return (
    <section className={`card user-sec${selected ? ' selected' : ''}${open ? ' open' : ''}`}>
      <button type="button" className="sec-head" aria-expanded={open} aria-controls={id} onClick={onToggle}>
        <svg className="chev" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M9 6l6 6-6 6" />
        </svg>
        <span className="u-name">
          {u.displayName && <strong>{u.displayName} </strong>}
          <span className={u.displayName ? 'muted' : ''}>{u.author}</span>
        </span>
        <span className="u-sum">
          {u.error ? (
            <span className="pct over">Error</span>
          ) : (
            <>
              Hours worked: <strong>{total.toFixed(1)} h / {expected} h</strong>{' '}
              {pct !== null && <strong className={state === 'over' ? 'pct over' : 'pct'}>({pct.toFixed(1)}%)</strong>}
            </>
          )}
        </span>
      </button>
      {/* Graph 1 sits just after the click target (not inside it), so it shows collapsed and expanded and the button's name stays short. */}
      {!u.error && (
        <div className="sec-bar">
          <ProgressBar total={total} expected={expected} pct={pct} state={state} />
        </div>
      )}
      <div id={id} className="sec-body" hidden={!open}>
        {u.error ? (
          <ErrorNote error={u.error} />
        ) : (
          <>
            <div>
              <h3>Hours per day</h3>
              <div className="no-print-block">
                <div className="mnav">
                  <button type="button" className="btn small" disabled={monthIndex === 0} onClick={() => onMonth(-1)}>‹ Prev</button>
                  <span className="lbl" aria-live="polite">{monthLabel(months[monthIndex])}</span>
                  <button type="button" className="btn small" disabled={monthIndex === months.length - 1} onClick={() => onMonth(1)}>Next ›</button>
                </div>
                <MonthChart byDay={byDay} month={months[monthIndex]} from={from} to={to} />
              </div>
              {/* Print: every month of the range, stacked. */}
              <div className="print-only">
                {months.map((m) => (
                  <div key={m} className="print-month">
                    <strong>{monthLabel(m)}</strong>
                    <MonthChart byDay={byDay} month={m} from={from} to={to} />
                  </div>
                ))}
              </div>
            </div>
          </>
        )}
      </div>
    </section>
  )
}

/** Graph 1: hours vs expected. Green up to 100%, amber under 50%; above 100% the red excess overlays the green from the left. */
export function ProgressBar({ total, expected, pct, state }: { total: number; expected: number; pct: number | null; state: ReturnType<typeof hoursState> }) {
  const { green, red } = barWidths(pct)
  const over = Math.max(0, total - expected)
  const track = (
    <div
      className="pbar"
      role="img"
      aria-label={pct === null ? `${total.toFixed(1)} hours, no expected hours` : `${pct}% of ${expected} expected hours${red > 0 ? `, ${(pct - 100).toFixed(1)}% over` : ''}`}
    >
      <div className={`fill ${state}`} style={{ width: `${green}%` }} />
      {red > 0 && <div className="excess" style={{ width: `${red}%` }} />}
    </div>
  )
  return (
    <div>
      {track}
      <div className="pbar-labels">
        <span>{total.toFixed(1)} h worked{pct !== null && ` (${pct.toFixed(1)}%)`}</span>
        {over > 0 ? <span className="over">+{over.toFixed(1)} h over{pct !== null && ` (+${(pct - 100).toFixed(1)}%)`}</span> : <span>{Math.max(0, expected - total).toFixed(1)} h remaining</span>}
        <span>expected {expected} h</span>
      </div>
    </div>
  )
}

const W = 640
const H = 230
const M = { top: 12, right: 12, bottom: 26, left: 34 }

/** Line chart of the hours per day of one month (days inside the range only); weekends shaded, real hours plotted. */
export function MonthChart({ byDay, month, from, to }: { byDay: Map<string, Entry[]>; month: string; from: string; to: string }) {
  const [hover, setHover] = useState<number | null>(null)
  const days = monthDays(month, from, to)
  const pts = days.map((d) => ({ d, h: hours(weekSeconds(byDay, [d])) }))
  const max = yMax(byDay, days)
  const step = max > 20 ? 4 : 2
  const ticks = Array.from({ length: Math.floor(max / step) + 1 }, (_, i) => i * step)
  const n = Math.max(1, days.length - 1)
  const x = (i: number) => M.left + (days.length === 1 ? (W - M.left - M.right) / 2 : (i / n) * (W - M.left - M.right))
  const y = (h: number) => M.top + (1 - h / max) * (H - M.top - M.bottom)
  const bw = (W - M.left - M.right) / Math.max(1, days.length)
  const path = pts.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)} ${y(p.h).toFixed(1)}`).join(' ')
  const labelEvery = Math.ceil(days.length / 10)
  const peak = pts.reduce((a, p) => (p.h > a.h ? p : a), pts[0])
  const summary = `Hours per day, ${monthLabel(month)}: ${pts.reduce((a, p) => a + p.h, 0).toFixed(1)} h in total, busiest day ${shortLabel(peak.d)} with ${fmtHours(peak.h * 3600)}`
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
        <line className="ref" x1={M.left} x2={W - M.right} y1={y(8)} y2={y(8)} />
        <text className="axis" x={W - M.right} y={y(8) - 4} textAnchor="end">8 h</text>
        <path className="area" d={`${path} L${x(pts.length - 1)} ${y(0)} L${x(0)} ${y(0)}Z`} />
        <path className="line" d={path} />
        {pts.map((p, i) => p.h > 0 && <circle key={p.d} className="dot" cx={x(i)} cy={y(p.h)} r={2.6} />)}
        {pts.map((p, i) => (i % labelEvery === 0 || i === pts.length - 1) && (
          <text key={p.d} className="axis" x={x(i)} y={H - 8} textAnchor="middle">{+p.d.slice(8)}</text>
        ))}
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
