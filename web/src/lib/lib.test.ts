import { describe, expect, test } from 'vitest'

import { addDays, clampWeek, mondayOf, monthDefaults, rangeDays, shortLabel, weekDays } from './dates'
import { assignColours, daySegments, entriesByDay, formatDayList, PALETTE_SIZE, splitSegments, taskRows, yMax, type Issue } from './data'
import { consoleLine, logLine } from './data'
import { validateForm } from './validate'

const issue = (key: string, worklogs: Issue['worklogs'], summary = 'Title'): Issue => ({
  type: 'issue', index: 1, count: 1, key, summary, seconds: worklogs.reduce((a, w) => a + w.seconds, 0), worklogs,
})
const wl = (date: string, start: string, end: string, seconds: number, off = 0) => ({ date, start, end, end_day_offset: off, seconds })

describe('month defaults', () => {
  test.each([
    ['2024-02-10', '2024-02-01', '2024-02-29'],
    ['2026-02-10', '2026-02-01', '2026-02-28'],
    ['2026-12-31', '2026-12-01', '2026-12-31'],
    ['2026-01-01', '2026-01-01', '2026-01-31'],
  ])('%s', (now, from, to) => {
    const [y, m, d] = now.split('-').map(Number)
    expect(monthDefaults(new Date(y, m - 1, d))).toEqual({ from, to })
  })
})

describe('week math', () => {
  test('monday of every weekday', () => {
    expect(mondayOf('2026-10-26')).toBe('2026-10-26') // Monday
    expect(mondayOf('2026-10-28')).toBe('2026-10-26')
    expect(mondayOf('2026-11-01')).toBe('2026-10-26') // Sunday
    expect(mondayOf('2026-10-01')).toBe('2026-09-28')
  })
  test('week days and labels', () => {
    expect(weekDays('2026-10-26')).toHaveLength(7)
    expect(shortLabel('2026-10-26')).toBe('Mon 10-26')
    expect(shortLabel('2026-11-01')).toBe('Sun 11-01')
  })
  test('clamping to the weeks of FROM and TO', () => {
    const from = '2026-10-01'
    const to = '2026-10-31'
    expect(clampWeek('2026-09-28', -1, from, to)).toBe('2026-09-28')
    expect(clampWeek('2026-09-28', 1, from, to)).toBe('2026-10-05')
    expect(clampWeek('2026-10-26', 1, from, to)).toBe('2026-10-26')
    expect(clampWeek('2026-10-26', -1, from, to)).toBe('2026-10-19')
  })
  test('rangeDays is inclusive, addDays crosses months', () => {
    expect(rangeDays('2026-10-30', '2026-11-02')).toEqual(['2026-10-30', '2026-10-31', '2026-11-01', '2026-11-02'])
    expect(addDays('2024-02-28', 2)).toBe('2024-03-01')
  })
})

describe('chart data', () => {
  const byDay = entriesByDay([
    issue('A-1', [wl('2026-10-26', '09:00', '17:00', 8 * 3600)]),
    issue('B-2', [wl('2026-10-27', '10:00', '11:00', 3600)]),
  ])
  test('y max = max(busiest, 8) + 2', () => {
    expect(yMax(byDay, weekDays('2026-10-26'))).toBe(10)
    const big = entriesByDay([issue('A-1', [wl('2026-10-26', '00:00', '12:00', 12 * 3600)])])
    expect(yMax(big, weekDays('2026-10-26'))).toBe(14)
    expect(yMax(new Map(), weekDays('2026-10-26'))).toBe(10)
  })
  test('colours by weekly hours desc', () => {
    const c = assignColours(byDay, weekDays('2026-10-26'))
    expect(c.get('A-1')).toEqual({ slot: 0, repeat: false })
    expect(c.get('B-2')).toEqual({ slot: 1, repeat: false })
  })
  test('colours repeat after the palette ends', () => {
    const many = entriesByDay(
      Array.from({ length: PALETTE_SIZE + 2 }, (_, i) => issue(`T-${i}`, [wl('2026-10-26', '09:00', '10:00', 3600 * (20 - i))])),
    )
    const c = assignColours(many, weekDays('2026-10-26'))
    expect(c.get('T-0')).toEqual({ slot: 0, repeat: false })
    expect(c.get(`T-${PALETTE_SIZE - 1}`)).toEqual({ slot: PALETTE_SIZE - 1, repeat: false })
    expect(c.get(`T-${PALETTE_SIZE}`)).toEqual({ slot: 0, repeat: true })
    expect(c.get(`T-${PALETTE_SIZE + 1}`)).toEqual({ slot: 1, repeat: true })
  })
})

describe('day list', () => {
  test('every day, sorted by start, (+1) and no logs', () => {
    const byDay = entriesByDay([
      issue('ABC-1', [wl('2026-10-01', '13:00', '14:00', 3600), wl('2026-10-01', '09:00', '10:30', 5400), wl('2026-10-02', '23:30', '00:30', 3600, 1)]),
    ])
    expect(formatDayList(byDay, '2026-10-01', '2026-10-03')).toEqual([
      '=== 2026-10-01, Thursday ===',
      '2.50h ABC-1 Title',
      '',
      '=== 2026-10-02, Friday ===',
      '1.00h ABC-1 Title',
      '',
      '=== 2026-10-03, Saturday ===',
      'no logs',
      '',
    ])
  })
})

