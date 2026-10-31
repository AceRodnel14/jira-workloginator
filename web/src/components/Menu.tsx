import { useEffect, useRef, useState, type ReactNode } from 'react'

export type MenuItem = { label: ReactNode; onClick: () => void }

/** Top-right dropdown. Closes on selection, Escape, an outside press or focus leaving it. */
export function Menu({ label, items, ariaLabel = 'Menu' }: { label: ReactNode; items: MenuItem[]; ariaLabel?: string }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    const onPress = (e: Event) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('keydown', onKey)
    document.addEventListener('pointerdown', onPress)
    return () => {
      document.removeEventListener('keydown', onKey)
      document.removeEventListener('pointerdown', onPress)
    }
  }, [open])

  return (
    <div className="menu" ref={ref} onBlur={(e) => !e.currentTarget.contains(e.relatedTarget) && setOpen(false)}>
      <button type="button" className="btn small ghost" aria-label={ariaLabel} aria-haspopup="true" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        {label} <span aria-hidden="true">▾</span>
      </button>
      {open && (
        <div className="menu-list">
          {items.map((it, i) => (
            <button key={i} type="button" onClick={() => { setOpen(false); it.onClick() }}>{it.label}</button>
          ))}
        </div>
      )}
    </div>
  )
}
