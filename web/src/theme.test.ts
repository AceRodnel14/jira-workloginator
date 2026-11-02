/// <reference types="node" />
import { readFileSync } from 'node:fs'

import { describe, expect, test } from 'vitest'

import { contrast, contrastWithWhite, DEFAULT_HUE, normalizeTheme, themeVars, type HSL } from './theme'

const parse = (c: string): HSL => {
  const m = /hsl\(([\d.]+) ([\d.]+)% ([\d.]+)%\)/.exec(c)!
  return [+m[1], +m[2], +m[3]]
}

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
      for (const k of ['--accent', '--accent-hover', '--bar-a', '--bar-b']) {
        const m = /hsl\(([\d.]+) ([\d.]+)% ([\d.]+)%\)/.exec(v[k])!
        expect(contrastWithWhite(+m[1], +m[2], +m[3]), `${k} h=${h} dark=${dark}`).toBeGreaterThanOrEqual(4.5)
      }
    }
  }
})

test('text-coloured accents stay AA on the backgrounds they sit on, every hue; the accent fill stays visible (3:1)', () => {
  for (let h = 0; h < 360; h += 5) {
    const light = themeVars(h, false)
    const dark = themeVars(h, true)
    for (const bg of ['--bg', '--surface', '--accent-soft']) {
      expect(contrast(parse(light['--accent-text']), parse(light[bg])), `light --accent-text on ${bg} h=${h}`).toBeGreaterThanOrEqual(4.5)
    }
    for (const bg of ['--bg', '--surface', '--surface-2', '--accent-soft']) {
      expect(contrast(parse(dark['--accent-text']), parse(dark[bg])), `dark --accent-text on ${bg} h=${h}`).toBeGreaterThanOrEqual(4.5)
    }
    for (const [v, name] of [[light, 'light'], [dark, 'dark']] as const) {
      for (const bg of ['--bg', '--surface']) {
        expect(contrast(parse(v['--accent']), parse(v[bg])), `${name} --accent on ${bg} h=${h}`).toBeGreaterThanOrEqual(3)
      }
    }
  }
})

test('navy default: bars and accent sit near the picked colours', () => {
  const v = themeVars(DEFAULT_HUE, false)
  const L = (k: string) => parse(v[k])[2]
  expect(DEFAULT_HUE).toBe(221)
  expect(Math.abs(L('--bar-a') - 21)).toBeLessThanOrEqual(2) // #0A2A6B
  expect(Math.abs(L('--bar-b') - 17)).toBeLessThanOrEqual(2) // #091F53
  expect(Math.abs(L('--accent') - 30)).toBeLessThanOrEqual(2) // #0B3E8F
  expect(themeVars(DEFAULT_HUE, true)['--bar-a']).toBe(v['--bar-a'])
  // the bump never pushes the bars near-black
  for (const h of [90, 100, 110]) expect(parse(themeVars(h, false)['--bar-a'])[2]).toBeGreaterThanOrEqual(12)
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
