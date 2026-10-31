// Calendar math on plain YYYY-MM-DD strings (UTC arithmetic only: no timezone surprises).
export const MAX_RANGE_DAYS = 366
const DAY_MS = 86_400_000
const pad = (n: number) => String(n).padStart(2, '0')

export const isoDate = (d: Date): string => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`

export function parseISO(s: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s)
  if (!m) return null
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]))
  return isoDate(d) === s ? d : null
}

export const addDays = (s: string, n: number): string => isoDate(new Date(parseISO(s)!.getTime() + n * DAY_MS))
export const daysBetween = (a: string, b: string): number => Math.round((parseISO(b)!.getTime() - parseISO(a)!.getTime()) / DAY_MS)

/** First and last day of the month containing `now` (local calendar). */
export function monthDefaults(now: Date = new Date()): { from: string; to: string } {
  const y = now.getFullYear()
  const m = now.getMonth()
  const last = new Date(Date.UTC(y, m + 1, 0)).getUTCDate()
  return { from: `${y}-${pad(m + 1)}-01`, to: `${y}-${pad(m + 1)}-${pad(last)}` }
}

/** Monday on or before the given day. */
export function mondayOf(s: string): string {
  const dow = (parseISO(s)!.getUTCDay() + 6) % 7 // Mon=0
  return addDays(s, -dow)
}

export const weekDays = (monday: string): string[] => Array.from({ length: 7 }, (_, i) => addDays(monday, i))

/** Every day from..to inclusive. */
export function rangeDays(from: string, to: string): string[] {
  const n = daysBetween(from, to)
  return Array.from({ length: n + 1 }, (_, i) => addDays(from, i))
}

/** Move a week start by `delta` weeks, clamped to the weeks containing from and to. */
export function clampWeek(monday: string, delta: number, from: string, to: string): string {
  const next = addDays(monday, delta * 7)
  const lo = mondayOf(from)
  const hi = mondayOf(to)
  return next < lo ? lo : next > hi ? hi : next
}

const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const DOW_LONG = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
export const shortLabel = (s: string): string => `${DOW[parseISO(s)!.getUTCDay()]} ${s.slice(5)}`
export const weekdayName = (s: string): string => DOW_LONG[parseISO(s)!.getUTCDay()]
