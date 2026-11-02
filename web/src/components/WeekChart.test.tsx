import { renderToStaticMarkup } from 'react-dom/server'
import { expect, test } from 'vitest'

import { assignColours, entriesByDay, type Issue } from '../lib/data'
import { weekDays } from '../lib/dates'
import { WeekChart } from './WeekChart'

const issue: Issue = {
  type: 'issue', index: 1, count: 1, key: 'ABC-1', summary: 'Title', seconds: 5400,
  worklogs: [{ date: '2026-10-28', start: '09:00', end: '10:30', end_day_offset: 0, seconds: 5400 }],
}

const byDay = entriesByDay([issue])
const MON = '2026-10-26'

test('chart renders 7 labelled days, one solid bar, dimmed out-of-range days and clamped nav', () => {
  const html = renderToStaticMarkup(
    <WeekChart byDay={byDay} from="2026-10-01" to="2026-10-31" monday="2026-09-28" onWeek={() => {}} colours={assignColours(byDay, weekDays(MON))} active={null} onActive={() => {}} />,
  )
  for (const l of ['Mon 09-28', 'Tue 09-29', 'Wed 09-30', 'Thu 10-01', 'Fri 10-02', 'Sat 10-03', 'Sun 10-04']) expect(html).toContain(l)
  expect(html.match(/class="day dim"/g)).toHaveLength(3)
  // week of FROM: Prev disabled, Next enabled
  expect(html).toMatch(/<button[^>]*disabled[^>]*>Prev/)
  expect(html).not.toMatch(/<button[^>]*disabled[^>]*>Next/)

  const logged = renderToStaticMarkup(
    <WeekChart byDay={byDay} from="2026-10-01" to="2026-10-31" monday="2026-10-26" onWeek={() => {}} colours={assignColours(byDay, weekDays(MON))} active={null} onActive={() => {}} />,
  )
  expect(logged.match(/class="bar solid"/g)).toHaveLength(1)
  expect(logged).toMatch(/<button[^>]*disabled[^>]*>Next/)
})

test('small date + total popup (no ticket list); the active day is split per ticket instead of solid', () => {
  const html = renderToStaticMarkup(
    <WeekChart byDay={byDay} from="2026-10-01" to="2026-10-31" monday={MON} onWeek={() => {}} colours={assignColours(byDay, weekDays(MON))} active="2026-10-28" onActive={() => {}} />,
  )
  expect(html).toContain('tooltip small')
  expect(html).toContain('Wed 10-28: <strong>1.50h</strong>')
  expect(html).not.toContain('tt-row')
  expect(html).toContain('seg s0')
  expect(html).not.toContain('bar solid')
})
