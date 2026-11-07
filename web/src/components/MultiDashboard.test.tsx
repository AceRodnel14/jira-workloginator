import { renderToStaticMarkup } from 'react-dom/server'
import { expect, test } from 'vitest'

import type { Issue } from '../lib/data'
import type { UserState } from '../lib/multi'
import { printCompact } from '../lib/multi'
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
  expect(html).not.toContain('pbar compact') // the compact export is a print mode, not a graph variant
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

test('both export buttons exist', () => {
  expect(html).toContain('Export PDF</button>')
  expect(html).toContain('Export PDF (compact)</button>')
})

test('non-working days input: labelled, only for users without an error, with the expected text in the markup', () => {
  expect(html.match(/type="number"/g)).toHaveLength(2) // not for err@x.com
  const m = /<label for="([^"]+)">Non-working days<\/label><input id="\1"[^>]*aria-describedby="([^"]+)"/.exec(html)
  expect(m).not.toBeNull()
  expect(html).toContain(`<p id="${m![2]}" class="nw-text">Expected 40 h (5 workdays \u00d7 8 h)</p>`)
  expect(html).toContain('max="5"')
  expect(html).toContain('class="nw-input no-print"')
  expect(html).toContain('Workdays:</span> <strong>5</strong> (5 \u00d7 8 h)')
})

test('work hours drive the header, expected text and bar label', () => {
  const h = renderToStaticMarkup(<MultiDashboard from="2026-10-26" to="2026-10-30" users={[user('a@x.com', 20)]} workHours={6} />)
  expect(h).toContain('(5 \u00d7 6 h)')
  expect(h).toContain('Expected 30 h (5 workdays \u00d7 6 h)')
  expect(h).toContain('expected 30 h')
})

test('printCompact sets data-print around print() and clears it on afterprint and right after', () => {
  const root = { dataset: {} as Record<string, string | undefined> }
  let during: string | undefined
  let after: (() => void) | undefined
  let removed = 0
  const win = {
    print: () => { during = root.dataset.print },
    addEventListener: (_: 'afterprint', f: () => void) => { after = f },
    removeEventListener: () => { removed++ },
  }
  printCompact(win, root)
  expect(during).toBe('compact')
  expect(root.dataset.print).toBeUndefined()
  expect(after).toBeDefined()
  expect(removed).toBe(1)
  root.dataset.print = 'compact'
  after!() // a late afterprint also clears it
  expect(root.dataset.print).toBeUndefined()
})
