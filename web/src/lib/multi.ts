// Pure logic for the /multiple dashboard: expected hours, month paging, the multi stream reducer.
import type { MultiEvent, Settings } from '../api'
import { addDays, parseISO, rangeDays } from './dates'
import { entriesByDay, fmtHours, isRetryMsg, hours, weekSeconds, type Entry, type Issue, type LogLine } from './data'

export const WORKDAY_HOURS = 8

/** Mon-Fri dates in from..to (no holidays). */
export function workdays(from: string, to: string): number {
  return rangeDays(from, to).filter((d) => {
    const w = parseISO(d)!.getUTCDay()
    return w >= 1 && w <= 5
  }).length
}
export const expectedHours = (from: string, to: string): number => workdays(from, to) * WORKDAY_HOURS
export const isWeekend = (d: string): boolean => {
  const w = parseISO(d)!.getUTCDay()
  return w === 0 || w === 6
}

/** Total hours of a user over the range (weekend hours count; entries outside the range are ignored). */
export function totalHours(byDay: Map<string, Entry[]>, from: string, to: string): number {
  return hours(weekSeconds(byDay, rangeDays(from, to)))
}

/** Percent of expected, rounded to 0.1 so the shown number and the colour state always agree. null = no expected hours. */
export function percent(total: number, expected: number): number | null {
  if (expected <= 0) return null
  return Math.round((total / expected) * 1000) / 10
}

export type HoursState = 'low' | 'ok' | 'over'
/** over: >100 (red), low: <50 (amber), else ok (green). */
export function hoursState(pct: number | null): HoursState {
  if (pct === null) return 'ok'
  return pct > 100 ? 'over' : pct < 50 ? 'low' : 'ok'
}

/** Bar geometry in percent of the bar width: green capped at 100, red = the excess (capped at 100). */
export function barWidths(pct: number | null): { green: number; red: number } {
  if (pct === null) return { green: 0, red: 0 }
  return { green: Math.min(100, pct), red: pct > 100 ? Math.min(100, pct - 100) : 0 }
}

/** Calendar months (YYYY-MM) touched by from..to, in order. */
export function monthsOf(from: string, to: string): string[] {
  const out: string[] = []
  for (let m = from.slice(0, 7); m <= to.slice(0, 7); ) {
    out.push(m)
    const [y, mo] = m.split('-').map(Number)
    m = mo === 12 ? `${y + 1}-01` : `${y}-${String(mo + 1).padStart(2, '0')}`
  }
  return out
}

/** Move the month index by delta, staying inside 0..count-1. */
export const pageMonth = (idx: number, delta: number, count: number): number => Math.min(count - 1, Math.max(0, idx + delta))

/** Days of month `m` that are inside from..to. */
export function monthDays(m: string, from: string, to: string): string[] {
  const first = `${m}-01`
  const [y, mo] = m.split('-').map(Number)
  const last = addDays(`${mo === 12 ? y + 1 : y}-${String(mo === 12 ? 1 : mo + 1).padStart(2, '0')}-01`, -1)
  return rangeDays(first < from ? from : first, last > to ? to : last)
}

const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
export const monthLabel = (m: string): string => `${MONTH_NAMES[+m.slice(5, 7) - 1]} ${m.slice(0, 4)}`

export type SortMode = 'entered' | 'asc' | 'desc'
export const nextSort = (m: SortMode): SortMode => (m === 'entered' ? 'asc' : m === 'asc' ? 'desc' : 'entered')
/** Stable sort by percent; users without a percent go last. 'entered' keeps the input order. */
export function sortByPercent<T extends { pct: number | null }>(list: T[], mode: SortMode): T[] {
  if (mode === 'entered') return list
  const k = (x: T) => x.pct ?? (mode === 'asc' ? Infinity : -Infinity)
  return [...list].sort((a, b) => (mode === 'asc' ? k(a) - k(b) : k(b) - k(a)))
}

// ---- multi stream reducer ----
export type UserState = { author: string; displayName?: string; issues: Issue[]; error?: string; done: boolean; seconds?: number }
export type MultiState = {
  lines: LogLine[]
  users: UserState[]
  /** all_done arrived. */
  complete: boolean
  /** A run-level fatal error (no author): no all_done follows. */
  fatal?: string
}
export const initialMulti = (requested: string[]): MultiState => ({
  lines: [],
  users: requested.map((u) => ({ author: u.toLowerCase(), issues: [], done: false })),
  complete: false,
})

