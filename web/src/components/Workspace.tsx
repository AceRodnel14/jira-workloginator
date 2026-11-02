import { useEffect, useMemo, useRef, useState } from 'react'

import { getSettings, HttpError, putSettings, streamWorklogs, UnauthorizedError, type Settings, type StreamEvent } from '../api'
import { mondayOf, monthDefaults, rangeDays, weekDays } from '../lib/dates'
import { assignColours, consoleLine, entriesByDay, highlightFor, logLine, weekLine, type Issue, type LogLine } from '../lib/data'
import { validateForm, type Errors } from '../lib/validate'
import { Console } from './Console'
import { DayList } from './DayList'
import { SettingsForm, type FormState } from './SettingsForm'
import { Transition } from './Transition'
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
  const [lines, setLines] = useState<LogLine[]>([])
  const [done, setDone] = useState(false)
  // Why the fetch stopped before `done` (null = running or finished): the transition page stays and offers Back.
  const [failure, setFailure] = useState<string | null>(null)
  const [activeDay, setActiveDay] = useState<string | null>(null)
  const [monday, setMonday] = useState('')
  const [settingsOpen, setSettingsOpen] = useState(true)
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
  const addLine = (l: string) => setLines((p) => [...p, logLine(l)])

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
    setFailure(null)
    setActiveDay(null)
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
    let fatalMsg = ''
    let failed = ''
    const acc: Issue[] = []
    const onEvent = (e: StreamEvent) => {
      const l = consoleLine(e)
      if (l) addLine(l)
      if (e.type === 'issue') {
        acc.push(e)
        setIssues([...acc])
      } else if (e.type === 'error' && e.fatal) {
        sawFatal = true
        fatalMsg = e.msg
      } else if (e.type === 'done') sawDone = true
    }
    try {
      await streamWorklogs({ ...s, ...r }, onEvent, ac.signal)
      if (!sawDone && !sawFatal) {
        failed = 'Connection lost: the stream ended before the fetch finished.'
        addLine('Interrupted: the connection ended before the fetch finished.')
      }
    } catch (e) {
      if (e instanceof UnauthorizedError) {
        onUnauthorized()
        return
      }
      if (isAbort(e) || cancelled.current) {
        failed = 'Cancelled.'
        addLine('Cancelled.')
      } else if (!(e instanceof HttpError) && !sawDone && !sawFatal) {
        failed = `Connection lost: ${errMsg(e)}`
        addLine(`Interrupted: ${errMsg(e)}`)
      } else {
        failed = errMsg(e)
        addLine(`ERROR: ${errMsg(e)}`)
      }
    }
    abortRef.current = null
    busyRef.current = false
    setFetching(false)
    if (sawDone) {
      setDone(true)
      addLine(weekLine(mondayOf(r.from), entriesByDay(acc)))
    } else setFailure(failed || fatalMsg || 'The fetch did not finish.')
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
  if (!done) return <Transition lines={lines} failure={failure} onCancel={cancel} onBack={() => setRange(undefined)} />

  const days = weekDays(monday)
  const colours = assignColours(byDay, days)
  const highlight = highlightFor(byDay, activeDay, colours)

  return (
    <div className="results">
      <details className="settings-fold" open={settingsOpen} onToggle={(e) => setSettingsOpen(e.currentTarget.open)}>
        <summary>Settings and date range</summary>
        {formEl}
      </details>
      <div className="results-grid with-days">
        <div className="results-main">
          <section className="card">
            <WeekChart byDay={byDay} from={range.from} to={range.to} monday={monday} onWeek={changeWeek} colours={colours} active={activeDay} onActive={setActiveDay} />
          </section>
          <Console lines={lines} />
        </div>
        <aside className="card days">
          <DayList byDay={byDay} days={rangeDays(range.from, range.to)} activeDay={activeDay} highlight={highlight} />
        </aside>
      </div>
    </div>
  )
}
