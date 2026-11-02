import { describe, expect, test } from 'vitest'

import type { MultiEvent, Settings } from '../api'
import { entriesByDay, taskLine, type Issue } from './data'
import {
  barWidths, entriesOf, expectedHours, hoursState, initialMulti, monthDays, monthLabel, monthsOf, multiReducer, multiStatus, nextSort, pageMonth, percent,
  sortByPercent, totalHours, workdays, multiApiEmail, multiSettingsToSave, type MultiState,
} from './multi'
import { addEmails, chipKeyAction, MAX_USERS, validateForm } from './validate'

describe('workdays and expected hours', () => {
  test('Mon-Fri only, no holidays', () => {
    expect(workdays('2026-10-26', '2026-11-01')).toBe(5) // Mon..Sun
    expect(workdays('2026-10-31', '2026-11-01')).toBe(0) // Sat+Sun
    expect(workdays('2026-09-01', '2026-11-02')).toBe(45)
    expect(expectedHours('2026-09-01', '2026-11-02')).toBe(360)
    expect(workdays('2026-10-28', '2026-10-28')).toBe(1)
  })
  const issue = (key: string, date: string, seconds: number): Issue => ({
    type: 'issue', index: 1, count: 1, key, summary: 's', seconds, worklogs: [{ date, start: '09:00', end: '10:00', end_day_offset: 0, seconds }],
  })
  test('weekend hours count toward the total; entries outside the range do not', () => {
    const byDay = entriesByDay([issue('A-1', '2026-10-26', 8 * 3600), issue('A-1', '2026-10-31', 4 * 3600), issue('A-1', '2026-11-09', 3600)])
    expect(totalHours(byDay, '2026-10-26', '2026-11-01')).toBe(12)
  })
})

describe('percent and colour states', () => {
  test('rounding to 0.1 and no expected hours', () => {
    expect(percent(126.5, 168)).toBe(75.3)
    expect(percent(5, 0)).toBeNull()
  })
  test('thresholds: <50 low, 50..100 ok, >100 over', () => {
    expect(hoursState(49.9)).toBe('low')
    expect(hoursState(50)).toBe('ok')
    expect(hoursState(100)).toBe('ok')
    expect(hoursState(100.1)).toBe('over')
    expect(hoursState(null)).toBe('ok')
  })
  test('bars: green capped at 100, red = the excess', () => {
    expect(barWidths(49.9)).toEqual({ green: 49.9, red: 0 })
    expect(barWidths(50)).toEqual({ green: 50, red: 0 })
    expect(barWidths(100)).toEqual({ green: 100, red: 0 })
    expect(barWidths(75)).toEqual({ green: 75, red: 0 })
    expect(barWidths(115)).toEqual({ green: 100, red: 15 })
    expect(barWidths(250)).toEqual({ green: 100, red: 100 })
    expect(barWidths(null)).toEqual({ green: 0, red: 0 })
  })
})

describe('months', () => {
  test('months of the range and day clipping', () => {
    expect(monthsOf('2026-09-01', '2026-11-02')).toEqual(['2026-09', '2026-10', '2026-11'])
    expect(monthsOf('2026-12-15', '2027-01-10')).toEqual(['2026-12', '2027-01'])
    expect(monthDays('2026-09', '2026-09-20', '2026-11-02')).toHaveLength(11)
    expect(monthDays('2026-11', '2026-09-01', '2026-11-02')).toEqual(['2026-11-01', '2026-11-02'])
    expect(monthDays('2026-12', '2026-11-30', '2027-01-02')[0]).toBe('2026-12-01')
    expect(monthLabel('2026-10')).toBe('October 2026')
  })
  test('paging stays inside the range', () => {
    expect(pageMonth(0, -1, 3)).toBe(0)
    expect(pageMonth(0, 1, 3)).toBe(1)
    expect(pageMonth(2, 1, 3)).toBe(2)
    expect(pageMonth(0, 1, 1)).toBe(0)
  })
})

test('task line: hours first', () => {
  expect(taskLine({ seconds: 5400, key: 'PROJ-1', summary: 'Fix it' })).toBe('1.50h PROJ-1 Fix it')
})

describe('sorting', () => {
  const l = [{ n: 'a', pct: 50 }, { n: 'b', pct: 120 }, { n: 'c', pct: null }, { n: 'd', pct: 10 }]
  test('entered order is untouched; asc/desc put no-percent last', () => {
    expect(sortByPercent(l, 'entered')).toBe(l)
    expect(sortByPercent(l, 'asc').map((x) => x.n)).toEqual(['d', 'a', 'b', 'c'])
    expect(sortByPercent(l, 'desc').map((x) => x.n)).toEqual(['b', 'a', 'd', 'c'])
    expect(l.map((x) => x.n)).toEqual(['a', 'b', 'c', 'd'])
  })
  test('cycle', () => expect([nextSort('entered'), nextSort('asc'), nextSort('desc')]).toEqual(['asc', 'desc', 'entered']))
})

