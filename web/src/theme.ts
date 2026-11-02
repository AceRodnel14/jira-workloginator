// Theme: mode (auto/light/dark) plus an optional accent hue that tints accents and
// backgrounds. Colours are set through the CSSOM (allowed by the CSP, unlike style attributes).
export type ThemeMode = 'auto' | 'light' | 'dark'
export type Theme = { mode: ThemeMode; hue: number | null }

/** The one brand constant: styles.css derives its default accent and backgrounds from this hue (a test keeps them in sync). */
export const DEFAULT_HUE = 221
const CACHE_KEY = 'app.theme'
const MODES: ThemeMode[] = ['auto', 'light', 'dark']

export function normalizeTheme(t: Partial<Theme> | null | undefined): Theme {
  const mode = MODES.includes(t?.mode as ThemeMode) ? (t!.mode as ThemeMode) : 'light'
  const h = t?.hue
  const hue = typeof h === 'number' && Number.isInteger(h) && h >= 0 && h < 360 ? h : null
  return { mode, hue }
}

const hsl = (h: number, s: number, l: number) => `hsl(${(h + 360) % 360} ${s}% ${l}%)`
/** Yellow/green hues are pulled darker so white text on the accent stays readable. */
const bump = (h: number) => Math.max(0, 1 - Math.abs(h - 100) / 75)

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  const sa = s / 100
  const li = l / 100
  const k = (n: number) => (n + h / 30) % 12
  const a = sa * Math.min(li, 1 - li)
  const f = (n: number) => li - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)))
  return [f(0), f(8), f(4)]
}

/** WCAG contrast of white text on hsl(h s l). */
export function contrastWithWhite(h: number, s: number, l: number): number {
  return 1.05 / (luminance([h, s, l]) + 0.05)
}

const lin = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)
export type HSL = [number, number, number]
const luminance = ([h, s, l]: HSL): number => {
  const [r, g, b] = hslToRgb(((h % 360) + 360) % 360, s, l).map(lin) as [number, number, number]
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}
/** WCAG contrast of two hsl colours. */
export function contrast(a: HSL, b: HSL): number {
  const [x, y] = [luminance(a), luminance(b)].sort((m, n) => n - m)
  return (x + 0.05) / (y + 0.05)
}

/** hsl() that keeps white text at AA (4.5:1) by darkening only as far as needed. */
export function fitWhite(h: number, s: number, l: number, min = 4.5): string {
  let li = l
  while (li > 10 && contrastWithWhite(h, s, li) < min) li -= 1
  return hsl(h, s, li)
}

/** Darkest-step search: hsl() for text that keeps `min` contrast on `bg`, darkening from l only as far as needed. */
function fitText(h: number, s: number, l: number, bg: HSL, min = 4.5): string {
  let li = l
  while (li > 10 && contrast([h, s, li], bg) < min) li -= 1
  return hsl(h, s, li)
}

/** Light-on-dark text: lightens from l only as far as needed to keep `min` contrast on `bg`. */
function fitLight(h: number, s: number, l: number, bgs: HSL[], min = 4.5): string {
  let li = l
  while (li < 90 && bgs.some((bg) => contrast([h, s, li], bg) < min)) li += 1
  return hsl(h, s, li)
}

/** Dark accent fill: white text stays AA, and where possible it also stands out (3:1) from the dark surface. */
function fitDarkAccent(h: number, s: number, l: number): string {
  const surface: HSL = [h, 24, 11]
  let li = Number(/(\d+(?:\.\d+)?)%\)$/.exec(fitWhite(h, s, l))![1])
  while (contrast([h, s, li], surface) < 3 && contrastWithWhite(h, s, li + 1) >= 4.5) li += 1
  return hsl(h, s, li)
}

