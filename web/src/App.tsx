import { useCallback, useEffect, useState } from 'react'

import { getSession, logout, UnauthorizedError, type Session } from './api'
import { Appearance } from './components/Appearance'
import { Login } from './components/Login'
import { Logo } from './components/Logo'
import { Menu } from './components/Menu'
import { MultiWorkspace } from './components/MultiWorkspace'
import { Workspace } from './components/Workspace'
import { ErrorNote, Icon, Modal, Spinner, errMsg } from './components/ui'

export function App() {
  const [session, setSession] = useState<Session>()
  const [error, setError] = useState<string>()
  const [appearance, setAppearance] = useState(false)
  const multi = window.location.pathname === '/multiple'

  const load = useCallback(() => {
    getSession().then(setSession, (e: unknown) => setError(errMsg(e)))
  }, [])
  useEffect(load, [load])

  const toLogin = useCallback(() => setSession({ login_required: true, authenticated: false }), [])

  async function doLogout() {
    try {
      await logout()
    } catch (e) {
      if (!(e instanceof UnauthorizedError)) console.warn('Logout failed:', errMsg(e))
    }
    toLogin()
  }

  if (error) return <main className="page"><ErrorNote error={error} onRetry={() => { setError(undefined); load() }} /></main>
  if (!session) return <main className="page"><Spinner /></main>
  if (session.login_required && !session.authenticated) return <Login onDone={() => setSession({ ...session, authenticated: true })} />

  return (
    <>
      <header className="topbar">
        <span className="brand">
          <Logo height={28} /> Jira Workloginator
        </span>
        <span className="row">
          {session.login_required && (
            <button type="button" className="btn ghost" onClick={() => void doLogout()}>
              <Icon name="logout" /> Logout
            </button>
          )}
          <Menu label="Menu" items={[
              multi ? { label: 'Single user', href: '/' } : { label: 'Multiple users', href: '/multiple' },
              { label: 'Appearance', onClick: () => setAppearance(true) },
            ]} />
        </span>
      </header>
      <main className="page wide">
        {multi ? <MultiWorkspace onUnauthorized={toLogin} /> : <Workspace onUnauthorized={toLogin} />}
      </main>
      {appearance && (
        <Modal title="Appearance" onClose={() => setAppearance(false)}>
          <Appearance />
        </Modal>
      )}
    </>
  )
}
