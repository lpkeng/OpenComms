// SPDX-License-Identifier: AGPL-3.0-or-later
import { useState } from 'react'

/** Text that turns into an input when clicked; saves on Enter or blur, cancels on Escape. */
export default function InlineName({ value, onSave }: { value: string; onSave: (v: string) => void }) {
  const [editing, setEditing] = useState(false)
  const [text, setText] = useState(value)
  if (!editing) {
    return (
      <span
        className="inline-name"
        title="Click to rename"
        onClick={(e) => {
          e.stopPropagation()
          setText(value)
          setEditing(true)
        }}
      >
        {value} <span className="muted small">✎</span>
      </span>
    )
  }
  const commit = () => {
    setEditing(false)
    if (text.trim() && text.trim() !== value) onSave(text.trim())
  }
  return (
    <input
      autoFocus
      value={text}
      onClick={(e) => e.stopPropagation()}
      onChange={(e) => setText(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') commit()
        if (e.key === 'Escape') setEditing(false)
      }}
    />
  )
}