export function themeVars(hue: number, dark: boolean): Record<string, string> {
  const b = bump(hue)
  // Navy bars and accent: one formula for every hue; the floor keeps the yellow/green bump from going near-black.
  const bars = {
    '--bar-a': fitWhite(hue, 83, Math.max(12, 23 - 10 * b)),
    '--bar-b': fitWhite(hue + 1, 80, Math.max(12, 18 - 6 * b)),
  }
  const common = {
    ...bars,
    '--accent-glow': hsl(hue - 5, 80, 52 - 14 * b),
    '--accent-hi': hsl(hue - 7, 87, 59 - 16 * b),
    '--accent-lo': hsl(hue + 3, 100, 20 - 4 * b),
  }
  if (dark) {
    return {
      ...common,
      '--accent': fitDarkAccent(hue, 74, 52 - 17 * b),
      // Hover fill behind white text (buttons): a touch darker than --accent, white stays AA.
      '--accent-hover': fitWhite(hue, 76, 46 - 15 * b),
      // Text accents: a light accent, lightened if needed to stay AA on the dark surfaces, down to the lightest one (--accent-soft).
      '--accent-text': fitLight(hue, 80, 62 - 12 * b, [[hue, 45, 16], [hue, 24, 14]]),
      '--accent-soft': hsl(hue, 45, 16),
      '--bg': hsl(hue, 28, 8),
      '--surface': hsl(hue, 24, 11),
      '--surface-2': hsl(hue, 24, 14),
      '--hover': hsl(hue, 26, 17),
      '--border': hsl(hue, 22, 20),
      '--border-strong': hsl(hue, 20, 29),
    }
  }
  const accentL = Math.max(12, 30 - 10 * b)
  const accent = fitWhite(hue, 86, accentL)
  return {
    ...common,
    '--accent': accent,
    '--accent-hover': fitWhite(hue, 88, Math.max(12, 23 - 7 * b), 6),
    // Text-coloured accents (links, badges): the accent, darkened if needed to stay AA on the tinted soft background.
    '--accent-text': fitText(hue, 86, Number(/(\d+(?:\.\d+)?)%\)$/.exec(accent)![1]), [hue, 80, 94]),
    '--accent-soft': hsl(hue, 80, 94),
    '--bg': hsl(hue, 42, 96),
    '--surface': hsl(hue, 40, 99),
    '--surface-2': hsl(hue, 38, 97),
    '--hover': hsl(hue, 45, 93),
    '--border': hsl(hue, 26, 88),
    '--border-strong': hsl(hue, 22, 78),
  }
}

const darkQuery = typeof matchMedia === 'function' ? matchMedia('(prefers-color-scheme: dark)') : null
let current: Theme = { mode: 'light', hue: null }
const VAR_NAMES = Object.keys(themeVars(0, false))

/** The theme currently applied (what the UI shows). */
export const currentTheme = (): Theme => current

export function applyTheme(t: Theme): void {
  current = t
  if (typeof document === 'undefined') return
  const root = document.documentElement
  // light is the default (no attribute); auto follows the OS; dark is explicit
  if (t.mode === 'light') root.removeAttribute('data-theme')
  else root.setAttribute('data-theme', t.mode)
  for (const v of VAR_NAMES) root.style.removeProperty(v)
  if (t.hue === null) return
  const dark = t.mode === 'dark' || (t.mode === 'auto' && !!darkQuery?.matches)
  for (const [k, v] of Object.entries(themeVars(t.hue, dark))) root.style.setProperty(k, v)
}

// In auto mode the tints follow the OS light/dark setting.
darkQuery?.addEventListener?.('change', () => applyTheme(current))

export function cacheTheme(t: Theme): void {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(t))
  } catch {
    /* storage unavailable: the theme just is not remembered */
  }
}

/** Apply the cached theme at startup so the first paint does not flash the wrong colours. */
export function applyCachedTheme(): void {
  try {
    const raw = localStorage.getItem(CACHE_KEY)
    if (raw) applyTheme(normalizeTheme(JSON.parse(raw) as Partial<Theme>))
  } catch {
    /* ignore */
  }
}
