import { renderToStaticMarkup } from 'react-dom/server'
import { expect, test } from 'vitest'

import { entriesByDay, type Issue } from '../lib/data'
import { addDays, rangeDays } from '../lib/dates'
import { DayChart } from './DayChart'

const issue: Issue = {
  type: 'issue', index: 1, count: 1, key: 'A-1', summary: 'T', seconds: 3 * 3600 + 2 * 3600,
  worklogs: [
    { date: '2026-10-28', start: '09:00', end: '12:00', end_day_offset: 0, seconds: 3 * 3600 },
    { date: '2026-11-03', start: '09:00', end: '11:00', end_day_offset: 0, seconds: 2 * 3600 },
  ],
}
const byDay = entriesByDay([issue])

function render(from: string, n: number, refHours?: number) {
  const days = rangeDays(from, addDays(from, n - 1))
  return renderToStaticMarkup(<DayChart byDay={byDay} days={days} label="test range" refHours={refHours} />)
}
const count = (html: string, cls: string) => html.match(new RegExp(`class="${cls}"`, 'g'))?.length ?? 0
/** x and text of the long-range axis labels ("1 Nov"). */
const monthLabels = (html: string) => [...html.matchAll(/<text class="axis" x="([\d.]+)" y="222" text-anchor="middle">(\d+ [A-Z][a-z]{2})<\/text>/g)].map((m) => ({ x: +m[1], t: m[2] }))

test('40 days: one hit strip per day, weekend rects for Sat and Sun, dots shown', () => {
  const html = render('2026-10-12', 40) // Monday start: 5 full weeks + Mon-Fri = 5 Saturdays and 5 Sundays
  expect(count(html, 'hit')).toBe(40)
  expect(count(html, 'wk')).toBe(10)
  expect(count(html, 'dot')).toBe(2)
})

test('366 days: no dots, at most 12 axis labels, month names on month starts', () => {
  const html = render('2026-11-15', 366)
  const labels = monthLabels(html).map((l) => l.t)
  expect(labels.length).toBeLessThanOrEqual(12)
  expect(labels.length).toBeGreaterThanOrEqual(8)
  expect(labels.every((l) => l.startsWith('1 '))).toBe(true)
  expect(labels).toContain('1 Dec')
  expect(count(html, 'dot')).toBe(0)
})

test('32 and 90 days label month starts and stay sparse', () => {
  for (const n of [32, 90]) {
    const labels = monthLabels(render('2026-10-20', n)).map((l) => l.t)
    expect(labels.length).toBeGreaterThanOrEqual(3)
    expect(labels.length).toBeLessThanOrEqual(12)
    expect(labels).toContain('1 Nov')
  }
})

test('long-range axis labels stay at least 48 viewBox units apart for 32..120 days', () => {
  for (const from of ['2026-10-20', '2026-11-01', '2027-01-27']) {
    for (let n = 32; n <= 120; n++) {
      const xs = monthLabels(render(from, n)).map((l) => l.x)
      for (let i = 1; i < xs.length; i++) expect(xs[i] - xs[i - 1], `${from} n=${n}`).toBeGreaterThanOrEqual(48)
    }
  }
})

test('aria-label has the label, the total and the busiest day', () => {
  const html = render('2026-10-26', 14)
  expect(html).toContain('aria-label="Hours per day, test range: 5.0 h in total, busiest day Wed 10-28 with 3.00h"')
  expect(html).not.toContain('role="tooltip"') // the tooltip only shows on hover
})

test('refHours drives the reference line label', () => {
  const html = render('2026-10-26', 7, 6)
  expect(html).toContain('>6 h<')
  expect(html).not.toContain('>8 h<')
})
