import { daysBetween, MAX_RANGE_DAYS, parseISO } from './dates'
import type { Settings } from '../api'

export type Errors = Partial<Record<'jira_domain' | 'user' | 'users' | 'api_email' | 'api_token' | 'timezone' | 'from' | 'to', string>>

/** Mirrors the backend validation so mistakes show up before any request. */
export function validTimezone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat('en', { timeZone: tz })
    return true
  } catch {
    return false
  }
}

/** The server accepts at most this many users per /multiple run. */
export const MAX_USERS = 50

/** What a key press in the chip input does: Enter or comma adds, Backspace on an empty input removes the last chip. */
export function chipKeyAction(key: string, text: string, count: number): 'commit' | 'removeLast' | null {
  if (key === 'Enter' || key === ',') return 'commit'
  if (key === 'Backspace' && text === '' && count > 0) return 'removeLast'
  return null
}

/**
 * Add the emails in `raw` (separated by commas or whitespace) to `list`: trims, ignores duplicates
 * (case-insensitive), requires an '@', and stops at MAX_USERS. `rest` is the text to leave in the input.
 */
export function addEmails(list: string[], raw: string): { list: string[]; rest: string; error: string | null } {
  const out = [...list]
  let rest = ''
  let error: string | null = null
  for (const t of raw.split(/[\s,;]+/).filter(Boolean)) {
    if (!/^[^\s@]+@[^\s@]+$/.test(t)) {
      rest = t
      error = `"${t}" is not an email address`
    } else if (!out.some((u) => u.toLowerCase() === t.toLowerCase())) {
      if (out.length >= MAX_USERS) {
        rest = t
        error = `At most ${MAX_USERS} users`
      } else out.push(t)
    }
  }
  return { list: out, rest, error }
}

/** `multi` = the /multiple form: a list of users and an always-editable API email. */
export function validateForm(s: Settings, from: string, to: string, multi = false): Errors {
  const e: Errors = {}
  let host = ''
  try {
    const u = new URL(s.jira_domain.trim())
    if (u.protocol === 'https:' && !u.port && !u.username && !u.password && /^[a-z0-9-]+\.atlassian\.net$/i.test(u.hostname)) host = u.hostname
  } catch {
    /* invalid URL */
  }
  if (!host) e.jira_domain = 'Use https://<name>.atlassian.net'
  if (multi) {
    if (s.users.length === 0) e.users = 'Add at least one user'
    else if (s.users.length > MAX_USERS) e.users = `At most ${MAX_USERS} users`
  } else if (!s.user.includes('@')) e.user = 'Enter an email address'
  if ((multi || !s.same_as_user) && !s.api_email.includes('@')) e.api_email = 'Enter an email address'
  if (!s.api_token.trim()) e.api_token = 'The API token is required'
  const tz = s.timezone.trim()
  if (!tz) e.timezone = 'Choose a timezone'
  else if (!validTimezone(tz)) e.timezone = 'Unknown timezone'
  const f = parseISO(from)
  const t = parseISO(to)
  if (!f) e.from = 'Pick a start date'
  if (!t) e.to = 'Pick an end date'
  if (f && t) {
    if (from > to) e.to = 'The end date is before the start date'
    else if (daysBetween(from, to) + 1 > MAX_RANGE_DAYS) e.to = `The range is at most ${MAX_RANGE_DAYS} days`
  }
  return e
}
