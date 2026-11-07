import { useEffect, useRef, useState } from 'react'

import { getSettings, HttpError, putSettings, streamMulti, UnauthorizedError, type MultiEvent, type Settings } from '../api'
import { monthDefaults } from '../lib/dates'
import { initialMulti, multiApiEmail, multiReducer, multiSettingsToSave, multiStatus, type MultiState } from '../lib/multi'
import { validateForm, type Errors } from '../lib/validate'
import { MultiDashboard } from './MultiDashboard'
import { SettingsForm, type FormState } from './SettingsForm'
import { Transition } from './Transition'
import { ErrorNote, Spinner, errMsg } from './ui'

const isAbort = (e: unknown) => e instanceof DOMException && e.name === 'AbortError'

type Range = { from: string; to: string }

/** /multiple: settings form with a user list, a transition page while fetching, then one dashboard section per user. */
export function MultiWorkspace({ onUnauthorized }: { onUnauthorized: () => void }) {
  const [form, setForm] = useState<FormState>()
  // The document as the server sent it: /multiple saves it back with only its own fields changed.
  const stored = useRef<Settings | undefined>(undefined)
  const [loadError, setLoadError] = useState<string>()
  const [errors, setErrors] = useState<Errors>({})
  const [fetching, setFetching] = useState(false)
  const [range, setRange] = useState<Range>()
  const [run, setRun] = useState<MultiState>(() => initialMulti([]))
  const [workHours, setWorkHours] = useState(8)
  const [done, setDone] = useState(false)
  const [failure, setFailure] = useState<string | null>(null)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const abortRef = useRef<AbortController | null>(null)
  const cancelled = useRef(false)
  const busyRef = useRef(false)

  // Warn before leaving only while a fetch runs or results are shown.
  const guard = fetching || done
  useEffect(() => {
    if (!guard) return
    const h = (e: BeforeUnloadEvent) => {
      e.preventDefault()
      e.returnValue = ''
    }
    window.addEventListener('beforeunload', h)
    return () => window.removeEventListener('beforeunload', h)
  }, [guard])

  useEffect(() => {
    let live = true
    getSettings().then(
      (s) => {
        if (!live) return
        stored.current = s
        setForm({ settings: { ...s, api_email: multiApiEmail(s) }, ...monthDefaults() })
      },
      (e: unknown) => {
        if (!live) return
        if (e instanceof UnauthorizedError) onUnauthorized()
        else setLoadError(errMsg(e))
      },
    )
    return () => {
      live = false
      abortRef.current?.abort()
    }
  }, [onUnauthorized])

  async function submit() {
    if (!form || busyRef.current) return
    const errs = validateForm(form.settings, form.from, form.to, true)
    setErrors(errs)
    if (Object.keys(errs).length) return
    busyRef.current = true
    const s: Settings = multiSettingsToSave(stored.current ?? form.settings, form.settings)
    const ac = new AbortController()
    abortRef.current = ac
    cancelled.current = false
    const r = { from: form.from, to: form.to }
    let acc = initialMulti(s.users)
    setRange(r)
    setWorkHours(s.work_hours)
    setRun(acc)
    setDone(false)
    setFailure(null)
    setSettingsOpen(false)
    setFetching(true)
    try {
      await putSettings(s)
      stored.current = s
    } catch (e) {
      if (e instanceof UnauthorizedError) {
        busyRef.current = false
        abortRef.current = null
        setFetching(false)
        return onUnauthorized()
      }
      console.warn('Could not save settings:', errMsg(e))
      acc = multiReducer(acc, { type: 'error', msg: `settings not saved: ${errMsg(e)}`, fatal: false })
      setRun(acc)
    }
    const add = (text: string) => {
      acc = { ...acc, lines: [...acc.lines, { text, error: true }] }
    }
    let ended = false
    let failed = ''
    const onEvent = (e: MultiEvent) => {
      acc = multiReducer(acc, e)
      setRun(acc)
    }
    try {
      await streamMulti({ jira_domain: s.jira_domain, api_email: s.api_email, api_token: s.api_token, timezone: s.timezone, users: s.users, ...r }, onEvent, ac.signal)
      ended = true
    } catch (e) {
      if (e instanceof UnauthorizedError) {
        onUnauthorized()
        return
      }
      if (isAbort(e) || cancelled.current) failed = 'Cancelled.'
      else if (e instanceof HttpError) failed = errMsg(e)
      else {
        ended = true
        failed = `Connection lost: ${errMsg(e)}`
      }
      add(failed.startsWith('Connection') ? `Interrupted: ${errMsg(e)}` : failed === 'Cancelled.' ? 'Cancelled.' : `ERROR: ${failed}`)
    }
    abortRef.current = null
    busyRef.current = false
    setFetching(false)
    const status = multiStatus(acc, ended)
    if (status === 'complete') setDone(true)
    else if (!failed) {
      failed = status === 'fatal' ? acc.fatal! : 'Connection lost: the stream ended before the run finished.'
      if (status === 'lost') add('Interrupted: the stream ended before the run finished.')
    }
    setRun(acc)
    if (status !== 'complete') setFailure(failed)
  }

  function cancel() {
    cancelled.current = true
    abortRef.current?.abort()
  }

  if (loadError) return <ErrorNote error={loadError} />
  if (!form) return <Spinner />

  const formEl = <SettingsForm multi value={form} errors={errors} fetching={fetching} centered={!range} onChange={setForm} onSubmit={() => void submit()} />
  if (!range) return <div className="start">{formEl}</div>
  if (!done) return <Transition lines={run.lines} failure={failure} onCancel={cancel} onBack={() => setRange(undefined)} />

  return (
    <div className="results">
      <details className="settings-fold no-print" open={settingsOpen} onToggle={(e) => setSettingsOpen(e.currentTarget.open)}>
        <summary>Settings and date range</summary>
        {formEl}
      </details>
      <MultiDashboard key={`${range.from}${range.to}${run.users.length}`} from={range.from} to={range.to} users={run.users} workHours={workHours} />
    </div>
  )
}