describe('task rows', () => {
  test('two worklogs on the same ticket and day become one summed line, in first-start order', () => {
    const byDay = entriesByDay([
      issue('B-2', [wl('2026-10-01', '08:00', '09:00', 3600)]),
      issue('A-1', [wl('2026-10-01', '13:00', '14:00', 3600), wl('2026-10-01', '09:30', '10:30', 3600), wl('2026-10-01', '16:00', '16:30', 1800)]),
    ])
    expect(taskRows(byDay.get('2026-10-01'))).toEqual([
      { key: 'B-2', summary: 'Title', seconds: 3600 },
      { key: 'A-1', summary: 'Title', seconds: 9000 },
    ])
    expect(taskRows(undefined)).toEqual([])
  })
})

describe('form validation', () => {
  const ok = { users: [] as string[], jira_domain: 'https://x.atlassian.net', user: 'a@b.c', api_email: '', same_as_user: true, api_token: 't', timezone: 'Etc/UTC' }
  test('valid', () => expect(validateForm(ok, '2026-10-01', '2026-10-31')).toEqual({}))
  test('domain rules', () => {
    for (const d of ['http://x.atlassian.net', 'https://example.com', 'https://atlassian.net', 'nope', 'https://x.atlassian.net.evil.com', 'https://x.atlassian.net:8443', 'https://u@x.atlassian.net'])
      expect(validateForm({ ...ok, jira_domain: d }, '2026-10-01', '2026-10-02').jira_domain, d).toBeTruthy()
  })
  test('timezone accepts canonical IANA names', () => {
    for (const tz of ['Asia/Kolkata', 'Europe/Kyiv', 'Etc/UTC']) expect(validateForm({ ...ok, timezone: tz }, '2026-10-01', '2026-10-02').timezone, tz).toBeUndefined()
  })
  test('emails, token, timezone', () => {
    const e = validateForm({ ...ok, user: 'x', same_as_user: false, api_email: 'y', api_token: ' ', timezone: 'Nope/Zone' }, '2026-10-01', '2026-10-02')
    expect(Object.keys(e).sort()).toEqual(['api_email', 'api_token', 'timezone', 'user'])
  })
  test('range: reversed, 366 ok, 367 rejected', () => {
    expect(validateForm(ok, '2026-10-02', '2026-10-01').to).toBeTruthy()
    expect(validateForm(ok, '2024-01-01', '2024-12-31').to).toBeUndefined()
    expect(validateForm(ok, '2024-01-01', '2025-01-01').to).toBeTruthy()
  })
})

describe('split segments', () => {
  test('stack bottom-up with gaps, colours and repeat flags', () => {
    const byDay = entriesByDay([
      issue('A-1', [wl('2026-10-26', '09:00', '13:00', 4 * 3600)]),
      issue('B-2', [wl('2026-10-26', '13:00', '15:00', 2 * 3600)]),
    ])
    const days = weekDays('2026-10-26')
    const segs = splitSegments(daySegments(byDay.get('2026-10-26')), assignColours(byDay, days), (h) => 100 - h * 10, 2)
    expect(segs.map((s) => s.key)).toEqual(['A-1', 'B-2'])
    expect(segs[0]).toMatchObject({ y: 60, height: 40, slot: 0, repeat: false })
    expect(segs[1]).toMatchObject({ y: 40, height: 18, slot: 1, repeat: false }) // 20px minus the 2px gap
  })
  test('colour repeats and tiny segments keep 1px', () => {
    const wls = Array.from({ length: PALETTE_SIZE + 1 }, (_, i) => issue(`T-${i}`, [wl('2026-10-26', '09:00', '10:00', i === PALETTE_SIZE ? 1 : 3600 * (20 - i))]))
    const byDay = entriesByDay(wls)
    const segs = splitSegments(daySegments(byDay.get('2026-10-26')), assignColours(byDay, weekDays('2026-10-26')), (h) => 1000 - h, 2)
    const last = segs[segs.length - 1]
    expect(last).toMatchObject({ slot: 0, repeat: true })
    expect(last.height).toBeGreaterThanOrEqual(1)
  })
})

describe('retry lines', () => {
  test('a rate-limit retry is neutral, other non-fatal errors stay errors', () => {
    const retry = consoleLine({ type: 'error', msg: 'A-1: Jira answered 429 (rate limited); retrying in 5 s (retry 1 of 3)', fatal: false })!
    expect(retry.startsWith('Retry: ')).toBe(true)
    expect(logLine(retry)).toMatchObject({ error: false, retry: true })
    expect(logLine(consoleLine({ type: 'error', msg: 'A-1: boom', fatal: false })!)).toMatchObject({ error: true })
  })
})
