import { useEffect, useRef } from 'react'

export function Console({ lines }: { lines: string[] }) {
  const ref = useRef<HTMLPreElement>(null)
  useEffect(() => {
    const el = ref.current
    if (el) el.scrollTop = el.scrollHeight
  }, [lines.length])
  return (
    <pre ref={ref} className="console" aria-label="Console" aria-live="off" tabIndex={0}>
      {lines.join('\n')}
    </pre>
  )
}
