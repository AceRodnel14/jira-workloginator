import { useEffect, useRef } from 'react'

import { dayHeading, taskLine, taskRows, type ColourSlot, type Entry } from '../lib/data'

type Props = {
  byDay: Map<string, Entry[]>
  days: string[]
  /** Hide days without logs (the /multiple task list). */
  skipEmpty?: boolean
  /** The day hovered in the chart: scrolled into view and highlighted. */
  activeDay?: string | null
  /** Colour slot per ticket of the active day (the segment colours of the hovered bar). */
  highlight?: Map<string, ColourSlot>
  label?: string
}

/** Tasks by day: `<hours> <KEY> <title>`. The active day's ticket lines carry their chart-segment colour. */
export function DayList({ byDay, days, skipEmpty, activeDay, highlight, label = 'Worklogs by day' }: Props) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const box = ref.current
    const row = activeDay ? box?.querySelector<HTMLElement>(`[data-day="${activeDay}"]`) : null
    if (!box || !row) return
    // Scroll the list itself, never the page.
    const top = row.getBoundingClientRect().top - box.getBoundingClientRect().top + box.scrollTop
    box.scrollTop = Math.max(0, top - 4)
  }, [activeDay])
  return (
    <div ref={ref} className="daylist" role="region" aria-label={label} tabIndex={0}>
      {days.map((d) => {
        const list = taskRows(byDay.get(d))
        if (skipEmpty && list.length === 0) return null
        return (
          <div key={d} data-day={d} className={`dayrow${d === activeDay ? ' active' : ''}`}>
            <div className="dayhead">{dayHeading(d)}</div>
            {list.length === 0 && <div className="muted">no logs</div>}
            {list.map((e) => {
              const c = d === activeDay ? highlight?.get(e.key) : undefined
              return (
                <div key={e.key} className="taskline">
                  {c && <span className={`swatch s${c.slot}${c.repeat ? ' repeat' : ''}`} aria-hidden="true" />}
                  <span>{taskLine(e)}</span>
                </div>
              )
            })}
          </div>
        )
      })}
    </div>
  )
}
