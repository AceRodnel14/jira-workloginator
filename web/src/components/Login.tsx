import { useState, type FormEvent } from 'react'

import { login } from '../api'
import { Logo } from './Logo'
import { ErrorNote, useAction } from './ui'

export function Login({ onDone }: { onDone: () => void }) {
  const [password, setPassword] = useState('')
  const { busy, error, run } = useAction()
  async function submit(e: FormEvent) {
    e.preventDefault()
    const ok = await run(async () => {
      await login(password)
      return true
    })
    if (ok) onDone()
  }
  return (
    <div className="auth">
      <form className="card auth-card stack" onSubmit={(e) => void submit(e)}>
        <div className="brand-block">
          <Logo height={40} />
          <h1>Jira Workloginator</h1>
        </div>
        {error && <ErrorNote error={error} />}
        <label className="field">
          <span className="field-label">Password</span>
          <input className="input" type="password" autoComplete="current-password" autoFocus required value={password} onChange={(e) => setPassword(e.target.value)} />
        </label>
        <button type="submit" className="btn primary block" disabled={busy || !password}>
          {busy ? 'Signing in...' : 'Sign in'}
        </button>
      </form>
    </div>
  )
}
