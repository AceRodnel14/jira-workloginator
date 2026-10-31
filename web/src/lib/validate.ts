import { daysBetween, MAX_RANGE_DAYS, parseISO } from './dates'
import type { Settings } from '../api'

export type Errors = Partial<Record<'jira_domain' | 'user' | 'api_email' | 'api_token' | 'timezone' | 'from' | 'to', string>>

/** Mirrors the backend validation so mistakes show up before any request. */
export function validTimezone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat('en', { timeZone: tz })
    return true
  } catch {
    return false
  }
}

export function validateForm(s: Settings, from: string, to: string): Errors {
  const e: Errors = {}
  let host = ''
  try {
    const u = new URL(s.jira_domain.trim())
    if (u.protocol === 'https:' && !u.port && !u.username && !u.password && /^[a-z0-9-]+\.atlassian\.net$/i.test(u.hostname)) host = u.hostname
  } catch {
    /* invalid URL */
  }
  if (!host) e.jira_domain = 'Use https://<name>.atlassian.net'
  if (!s.user.includes('@')) e.user = 'Enter an email address'
  if (!s.same_as_user && !s.api_email.includes('@')) e.api_email = 'Enter an email address'
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