describe('multi stream reducer', () => {
  const wl = (date: string, seconds: number) => ({ date, start: '09:00', end: '10:00', end_day_offset: 0, seconds })
  const run = (ev: MultiEvent[], req = ['Alice@x.com', 'bob@x.com']): MultiState => ev.reduce(multiReducer, initialMulti(req))
  const issue = (author: string, index: number, key: string, seconds: number): MultiEvent => ({
    type: 'issue', author, index, count: 2, key, summary: 'S ' + key, seconds, worklogs: [wl('2026-10-26', seconds)],
  })

  test('shared events carry no author; the same issue key can reach several authors', () => {
    const s = run([
      { type: 'log', msg: 'Looking up Jira users' },
      { type: 'user', author: 'alice@x.com', display_name: 'Alice A' },
      { type: 'user', author: 'bob@x.com', display_name: 'Bob B' },
      { type: 'log', msg: 'Searching issues with worklogs' },
      { type: 'issues', count: 2 },
      issue('alice@x.com', 1, 'P-1', 3600),
      issue('bob@x.com', 1, 'P-1', 7200),
      issue('bob@x.com', 2, 'P-2', 1800),
      { type: 'done', author: 'alice@x.com', issues: 1, worklogs: 1, seconds: 3600 },
      { type: 'done', author: 'bob@x.com', issues: 2, worklogs: 2, seconds: 9000 },
      { type: 'all_done', authors: 2, seconds: 12600 },
    ])
    expect(s.lines[0]).toEqual({ text: 'Looking up Jira users', error: false })
    expect(s.lines.some((l) => l.text === 'Found 2 issues')).toBe(true)
    expect(s.users.map((u) => [u.author, u.displayName, u.issues.map((i) => i.key), u.done])).toEqual([
      ['alice@x.com', 'Alice A', ['P-1'], true],
      ['bob@x.com', 'Bob B', ['P-1', 'P-2'], true],
    ])
    expect(entriesOf(s.users[1]).get('2026-10-26')).toHaveLength(2)
    expect(multiStatus(s, true)).toBe('complete')
  })

  test('author-level fatal error marks that user and the run still completes; non-fatal shared error is a red line', () => {
    const s = run([
      { type: 'error', author: 'bob@x.com', msg: 'User not found', fatal: true },
      { type: 'error', msg: 'P-9: Jira answered 429 (rate limited); retrying in 5 s (retry 1 of 3)', fatal: false },
      { type: 'user', author: 'alice@x.com', display_name: 'Alice' },
      { type: 'done', author: 'alice@x.com', issues: 0, worklogs: 0, seconds: 0 },
      { type: 'all_done', authors: 1, seconds: 0 },
    ])
    expect(s.users.find((u) => u.author === 'bob@x.com')).toMatchObject({ error: 'User not found', done: true })
    expect(s.users.find((u) => u.author === 'alice@x.com')).toMatchObject({ done: true, seconds: 0, issues: [] })
    expect(s.lines.filter((l) => l.error).map((l) => l.text)).toEqual(['FATAL [bob@x.com]: User not found'])
    expect(s.lines.filter((l) => l.retry).map((l) => l.text)).toEqual(['Retry: P-9: Jira answered 429 (rate limited); retrying in 5 s (retry 1 of 3)'])
    const other = run([{ type: 'error', msg: 'P-9: boom', fatal: false }])
    expect(other.lines[0]).toEqual({ text: 'ERROR: P-9: boom', error: true })
    expect(s.fatal).toBeUndefined()
    expect(multiStatus(s, true)).toBe('complete')
  })

  test('run-level fatal (no author, no all_done) stays on the transition page', () => {
    const s = run([{ type: 'log', msg: 'x' }, { type: 'error', msg: 'Jira refused the credentials', fatal: true }])
    expect(s.fatal).toBe('Jira refused the credentials')
    expect(multiStatus(s, true)).toBe('fatal')
    expect(s.users.every((u) => !u.error)).toBe(true)
  })

  test('stream closed without all_done or a fatal = lost; still running before the end', () => {
    const s = run([{ type: 'log', msg: 'x' }])
    expect(multiStatus(s, false)).toBe('running')
    expect(multiStatus(s, true)).toBe('lost')
  })

  test('requested users start listed in entered order, lowercase', () => {
    expect(initialMulti(['A@X.com']).users.map((u) => u.author)).toEqual(['a@x.com'])
  })
})

