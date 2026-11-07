import { useId, useState } from 'react'

import type { Entry } from '../lib/data'
import {
  barWidths, entriesOf, expectedHours, expectedText, hoursState, monthDays, monthLabel, monthsOf, nextSort, nonWorkingEdit, printCompact, pageMonth, percent, sortByPercent,
  totalHours, workdays, WORKDAY_HOURS, type SortMode, type UserState,
} from '../lib/multi'
import { DayChart } from './DayChart'
import { DayList } from './DayList'
import { ErrorNote } from './ui'

type Row = { u: UserState; byDay: Map<string, Entry[]>; total: number; pct: number | null; nonWorking: number; expected: number }

const SORT_LABEL: Record<SortMode, string> = { entered: 'Order: entered', asc: 'Sort by %: low to high', desc: 'Sort by %: high to low' }

/** workHours is the value the data was fetched with. Non-working days are per user, not persisted, and reset with a new fetch (this component is remounted). */
export function MultiDashboard({ from, to, users, workHours = WORKDAY_HOURS }: { from: string; to: string; users: UserState[]; workHours?: number }) {
  const wd = workdays(from, to)
  const [nonWorking, setNonWorking] = useState<Record<string, number>>({})
  const months = monthsOf(from, to)
  const base: Row[] = users.map((u) => {
    const byDay = entriesOf(u)
    const total = totalHours(byDay, from, to)
    const nw = nonWorking[u.author] ?? 0
    const expected = expectedHours(from, to, workHours, nw)
    return { u, byDay, total, nonWorking: nw, expected, pct: u.error ? null : percent(total, expected) }
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
            <span className="muted">Workdays:</span> <strong>{wd}</strong> ({wd} × {workHours} h)
          </span>
        </div>
        <div className="row toolbar no-print">
          <button type="button" className="btn small" onClick={() => setOpen(new Set(rows.map((r) => r.u.author)))}>Expand all</button>
          <button type="button" className="btn small" onClick={() => setOpen(new Set())}>Collapse all</button>
          <button type="button" className="btn small" onClick={() => setSort(nextSort(sort))} aria-label={`${SORT_LABEL[sort]}. Click to change`}>
            {SORT_LABEL[sort]}
          </button>
          <button type="button" className="btn small push" onClick={() => window.print()}>Export PDF</button>
          <button type="button" className="btn small" onClick={() => printCompact(window, document.documentElement)}>Export PDF (compact)</button>
        </div>
        {rows.map((r) => (
          <Section
            key={r.u.author}
            row={r}
            from={from}
            to={to}
            wd={wd}
            workHours={workHours}
            onNonWorking={(n) => setNonWorking({ ...nonWorking, [r.u.author]: n })}
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
  wd: number
  workHours: number
  onNonWorking: (n: number) => void
  months: string[]
  monthIndex: number
  onMonth: (delta: number) => void
  open: boolean
  selected: boolean
  onToggle: () => void
}

function Section({ row, from, to, wd, workHours, onNonWorking, months, monthIndex, onMonth, open, selected, onToggle }: SectionProps) {
  const id = useId()
  const { u, byDay, total, pct, expected, nonWorking } = row
  const inputId = useId()
  const textId = useId()
  // While editing, the typed text is kept (an empty field stays empty); blur shows the committed number again.
  const [draft, setDraft] = useState<string | null>(null)
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
          <div className="nw-row">
            <p id={textId} className="nw-text">{expectedText(wd, nonWorking, workHours)}</p>
            <div className="nw-input no-print">
              <label htmlFor={inputId}>Non-working days</label>
              <input
                id={inputId}
                className="input"
                type="number"
                inputMode="numeric"
                min={0}
                max={wd}
                step={1}
                value={draft ?? nonWorking}
                aria-describedby={textId}
                onChange={(e) => {
                  const edit = nonWorkingEdit(e.target.value, wd)
                  onNonWorking(edit.value)
                  setDraft(edit.draft)
                }}
                onBlur={() => setDraft(null)}
              />
            </div>
          </div>
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
                <DayChart byDay={byDay} days={monthDays(months[monthIndex], from, to)} label={monthLabel(months[monthIndex])} refHours={workHours} />
              </div>
              {/* Print: every month of the range, stacked. */}
              <div className="print-only">
                {months.map((m) => (
                  <div key={m} className="print-month">
                    <strong>{monthLabel(m)}</strong>
                    <DayChart byDay={byDay} days={monthDays(m, from, to)} label={monthLabel(m)} refHours={workHours} />
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
