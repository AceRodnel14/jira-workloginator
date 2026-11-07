import { expect, test } from 'vitest'

import { getInfo, getSettings } from './api'

test('getInfo returns the API answer', async () => {
  const body = { base_url: 'http://localhost:8080' }
  const fetcher = (async () => Response.json(body)) as typeof fetch
  await expect(getInfo(fetcher)).resolves.toEqual(body)
})

test('getInfo fails on an error status', async () => {
  const fetcher = (async () => new Response('', { status: 503 })) as typeof fetch
  await expect(getInfo(fetcher)).rejects.toThrow('503')
})

import { createNdjsonParser, HttpError, streamWorklogs, UnauthorizedError, type WorklogRequest } from './api'

test('ndjson parser buffers partial lines across chunks', () => {
  const p = createNdjsonParser()
  expect(p.push('{"type":"log","msg":"he')).toEqual([])
  expect(p.push('llo"}\n{"type":"issues","count":2}\n{"type":"do')).toEqual([
    { type: 'log', msg: 'hello' },
    { type: 'issues', count: 2 },
  ])
  expect(p.push('ne","issues":2,"worklogs":0,"seconds":0}\n')).toEqual([{ type: 'done', issues: 2, worklogs: 0, seconds: 0 }])
  expect(p.flush()).toEqual([])
})

test('ndjson parser handles a final line without newline and skips junk', () => {
  const p = createNdjsonParser()
  expect(p.push('garbage\n\n{"type":"log","msg":"a"}')).toEqual([])
  expect(p.flush()).toEqual([{ type: 'log', msg: 'a' }])
})

const req = {} as WorklogRequest

test('streamWorklogs surfaces a 400 as HttpError with the server message, before any event', async () => {
  const events: unknown[] = []
  const fetcher = (async () => Response.json({ error: 'The range may cover at most 366 days.' }, { status: 400 })) as typeof fetch
  const p = streamWorklogs(req, (e) => events.push(e), new AbortController().signal, fetcher)
  await expect(p).rejects.toBeInstanceOf(HttpError)
  await expect(p).rejects.toThrow('366 days')
  expect(events).toEqual([])
})

test('streamWorklogs maps 401 to UnauthorizedError', async () => {
  const fetcher = (async () => new Response('', { status: 401 })) as typeof fetch
  await expect(streamWorklogs(req, () => {}, new AbortController().signal, fetcher)).rejects.toBeInstanceOf(UnauthorizedError)
})

test('getSettings normalises work_hours: 1..12 kept, anything else becomes 8', async () => {
  const get = (wh?: number) => getSettings((async () => Response.json({ jira_domain: '', user: '', users: [], api_email: '', same_as_user: true, api_token: '', timezone: 'Etc/UTC', work_hours: wh })) as typeof fetch)
  expect((await get()).work_hours).toBe(8)
  expect((await get(0)).work_hours).toBe(8)
  expect((await get(13)).work_hours).toBe(8)
  expect((await get(6)).work_hours).toBe(6)
  expect((await get(12)).work_hours).toBe(12)
})
