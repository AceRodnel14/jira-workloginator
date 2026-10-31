import { formatDayList, type Entry } from '../lib/data'

export function DayList({ byDay, from, to }: { byDay: Map<string, Entry[]>; from: string; to: string }) {
  return (
    <pre className="daylist" aria-label="Worklogs by day" tabIndex={0}>
      {formatDayList(byDay, from, to).join('\n')}
    </pre>
  )
}
