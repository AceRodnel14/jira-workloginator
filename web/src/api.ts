// Typed client for the Go API. Same origin in production (embedded UI), proxied in dev.
export type Info = { base_url: string }
export type Session = { login_required: boolean; authenticated: boolean }
export type Settings = {
  jira_domain: string
  user: string
  /** Worklog authors for /multiple; [] when none (the server never sends null). */
  users: string[]
  api_email: string
  same_as_user: boolean
  api_token: string
  timezone: string
  /** Work hours per day, 1..12 (default 8): the chart reference line and the /multiple expected hours. */
  work_hours: number
}
export type WorklogRequest = Settings & { from: string; to: string }
/** POST /api/worklogs/multi body. */
export type MultiRequest = {
  jira_domain: string
  api_email: string
  api_token: string
  timezone: string
  users: string[]
  from: string
  to: string
}

export type Worklog = { date: string; start: string; end: string; end_day_offset: number; seconds: number }
export type StreamEvent =
  | { type: 'log'; msg: string }
  | { type: 'user'; display_name: string }
  | { type: 'issues'; count: number }
  | { type: 'issue'; index: number; count: number; key: string; summary: string; seconds: number; worklogs: Worklog[] }
  | { type: 'error'; msg: string; fatal: boolean }
  | { type: 'done'; issues: number; worklogs: number; seconds: number }

/**
 * Events of POST /api/worklogs/multi (NDJSON). Shared-phase events (log, issues, per-issue errors, retry lines)
 * carry no author; user, issue, done and per-user errors carry `author` (lowercase email). The run ends with
 * all_done, or with a fatal error that has no author. Several issue events may share a key (one per author).
 */
export type MultiEvent =
  | { type: 'log'; msg: string; author?: string }
  | { type: 'user'; author: string; display_name: string }
  | { type: 'issues'; count: number }
  | { type: 'issue'; author: string; index: number; count: number; key: string; summary: string; seconds: number; worklogs: Worklog[] }
  | { type: 'error'; msg: string; fatal: boolean; author?: string }
  | { type: 'done'; author: string; issues: number; worklogs: number; seconds: number }
  | { type: 'all_done'; authors: number; seconds: number }

/** Thrown for any 401: the UI goes back to the login page. */
export class UnauthorizedError extends Error {
  constructor() {
    super('Not signed in')
    this.name = 'UnauthorizedError'
  }
}

/** A non-2xx answer (the message is the server's `error` text when it sent one). */
export class HttpError extends Error {
  constructor(message: string, readonly status: number) {
    super(message)
    this.name = 'HttpError'
  }
}

async function failure(res: Response, what: string): Promise<Error> {
  if (res.status === 401) return new UnauthorizedError()
  let msg = `${what}: ${res.status}`
  try {
    const body = (await res.json()) as { error?: string }
    if (body.error) msg = body.error
  } catch {
    /* keep the status text */
  }
  return new HttpError(msg, res.status)
}

const JSON_HEADERS = { 'Content-Type': 'application/json' }

export async function getInfo(fetcher: typeof fetch = fetch): Promise<Info> {
  const res = await fetcher('/api/info')
  if (!res.ok) throw new Error(`GET /api/info: ${res.status}`)
  return (await res.json()) as Info
}

export async function getSession(fetcher: typeof fetch = fetch): Promise<Session> {
  const res = await fetcher('/api/session')
  if (!res.ok) throw await failure(res, 'GET /api/session')
  return (await res.json()) as Session
}

export async function login(password: string, fetcher: typeof fetch = fetch): Promise<void> {
  const res = await fetcher('/api/login', { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify({ password }) })
  if (res.status === 401) throw new Error('Wrong password')
  if (res.status === 429) throw new Error('Too many attempts, try again later')
  if (!res.ok) throw await failure(res, 'POST /api/login')
}

export async function logout(fetcher: typeof fetch = fetch): Promise<void> {
  const res = await fetcher('/api/logout', { method: 'POST' })
  if (!res.ok) throw await failure(res, 'POST /api/logout')
}

/** 1..12 whole hours are kept; anything else (missing, 0, 13, 7.5) becomes the default 8. */
export const normWorkHours = (n: unknown): number => (typeof n === 'number' && Number.isInteger(n) && n >= 1 && n <= 12 ? n : 8)

export async function getSettings(fetcher: typeof fetch = fetch): Promise<Settings> {
  const res = await fetcher('/api/settings')
  if (!res.ok) throw await failure(res, 'GET /api/settings')
  const body = (await res.json()) as Settings
  return { ...body, users: body.users ?? [], work_hours: normWorkHours(body.work_hours) }
}

export async function putSettings(s: Settings, fetcher: typeof fetch = fetch): Promise<void> {
  const res = await fetcher('/api/settings', { method: 'PUT', headers: JSON_HEADERS, body: JSON.stringify(s) })
  if (!res.ok) throw await failure(res, 'PUT /api/settings')
}

/**
 * Incremental NDJSON parser: feed it decoded text chunks (which may end mid-line);
 * it returns the complete lines parsed so far and keeps the partial tail.
 */
export function createNdjsonParser<T = StreamEvent>(): { push(chunk: string): T[]; flush(): T[] } {
  let buf = ''
  const parse = (line: string, out: T[]) => {
    const t = line.trim()
    if (!t) return
    try {
      out.push(JSON.parse(t) as T)
    } catch {
      /* ignore a malformed line rather than killing the stream */
    }
  }
  return {
    push(chunk) {
      buf += chunk
      const out: T[] = []
      let i: number
      while ((i = buf.indexOf('\n')) >= 0) {
        parse(buf.slice(0, i), out)
        buf = buf.slice(i + 1)
      }
      return out
    },
    flush() {
      const out: T[] = []
      parse(buf, out)
      buf = ''
      return out
    },
  }
}

async function stream<T>(path: string, req: unknown, onEvent: (e: T) => void, signal: AbortSignal, fetcher: typeof fetch): Promise<void> {
  const res = await fetcher(path, { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify(req), signal })
  if (!res.ok) throw await failure(res, `POST ${path}`)
  if (!res.body) throw new Error('No response body')
  const reader = res.body.getReader()
  const dec = new TextDecoder()
  const parser = createNdjsonParser<T>()
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    for (const e of parser.push(dec.decode(value, { stream: true }))) onEvent(e)
  }
  for (const e of parser.push(dec.decode())) onEvent(e)
  for (const e of parser.flush()) onEvent(e)
}

/**
 * POST /api/worklogs and call onEvent for every NDJSON line as it arrives.
 * Resolves when the stream ends; rejects with AbortError on cancel, UnauthorizedError on 401.
 */
export function streamWorklogs(req: WorklogRequest, onEvent: (e: StreamEvent) => void, signal: AbortSignal, fetcher: typeof fetch = fetch): Promise<void> {
  return stream('/api/worklogs', req, onEvent, signal, fetcher)
}

/** POST /api/worklogs/multi: same contract as streamWorklogs, with MultiEvent lines. */
export function streamMulti(req: MultiRequest, onEvent: (e: MultiEvent) => void, signal: AbortSignal, fetcher: typeof fetch = fetch): Promise<void> {
  return stream('/api/worklogs/multi', req, onEvent, signal, fetcher)
}
