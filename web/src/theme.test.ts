/// <reference types="node" />
import { readFileSync } from 'node:fs'

import { describe, expect, test } from 'vitest'

import { contrastWithWhite, DEFAULT_HUE, normalizeTheme, themeVars } from './theme'

describe('theme', () => {
  test('normalizeTheme falls back to light and a null hue', () => {
    expect(normalizeTheme(null)).toEqual({ mode: 'light', hue: null })
    expect(normalizeTheme({ mode: 'bogus' as never, hue: 400 })).toEqual({ mode: 'light', hue: null })
    expect(normalizeTheme({ mode: 'dark', hue: 120 })).toEqual({ mode: 'dark', hue: 120 })
  })
  test('hue tints accent and backgrounds', () => {
    const light = themeVars(200, false)
    const dark = themeVars(200, true)
    expect(light['--bg']).toContain('200')
    expect(dark['--surface']).toContain('200')
    expect(light['--bg']).not.toBe(dark['--bg'])
  })
})

test('accent and bar colours keep white text at AA for every hue, light and dark', () => {
  for (let h = 0; h < 360; h += 5) {
    for (const dark of [false, true]) {
      const v = themeVars(h, dark)
      for (const k of ['--accent', '--bar-a', '--bar-b']) {
        const m = /hsl\(([\d.]+) ([\d.]+)% ([\d.]+)%\)/.exec(v[k])!
        expect(contrastWithWhite(+m[1], +m[2], +m[3]), `${k} h=${h} dark=${dark}`).toBeGreaterThanOrEqual(4.5)
      }
    }
  }
})


const css = readFileSync(new URL('./styles.css', import.meta.url), 'utf8')

test('styles.css defaults are the DEFAULT_HUE tokens (copy the values from themeVars after changing it)', () => {
  const light = css.slice(0, css.indexOf('@media'))
  const dark = css.slice(css.indexOf(":root[data-theme='dark']"), css.indexOf('* { box-sizing'))
  for (const [block, isDark] of [[light, false], [dark, true]] as const) {
    const base = themeVars(DEFAULT_HUE, false)
    for (const [k, v] of Object.entries(themeVars(DEFAULT_HUE, isDark))) {
      if (isDark && v === base[k]) continue // inherited from :root
      expect(block, `${k} dark=${isDark}`).toContain(`${k}: ${v};`)
    }
  }
})
