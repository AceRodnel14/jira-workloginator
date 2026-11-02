import { useRef, useState, type ClipboardEvent, type KeyboardEvent } from 'react'

import { addEmails, chipKeyAction } from '../lib/validate'

type Props = {
  id: string
  value: string[]
  onChange: (users: string[]) => void
  disabled?: boolean
  invalid?: boolean
  describedBy?: string
}

/** Email list input: Enter, comma or paste adds; x or Backspace on empty removes. Trims, ignores duplicates, needs an '@'. */
export function ChipInput({ id, value, onChange, disabled, invalid, describedBy }: Props) {
  const [text, setText] = useState('')
  const [error, setError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  function commit(raw: string) {
    if (raw.trim() === '') {
      setText('')
      setError(null)
      return
    }
    const r = addEmails(value, raw)
    if (r.list.length !== value.length) onChange(r.list)
    setText(r.rest)
    setError(r.error)
  }

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    const action = chipKeyAction(e.key, text, value.length)
    if (action === 'commit') {
      e.preventDefault() // Enter must not submit the form
      commit(text)
    } else if (action === 'removeLast') {
      onChange(value.slice(0, -1))
      setError(null)
    }
  }

  function onPaste(e: ClipboardEvent<HTMLInputElement>) {
    const pasted = e.clipboardData.getData('text')
    if (/[\s,;]/.test(pasted.trim())) {
      e.preventDefault()
      commit(`${text} ${pasted}`)
    }
  }

  const errId = `${id}-error`
  return (
    <div>
      <div className={`chips${error || invalid ? ' invalid' : ''}`} onClick={() => inputRef.current?.focus()}>
        {value.map((u) => (
          <span key={u} className="chip">
            {u}
            <button type="button" aria-label={`Remove ${u}`} disabled={disabled} onClick={() => onChange(value.filter((x) => x !== u))}>
              ×
            </button>
          </span>
        ))}
        <input
          ref={inputRef}
          id={id}
          type="text"
          inputMode="email"
          value={text}
          disabled={disabled}
          autoComplete="off"
          spellCheck={false}
          placeholder={value.length ? '' : 'name@example.com, press Enter'}
          aria-invalid={error || invalid ? true : undefined}
          aria-describedby={error ? errId : describedBy}
          onChange={(e) => {
            setText(e.target.value)
            if (error) setError(null)
          }}
          onKeyDown={onKeyDown}
          onPaste={onPaste}
          onBlur={() => commit(text)}
        />
      </div>
      {error && (
        <span id={errId} className="field-error" role="alert">
          {error}
        </span>
      )}
    </div>
  )
}
