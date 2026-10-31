import { useEffect, useRef, useState } from 'react'

import { applyTheme, cacheTheme, currentTheme, DEFAULT_HUE, normalizeTheme, type Theme, type ThemeMode } from '../theme'
import { ErrorNote } from './ui'

const MODES: { value: ThemeMode; label: string }[] = [
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
  { value: 'auto', label: 'Auto' },
]
const STOPS = Array.from({ length: 13 }, (_, i) => `hsl(${i * 30} 85% 50%)`).join(', ')

/**
 * Mode and accent colour picker. Changes apply at once and are cached in this browser.
 * `onSave` persists them elsewhere (e.g. to the account on the server); when it rejects, the
 * last saved theme is restored.
 */
export function Appearance({ onSave }: { onSave?: (t: Theme) => Promise<void> }) {
  // Start from the theme that is applied right now, not from a possibly stale copy.
  const [theme, setTheme] = useState(() => currentTheme())
  const [error, setError] = useState<string | null>(null)
  const saved = useRef(theme)
  const timer = useRef<number | undefined>(undefined)
  const seq = useRef(0)
  const sliderRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    // Draw the slider track gradient through the CSSOM (inline style attributes are blocked by the CSP).
    sliderRef.current?.style.setProperty('--stops', STOPS)
    return () => window.clearTimeout(timer.current)
  }, [])

  function change(patch: Partial<Theme>) {
    const next = normalizeTheme({ ...theme, ...patch })
    setTheme(next)
    applyTheme(next)
    cacheTheme(next)
    if (!onSave) return
    window.clearTimeout(timer.current)
    const mine = ++seq.current
    timer.current = window.setTimeout(() => {
      onSave(next).then(
        () => { saved.current = next; setError(null) },
        (e: unknown) => {
          if (mine !== seq.current) return
          setError(e instanceof Error ? e.message : 'Could not save the theme')
          setTheme(saved.current)
          applyTheme(saved.current)
          cacheTheme(saved.current)
        },
      )
    }, 300)
  }

  return (
    <div className="stack">
      <div className="field">
        <span className="field-label" id="mode-label">Mode</span>
        <div className="seg" role="radiogroup" aria-labelledby="mode-label">
          {MODES.map((m) => (
            <button key={m.value} type="button" role="radio" aria-checked={theme.mode === m.value} className={theme.mode === m.value ? 'on' : ''} onClick={() => change({ mode: m.value })}>
              {m.label}
            </button>
          ))}
        </div>
        <span className="hint">Auto follows your device's light or dark setting.</span>
      </div>
      <div className="field">
        <label className="field-label" htmlFor="hue">Accent colour</label>
        <input ref={sliderRef} id="hue" className="hue" type="range" min={0} max={359} step={1} value={theme.hue ?? DEFAULT_HUE} onChange={(e) => change({ hue: Number(e.target.value) })} aria-valuetext={theme.hue === null ? 'Default' : `Hue ${theme.hue}`} />
        <div className="row between">
          <span className="hint">{theme.hue === null ? 'Default' : `Custom hue ${theme.hue}`}</span>
          <button type="button" className="btn small" disabled={theme.hue === null} onClick={() => change({ hue: null })}>Reset colour</button>
        </div>
      </div>
      {error && <ErrorNote error={error} />}
    </div>
  )
}