describe('chip input logic', () => {
  test('keys: Enter and comma add, Backspace on empty removes the last', () => {
    expect(chipKeyAction('Enter', 'a@x.com', 0)).toBe('commit')
    expect(chipKeyAction(',', 'a@x.com', 0)).toBe('commit')
    expect(chipKeyAction('Backspace', '', 2)).toBe('removeLast')
    expect(chipKeyAction('Backspace', 'a', 2)).toBeNull()
    expect(chipKeyAction('Backspace', '', 0)).toBeNull()
    expect(chipKeyAction('a', '', 1)).toBeNull()
  })
  test('trims, ignores duplicates case-insensitively, needs an @', () => {
    expect(addEmails(['a@x.com'], ' B@x.com ,A@X.com, c@x.com').list).toEqual(['a@x.com', 'B@x.com', 'c@x.com'])
    const bad = addEmails([], 'nope')
    expect(bad).toMatchObject({ list: [], rest: 'nope' })
    expect(bad.error).toBeTruthy()
    expect(addEmails([], 'a@x.com nope')).toMatchObject({ list: ['a@x.com'], rest: 'nope' })
  })
  test(`blocks the ${MAX_USERS + 1}st user`, () => {
    const full = Array.from({ length: MAX_USERS }, (_, i) => `u${i}@x.com`)
    const r = addEmails(full, 'extra@x.com')
    expect(r.list).toHaveLength(MAX_USERS)
    expect(r.error).toContain(String(MAX_USERS))
    expect(addEmails(full, 'U0@x.com').error).toBeNull()
  })
  test('multi form validation: users required, api email always required', () => {
    const s = { jira_domain: 'https://x.atlassian.net', user: '', users: [] as string[], api_email: '', same_as_user: false, api_token: 't', timezone: 'Etc/UTC' }
    expect(Object.keys(validateForm(s, '2026-10-01', '2026-10-02', true)).sort()).toEqual(['api_email', 'users'])
    expect(validateForm({ ...s, users: ['a@x.com'], api_email: 'me@x.com' }, '2026-10-01', '2026-10-02', true)).toEqual({})
  })
})

describe('/multiple settings rules', () => {
  const doc = (p: Partial<Settings> = {}): Settings => ({ jira_domain: ' https://x.atlassian.net ', user: 'me@x.com', users: ['a@x.com'], api_email: '', same_as_user: false, api_token: 't', timezone: 'Etc/UTC', ...p })
  test('prefill: stored api_email; falls back to user only when same_as_user; empty otherwise', () => {
    expect(multiApiEmail(doc({ api_email: 'api@x.com', same_as_user: true }))).toBe('api@x.com')
    expect(multiApiEmail(doc({ same_as_user: true }))).toBe('me@x.com')
    expect(multiApiEmail(doc({ same_as_user: false }))).toBe('')
    expect(multiApiEmail(doc({ user: '', same_as_user: true }))).toBe('')
  })
  test('save keeps same_as_user=true only when stored true, user not empty and the API email equals the user (trim, case)', () => {
    const t = doc({ same_as_user: true })
    expect(multiSettingsToSave(t, doc({ api_email: ' ME@x.com ' })).same_as_user).toBe(true)
    expect(multiSettingsToSave(t, doc({ api_email: 'other@x.com' })).same_as_user).toBe(false)
    expect(multiSettingsToSave(doc({ same_as_user: true, user: '' }), doc({ api_email: '' })).same_as_user).toBe(false)
    expect(multiSettingsToSave(doc({ same_as_user: true, user: '  ' }), doc({ api_email: '  ' })).same_as_user).toBe(false)
    expect(multiSettingsToSave(doc({ same_as_user: false }), doc({ api_email: 'me@x.com' })).same_as_user).toBe(false)
  })
  test('save: user stays as stored, api_email and users are always sent, text fields are trimmed', () => {
    const out = multiSettingsToSave(doc({ user: 'keep@x.com' }), doc({ user: 'changed@x.com', api_email: ' api@x.com ', users: ['b@x.com', 'c@x.com'] }))
    expect(out).toMatchObject({ user: 'keep@x.com', api_email: 'api@x.com', users: ['b@x.com', 'c@x.com'], jira_domain: 'https://x.atlassian.net' })
  })
  test('validation: api_email is required and must be an email on /multiple, whatever same_as_user says', () => {
    const f = doc({ users: ['a@x.com'], same_as_user: true, api_email: '' })
    expect(validateForm(f, '2026-10-01', '2026-10-02', true).api_email).toBeTruthy()
    expect(validateForm({ ...f, api_email: 'nope' }, '2026-10-01', '2026-10-02', true).api_email).toBeTruthy()
    expect(validateForm({ ...f, jira_domain: 'https://x.atlassian.net', api_email: 'ok@x.com' }, '2026-10-01', '2026-10-02', true)).toEqual({})
  })
})
