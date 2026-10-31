import type { StreamEvent } from '../api'
import { addDays, rangeDays, weekdayName } from './dates'

export type Issue = Extract<StreamEvent, { type: 'issue' }>

/** One worklog entry placed on its day. */
export type Entry = { key: string; summary: string; start: string; end: string; offset: number; seconds: number }

export function entriesByDay(issues: Issue[]): Map<string, Entry[]> {
  const m = new Map<string, Entry[]>()
  for (const i of issues) {
    for (const w of i.worklogs) {
      const list = m.get(w.date) ?? []
      list.push({ key: i.key, summary: i.summary, start: w.start, end: w.end, offset: w.end_day_offset, seconds: w.seconds })
      m.set(w.date, list)
    }
  }
  for (const list of m.values()) list.sort((a, b) => a.start.localeCompare(b.start) || a.key.localeCompare(b.key))
  return m
}

export type Segment = { key: string; summary: string; seconds: number }

/** Per-ticket seconds on one day, biggest first. */
export function daySegments(entries: Entry[] | undefined): Segment[] {
  const m = new Map<string, Segment>()
  for (const e of entries ?? []) {
    const s = m.get(e.key) ?? { key: e.key, summary: e.summary, seconds: 0 }
    s.seconds += e.seconds
    m.set(e.key, s)
  }
  return [...m.values()].sort((a, b) => b.seconds - a.seconds || a.key.localeCompare(b.key))
}

export const hours = (seconds: number): number => seconds / 3600
export const fmtHours = (seconds: number): string => `${hours(seconds).toFixed(2)}h`

/** Total seconds for the given days. */
export function weekSeconds(byDay: Map<string, Entry[]>, days: string[]): number {
  return days.reduce((t, d) => t + (byDay.get(d) ?? []).reduce((a, e) => a + e.seconds, 0), 0)
}

/** y-axis maximum in hours: max(busiest day, 8) + 2. */
export function yMax(byDay: Map<string, Entry[]>, days: string[]): number {
  const busiest = Math.max(0, ...days.map((d) => hours(weekSeconds(byDay, [d]))))
  return Math.max(busiest, 8) + 2
}

// Validated categorical palette (dataviz skill, light + dark validated). Fixed order.
export const PALETTE_SIZE = 8

export type ColourSlot = { slot: number; repeat: boolean }

/** Colour slot per ticket for a week: by the ticket's weekly hours (desc), repeating after the palette ends. */
export function assignColours(byDay: Map<string, Entry[]>, days: string[]): Map<string, ColourSlot> {
  const totals = new Map<string, number>()
  for (const d of days) for (const e of byDay.get(d) ?? []) totals.set(e.key, (totals.get(e.key) ?? 0) + e.seconds)
  const keys = [...totals.keys()].sort((a, b) => totals.get(b)! - totals.get(a)! || a.localeCompare(b))
  return new Map(keys.map((k, i) => [k, { slot: i % PALETTE_SIZE, repeat: i >= PALETTE_SIZE }]))
}

/** The day list: every day from..to with its logs (or "no logs"). */
export function formatDayList(byDay: Map<string, Entry[]>, from: string, to: string): string[] {
  const lines: string[] = []
  for (const d of rangeDays(from, to)) {
    lines.push(`=== ${d}, ${weekdayName(d)} ===`)
    const list = byDay.get(d) ?? []
    if (list.length === 0) lines.push('no logs')
    for (const e of list) lines.push(`${e.start} - ${e.end}${e.offset > 0 ? ' (+1)' : ''}   ${e.key} ${e.summary}`)
    lines.push('')
  }
  return lines
}

/** `Week 2026-10-27 .. 2026-11-02: 37.50h` */
export function weekLine(monday: string, byDay: Map<string, Entry[]>): string {
  const days = Array.from({ length: 7 }, (_, i) => addDays(monday, i))
  return `Week ${monday} .. ${days[6]}: ${fmtHours(weekSeconds(byDay, days))}`
}

/** Console line for a stream event (null = nothing to print). */
export function consoleLine(e: StreamEvent): string | null {
  switch (e.type) {
    case 'log':
      return e.msg
    case 'user':
      return `User: ${e.display_name}`
    case 'issues':
      return `Found ${e.count} issue${e.count === 1 ? '' : 's'}`
    case 'issue': {
      const n = e.worklogs.length
      return `[${e.index}/${e.count}] ${e.key} ${e.summary}: ${n} worklog${n === 1 ? '' : 's'}, ${fmtHours(e.seconds)}`
    }
    case 'error':
      return `${e.fatal ? 'FATAL' : 'ERROR'}: ${e.msg}`
    case 'done':
      return `Done: ${e.issues} issues, ${e.worklogs} worklogs, ${fmtHours(e.seconds)}`
  }
}

export type SplitSeg = { key: string; summary: string; seconds: number; y: number; height: number; slot: number; repeat: boolean }

/**
 * Geometry of a day's bar split into per-ticket segments, stacked bottom-up (biggest first).
 * `yOf` maps hours to a y pixel; `gap` px separate neighbouring segments; every segment is at least 1px tall.
 */
export function splitSegments(segs: Segment[], colours: Map<string, ColourSlot>, yOf: (hours: number) => number, gap: number): SplitSeg[] {
  let acc = 0
  return segs.map((s) => {
    const top = yOf(hours(acc + s.seconds))
    const height = Math.max(1, yOf(hours(acc)) - top - (acc > 0 ? gap : 0))
    acc += s.seconds
    const c = colours.get(s.key) ?? { slot: 0, repeat: false }
    return { key: s.key, summary: s.summary, seconds: s.seconds, y: top, height, slot: c.slot, repeat: c.repeat }
  })
}
