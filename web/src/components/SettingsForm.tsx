import { useState, type FormEvent } from 'react'

import type { Settings } from '../api'
import type { Errors } from '../lib/validate'
import { Icon } from './ui'

export type FormState = { settings: Settings; from: string; to: string }

export function timezones(): string[] {
  let zones: string[] = []
  try {
    zones = (Intl as unknown as { supportedValuesOf?: (k: string) => string[] }).supportedValuesOf?.('timeZone') ?? []
  } catch {
    /* older browsers: the list stays short */
  }
  return zones.includes('Etc/UTC') ? zones : ['Etc/UTC', ...zones]
}

export const ZONES = timezones()

type Props = {
  value: FormState
  errors: Errors
  fetching: boolean
  centered: boolean
  onChange: (v: FormState) => void
  onSubmit: () => void
}

export function SettingsForm({ value, errors, fetching, centered, onChange, onSubmit }: Props) {
  const [reveal, setReveal] = useState(false)
  const zones = ZONES
  const s = value.settings
  const set = (patch: Partial<Settings>) => onChange({ ...value, settings: { ...s, ...patch } })
  const field = (k: keyof Errors) => ({ 'aria-invalid': errors[k] ? (true as const) : undefined, 'aria-describedby': errors[k] ? `err-${k}` : undefined })
  const err = (k: keyof Errors) => errors[k] && <span id={`err-${k}`} className="field-error">{errors[k]}</span>
  function submit(e: FormEvent) {
    e.preventDefault()
    onSubmit()
  }
  return (
    <form className={`card settings stack${centered ? ' centered' : ''}`} onSubmit={submit} noValidate>
      <h1>Jira Workloginator</h1>
      <label className="field">
        <span className="field-label">Jira domain</span>
        <input className="input" type="url" placeholder="https://<domain>.atlassian.net" autoComplete="off" value={s.jira_domain} onChange={(e) => set({ jira_domain: e.target.value })} {...field('jira_domain')} />
        {err('jira_domain')}
      </label>
      <label className="field">
        <span className="field-label">User (email)</span>
        <input className="input" type="email" autoComplete="off" value={s.user} onChange={(e) => set({ user: e.target.value })} {...field('user')} />
        {err('user')}
      </label>
      <div className="field">
        <label className="field-label" htmlFor="api_email">API email</label>
        <input id="api_email" className="input" type="email" autoComplete="off" disabled={s.same_as_user} value={s.same_as_user ? s.user : s.api_email} onChange={(e) => set({ api_email: e.target.value })} {...field('api_email')} />
        <label className="check">
          <input type="checkbox" checked={s.same_as_user} onChange={(e) => set({ same_as_user: e.target.checked })} /> Same as user
        </label>
        {err('api_email')}
      </div>
      <div className="field">
        <label className="field-label" htmlFor="api_token">API token</label>
        <div className="input-group">
          <input id="api_token" className="input" type={reveal ? 'text' : 'password'} autoComplete="off" value={s.api_token} onChange={(e) => set({ api_token: e.target.value })} {...field('api_token')} />
          <button type="button" className="btn ghost eye" aria-label={reveal ? 'Hide token' : 'Show token'} aria-pressed={reveal} onClick={() => setReveal((r) => !r)}>
            <Icon name={reveal ? 'eyeOff' : 'eye'} />
          </button>
        </div>
        {err('api_token')}
      </div>
      <label className="field">
        <span className="field-label">Timezone</span>
        <input className="input" list="tz-list" autoComplete="off" value={s.timezone} onChange={(e) => set({ timezone: e.target.value })} {...field('timezone')} />
        <datalist id="tz-list">
          {zones.map((z) => (
            <option key={z} value={z} />
          ))}
        </datalist>
        {err('timezone')}
      </label>
      <div className="grid2">
        <label className="field">
          <span className="field-label">From</span>
          <input className="input" type="date" value={value.from} onChange={(e) => onChange({ ...value, from: e.target.value })} {...field('from')} />
          {err('from')}
        </label>
        <label className="field">
          <span className="field-label">To</span>
          <input className="input" type="date" value={value.to} onChange={(e) => onChange({ ...value, to: e.target.value })} {...field('to')} />
          {err('to')}
        </label>
      </div>
      <div className="row">
        <button type="submit" className="btn primary" disabled={fetching}>
          {fetching ? 'Fetching...' : 'Fetch worklogs'}
        </button>
      </div>
    </form>
  )
}
