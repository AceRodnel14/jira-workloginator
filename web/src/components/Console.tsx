import { useEffect, useRef } from 'react'

import type { LogLine } from '../lib/data'

export function Console({ lines, tall }: { lines: LogLine[]; tall?: boolean }) {
  const ref = useRef<HTMLPreElement>(null)
  useEffect(() => {
    const el = ref.current
    if (el) el.scrollTop = el.scrollHeight
  }, [lines.length])
  return (
    <pre ref={ref} className={`console${tall ? ' tall' : ''}`} aria-label="Console" aria-live="off" tabIndex={0}>
      {lines.map((l, i) => (
        <span key={i} className={l.error ? 'line err' : l.retry ? 'line retry' : 'line'}>
          {l.text}
          {'\n'}
        </span>
      ))}
    </pre>
  )
}
