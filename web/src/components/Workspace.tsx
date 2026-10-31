import { useEffect, useMemo, useRef, useState } from 'react'

import { getSettings, HttpError, putSettings, streamWorklogs, UnauthorizedError, type Settings, type StreamEvent } from '../api'
import { mondayOf, monthDefaults } from '../lib/dates'
import { consoleLine, entriesByDay, weekLine, type Issue } from '../lib/data'
import { validateForm, type Errors } from '../lib/validate'
import { Console } from './Console'
import { DayList } from './DayList'
import { SettingsForm, type FormState } from './SettingsForm'
import { WeekChart } from './WeekChart'
import { ErrorNote, Spinner, errMsg } from './ui'

const isAbort = (e: unknown) => e instanceof DOMException && e.name === 'AbortError'

type Range = { from: string; to: string }

export function Workspace({ onUnauthorized }: { onUnauthorized: () => void }) {
  const [form, setForm] = useState<FormState>()
  const [loadError, setLoadError] = useState<string>()
  const [errors, setErrors] = useState<Errors>({})
  const [fetching, setFetching] = useState(false)
  const [range, setRange] = useState<Range>()
  const [issues, setIssues] = useState<Issue[]>([])
  const [lines, setLines] = useState<string[]>([])
  const [done, setDone] = useState(false)
  const [monday, setMonday] = useState('')
  const [settingsOpen, setSettingsOpen] = useState(true)
  const abortRef = useRef<AbortController | null>(null)
  const cancelled = useRef(false)
  const busyRef = useRef(false)

  // Warn before leaving once the app view is shown (also after a submit).
  useEffect(() => {
    const h = (e: BeforeUnloadEvent) => {
      e.preventDefault()
      e.returnValue = ''
    }
    window.addEventListener('beforeunload', h)
    return () => window.removeEventListener('beforeunload', h)
  }, [])

  useEffect(() => {
    let live = true
    getSettings().then(
      (s) => live && setForm({ settings: s, ...monthDefaults() }),
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

  const byDay = useMemo(() => entriesByDay(issues), [issues])
  const addLine = (l: string) => setLines((p) => [...p, l])

  async function submit() {
    if (!form || busyRef.current) return
    const errs = validateForm(form.settings, form.from, form.to)
    setErrors(errs)
    if (Object.keys(errs).length) return
    busyRef.current = true
    const s: Settings = { ...form.settings, jira_domain: form.settings.jira_domain.trim(), timezone: form.settings.timezone.trim() }
    const ac = new AbortController()
    abortRef.current = ac
    cancelled.current = false
    const r = { from: form.from, to: form.to }
    setRange(r)
    setMonday(mondayOf(r.from))
    setIssues([])
    setLines([])
    setDone(false)
    setSettingsOpen(false)
    setFetching(true)
    try {
      await putSettings(s)
    } catch (e) {
      if (e instanceof UnauthorizedError) {
        busyRef.current = false
        abortRef.current = null
        setFetching(false)
        return onUnauthorized()
      }
      console.warn('Could not save settings:', errMsg(e))
      addLine(`WARNING: settings not saved: ${errMsg(e)}`)
    }
    let sawDone = false
    let sawFatal = false
    const acc: Issue[] = []
    const onEvent = (e: StreamEvent) => {
      const l = consoleLine(e)
      if (l) addLine(l)
      if (e.type === 'issue') {
        acc.push(e)
        setIssues([...acc])
      } else if (e.type === 'error' && e.fatal) sawFatal = true
      else if (e.type === 'done') sawDone = true
    }
    try {
      await streamWorklogs({ ...s, ...r }, onEvent, ac.signal)
      if (!sawDone && !sawFatal) addLine('Interrupted: the connection ended before the fetch finished.')
    } catch (e) {
      if (e instanceof UnauthorizedError) {
        onUnauthorized()
        return
      }
      if (isAbort(e) || cancelled.current) addLine('Cancelled.')
      else if (!(e instanceof HttpError) && !sawDone && !sawFatal) addLine(`Interrupted: ${errMsg(e)}`)
      else addLine(`ERROR: ${errMsg(e)}`)
    }
    abortRef.current = null
    busyRef.current = false
    setFetching(false)
    if (sawDone) {
      setDone(true)
      addLine(weekLine(mondayOf(r.from), entriesByDay(acc)))
    }
  }

  function cancel() {
    cancelled.current = true
    abortRef.current?.abort()
  }

  function changeWeek(m: string) {
    setMonday(m)
    addLine(weekLine(m, byDay))
  }

  if (loadError) return <ErrorNote error={loadError} />
  if (!form) return <Spinner />

  const formEl = (
    <SettingsForm value={form} errors={errors} fetching={fetching} centered={!range} onChange={setForm} onSubmit={() => void submit()} />
  )
  if (!range) return <div className="start">{formEl}</div>

  return (
    <div className="results">
      <details className="settings-fold" open={settingsOpen} onToggle={(e) => setSettingsOpen(e.currentTarget.open)}>
        <summary>Settings and date range</summary>
        {formEl}
      </details>
      {fetching && (
        <div className="row">
          <span className="spinner" aria-hidden="true" /> <span role="status">Fetching...</span>
          <button type="button" className="btn small danger" onClick={cancel}>
            Cancel
          </button>
        </div>
      )}
      <div className={`results-grid${done ? ' with-days' : ''}`}>
        <div className="results-main">
          <section className="card">
            <WeekChart byDay={byDay} from={range.from} to={range.to} monday={monday} onWeek={changeWeek} />
          </section>
          <Console lines={lines} />
        </div>
        {done && (
          <aside className="card days">
            <DayList byDay={byDay} from={range.from} to={range.to} />
          </aside>
        )}
      </div>
    </div>
  )
}
