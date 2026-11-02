import { renderToStaticMarkup } from 'react-dom/server'
import { expect, test } from 'vitest'

import { assignColours, entriesByDay, highlightFor, type Issue } from '../lib/data'
import { weekDays } from '../lib/dates'
import { DayList } from './DayList'

const wl = (date: string, seconds: number) => ({ date, start: '09:00', end: '10:00', end_day_offset: 0, seconds })
const issue = (key: string, worklogs: ReturnType<typeof wl>[]): Issue => ({ type: 'issue', index: 1, count: 1, key, summary: `Title ${key}`, seconds: 0, worklogs })
const byDay = entriesByDay([issue('A-1', [wl('2026-10-26', 7200), wl('2026-10-27', 3600)]), issue('B-2', [wl('2026-10-26', 1800)])])
const colours = assignColours(byDay, weekDays('2026-10-26'))

test('hover maps a day to the colour slot of each of its tickets', () => {
  expect([...highlightFor(byDay, '2026-10-26', colours)]).toEqual([['A-1', { slot: 0, repeat: false }], ['B-2', { slot: 1, repeat: false }]])
  expect([...highlightFor(byDay, '2026-10-27', colours).keys()]).toEqual(['A-1'])
  expect(highlightFor(byDay, null, colours).size).toBe(0)
  expect(highlightFor(byDay, '2026-10-30', colours).size).toBe(0)
})

test('day list: hours first, active day highlighted with coloured swatches, text kept', () => {
  const days = ['2026-10-26', '2026-10-27', '2026-10-28']
  const html = renderToStaticMarkup(<DayList byDay={byDay} days={days} activeDay="2026-10-26" highlight={highlightFor(byDay, '2026-10-26', colours)} />)
  expect(html).toContain('2.00h A-1 Title A-1')
  expect(html).toContain('0.50h B-2 Title B-2')
  expect(html).toContain('no logs')
  expect(html.match(/class="dayrow active"/g)).toHaveLength(1)
  expect(html.match(/swatch s0/g)).toHaveLength(1)
  expect(html.match(/swatch s1/g)).toHaveLength(1)
  expect(renderToStaticMarkup(<DayList byDay={byDay} days={days} skipEmpty />)).not.toContain('no logs')
})
