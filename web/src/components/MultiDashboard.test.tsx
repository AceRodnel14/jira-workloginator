import { renderToStaticMarkup } from 'react-dom/server'
import { expect, test } from 'vitest'

import type { Issue } from '../lib/data'
import type { UserState } from '../lib/multi'
import { MultiDashboard } from './MultiDashboard'

const user = (author: string, hours: number, error?: string): UserState => {
  const issue: Issue = {
    type: 'issue', index: 1, count: 1, key: 'A-1', summary: 'T', seconds: hours * 3600,
    worklogs: [{ date: '2026-10-27', start: '09:00', end: '10:00', end_day_offset: 0, seconds: hours * 3600 }],
  }
  return { author, issues: hours ? [issue] : [], done: true, error }
}
// 2026-10-26..2026-10-30 = 5 workdays = 40 h expected
const html = renderToStaticMarkup(<MultiDashboard from="2026-10-26" to="2026-10-30" users={[user('a@x.com', 20), user('bob@x.com', 46), user('err@x.com', 0, 'No such user')]} />)

test('Graph 1 shows for every user without an error, collapsed or expanded, once per user, with its labels', () => {
  expect(html.match(/class="pbar"/g)).toHaveLength(2) // a@x.com (open) and bob (collapsed); not err
  expect(html).not.toContain('compact')
  expect(html).toContain('20.0 h worked (50.0%)')
  expect(html).toContain('+6.0 h over (+15.0%)')
  expect(html).toContain('expected 40 h')
})

test('over 100%: the red layer overlaps inside the same track with width = excess; Graph 1 names the excess', () => {
  expect(html.match(/class="excess"/g)).toHaveLength(1)
  expect(html).toContain('class="excess" style="width:15%"')
  expect(html).toContain('115% of 40 expected hours, 15.0% over')
  expect(html).not.toContain('pbar-over')
})
