export type ChartView = 'day' | 'week'

const VIEWS: { value: ChartView; label: string }[] = [
  { value: 'day', label: 'Per day' },
  { value: 'week', label: 'Per week' },
]

/** Segmented two-button control; aria-pressed marks the current view. */
export function ChartViewToggle({ value, onChange }: { value: ChartView; onChange: (v: ChartView) => void }) {
  return (
    <div className="seg chart-view" role="group" aria-label="Chart view">
      {VIEWS.map((v) => (
        <button key={v.value} type="button" aria-pressed={value === v.value} className={value === v.value ? 'on' : ''} onClick={() => onChange(v.value)}>
          {v.label}
        </button>
      ))}
    </div>
  )
}
