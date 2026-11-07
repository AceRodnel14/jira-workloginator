import { renderToStaticMarkup } from 'react-dom/server'
import { expect, test } from 'vitest'

import { ChartViewToggle } from './ChartViewToggle'

const render = (v: 'day' | 'week') => renderToStaticMarkup(<ChartViewToggle value={v} onChange={() => {}} />)

test('a labelled group of two type=button buttons; aria-pressed follows the value', () => {
  const day = render('day')
  expect(day).toContain('role="group" aria-label="Chart view"')
  expect(day).toContain('<button type="button" aria-pressed="true" class="on">Per day</button>')
  expect(day).toContain('<button type="button" aria-pressed="false" class="">Per week</button>')
  const week = render('week')
  expect(week).toContain('aria-pressed="false" class="">Per day')
  expect(week).toContain('aria-pressed="true" class="on">Per week')
})
