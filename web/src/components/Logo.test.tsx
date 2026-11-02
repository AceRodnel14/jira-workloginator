import { renderToStaticMarkup } from 'react-dom/server'
import { expect, test } from 'vitest'

import { Logo } from './Logo'

test('logo is a decorative 48x48 svg sized by height', () => {
  const html = renderToStaticMarkup(<Logo height={28} />)
  expect(html).toContain('<svg')
  expect(html).toContain('viewBox="0 0 48 48"')
  expect(html).toContain('aria-hidden="true"')
  expect(html).toContain('height="28"')
  expect(html).toContain('width="28"')
})
