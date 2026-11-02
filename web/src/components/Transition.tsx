import type { LogLine } from '../lib/data'
import { Console } from './Console'
import { ErrorNote } from './ui'

type Props = {
  lines: LogLine[]
  /** null while the fetch runs; otherwise why it stopped (shown with a Back button). */
  failure: string | null
  onCancel: () => void
  onBack: () => void
}

/** The page between the form and the dashboard: only the progress lines, Cancel while running, Back on failure. */
export function Transition({ lines, failure, onCancel, onBack }: Props) {
  return (
    <section className="card transition stack" aria-label="Fetching worklogs">
      {failure === null ? (
        <div className="row">
          <span className="spinner" aria-hidden="true" /> <span role="status">Fetching...</span>
          <button type="button" className="btn small danger" onClick={onCancel}>
            Cancel
          </button>
        </div>
      ) : (
        <>
          <ErrorNote error={failure} />
          <div className="row">
            <button type="button" className="btn primary" onClick={onBack}>
              Back to settings
            </button>
          </div>
        </>
      )}
      <Console lines={lines} tall />
    </section>
  )
}