const upd = (users: UserState[], author: string, f: (u: UserState) => UserState): UserState[] =>
  users.some((u) => u.author === author) ? users.map((u) => (u.author === author ? f(u) : u)) : [...users, f({ author, issues: [], done: false })]

/** Fold one event into the state. Shared events have no author; user/issue/done/errors with an author update that user. */
export function multiReducer(s: MultiState, e: MultiEvent): MultiState {
  const line = (text: string, error = false): MultiState['lines'] => [...s.lines, { text, error }]
  switch (e.type) {
    case 'log':
      return { ...s, lines: line(e.author ? `[${e.author}] ${e.msg}` : e.msg) }
    case 'issues':
      return { ...s, lines: line(`Found ${e.count} issue${e.count === 1 ? '' : 's'}`) }
    case 'user':
      return { ...s, lines: line(`User ${e.author}: ${e.display_name}`), users: upd(s.users, e.author, (u) => ({ ...u, displayName: e.display_name })) }
    case 'issue': {
      const n = e.worklogs.length
      return {
        ...s,
        lines: line(`[${e.index}/${e.count}] ${e.key} ${e.summary} (${e.author}): ${n} worklog${n === 1 ? '' : 's'}, ${fmtHours(e.seconds)}`),
        users: upd(s.users, e.author, (u) => ({ ...u, issues: [...u.issues, e] })),
      }
    }
    case 'error': {
      if (!e.fatal && isRetryMsg(e.msg)) return { ...s, lines: [...s.lines, { text: `Retry${e.author ? ` [${e.author}]` : ''}: ${e.msg}`, error: false, retry: true }] }
      const text = `${e.fatal ? 'FATAL' : 'ERROR'}${e.author ? ` [${e.author}]` : ''}: ${e.msg}`
      if (e.author) return { ...s, lines: line(text, true), users: e.fatal ? upd(s.users, e.author, (u) => ({ ...u, error: e.msg, done: true })) : s.users }
      return { ...s, lines: line(text, true), fatal: e.fatal ? e.msg : s.fatal }
    }
    case 'done':
      return { ...s, lines: line(`Done ${e.author}: ${e.issues} issues, ${e.worklogs} worklogs, ${fmtHours(e.seconds)}`), users: upd(s.users, e.author, (u) => ({ ...u, done: true, seconds: e.seconds })) }
    case 'all_done':
      return { ...s, complete: true, lines: line(`All done: ${e.authors} user${e.authors === 1 ? '' : 's'}, ${fmtHours(e.seconds)}`) }
  }
}

export type MultiStatus = 'running' | 'complete' | 'fatal' | 'lost'
/** How the run stands once the stream ended (`ended`) or while it still runs. Closing without all_done or a fatal = lost. */
export function multiStatus(s: MultiState, ended: boolean): MultiStatus {
  if (s.complete) return 'complete'
  if (s.fatal) return 'fatal'
  return ended ? 'lost' : 'running'
}

export const entriesOf = (u: UserState): Map<string, Entry[]> => entriesByDay(u.issues)

// ---- /multiple settings rules ----
const same = (a: string, b: string): boolean => a.trim().toLowerCase() === b.trim().toLowerCase()

/** API email to prefill on /multiple: the stored one; if "same as user" is on and it is empty, the stored user. */
export function multiApiEmail(stored: Settings): string {
  return stored.api_email || (stored.same_as_user ? stored.user : '')
}

/**
 * The settings document /multiple saves: the one it got, with this page's fields changed. `user` stays as stored.
 * same_as_user stays true only if it was true, the stored user is not empty and the form's API email equals that user
 * (the backend rejects same_as_user=true with an empty user and would overwrite api_email with the user).
 */
export function multiSettingsToSave(stored: Settings, form: Settings): Settings {
  const keep = stored.same_as_user && stored.user.trim() !== '' && same(form.api_email, stored.user)
  return {
    ...stored,
    jira_domain: form.jira_domain.trim(),
    timezone: form.timezone.trim(),
    api_token: form.api_token,
    api_email: form.api_email.trim(),
    users: form.users,
    same_as_user: keep,
  }
}
